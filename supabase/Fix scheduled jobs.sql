-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Fix_scheduled_jobs.sql
-- Run after every previous migration, including Fix_client_admin_tasks.sql.
-- Safe to run more than once. Changes rules only; the one data change is
-- filling in the new series_start_date column (step 1).
--
-- Fixes problems found by section L (Scheduled jobs) of the Test Case Register:
--
--   P-19  Month-end series drift: 31 Jan -> 28 Feb -> 28 Mar -> 28 Apr ...
--         Each copy was counted from the copy before it, so after a short
--         month the series stayed on the 28th. Now every copy is counted
--         from the series' first due date (new column series_start_date).
--   P-20  A repeating document request (staff asking a Client to upload,
--         e.g. "monthly bank statement") lost the request in its copies:
--         next month's task no longer asked the Client for anything. The
--         request (name + book-entry setting) is now carried; the uploaded
--         document is not (each period brings its own).
--   P-22  Anyone, even someone not signed in, could run the two daily jobs
--         through the app's API. Now only the database owner (pg_cron) can.
--   P-23  A new task could be saved already 'escalated', already marked
--         'next copy made' (so it would never repeat), or linked as the
--         copy of any task, even another firm's. These are now set only by
--         the database.
--   P-24  One task whose copy could not be saved stopped the whole morning's
--         run, for every firm, with nobody told. Now that task is skipped
--         and written to dw_private.scheduled_job_errors; the rest go ahead.
--
-- Not in this file: P-21 (who may stop a series) needs your decision;
-- see "Fix stop repeating.sql".
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. P-19: the date a series is counted from
-- ------------------------------------------------------------
alter table public.tasks add column if not exists series_start_date date null;

-- Existing series: use the due date of the first task in the chain
with recursive chain(id, root_due) as (
  select id, due_date from public.tasks where parent_task_id is null and recurring
  union all
  select t.id, c.root_due from public.tasks t join chain c on t.parent_task_id = c.id
)
update public.tasks t set series_start_date = c.root_due
  from chain c
 where t.id = c.id and t.recurring and t.series_start_date is distinct from c.root_due;

