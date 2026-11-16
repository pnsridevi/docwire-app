-- =====================================================================
-- Fix admins and seats.sql
-- Run once in the Supabase SQL Editor, AFTER "Fix P1 to P7.sql".
-- Closes P-8 to P-11 (Findings tab of "DocWire — Test Case Register")
-- and puts in the decisions of 16 Nov 2026:
--   * An organisation can have several Client Admins; they are equal.
--   * Only Clients use seats. Client Admins never do.
--   * Several Super Admins are equal; a Super Admin can add another.
--
--   1. Seat rule in the database (P-8, P-9)
--        Saving a new active Client, or reactivating one, locks the
--        organisation, counts its active Clients and refuses when full.
--        Two requests at the same moment can no longer both take the
--        last seat. Applies to everyone, Edge Functions included.
--   2. set_user_active: seats are checked only for Clients (P-9).
--      The last active Client Admin of an organisation that still has
--      active Clients can't be deactivated.
--   3. get_deactivation_blockers: lists that as a blocker
--      (client_admin_needed), so the screen can explain it.
--   4. Seat limit must be at least 1.
--   5. is_document_file_in_use moves to dw_private, which the app's
--      API does not publish (P-11). The storage rules keep using it.
--   6. A Super Admin's direct edits on staff rows are limited to the
--      "firm-wide staff" switch (name and email would no longer match
--      the login otherwise).
--
-- Safe to run more than once. Changes no existing rows.
-- Undo: see the bottom of this file.
-- =====================================================================

create schema if not exists dw_private;
revoke all on schema dw_private from public, anon;
grant usage on schema dw_private to authenticated;

-- ---------------------------------------------------------------------
-- 1. Seat rule (P-8, P-9)
-- ---------------------------------------------------------------------
create or replace function dw_private.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org  client_organizations;
  v_used integer;
begin
  -- Only an active Client takes a seat.
  if new.role <> 'client' or new.deactivated_at is not null or new.client_org_id is null then
    return new;
  end if;
  -- On an update, only when the person starts taking a seat here.
  if tg_op = 'UPDATE' and old.role = 'client' and old.deactivated_at is null
     and old.client_org_id is not distinct from new.client_org_id then
    return new;
  end if;

  -- Lock the organisation so two saves at the same moment wait for each other.
  select * into v_org from client_organizations where id = new.client_org_id for update;
  if not found then
    return new;  -- the foreign key reports a missing organisation
  end if;

  select count(*) into v_used from users
   where client_org_id = new.client_org_id and role = 'client'
     and deactivated_at is null and id <> new.id;

  if v_used >= v_org.seat_limit then
    raise exception 'No free seat in % (% of % Client seats used). Free a seat or ask Super Admin to raise the limit first.',
      v_org.name, v_used, v_org.seat_limit;
  end if;
  return new;
end $$;
revoke all on function dw_private.enforce_seat_limit() from public, anon, authenticated;

drop trigger if exists users_zz_seat_limit on public.users;
create trigger users_zz_seat_limit
  before insert or update of role, client_org_id, deactivated_at on public.users
  for each row execute function dw_private.enforce_seat_limit();

-- ---------------------------------------------------------------------
-- 2. Deactivate / reactivate
-- ---------------------------------------------------------------------
create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target users;
  v_blockers jsonb;
  v_org client_organizations;
  v_used integer;
  v_parts text[] := array[]::text[];
begin
  select * into v_target from users where id = p_user_id for update;
  if not found or not can_manage_user_status(v_target) then
    raise exception 'You can''t manage this person''s account.';
  end if;

  if p_active then
    if v_target.deactivated_at is null then
      return; -- already active
    end if;
    -- Only Clients use seats (the seat trigger checks again, under a lock).
    if v_target.role = 'client' then
      select * into v_org from client_organizations where id = v_target.client_org_id;
      select count(*) into v_used from users
       where client_org_id = v_target.client_org_id and role = 'client' and deactivated_at is null;
      if v_used >= v_org.seat_limit then
        raise exception 'No free seat in % (% of % Client seats used). Free a seat or ask Super Admin to raise the limit first.',
          v_org.name, v_used, v_org.seat_limit;
      end if;
    end if;
    update users set deactivated_at = null, deactivated_by = null where id = p_user_id;
    return;
  end if;

  -- Deactivate
  if v_target.deactivated_at is not null then
    return; -- already deactivated
  end if;
  if v_target.role = 'super_admin' and not exists (
       select 1 from users u where u.tenant_id = v_target.tenant_id and u.role = 'super_admin'
         and u.id <> v_target.id and u.deactivated_at is null) then
    raise exception 'This is the last active Super Admin, so it can''t be deactivated.';
  end if;

  v_blockers := get_deactivation_blockers(p_user_id);
  if (v_blockers->>'client_admin_needed')::boolean then
    raise exception '% is the last active Client Admin of an organisation that still has active Clients. Add another Client Admin first.',
      coalesce(v_target.name, 'This person');
  end if;
  if jsonb_array_length(v_blockers->'open_tasks') > 0 then
    v_parts := v_parts || (jsonb_array_length(v_blockers->'open_tasks') || ' open task(s)');
  end if;
  if jsonb_array_length(v_blockers->'client_assignments') > 0 then
    v_parts := v_parts || (jsonb_array_length(v_blockers->'client_assignments') || ' assigned Client(s)');
  end if;
  if jsonb_array_length(v_blockers->'org_defaults') > 0 then
    v_parts := v_parts || (jsonb_array_length(v_blockers->'org_defaults') || ' organisation default(s)');
  end if;
  if jsonb_array_length(v_blockers->'rework_documents') > 0 then
    v_parts := v_parts || (jsonb_array_length(v_blockers->'rework_documents') || ' document(s) waiting for a reupload');
  end if;
  if array_length(v_parts, 1) > 0 then
    raise exception '% can''t be deactivated yet: %. Sort these out first.',
      coalesce(v_target.name, 'This person'), array_to_string(v_parts, ', ');
  end if;

  update users set deactivated_at = now(), deactivated_by = auth.uid() where id = p_user_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. What blocks a deactivation (adds client_admin_needed)
