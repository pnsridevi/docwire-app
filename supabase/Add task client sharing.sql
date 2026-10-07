-- migration_add_task_client_sharing.sql
-- Run after every previous migration in this project.
--
-- Closes the gap found while confirming requirements directly: a Client
-- was NEVER shown a task, even when a Manager/Accountant explicitly
-- wanted them to see it — Architecture §7.6 restricts a Client to tasks
-- where they're personally creator or assignee, with no exception. And
-- on the document side, sharing with the Client was actually automatic
-- (any task about a real Client forced shared_with_clients = true on its
-- document) rather than a genuine choice — meaning there was no way to
-- discuss a Client's file between Manager and Accountant without it
-- being visible to that Client.
--
-- Fix: one new column, one new additive SELECT policy. TasksScreen.tsx's
-- "Share with Client" toggle now drives both the task's own visibility
-- AND the attached document's shared_with_clients together, as a single
-- explicit choice — not automatic, not two separate settings that could
-- disagree.

alter table public.tasks
  add column if not exists shared_with_client boolean not null default false;

drop policy if exists "tasks_select_client_shared" on tasks;
create policy "tasks_select_client_shared" on tasks
  for select using (
    current_user_role() = 'client'
    and client_id = auth.uid()
    and shared_with_client = true
  );

-- Note: this is purely additive. tasks_select_client (unchanged, from
-- the base schema) already covers a Client who is personally the
-- creator or assignee — this policy only adds the NEW case: a task
-- between two staff members, about this Client, that they were
-- explicitly given visibility into.

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'tasks' and column_name = 'shared_with_client';
--   select polname from pg_policy where polrelid = 'tasks'::regclass
--   and polname = 'tasks_select_client_shared';
-- 1 row expected each.