-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Add_user_deactivation.sql
-- Run after every previous migration, including
-- Update_master_documents_permissions.sql. Safe to run once.
--
-- P6, as agreed 7 Oct 2026:
--
-- Deactivate instead of delete. A deactivated person can't sign in
-- (the login itself is blocked by the admin-set-user-active Edge
-- Function), loses ALL database access immediately — even on a phone
-- that is still signed in — leaves every picker, and frees their seat.
-- Everything they uploaded or created stays, with their name on it.
--
--   Who      Super Admin: anyone in the firm except themselves and the
--            last active Super Admin. Client Admin: Clients of their
--            own organisation only.
--   Blocked  until the person has no open tasks (recurring included);
--            for a Manager/Accountant, until no Client is assigned to
--            them and no organisation has them as its default; for a
--            Client, until none of their documents is waiting for them
--            to reupload after Rework. get_deactivation_blockers() lists
--            exactly what is in the way.
--   Seats    Deactivated users don't count. Reactivating is refused if
--            the organisation is full.
--
-- Tasks:
--   - When a Client's Manager or Accountant changes (for any reason),
--     that Client's open tasks assigned to the old person in that role
--     move to the new person automatically, with a line in the task's
--     new activity history.
--   - Reassigning by hand goes through reassign_task(): the Client's
--     current Manager (tasks about their Clients) or Super Admin (any
--     task, including ones not about a Client).
--   - The Client's Manager or Super Admin can close, or stop the
--     repeating of, a task whose creator or assignee has been
--     deactivated (supervise_task()).
--   - Loophole closed: tasks_update_participant let a task's creator or
--     assignee change ANY column with a crafted request (reassign it to
--     anyone, move it to another Client or organisation). Direct edits
--     are now limited to what the app actually does — the status and
--     the linked document. Everything else goes through the checked
--     functions above.
--
-- Also closed: Super Admin's users UPDATE policy (for the Firm-wide
-- switch) allowed changing any column of a staff row directly, which
-- could have bypassed every deactivation check. Direct edits can no
-- longer touch status, role, firm or organisation.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Status columns + "is the current person active?"
-- ------------------------------------------------------------

alter table public.users
  add column if not exists deactivated_at timestamptz null,
  add column if not exists deactivated_by uuid null references public.users(id);

create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from users where id = auth.uid() and deactivated_at is null);
$$;

-- "Active" for any user id (pickers, checks below).
create or replace function public.is_user_active(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from users where id = p_user_id and deactivated_at is null);
$$;


-- ------------------------------------------------------------
-- 2. Direct edits to users can't change status, role, firm or
-- organisation. (The Edge Functions use the service role, and the
-- functions below run as the owner — neither is affected.)
-- ------------------------------------------------------------

create or replace function public.users_guard_direct_update()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and (
       new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.client_org_id is distinct from old.client_org_id
    or new.role is distinct from old.role
    or new.deactivated_at is distinct from old.deactivated_at
    or new.deactivated_by is distinct from old.deactivated_by
  ) then
    raise exception 'That change has to go through Deactivate/Reactivate or account creation.';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_direct_update on public.users;
create trigger users_guard_direct_update
  before update on public.users
  for each row execute function public.users_guard_direct_update();


-- ------------------------------------------------------------
-- 3. Task activity history (new). Written only by the functions and
-- trigger below. Readable by anyone who can see the task.
-- ------------------------------------------------------------

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  action text not null check (action in ('reassigned', 'closed', 'stopped_repeating')),
  details text not null,
  actor_id uuid null,
  actor_name text null,
  created_at timestamptz not null default now()
);

create index if not exists task_activity_task_idx on public.task_activity (task_id);

alter table public.task_activity enable row level security;

drop policy if exists "task_activity_select" on public.task_activity;
create policy "task_activity_select" on public.task_activity
  for select using (exists (select 1 from public.tasks t where t.id = task_activity.task_id));