-- ------------------------------------------------------------
-- 2. P-24: where a copy that could not be made is recorded
--    (dw_private is not published by the app's API; read it in the SQL Editor)
-- ------------------------------------------------------------
create table if not exists dw_private.scheduled_job_errors (
  id bigint generated always as identity primary key,
  job text not null,
  task_id uuid,
  error text not null,
  happened_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. The repeating-task job (P-19, P-20, P-24). Otherwise as before:
--    catches up missed days, never creates a copy for a deactivated
--    person, carries 'shared with Client'.
-- ------------------------------------------------------------
create or replace function public.generate_recurring_task_occurrences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  step interval;
  n integer;
  anchor date;
  new_due date;
  carries_request boolean;
begin
  for r in
    select * from tasks
    where recurring = true
      and due_date is not null
      and due_date <= current_date
      and next_occurrence_generated_at is null
      and exists (select 1 from users u where u.id = tasks.assignee_id and u.deactivated_at is null)
    order by due_date, created_at
  loop
    step := case r.recurrence_term
      when 'weekly'    then interval '7 days'
      when 'monthly'   then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'yearly'    then interval '1 year'
    end;
    continue when step is null;

    -- P-19: count from the first due date of the series, so 31 Jan gives 28 Feb, then 31 Mar
    anchor := coalesce(r.series_start_date, r.due_date);
    n := 1;
    loop
      new_due := (anchor + n * step)::date;
      exit when new_due > current_date and new_due > r.due_date;
      n := n + 1;
    end loop;

    -- P-20: a staff request to a Client to upload a document repeats as a request
    carries_request := r.linked_document_name is not null
                       and r.assignee_role = 'client' and r.creator_role <> 'client';

    -- P-24: one task that can't be copied doesn't stop the others
    begin
      insert into tasks (
        tenant_id, client_org_id, client_org_name, client_id, title, description,
        creator_id, creator_name, creator_role,
        assignee_id, assignee_name, assignee_role,
        priority, due_date, status,
        recurring, recurrence_term, parent_task_id, series_start_date,
        shared_with_client,
        linked_document_name, linked_document_needs_entry
      ) values (
        r.tenant_id, r.client_org_id, r.client_org_name, r.client_id, r.title, r.description,
        r.creator_id, r.creator_name, r.creator_role,
        r.assignee_id, r.assignee_name, r.assignee_role,
        r.priority, new_due, 'in_progress',
        true, r.recurrence_term, r.id, anchor,
        r.shared_with_client,
        case when carries_request then r.linked_document_name end,
        case when carries_request then r.linked_document_needs_entry end
      );
      update tasks set next_occurrence_generated_at = now() where id = r.id;
    exception when others then
      insert into dw_private.scheduled_job_errors (job, task_id, error)
      values ('generate-recurring-tasks-daily', r.id, sqlerrm);
    end;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 4. P-22: only the database owner (pg_cron runs as postgres) may run the jobs
-- ------------------------------------------------------------
revoke execute on function public.generate_recurring_task_occurrences() from public, anon, authenticated, service_role;
revoke execute on function public.escalate_overdue_tasks() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 5. P-23: the columns only the database sets. Same function as
--    Fix_security_P1_to_P7.sql, plus the four lines marked P-23.
-- ------------------------------------------------------------
create or replace function public.tasks_enforce_rules()
returns trigger
language plpgsql
as $$
declare
  me       record;
  assignee record;
  person   record;
  org      record;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select * into me from dw_private.user_facts(auth.uid());
  if me.tenant_id is null then
    raise exception 'Your account could not be found. Sign in again.';
  end if;

  if tg_op = 'UPDATE' then
    if new.linked_document_id is distinct from old.linked_document_id and new.linked_document_id is not null
       and not exists (select 1 from documents d where d.id = new.linked_document_id and d.tenant_id = me.tenant_id) then
      raise exception 'You can only link a document you can see, from your own firm.';
    end if;
    return new;
  end if;

  -- INSERT --------------------------------------------------------------
  -- P-23: set only by the daily jobs
  new.escalated := false;
  new.next_occurrence_generated_at := null;
  new.parent_task_id := null;
  new.series_start_date := null;

  -- P-7: a task needs a title
  if btrim(coalesce(new.title, '')) = '' then
    raise exception 'Please give the task a title.';
  end if;
  new.title := btrim(new.title);

  -- P-1: the task belongs to your own firm
  if new.tenant_id is distinct from me.tenant_id then
    raise exception 'A task can only be created in your own firm.';
  end if;
  -- P-6: who created it comes from your account
  new.creator_id := auth.uid();
  new.creator_role := me.role;
  new.creator_name := me.name;

  -- P-1: the assignee is an active person in your firm
  select * into assignee from dw_private.user_facts(new.assignee_id);
  if assignee.tenant_id is distinct from me.tenant_id then
    raise exception 'You can only give a task to someone in your own firm.';
  end if;
  new.assignee_role := assignee.role;
  new.assignee_name := assignee.name;

  if me.role in ('client', 'client_admin') then
    -- A Client gives tasks to staff, or to people in their own organisation
    if new.client_org_id is distinct from me.client_org_id then
      raise exception 'A task can only be created for your own organisation.';
    end if;
    if assignee.role in ('client', 'client_admin') and assignee.client_org_id is distinct from me.client_org_id then
      raise exception 'You can only give a task to your firm''s staff or to people in your own organisation.';
    end if;
  elsif assignee.role in ('client', 'client_admin') and new.client_org_id is distinct from assignee.client_org_id then
    raise exception 'The task''s client organisation must be the assignee''s own organisation.';
  end if;

  if new.client_org_id is not null then
    select * into org from dw_private.org_facts(new.client_org_id);
    if org.tenant_id is distinct from me.tenant_id then
      raise exception 'That client organisation is not in your firm.';
    end if;
    new.client_org_name := org.name;
  end if;

  if new.client_id is not null then
    select * into person from dw_private.user_facts(new.client_id);
    if person.tenant_id is distinct from me.tenant_id
       or (new.client_org_id is not null and person.client_org_id is distinct from new.client_org_id) then
      raise exception 'That client is not in this organisation.';
    end if;
  end if;

  if new.linked_document_id is not null
     and not exists (select 1 from documents d where d.id = new.linked_document_id and d.tenant_id = me.tenant_id) then
    raise exception 'You can only link a document you can see, from your own firm.';
  end if;

  return new;
end;
$$;

commit;

-- ------------------------------------------------------------
-- Checks after running (read-only)
-- ------------------------------------------------------------
-- Installed? Expect: true, false, false, true
-- select (select prosrc like '%series_start_date%' from pg_proc where proname = 'generate_recurring_task_occurrences'),
--        has_function_privilege('anon', 'public.escalate_overdue_tasks()', 'execute'),
--        has_function_privilege('authenticated', 'public.generate_recurring_task_occurrences()', 'execute'),
--        (select prosrc like '%new.parent_task_id := null%' from pg_proc where proname = 'tasks_enforce_rules');
--
-- Any copy the job could not make (should normally be empty):
-- select * from dw_private.scheduled_job_errors order by happened_at desc;
--
-- Existing series that have drifted off a month-end (shown for information; the
-- next copy of each is counted from its series_start_date and goes back on track):
-- select id, title, series_start_date, due_date from public.tasks
--  where recurring and recurrence_term in ('monthly','quarterly','yearly')
--    and extract(day from due_date) <> extract(day from series_start_date) and next_occurrence_generated_at is null;

-- ------------------------------------------------------------
-- Undo (puts back the 17 Nov versions; series_start_date and the error table stay, unused)
-- ------------------------------------------------------------
-- grant execute on function public.generate_recurring_task_occurrences() to public, anon, authenticated, service_role;
-- grant execute on function public.escalate_overdue_tasks() to public, anon, authenticated, service_role;
-- Then re-run section 10 of Add_user_deactivation.sql (the repeating job) and
-- the tasks_enforce_rules function in Fix_security_P1_to_P7.sql (the repo's "Fix P1 t oP7.sql").