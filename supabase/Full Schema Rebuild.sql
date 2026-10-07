-- LOCATION: Supabase Dashboard -> SQL Editor (paste and run — not a file in the app repo)
-- ============================================================
-- DocWire — FULL SCHEMA REBUILD (corrected)
-- Consolidates schema.sql + all migrations across BOTH sessions,
-- deduplicated, in correct dependency order, reflecting the final state
-- of everything. This revision fixes a real gap in the first version of
-- this file: it was missing the RLS infinite-recursion fix
-- (is_manager_of_client / is_accountant_of_client), because that fix was
-- applied in the first session before this conversation began, and the
-- source file for it was never actually uploaded here — only the
-- pre-fix versions of schema.sql and Migration_client_accountant_
-- visibility_fix_.sql were. Running the first version of this rebuild
-- would have reintroduced the exact bug that once blocked every login.
-- Caught by cross-checking against quereis_-_phase1.txt, a full export
-- of every query actually run across both sessions.
--
-- Run Part 1 ONLY if you want to wipe an existing DocWire schema first —
-- skip it entirely on a genuinely brand-new Supabase project. Part 2 is
-- always safe to run on a clean/empty public schema.
--
-- Part 1 does NOT touch auth.users (your login accounts) — see the note
-- at the end of Part 1 if you also want to clear out test accounts.
-- ============================================================


-- ============================================================
-- PART 1 — DROP EVERYTHING (skip this on a brand-new project)
-- ============================================================

-- Unschedule cron jobs first — safe even if they were never created.
do $$
begin
  perform cron.unschedule('generate-recurring-tasks-daily');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('escalate-overdue-tasks-daily');
exception when others then null;
end $$;

-- CASCADE removes every RLS policy attached to each table along with it,
-- so policies don't need dropping separately. Order doesn't strictly
-- matter with CASCADE, but listed child-first for readability.
drop table if exists tasks cascade;
drop table if exists documents cascade;
drop table if exists accountant_assignments cascade;
drop table if exists manager_assignments cascade;
drop table if exists users cascade;
drop table if exists client_organizations cascade;
drop table if exists tenants cascade;

drop function if exists public.generate_recurring_task_occurrences();
drop function if exists public.escalate_overdue_tasks();
drop function if exists public.is_manager_of_client(uuid);
drop function if exists public.is_accountant_of_client(uuid);
drop function if exists public.current_user_role();
drop function if exists public.current_user_tenant();

-- NOT included above, deliberately: auth.users. Dropping the public.users
-- TABLE above does not touch auth.users at all (it's just a table
-- definition being removed, not a cascading delete into another schema).
-- If you also want to clear out every test login account, that's a
-- separate, more irreversible action — either delete accounts one at a
-- time via Dashboard -> Authentication -> Users, or run this yourself if
-- you're certain you want every single account gone:
--   delete from auth.users;
-- Left as a manual, deliberate step rather than bundled in here.


-- ============================================================
-- PART 2 — CREATE EVERYTHING
-- ============================================================

create extension if not exists pg_cron with schema extensions;

-- ------------------------------------------------------------
-- Tables, in dependency order
-- ------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  firm_name text not null,
  created_at timestamptz default now()
);

create table client_organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  name text not null,
  -- Architecture §5.1 data model field; Super Admin Core Responsibility /
  -- Client Admin hard constraint per the Roles doc.
  seat_limit integer not null default 5,
  created_at timestamptz default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  client_org_id uuid references client_organizations(id),
  name text,
  -- public.users never stored this originally — only auth.users has it.
  -- Populated by the admin-create-user Edge Function on every new account.
  email text,
  role text not null check (role in ('client','accountant','manager','client_admin','super_admin')),
  created_at timestamptz default now()
);

create table manager_assignments (
  id uuid primary key default gen_random_uuid(),
  client_org_id uuid references client_organizations(id) not null unique,
  manager_id uuid references users(id) not null,
  created_at timestamptz default now()
);

