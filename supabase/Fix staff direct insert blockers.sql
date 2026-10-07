-- migration_fix_staff_direct_insert_blockers.sql
-- Run after migration_add_staff_direct_tasks_and_docs.sql and
-- migration_add_shared_with_user_name.sql.
--
-- Both prior migrations made the right COLUMNS nullable, but two things
-- from the actual live schema (only visible now that the real migration
-- history was shared) would have silently rejected every direct-mode
-- insert:
--   1. derive_task_client_id (phase2_documents_tasks.sql, B.2) explicitly
--      raises an exception for any staff-to-staff task with client_id
--      null — a hard block, before RLS is even evaluated.
--   2. tasks_insert_manager/tasks_insert_accountant and
--      documents_manager_insert_work_doc/documents_accountant_insert_
--      work_doc all require client_id (or client_org_id) to resolve
--      through client_assignments — which NULL can never do.
-- This migration fixes both.

-- ------------------------------------------------------------
-- 1. Stop the trigger from blocking a genuinely intentional direct task.
--    The original rule ("every staff-to-staff task must have an explicit
--    client_id") is exactly what migration_add_staff_direct_tasks_and_
--    docs.sql set out to reverse — this trigger was never updated to
--    match at the time.
-- ------------------------------------------------------------

create or replace function public.derive_task_client_id()
returns trigger
language plpgsql
security definer
as $$
declare
  v_creator_role text;
  v_assignee_role text;
begin
  select role into v_creator_role from users where id = new.creator_id;
  select role into v_assignee_role from users where id = new.assignee_id;

  if v_creator_role = 'client' then
    new.client_id := new.creator_id;
  elsif v_assignee_role = 'client' then
    new.client_id := new.assignee_id;
  end if;
  -- No else/raise branch anymore: a staff-to-staff task (neither party
  -- is a Client) with client_id left null is now a valid, intentional
  -- direct task — TasksScreen.tsx's directMode. The app still supplies
  -- client_id explicitly for every OTHER case (the Client themselves, or
  -- the real Client a staff-to-staff task is about), so this trigger
  -- only ever needs to fill it in for the two Client-involved branches
  -- above.

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. New INSERT policies for tasks — additive, alongside (not replacing)
--    tasks_insert_manager/tasks_insert_accountant. Scoped to client_id
--    is null, so these can only ever match the new direct case; every
--    existing client-tied insert still goes through the original
--    policies unchanged. Option A scoping: assignee must be a genuine
--    current counterpart (someone this creator already shares at least
--    one Client with via client_assignments), matching what
--    TasksScreen.tsx's picker already restricts client-side — this is
--    the server-side backstop for that same rule.
-- ------------------------------------------------------------

drop policy if exists "tasks_insert_manager_direct" on tasks;
create policy "tasks_insert_manager_direct" on tasks
  for insert with check (
    current_user_role() = 'manager'
    and creator_id = auth.uid()
    and client_id is null
    and exists (
      select 1 from client_assignments ca
      where ca.manager_id = auth.uid() and ca.accountant_id = assignee_id
    )
  );

drop policy if exists "tasks_insert_accountant_direct" on tasks;
create policy "tasks_insert_accountant_direct" on tasks
  for insert with check (
    current_user_role() = 'accountant'
    and creator_id = auth.uid()
    and client_id is null
    and exists (
      select 1 from client_assignments ca
      where ca.accountant_id = auth.uid() and ca.manager_id = assignee_id
    )
  );

-- ------------------------------------------------------------
-- 3. New INSERT policies for documents — same additive shape, for the
--    direct point-to-point share (shared_with_user_id set, both
--    client_id and client_org_id null). Same Option A backstop: the
--    named recipient must be a genuine current counterpart.
-- ------------------------------------------------------------

drop policy if exists "documents_manager_insert_direct_share" on documents;
create policy "documents_manager_insert_direct_share" on documents
  for insert with check (
    current_user_role() = 'manager'
    and uploaded_by = auth.uid()
    and source = 'manager'
    and tenant_id = current_user_tenant()
    and client_id is null
    and client_org_id is null
    and shared_with_user_id is not null
    and exists (
      select 1 from client_assignments ca
      where ca.manager_id = auth.uid() and ca.accountant_id = shared_with_user_id
    )
  );

drop policy if exists "documents_accountant_insert_direct_share" on documents;
create policy "documents_accountant_insert_direct_share" on documents
  for insert with check (
    current_user_role() = 'accountant'
    and uploaded_by = auth.uid()
    and source = 'accountant'
    and tenant_id = current_user_tenant()
    and client_id is null
    and client_org_id is null
    and shared_with_user_id is not null
    and exists (
      select 1 from client_assignments ca
      where ca.accountant_id = auth.uid() and ca.manager_id = shared_with_user_id
    )
  );

-- ------------------------------------------------------------
-- Verify:
--   select proname from pg_proc where proname = 'derive_task_client_id';
--   select polname from pg_policy where polrelid = 'tasks'::regclass
--   and polname like '%_direct';
--   -- 2 rows expected
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname like '%_direct_share';
--   -- 2 rows expected
-- ------------------------------------------------------------