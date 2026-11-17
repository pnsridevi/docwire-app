-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Fix_resume_repeating.sql   (P-25)
-- Run after Fix_stop_repeating.sql. Safe to run more than once.
-- Changes one function and adds one word to the task history's list of
-- actions; no data is changed.
--
-- Fix_stop_repeating.sql lets the Client's Manager or a Super Admin stop a
-- repeating task at any time. Once stopped, it could not be started again.
-- This adds 'Resume repeating' for the same people:
--
--   - Only on a task that was stopped with 'Stop repeating' and has had no
--     copy since (the latest task of its series).
--   - The series carries on with its own schedule and dates. If dates passed
--     while it was stopped, the next copy is the first date after today,
--     as the daily job always does: no backlog of overdue copies.
--   - Refused while the assignee is deactivated (reassign it first if it is
--     still open; a completed task can't be reassigned, so make a new one).
--   - Every resume writes a line in the task's history.
--
-- 'Close task' and 'Stop repeating' are unchanged.
-- The screens need a matching change: TasksScreen.tsx and
-- components/TaskSupervision.tsx, plus one word in lib/types.ts
-- (all sent with this file).
-- ============================================================

begin;

-- The task history accepts one more action: 'resumed_repeating'
alter table public.task_activity drop constraint if exists task_activity_action_check;
alter table public.task_activity add constraint task_activity_action_check
  check (action in ('reassigned', 'closed', 'stopped_repeating', 'resumed_repeating'));

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
  select name into v_actor_name from users where id = auth.uid();

  if p_action = 'complete' then
    if is_user_active(t.creator_id) and is_user_active(t.assignee_id) then
      raise exception 'Only tasks created by or assigned to a deactivated person can be closed this way.';
    end if;
    if t.status <> 'in_progress' then
      raise exception 'This task is already completed.';
    end if;
    update tasks set status = 'completed' where id = p_task_id;
    insert into task_activity (task_id, action, details, actor_id, actor_name)
    values (p_task_id, 'closed', 'Closed because ' ||
            case when not is_user_active(t.creator_id) then coalesce(t.creator_name, 'its creator') else coalesce(t.assignee_name, 'its assignee') end
            || ' has been deactivated', auth.uid(), v_actor_name);

  elsif p_action = 'stop_repeating' then
    -- P-21: allowed whether or not anyone on the task has been deactivated
    if not (t.recurring and t.next_occurrence_generated_at is null) then
      raise exception 'This task is not set to repeat.';
    end if;
    update tasks set recurring = false where id = p_task_id;
    insert into task_activity (task_id, action, details, actor_id, actor_name)
    values (p_task_id, 'stopped_repeating', 'Stopped repeating (no more copies will be created)', auth.uid(), v_actor_name);

  elsif p_action = 'resume_repeating' then
    -- P-25: start a stopped series again
    if t.recurring then
      raise exception 'This task is already repeating.';
    end if;
    if t.recurrence_term is null or t.due_date is null
       or not exists (select 1 from task_activity a where a.task_id = p_task_id and a.action = 'stopped_repeating') then
      raise exception 'Only a repeating task that was stopped can be resumed.';
    end if;
    if t.next_occurrence_generated_at is not null then
      raise exception 'This task already has its next copy. Resume the latest task of the series.';
    end if;
    if not is_user_active(t.assignee_id) then
      raise exception 'The person this task is assigned to has been deactivated. If the task is still open, reassign it first; otherwise create a new repeating task.';
    end if;
    update tasks set recurring = true where id = p_task_id;
    insert into task_activity (task_id, action, details, actor_id, actor_name)
    values (p_task_id, 'resumed_repeating', 'Resumed repeating (' || t.recurrence_term || '; the next copy comes after today)', auth.uid(), v_actor_name);

  else
    raise exception 'Unknown action.';
  end if;
end;
$$;

commit;

-- ------------------------------------------------------------
-- Check after running (read-only). Expect: true
-- select prosrc like '%resume_repeating%' from pg_proc where proname = 'supervise_task';
--
-- Undo: re-run Fix_stop_repeating.sql (puts back the version without Resume).
-- The extra history word can stay; it does no harm.
-- ------------------------------------------------------------