-- ------------------------------------------------------------
-- 4. Immediate cut-off: one RESTRICTIVE policy per table. Postgres
-- applies a restrictive policy ON TOP of every other policy, so a
-- deactivated person can't read or write anything, whichever rule
-- would otherwise have let them — including rules added in future.
-- Exception: a person can still read their OWN users row, so the app
-- can see they've been deactivated and sign them out with a message.
-- ------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname <> 'users'
  loop
    execute format('drop policy if exists "zz_active_users_only" on public.%I', t.relname);
    execute format(
      'create policy "zz_active_users_only" on public.%I as restrictive for all to authenticated
         using ((select public.is_active_user())) with check ((select public.is_active_user()))',
      t.relname);
  end loop;
end $$;

drop policy if exists "zz_active_users_only" on public.users;
create policy "zz_active_users_only" on public.users
  as restrictive for all to authenticated
  using ((select public.is_active_user()) or id = auth.uid())
  with check ((select public.is_active_user()));

drop policy if exists "zz_active_users_only" on storage.objects;
create policy "zz_active_users_only" on storage.objects
  as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));


-- ------------------------------------------------------------
-- 5. Nobody deactivated can be newly chosen: as a task assignee, a
-- direct-share recipient, or a Manager/Accountant (per Client or as an
-- organisation's default).
-- ------------------------------------------------------------

create or replace function public.tasks_require_active_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not is_user_active(new.assignee_id) then
    raise exception 'This person has been deactivated and can''t be given tasks.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_require_active_assignee on public.tasks;
create trigger tasks_require_active_assignee
  before insert or update on public.tasks
  for each row execute function public.tasks_require_active_assignee();

create or replace function public.documents_require_active_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shared_with_user_id is not null
     and (tg_op = 'INSERT' or new.shared_with_user_id is distinct from old.shared_with_user_id)
     and not is_user_active(new.shared_with_user_id) then
    raise exception 'This person has been deactivated and can''t be sent documents.';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_require_active_recipient on public.documents;
create trigger documents_require_active_recipient
  before insert or update on public.documents
  for each row execute function public.documents_require_active_recipient();

create or replace function public.assignments_require_active_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager uuid;
  v_accountant uuid;
begin
  if tg_table_name in ('client_assignments', 'manager_assignments') then
    v_manager := new.manager_id;
  end if;
  if tg_table_name in ('client_assignments', 'accountant_assignments') then
    v_accountant := new.accountant_id;
  end if;
  if v_manager is not null and not is_user_active(v_manager) then
    raise exception 'That Manager has been deactivated and can''t be assigned.';
  end if;
  if v_accountant is not null and not is_user_active(v_accountant) then
    raise exception 'That Accountant has been deactivated and can''t be assigned.';
  end if;
  return new;
end;
$$;

drop trigger if exists client_assignments_require_active_staff on public.client_assignments;
create trigger client_assignments_require_active_staff
  before insert or update on public.client_assignments
  for each row execute function public.assignments_require_active_staff();

drop trigger if exists manager_assignments_require_active_staff on public.manager_assignments;
create trigger manager_assignments_require_active_staff
  before insert or update on public.manager_assignments
  for each row execute function public.assignments_require_active_staff();

drop trigger if exists accountant_assignments_require_active_staff on public.accountant_assignments;
create trigger accountant_assignments_require_active_staff
  before insert or update on public.accountant_assignments
  for each row execute function public.assignments_require_active_staff();


-- ------------------------------------------------------------
-- 6. Direct task edits limited to what the app does: status and the
-- linked document. SECURITY INVOKER on purpose, so current_user is the
-- requester's role: 'authenticated' for a request from the app, the
-- owner for the checked functions/trigger/daily jobs (which pass).
-- ------------------------------------------------------------

create or replace function public.tasks_guard_direct_update()
returns trigger
language plpgsql
as $$
declare
  allowed text[] := array['status', 'linked_document_id', 'linked_document_name', 'linked_document_needs_entry'];
begin
  if current_user = 'authenticated'
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Only the status and the linked document of a task can be changed directly. To give the task to someone else, use Reassign.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_direct_update on public.tasks;
create trigger tasks_guard_direct_update
  before update on public.tasks
  for each row execute function public.tasks_guard_direct_update();


-- "Open" for every rule in this file: in progress, OR a recurring task
-- whose next copy hasn't been made yet (even if this one is completed —
-- the daily job would otherwise create the next copy for the old person).
create or replace function public.is_task_open(t public.tasks)
returns boolean
language sql
immutable
as $$
  select t.status = 'in_progress'
      or (t.recurring and t.next_occurrence_generated_at is null and t.due_date is not null);
