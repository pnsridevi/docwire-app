-- ============================================================
-- Update_escalation_grace_period.sql
--
-- Escalate a task to the Manager only when it is MORE THAN 7 DAYS past
-- its due date and still in progress (was: any day past the due date).
-- "Overdue" in the app is unchanged — it still shows from the day after
-- the due date.
--
--   Due 1 Oct -> Overdue from 2 Oct -> Escalated at the 6:35 AM run on 9 Oct
--
-- The daily job (escalate-overdue-tasks-daily) keeps calling this same
-- function, so the job itself needs no change.
--
-- Also un-escalates in-progress tasks escalated under the old rule that
-- are not yet more than 7 days overdue, so badges match the new rule.
-- Completed tasks are left as they are (their history stays).
--
-- Safe to run more than once.
-- ============================================================

-- Optional preview before running: in-progress tasks that will lose the
-- "Escalated to Manager" badge.
-- select *, current_date - due_date as days_overdue
-- from public.tasks
-- where status = 'in_progress' and escalated = true
--   and (due_date is null or due_date >= current_date - 7);

begin;

create or replace function public.escalate_overdue_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update tasks
  set escalated = true
  where status = 'in_progress'
    and due_date < current_date - 7   -- more than 7 days past due
    and escalated = false;
end;
$function$;

update public.tasks
set escalated = false
where status = 'in_progress'
  and escalated = true
  and (due_date is null or due_date >= current_date - 7);

commit;

-- Check after running: every in-progress escalated task should be more
-- than 7 days overdue (smallest days_overdue = 8 or more).
-- select *, current_date - due_date as days_overdue
-- from public.tasks
-- where status = 'in_progress' and escalated = true
-- order by days_overdue;