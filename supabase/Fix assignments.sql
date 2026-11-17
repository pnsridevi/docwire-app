-- =====================================================================
-- Fix assignments.sql   (PROPOSED, 17 Nov 2026: not applied anywhere yet)
-- Run once in the Supabase SQL Editor, AFTER "Fix admins and seats.sql".
-- Closes P-12 to P-16 (Findings tab of "DocWire — Test Case Register").
--
--   1. Who can be assigned (P-12, P-13, P-14)
--        A Client's Manager must be an active Manager, and the Accountant
--        an active Accountant, of the organisation's own firm. The same
--        goes for each organisation's default Manager and Accountant.
--        A Client's assignment row stays with that Client and in that
--        Client's own organisation.
--   2. Organisation defaults can be set or changed, not removed (P-15).
--   3. The change record (P-16)
--        "Last changed by" and the time are filled in by the database.
--        A history line is written only when the Manager or Accountant
--        actually changes.
--
-- Safe to run more than once. Changes no existing rows.
-- Before running, the check at the bottom lists any existing rows that
-- break the new rule (it should list none).
-- Undo: see the bottom of this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Who can be assigned (replaces the "active staff only" check)
-- ---------------------------------------------------------------------
create or replace function public.assignments_require_active_staff()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_staff users;
  v_client users;
  v_manager uuid;
  v_accountant uuid;
begin
  select tenant_id into v_tenant from client_organizations where id = new.client_org_id;
  if not found then
    return new;  -- the foreign key reports a missing organisation
  end if;

  if tg_table_name = 'client_assignments' then
    if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
      raise exception 'An assignment stays with its Client. Change the Manager or Accountant instead.';
    end if;
    select * into v_client from users where id = new.client_id;
    if not found or v_client.role <> 'client' or v_client.client_org_id is distinct from new.client_org_id then
      raise exception 'An assignment must be in the Client''s own organisation.';
    end if;
  end if;

  if tg_table_name in ('client_assignments', 'manager_assignments') then
    v_manager := new.manager_id;
  end if;
  if tg_table_name in ('client_assignments', 'accountant_assignments') then
    v_accountant := new.accountant_id;
  end if;

  if v_manager is not null then
    select * into v_staff from users where id = v_manager;
    if not found or v_staff.role <> 'manager' or v_staff.tenant_id is distinct from v_tenant then
      raise exception 'Only a Manager of this firm can be assigned as Manager.';
    end if;
    if v_staff.deactivated_at is not null then
      raise exception 'That Manager has been deactivated and can''t be assigned.';
    end if;
  end if;

  if v_accountant is not null then
    select * into v_staff from users where id = v_accountant;
    if not found or v_staff.role <> 'accountant' or v_staff.tenant_id is distinct from v_tenant then
      raise exception 'Only an Accountant of this firm can be assigned as Accountant.';
    end if;
    if v_staff.deactivated_at is not null then
      raise exception 'That Accountant has been deactivated and can''t be assigned.';
    end if;
  end if;

  -- 3. The change record: who and when come from the database, not the app.
  if tg_table_name = 'client_assignments' and auth.uid() is not null then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;
-- The three triggers that call this function already exist
-- (client_assignments_require_active_staff, manager_assignments_require_active_staff,
-- accountant_assignments_require_active_staff); they pick up the new version.

-- ---------------------------------------------------------------------
-- 2. Organisation defaults can't be removed (P-15)
-- ---------------------------------------------------------------------
drop policy if exists "manager_assignments_delete_super_admin" on public.manager_assignments;
drop policy if exists "accountant_assignments_delete_super_admin" on public.accountant_assignments;

-- ---------------------------------------------------------------------
-- 3. History only for real changes (P-16)
-- ---------------------------------------------------------------------
create or replace function public.log_client_assignment_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.manager_id is not distinct from old.manager_id
     and new.accountant_id is not distinct from old.accountant_id
     and new.client_org_id is not distinct from old.client_org_id then
    return new;  -- nothing changed that the history records
  end if;
  insert into client_assignment_history (
    client_id, client_org_id,
    old_manager_id, new_manager_id,
    old_accountant_id, new_accountant_id,
    changed_by
  ) values (
    new.client_id, new.client_org_id,
    case when tg_op = 'UPDATE' then old.manager_id else null end, new.manager_id,
    case when tg_op = 'UPDATE' then old.accountant_id else null end, new.accountant_id,
    auth.uid()
  );
  return new;
end $$;

-- =====================================================================
-- Check existing rows (read-only; run it on its own before and after).
-- It lists any assignment that the new rule would refuse. Expect no rows.
--
--   select 'Client row' as kind, o.name as organisation, c.name as client,
--          m.name as manager, m.role as manager_role, a.name as accountant, a.role as accountant_role
--     from client_assignments ca
--     join client_organizations o on o.id = ca.client_org_id
--     join users c on c.id = ca.client_id
--     join users m on m.id = ca.manager_id
--     join users a on a.id = ca.accountant_id
--    where c.client_org_id is distinct from ca.client_org_id
--       or m.role <> 'manager' or m.tenant_id <> o.tenant_id
--       or a.role <> 'accountant' or a.tenant_id <> o.tenant_id
--   union all
--   select 'Org default', o.name, null, m.name, m.role, null, null
--     from manager_assignments ma join client_organizations o on o.id = ma.client_org_id
--     join users m on m.id = ma.manager_id
--    where m.role <> 'manager' or m.tenant_id <> o.tenant_id
--   union all
--   select 'Org default', o.name, null, null, null, a.name, a.role
--     from accountant_assignments aa join client_organizations o on o.id = aa.client_org_id
--     join users a on a.id = aa.accountant_id
--    where a.role <> 'accountant' or a.tenant_id <> o.tenant_id;
--
-- Undo (run these to take the changes out):
--   run the assignments_require_active_staff part of "Add user deactivation.sql" again,
--   and the log_client_assignment_change part of "Client assignment foundation.sql";
--   then put the two delete rules back:
--   create policy "manager_assignments_delete_super_admin" on public.manager_assignments for delete
--     using (current_user_role() = 'super_admin' and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant()));
--   create policy "accountant_assignments_delete_super_admin" on public.accountant_assignments for delete
--     using (current_user_role() = 'super_admin' and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant()));
-- =====================================================================