create table accountant_assignments (
  id uuid primary key default gen_random_uuid(),
  client_org_id uuid references client_organizations(id) not null unique,
  accountant_id uuid references users(id) not null,
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  client_org_id uuid references client_organizations(id) not null,
  -- Denormalized at insert time (avoids a join per row on every list
  -- render) — lets "All Clients" views tell documents from different
  -- client orgs apart, and show who uploaded each one.
  client_org_name text,
  name text not null,
  needs_entry boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','accounted','reviewed','rework','filed')),
  comment text,
  uploaded_by uuid references users(id) not null,
  uploaded_by_name text,
  created_at timestamptz default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  client_org_id uuid references client_organizations(id) not null,
  client_org_name text,
  title text not null,
  description text,
  creator_id uuid references users(id) not null,
  creator_name text,
  creator_role text not null,
  assignee_id uuid references users(id) not null,
  assignee_name text,
  assignee_role text not null,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_date date,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  created_at timestamptz default now(),
  -- Architecture §7.4 (recurrence) / §7.5 (overdue + escalation) / §13
  -- (background jobs).
  recurring boolean not null default false,
  recurrence_term text check (recurrence_term in ('weekly','monthly','quarterly','yearly')),
  parent_task_id uuid references tasks(id),
  next_occurrence_generated_at timestamptz,
  escalated boolean not null default false
);

-- ------------------------------------------------------------
-- Helper functions — used inside RLS policies below, so must exist first.
-- ------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
security definer
stable
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.current_user_tenant()
returns uuid
language sql
security definer
stable
as $$
  select tenant_id from public.users where id = auth.uid();
$$;

-- Break a real infinite-recursion cycle found in the first session (before
-- this file existed): accountant_assignments_own subqueried
-- manager_assignments directly, and manager_assignments_select_accountant
-- subqueried accountant_assignments directly — each one's RLS check
-- required evaluating the OTHER table's RLS, which required evaluating
-- this table's RLS again. Postgres detected the unbounded loop and
-- refused to run either policy, for every role, which blocked ALL logins
-- from reading either assignments table (and therefore documents/tasks
-- too). Same fix pattern as current_user_role()/current_user_tenant()
-- above: a security definer function reads its target table directly
-- without re-triggering that table's own RLS, breaking the cycle at one
-- of the two crossing points (only one side needs to break).
create or replace function public.is_manager_of_client(check_client_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from manager_assignments
    where manager_id = auth.uid() and client_org_id = check_client_org_id
  );
$$;

create or replace function public.is_accountant_of_client(check_client_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from accountant_assignments
    where accountant_id = auth.uid() and client_org_id = check_client_org_id
  );
$$;

-- ------------------------------------------------------------
-- Enable RLS
-- ------------------------------------------------------------

alter table users enable row level security;
alter table client_organizations enable row level security;
alter table manager_assignments enable row level security;
alter table accountant_assignments enable row level security;
alter table documents enable row level security;
alter table tasks enable row level security;

-- ------------------------------------------------------------
-- RLS — users
-- No insert/update policy exists on purpose: account creation goes
-- through the admin-create-user Edge Function using the service-role
-- key, which bypasses RLS entirely — keeping that key server-side is the
-- entire reason it's a service-role action rather than a direct insert.
--
-- KNOWN GAP, carried forward deliberately: users_select_tenant grants
-- every tenant member read access to every other user's row — including
-- email since that column now lives here too. This is broader than the
-- Roles doc intends (a Client Admin can technically read users outside
-- their own org), but it's relied on today by the Tasks assignee picker
-- across Client/Manager/Accountant. Narrowing it needs an audit of every
-- place that depends on the broad version — worth prioritizing, not
-- fixed in this rebuild.
-- ------------------------------------------------------------

create policy "users_select_own" on users
  for select using (id = auth.uid());

create policy "users_select_tenant" on users
  for select using (tenant_id = current_user_tenant());

