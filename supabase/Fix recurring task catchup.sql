-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Fix_recurring_task_catchup.sql
-- Run after every previous migration (including Add_master_documents.sql).
--
-- Two gaps found while writing Test Plan Part 2 (G-04) and reviewing the
-- live tasks table:
--
-- 1. The daily job (generate-recurring-tasks-daily, 6:30 AM IST) only
--    picked up recurring tasks whose due date was EXACTLY today. A
--    recurring task created after that morning's run with today's due
--    date — or any day the job didn't run — was skipped forever, because
--    by the next run its due date was already in the past.
--
-- 2. Due date was optional even for recurring tasks. With no due date the
--    job has no date to schedule from, so the task never repeats. Both
--    "Monthly GST filing check" tasks in the live data are in this state.
--
-- Fix:
--   - The job now catches up: any recurring task whose due date is today
--     OR earlier, and whose next occurrence hasn't been made yet, gets
--     one. The new due date is the first scheduled date AFTER today —
--     missed periods are skipped rather than flooding the list with a
--     backlog of already-overdue copies (the original task itself is
--     still there, overdue and escalated, so nothing is hidden).
--   - Dates are always counted from the ORIGINAL due date (due + n
--     periods), so a task due on the 31st stays on month-end instead of
--     drifting to the 28th after February.
--   - New recurring tasks must have a due date (enforced here on insert,
--     and in TasksScreen.tsx's form). Existing rows are untouched, so the
--     two old tasks without a due date keep working normally — they just
--     won't repeat until a due date is set (see the note at the end).
--
-- Unchanged on purpose: a next occurrence is still created whether or not
-- the current one was completed (Test Plan G-05 asks Venkatesh to
-- confirm), and shared_with_client is still carried forward.
-- ============================================================

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
  loop
    step := case r.recurrence_term
      when 'weekly'    then interval '7 days'
      when 'monthly'   then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'yearly'    then interval '1 year'
    end;

    -- Unknown/missing term: nothing sensible to schedule. Leave the row
    -- alone rather than guessing.
    continue when step is null;

    -- First scheduled date strictly after today, always counted from the
    -- original due date (no month-end drift).
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
-- New recurring tasks must have a due date and a term. INSERT only — an
-- update to one of the two existing undated recurring tasks (e.g. marking
-- it complete) must keep working, which a CHECK constraint wouldn't allow.
-- ------------------------------------------------------------

create or replace function public.require_due_date_for_recurring()
returns trigger
language plpgsql
as $$
begin
  if new.recurring = true and new.due_date is null then
    raise exception 'A recurring task needs a due date — the next one is created automatically from it.';
  end if;
  if new.recurring = true and new.recurrence_term is null then
    raise exception 'A recurring task needs a repeat interval (weekly, monthly, quarterly or yearly).';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_require_due_date_for_recurring on public.tasks;
create trigger tasks_require_due_date_for_recurring
  before insert on public.tasks
  for each row execute function public.require_due_date_for_recurring();


-- ============================================================
-- Verify:
--   select prosrc like '%due_date <= current_date%' from pg_proc
--   where proname = 'generate_recurring_task_occurrences';      -- true
--   select tgname from pg_trigger
--   where tgname = 'tasks_require_due_date_for_recurring';      -- 1 row
--
-- The two existing recurring tasks with no due date ("Monthly GST filing
-- check" and "Monthly GST filing check 1") will not repeat until they
-- have one. The app can't edit a task's due date after creation, so if
-- you want them to start repeating, set it here, e.g.:
--   update tasks set due_date = '2026-10-10'
--   where recurring = true and due_date is null;
-- Optional — they're Part 1 test data, so leaving them is also fine.
-- ============================================================