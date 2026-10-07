-- migration_fix_recurring_task_sharing_carryover.sql
-- Run after every previous migration in this project.
--
-- Found during end-to-end verification, before anything's been run —
-- generate_recurring_task_occurrences() (phase2_documents_tasks.sql,
-- B.4) explicitly lists every column to carry from a recurring task to
-- its next auto-generated occurrence, written before shared_with_client
-- existed. Left as-is, a Manager/Accountant's shared, recurring task
-- would correctly show to the Client on its FIRST occurrence, then
-- silently stop being visible on every occurrence after that, since the
-- new row would default to shared_with_client = false with no code path
-- ever setting it. Not yet actively triggering anything (no scheduler
-- calls this function yet — a known, separate open item), but worth
-- closing now while it's in scope, rather than leaving a trap for
-- whoever builds the scheduler later.

create or replace function public.generate_recurring_task_occurrences()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  new_due date;
begin
  for r in
    select * from tasks
    where recurring = true
      and due_date = current_date
      and next_occurrence_generated_at is null
  loop
    new_due := case r.recurrence_term
      when 'weekly'    then r.due_date + interval '7 days'
      when 'monthly'   then r.due_date + interval '1 month'
      when 'quarterly' then r.due_date + interval '3 months'
      when 'yearly'    then r.due_date + interval '1 year'
    end;

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

-- Note: this only carries the task-level share forward. If the ORIGINAL
-- occurrence also had a document attached, the new occurrence does NOT
-- get a new document auto-created or auto-shared — Architecture §7.2 is
-- explicit that a document is only ever created "at the same time" as
-- its task, never attached later, and this function doesn't change that.
-- A recurring task's later occurrences are task-only unless someone
-- attaches a fresh document to them directly (not yet a feature either
-- — flagging, not fixing, since it's outside what was asked).

-- Verify:
--   select prosrc from pg_proc where proname = 'generate_recurring_task_occurrences';
-- Should show shared_with_client in both the column and values list.