$$;


-- ------------------------------------------------------------
-- 7. Automatic move when a Client's Manager or Accountant changes.
-- Only that Client's open tasks assigned to the old person move.
-- ------------------------------------------------------------

create or replace function public.move_tasks_on_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_old_name text;
  v_new_name text;
  r record;
begin
  select name into v_actor_name from users where id = v_actor;

  if new.manager_id is distinct from old.manager_id then
    select name into v_old_name from users where id = old.manager_id;
    select name into v_new_name from users where id = new.manager_id;
    for r in
      update tasks t
         set assignee_id = new.manager_id, assignee_name = v_new_name, assignee_role = 'manager'
       where t.client_id = new.client_id and t.assignee_id = old.manager_id and is_task_open(t)
      returning t.id
    loop
      insert into task_activity (task_id, action, details, actor_id, actor_name)
      values (r.id, 'reassigned',
              'Reassigned from ' || coalesce(v_old_name, 'previous Manager') || ' to ' || coalesce(v_new_name, 'new Manager')
              || ' because the Client''s Manager changed',
              v_actor, v_actor_name);
    end loop;
  end if;

  if new.accountant_id is distinct from old.accountant_id then
    select name into v_old_name from users where id = old.accountant_id;
    select name into v_new_name from users where id = new.accountant_id;
    for r in
      update tasks t
         set assignee_id = new.accountant_id, assignee_name = v_new_name, assignee_role = 'accountant'
       where t.client_id = new.client_id and t.assignee_id = old.accountant_id and is_task_open(t)
      returning t.id
    loop
      insert into task_activity (task_id, action, details, actor_id, actor_name)
      values (r.id, 'reassigned',
              'Reassigned from ' || coalesce(v_old_name, 'previous Accountant') || ' to ' || coalesce(v_new_name, 'new Accountant')
              || ' because the Client''s Accountant changed',
              v_actor, v_actor_name);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists client_assignments_move_tasks on public.client_assignments;
create trigger client_assignments_move_tasks
  after update on public.client_assignments
  for each row execute function public.move_tasks_on_reassignment();


-- ------------------------------------------------------------
-- 8. Reassigning by hand.
-- Allowed: Super Admin (any task in the firm), or the CURRENT Manager
-- of the Client the task is about.
-- Who it can go to:
--   task about a Client, now with a staff member -> that Client's
--     current Manager or Accountant
--   task about a Client, now with a Client -> those two, or another
--     active Client of the same organisation
--   task not about any Client (direct staff task) -> any active
--     Manager or Accountant (Super Admin only)
-- ------------------------------------------------------------

create or replace function public.can_supervise_task(t public.tasks)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_active_user() and (
    (current_user_role() = 'super_admin' and t.tenant_id = current_user_tenant())
    or (current_user_role() = 'manager' and t.client_id is not null and exists (
          select 1 from client_assignments ca where ca.client_id = t.client_id and ca.manager_id = auth.uid()))
  );
$$;

