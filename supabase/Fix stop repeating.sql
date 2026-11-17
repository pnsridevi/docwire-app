-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Fix_stop_repeating.sql   (P-21, needs your decision; optional)
-- Run after Fix_scheduled_jobs.sql. Safe to run more than once.
--
-- Today a repeating task can only be stopped when its creator or assignee
-- has been deactivated (supervise_task 'stop_repeating'). While both are
-- active, nobody can stop it: completing it still creates the next copy,
-- and direct edits can't change 'recurring'. So when a Client's engagement
-- ends, or a monthly task is no longer needed, it repeats for ever.
--
-- This file lets the same people who can reassign a task (the Client's
-- current Manager, or a Super Admin of the firm) stop it repeating at any
-- time. 'Close' (complete on behalf of a departed person) is unchanged.
-- Every stop writes a line in the task's history, as before.
--
-- The screens need a matching one-word change, shown at the end.
-- ============================================================

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
  else
    raise exception 'Unknown action.';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Screens: show "Stop repeating" to the same people, without waiting for
-- someone to be deactivated. Two lines, the same change in each:
--
--   components/TaskSupervision.tsx (line 71) and screens/TasksScreen.tsx (line 1046)
--   - const showStop = canSupervise && departed && task.recurring && !task.next_occurrence_generated_at;
--   + const showStop = canSupervise && task.recurring && !task.next_occurrence_generated_at;
--   (in TasksScreen.tsx the names are `supervise` and `item`)
--
-- Undo: re-run section 9 of Add_user_deactivation.sql, and put `departed &&` back.
-- ------------------------------------------------------------