-- ------------------------------------------------------------
-- RLS — client_organizations
-- ------------------------------------------------------------

create policy "client_org_same_tenant" on client_organizations
  for select using (tenant_id = current_user_tenant());

create policy "client_organizations_insert_super_admin" on client_organizations
  for insert with check (
    current_user_role() = 'super_admin'
    and tenant_id = current_user_tenant()
  );

create policy "client_organizations_update_super_admin" on client_organizations
  for update using (
    current_user_role() = 'super_admin'
    and tenant_id = current_user_tenant()
  );

-- ------------------------------------------------------------
-- RLS — manager_assignments
-- Architecture §8: only Super Admin assigns a Client Org to a Manager.
-- ------------------------------------------------------------

create policy "manager_assignments_own" on manager_assignments
  for select using (manager_id = auth.uid());

create policy "manager_assignments_select_client" on manager_assignments
  for select using (
    current_user_role() = 'client'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "manager_assignments_select_accountant" on manager_assignments
  for select using (
    current_user_role() = 'accountant'
    and is_accountant_of_client(client_org_id)
  );

create policy "manager_assignments_select_super_admin" on manager_assignments
  for select using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "manager_assignments_select_client_admin" on manager_assignments
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "manager_assignments_insert_super_admin" on manager_assignments
  for insert with check (current_user_role() = 'super_admin');

create policy "manager_assignments_update_super_admin" on manager_assignments
  for update using (current_user_role() = 'super_admin');

create policy "manager_assignments_delete_super_admin" on manager_assignments
  for delete using (current_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- RLS — accountant_assignments
-- Architecture §8: a Manager assigns an Accountant only to a client THEY
-- are themselves assigned to.
-- ------------------------------------------------------------

create policy "accountant_assignments_own" on accountant_assignments
  for select using (
    accountant_id = auth.uid()
    or is_manager_of_client(client_org_id)
  );

create policy "accountant_assignments_select_client" on accountant_assignments
  for select using (
    current_user_role() = 'client'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

-- Architecture §8.1 — Accountant workload visibility: a Manager sees
-- which OTHER clients an Accountant already handles, tenant-wide, not
-- just clients that Manager assigned themselves.
create policy "accountant_assignments_tenant_managers" on accountant_assignments
  for select using (
    current_user_role() = 'manager'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "accountant_assignments_select_super_admin" on accountant_assignments
  for select using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "accountant_assignments_select_client_admin" on accountant_assignments
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "accountant_assignments_insert_manager" on accountant_assignments
  for insert with check (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "accountant_assignments_update_manager" on accountant_assignments
  for update using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "accountant_assignments_delete_manager" on accountant_assignments
  for delete using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

-- ------------------------------------------------------------
-- RLS — documents
-- "All Clients" toggle (Architecture §6.6/9.1) is additive on top of the
-- base *_select policies — Postgres OR's multiple SELECT policies on the
-- same table together. Update policies stay scoped to a role's own
-- assigned clients only — "All Clients" is a visibility toggle, not an
-- action-scope change.
-- ------------------------------------------------------------

create policy "documents_client_select_own" on documents
  for select using (
    current_user_role() = 'client' and uploaded_by = auth.uid()
  );

create policy "documents_client_insert_own" on documents
  for insert with check (
    current_user_role() = 'client'
    and uploaded_by = auth.uid()
    and tenant_id = current_user_tenant()
  );

create policy "documents_accountant_select" on documents
  for select using (
    current_user_role() = 'accountant'
    and client_org_id in (select client_org_id from accountant_assignments where accountant_id = auth.uid())
  );

create policy "documents_accountant_select_tenant" on documents
  for select using (
    current_user_role() = 'accountant'
    and tenant_id = current_user_tenant()
  );

create policy "documents_accountant_update" on documents
  for update using (
    current_user_role() = 'accountant'
    and client_org_id in (select client_org_id from accountant_assignments where accountant_id = auth.uid())
  );

create policy "documents_manager_select" on documents
  for select using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "documents_manager_select_tenant" on documents
  for select using (
    current_user_role() = 'manager'
    and tenant_id = current_user_tenant()
  );

create policy "documents_manager_update" on documents
  for update using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "documents_select_super_admin" on documents
  for select using (
    current_user_role() = 'super_admin'
    and tenant_id = current_user_tenant()
  );

create policy "documents_select_client_admin" on documents
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

-- ------------------------------------------------------------
-- RLS — tasks
-- Architecture §7.6 scoping. Update: §7.3 — assignee marks Complete,
-- creator can Reopen; both are already narrowed to a specific person's
-- own id, so one policy safely covers both directions.
-- ------------------------------------------------------------

create policy "tasks_select_client" on tasks
  for select using (
    current_user_role() = 'client'
    and (creator_id = auth.uid() or assignee_id = auth.uid())
  );

create policy "tasks_select_manager" on tasks
  for select using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "tasks_select_accountant" on tasks
  for select using (
    current_user_role() = 'accountant'
    and client_org_id in (select client_org_id from accountant_assignments where accountant_id = auth.uid())
  );

create policy "tasks_select_super_admin" on tasks
  for select using (
    current_user_role() = 'super_admin'
    and tenant_id = current_user_tenant()
  );

create policy "tasks_select_client_admin" on tasks
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "tasks_insert_client" on tasks
  for insert with check (
    current_user_role() = 'client'
    and creator_id = auth.uid()
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "tasks_insert_manager" on tasks
  for insert with check (
    current_user_role() = 'manager'
    and creator_id = auth.uid()
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "tasks_insert_accountant" on tasks
  for insert with check (
    current_user_role() = 'accountant'
    and creator_id = auth.uid()
    and client_org_id in (select client_org_id from accountant_assignments where accountant_id = auth.uid())
  );

create policy "tasks_update_participant" on tasks
  for update using (
    assignee_id = auth.uid() or creator_id = auth.uid()
  );

-- ------------------------------------------------------------
-- Background jobs — Architecture §7.4 (recurrence), §7.5 (overdue),
-- §13 (background jobs / scheduler).
-- generate_recurring_task_occurrences includes the client_org_name fix
-- (this column didn't exist when the function was first written — an
-- earlier version silently produced NULL client_org_name on every
-- auto-generated recurring task).
-- ------------------------------------------------------------

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
      tenant_id, client_org_id, client_org_name, title, description,
      creator_id, creator_name, creator_role,
      assignee_id, assignee_name, assignee_role,
      priority, due_date, status,
      recurring, recurrence_term, parent_task_id
    ) values (
      r.tenant_id, r.client_org_id, r.client_org_name, r.title, r.description,
      r.creator_id, r.creator_name, r.creator_role,
      r.assignee_id, r.assignee_name, r.assignee_role,
      r.priority, new_due, 'in_progress',
      true, r.recurrence_term, r.id
    );

    update tasks set next_occurrence_generated_at = now() where id = r.id;
  end loop;
end;
$$;

create or replace function public.escalate_overdue_tasks()
returns void
language plpgsql
security definer
as $$
begin
  update tasks
  set escalated = true
  where status = 'in_progress'
    and due_date < current_date
    and escalated = false;
end;
$$;

select cron.schedule(
  'generate-recurring-tasks-daily',
  '0 1 * * *',
  $$select public.generate_recurring_task_occurrences();$$
);

select cron.schedule(
  'escalate-overdue-tasks-daily',
  '5 1 * * *',
  $$select public.escalate_overdue_tasks();$$
);

-- ============================================================
-- Done. Next step: seed at least one tenant row, e.g.:
--   insert into tenants (id, firm_name) values
--     ('11111111-1111-1111-1111-111111111111', 'Test Firm');
-- then create your first Super Admin per the earlier process (an
-- auth.users account, plus a matching public.users row referencing that
-- tenant, role = 'super_admin', client_org_id = null). Everything after
-- that goes through the app itself.
-- ============================================================