create or replace function public.task_reassign_options(p_task_id uuid)
returns table (id uuid, name text, role text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  t tasks;
  ca client_assignments;
begin
  select * into t from tasks where tasks.id = p_task_id;
  if not found or not can_supervise_task(t) then
    raise exception 'You can''t reassign this task.';
  end if;

  if t.client_id is null then
    return query
      select u.id, u.name, u.role from users u
      where u.tenant_id = t.tenant_id and u.role in ('manager', 'accountant')
        and u.deactivated_at is null and u.id <> t.assignee_id
      order by u.name;
    return;
  end if;

  select * into ca from client_assignments where client_id = t.client_id;

  return query
    select u.id, u.name, u.role from users u
    where u.deactivated_at is null
      and u.id <> t.assignee_id
      and (
        u.id in (ca.manager_id, ca.accountant_id)
        or (t.assignee_role = 'client' and u.role = 'client' and u.client_org_id = t.client_org_id)
      )
    order by u.role desc, u.name;
end;
$$;

create or replace function public.reassign_task(p_task_id uuid, p_new_assignee uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t tasks;
  v_new users;
  v_actor_name text;
begin
  select * into t from tasks where id = p_task_id;
  if not found or not can_supervise_task(t) then
    raise exception 'You can''t reassign this task.';
  end if;
  if not is_task_open(t) then
    raise exception 'This task is already finished, so there is nothing to reassign.';
  end if;
  if not exists (select 1 from task_reassign_options(p_task_id) o where o.id = p_new_assignee) then
    raise exception 'This task can''t be given to that person.';
  end if;

  select * into v_new from users where id = p_new_assignee;
  select name into v_actor_name from users where id = auth.uid();

  update tasks
     set assignee_id = v_new.id, assignee_name = v_new.name, assignee_role = v_new.role
   where id = p_task_id;

  insert into task_activity (task_id, action, details, actor_id, actor_name)
  values (p_task_id, 'reassigned',
          'Reassigned from ' || coalesce(t.assignee_name, 'someone') || ' to ' || coalesce(v_new.name, 'someone'),
          auth.uid(), v_actor_name);
end;
$$;


-- ------------------------------------------------------------
-- 9. Close / stop repeating a task whose creator or assignee has been
-- deactivated (nobody else could otherwise end a recurring series a
-- departed person created). Same people as reassigning.
-- ------------------------------------------------------------

create or replace function public.supervise_task(p_task_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t tasks;
  v_actor_name text;
begin
  select * into t from tasks where id = p_task_id;
  if not found or not can_supervise_task(t) then
    raise exception 'You can''t change this task.';
  end if;
  if is_user_active(t.creator_id) and is_user_active(t.assignee_id) then
    raise exception 'Only tasks created by or assigned to a deactivated person can be closed this way.';
  end if;
  select name into v_actor_name from users where id = auth.uid();

  if p_action = 'complete' then
    if t.status <> 'in_progress' then
      raise exception 'This task is already completed.';
    end if;
    update tasks set status = 'completed' where id = p_task_id;
    insert into task_activity (task_id, action, details, actor_id, actor_name)
    values (p_task_id, 'closed', 'Closed because ' ||
            case when not is_user_active(t.creator_id) then coalesce(t.creator_name, 'its creator') else coalesce(t.assignee_name, 'its assignee') end
            || ' has been deactivated', auth.uid(), v_actor_name);
  elsif p_action = 'stop_repeating' then
    if not (t.recurring and t.next_occurrence_generated_at is null) then
      raise exception 'This task is not set to repeat.';
    end if;
    update tasks set recurring = false where id = p_task_id;
    insert into task_activity (task_id, action, details, actor_id, actor_name)
    values (p_task_id, 'stopped_repeating', 'Stopped repeating (no more copies will be created)', auth.uid(), v_actor_name);
  else
    raise exception 'Unknown action.';
  end if;
end;
$$;


-- ------------------------------------------------------------
-- 10. The daily recurring job never creates a copy for a deactivated
-- person. (The blocking rules should make this impossible already —
-- this is the safety net.) Otherwise identical to
-- Fix_recurring_task_catchup.sql.
-- ------------------------------------------------------------

create or replace function public.generate_recurring_task_occurrences()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  step interval;
  n integer;
  new_due date;
begin
  for r in
    select * from tasks
    where recurring = true
      and due_date is not null
      and due_date <= current_date
      and next_occurrence_generated_at is null
      and exists (select 1 from users u where u.id = tasks.assignee_id and u.deactivated_at is null)
  loop
    step := case r.recurrence_term
      when 'weekly'    then interval '7 days'
      when 'monthly'   then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'yearly'    then interval '1 year'
    end;

    continue when step is null;

    n := 1;
    loop
      new_due := (r.due_date + n * step)::date;
      exit when new_due > current_date;
      n := n + 1;
    end loop;

    insert into tasks (
      tenant_id, client_org_id, client_org_name, client_id, title, description,
      creator_id, creator_name, creator_role,
      assignee_id, assignee_name, assignee_role,
      priority, due_date, status,
      recurring, recurrence_term, parent_task_id,
      shared_with_client
    ) values (
      r.tenant_id, r.client_org_id, r.client_org_name, r.client_id, r.title, r.description,
      r.creator_id, r.creator_name, r.creator_role,
      r.assignee_id, r.assignee_name, r.assignee_role,
      r.priority, new_due, 'in_progress',
      true, r.recurrence_term, r.id,
      r.shared_with_client
    );

    update tasks set next_occurrence_generated_at = now() where id = r.id;
  end loop;
end;
$$;


-- ------------------------------------------------------------
-- 11. What's in the way of deactivating someone. Returns a JSON object
-- the Users screens show as a checklist. Super Admin: anyone in the
-- firm. Client Admin: Clients of their own organisation.
-- ------------------------------------------------------------

create or replace function public.can_manage_user_status(p_target users)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_active_user() and p_target.id <> auth.uid() and (
    (current_user_role() = 'super_admin' and p_target.tenant_id = current_user_tenant())
    or (current_user_role() = 'client_admin' and p_target.role = 'client'
        and p_target.client_org_id = (select u.client_org_id from users u where u.id = auth.uid()))
  );
$$;

create or replace function public.get_deactivation_blockers(p_user_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_target users;
begin
  select * into v_target from users where id = p_user_id;
  if not found or not can_manage_user_status(v_target) then
    raise exception 'You can''t manage this person''s account.';
  end if;

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
        -- Who can reassign it: the Client's current Manager, or Super
        -- Admin for tasks not about a Client.
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
    -- Not a blocker — a warning the screen shows before confirming.
    'only_client_admin', (
      v_target.role = 'client_admin' and not exists (
        select 1 from users u
        where u.client_org_id = v_target.client_org_id and u.role = 'client_admin'
          and u.id <> v_target.id and u.deactivated_at is null)
    )
  );
end;
$$;


-- ------------------------------------------------------------
-- 12. Deactivate / reactivate. Called by the admin-set-user-active Edge
-- Function WITH THE CALLER'S OWN SESSION (so every check here applies to
-- the real person asking); the Edge Function then blocks or unblocks the
-- login itself.
-- ------------------------------------------------------------

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    if v_target.role in ('client', 'client_admin') then
      select * into v_org from client_organizations where id = v_target.client_org_id;
      select count(*) into v_used from users
       where client_org_id = v_target.client_org_id and deactivated_at is null;
      if v_used >= v_org.seat_limit then
        raise exception 'No free seat in % (% of % used). Free a seat or ask Super Admin to raise the limit first.',
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
end;
$$;


-- ------------------------------------------------------------
-- 13. Function permissions: callable by signed-in users only (each one
-- checks the caller itself). The internal helpers stay callable too —
-- RLS policies use them — but they only ever answer yes/no.
-- ------------------------------------------------------------

revoke all on function public.get_deactivation_blockers(uuid) from public, anon;
revoke all on function public.set_user_active(uuid, boolean) from public, anon;
revoke all on function public.task_reassign_options(uuid) from public, anon;
revoke all on function public.reassign_task(uuid, uuid) from public, anon;
revoke all on function public.supervise_task(uuid, text) from public, anon;
grant execute on function public.get_deactivation_blockers(uuid) to authenticated;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
grant execute on function public.task_reassign_options(uuid) to authenticated;
grant execute on function public.reassign_task(uuid, uuid) to authenticated;
grant execute on function public.supervise_task(uuid, text) to authenticated;


-- ============================================================
-- Verify after running:
--   select column_name from information_schema.columns
--   where table_name = 'users' and column_name like 'deactivated%';      -- 2 rows
--   select count(*) from pg_policies where policyname = 'zz_active_users_only';
--     -- one per table with RLS, plus storage.objects (16 at the time of writing)
--   select tgname from pg_trigger where tgname in
--     ('tasks_guard_direct_update','client_assignments_move_tasks','users_guard_direct_update');  -- 3 rows
--
-- Then redeploy BOTH Edge Functions:
--   supabase functions deploy admin-create-user
--   supabase functions deploy admin-set-user-active
-- ============================================================