-- ---------------------------------------------------------------------
create or replace function public.get_deactivation_blockers(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_target users;
  v_only_admin boolean;
  v_has_clients boolean;
begin
  select * into v_target from users where id = p_user_id;
  if not found or not can_manage_user_status(v_target) then
    raise exception 'You can''t manage this person''s account.';
  end if;

  v_only_admin := v_target.role = 'client_admin' and not exists (
    select 1 from users u
    where u.client_org_id = v_target.client_org_id and u.role = 'client_admin'
      and u.id <> v_target.id and u.deactivated_at is null);
  v_has_clients := exists (
    select 1 from users u
    where u.client_org_id = v_target.client_org_id and u.role = 'client' and u.deactivated_at is null);

  return jsonb_build_object(
    'open_tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'client_name', c.name,
        'client_org_name', t.client_org_name,
        'due_date', t.due_date,
        'recurring', t.recurring,
        'status', t.status,
        'reassigned_by', coalesce(m.name, 'Super Admin')
      ) order by t.due_date nulls last, t.title)
      from tasks t
      left join users c on c.id = t.client_id
      left join client_assignments ca on ca.client_id = t.client_id
      left join users m on m.id = ca.manager_id
      where t.assignee_id = p_user_id and is_task_open(t)
    ), '[]'::jsonb),
    'client_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_name', c.name,
        'client_org_name', o.name,
        'as', case when ca.manager_id = p_user_id then 'Manager' else 'Accountant' end
      ) order by o.name, c.name)
      from client_assignments ca
      join users c on c.id = ca.client_id
      join client_organizations o on o.id = ca.client_org_id
      where ca.manager_id = p_user_id or ca.accountant_id = p_user_id
    ), '[]'::jsonb),
    'org_defaults', coalesce((
      select jsonb_agg(x order by x->>'client_org_name') from (
        select jsonb_build_object('client_org_name', o.name, 'as', 'Manager') as x
          from manager_assignments ma join client_organizations o on o.id = ma.client_org_id
          where ma.manager_id = p_user_id
        union all
        select jsonb_build_object('client_org_name', o.name, 'as', 'Accountant')
          from accountant_assignments aa join client_organizations o on o.id = aa.client_org_id
          where aa.accountant_id = p_user_id
      ) d
    ), '[]'::jsonb),
    'rework_documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
      from documents d
      where d.client_id = p_user_id and d.status = 'rework'
        and d.reupload_requested and not d.reupload_fulfilled
    ), '[]'::jsonb),
    -- Blocker: the last Client Admin while the organisation still has Clients.
    'client_admin_needed', v_only_admin and v_has_clients,
    -- Warning only: the last Client Admin of an organisation with no Clients left.
    'only_client_admin', v_only_admin and not v_has_clients
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. Seat limit at least 1
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_organizations_seat_limit_min') then
    alter table public.client_organizations
      add constraint client_organizations_seat_limit_min check (seat_limit >= 1);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Hide the file-path helper from the app's API (P-11)
--    Storage rules point at the function itself, not at its name, so
--    they keep working after the move.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'is_document_file_in_use') then
    alter function public.is_document_file_in_use(text) set schema dw_private;
  end if;
end $$;
revoke all on function dw_private.is_document_file_in_use(text) from public, anon;
grant execute on function dw_private.is_document_file_in_use(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Direct edits on a person's row: only the "firm-wide staff" switch
--    (the one thing the app changes there). Role, firm, organisation
--    and deactivation already had their own guard; this adds name,
--    email and the rest. Deactivate/Reactivate, account creation and
--    the password change are not affected (they don't run as the
--    signed-in user).
-- ---------------------------------------------------------------------
create or replace function dw_private.users_only_firm_wide_switch()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (to_jsonb(new) - 'firm_wide_staff' - 'must_change_password')
         is distinct from (to_jsonb(old) - 'firm_wide_staff' - 'must_change_password') then
    raise exception 'Only the firm-wide staff setting can be changed here.';
  end if;
  return new;
end $$;
revoke all on function dw_private.users_only_firm_wide_switch() from public, anon;
grant execute on function dw_private.users_only_firm_wide_switch() to authenticated;

drop trigger if exists users_zy_only_firm_wide_switch on public.users;
create trigger users_zy_only_firm_wide_switch
  before update on public.users
  for each row execute function dw_private.users_only_firm_wide_switch();

-- =====================================================================
-- Undo (run these lines to take the changes out):
--   drop trigger users_zz_seat_limit on public.users;
--   drop trigger users_zy_only_firm_wide_switch on public.users;
--   alter table public.client_organizations drop constraint client_organizations_seat_limit_min;
--   alter function dw_private.is_document_file_in_use(text) set schema public;
--   then run the set_user_active and get_deactivation_blockers parts of
--   "Add user deactivation.sql" again.
-- =====================================================================