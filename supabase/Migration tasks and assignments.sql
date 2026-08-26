-- ============================================================
-- Incremental migration #2 — run this on top of everything you've
-- already applied (core schema + migration_assignment_policies.sql).
-- Adds: tasks table + RLS, and two visibility policies needed for
-- task assignee pickers and the Manager's Accountant Assignment screen.
-- ============================================================

-- ------------------------------------------------------------
-- tasks (Architecture Section 7)
-- Simplifications for this pass: no recurrence, no linked_document_id,
-- no overdue/escalation (needs a scheduler — Section 13, deferred).
-- creator_name / assignee_name / assignee_role are denormalized at
-- write time so task lists don't need a join under RLS.
-- ------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  client_org_id uuid references client_organizations(id) not null,
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
  created_at timestamptz default now()
);

alter table tasks enable row level security;

-- Select: matches Section 7.6 scoping.
-- Client — only tasks where they are personally creator or assignee.
create policy "tasks_select_client" on tasks
  for select using (
    current_user_role() = 'client'
    and (creator_id = auth.uid() or assignee_id = auth.uid())
  );

-- Manager / Accountant — scoped to their assigned clients. (The Architecture
-- doc flags Manager/Accountant Tasks scope as an open item — platform-wide
-- vs. My Clients/All Clients toggle, Section 7.6. Scoping by assigned
-- clients here for consistency with how Documents already works; revisit
-- if the open item gets resolved the other way.)
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

-- Insert: creator must be who they say they are, and the client_org_id
-- must be one they're actually allowed to raise a task against.
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

-- Update: Section 7.3 — assignee marks Complete, creator can Reopen.
-- Both are already narrowed to a specific person's own id, so this
-- single policy safely covers both directions.
create policy "tasks_update_participant" on tasks
  for update using (
    assignee_id = auth.uid() or creator_id = auth.uid()
  );

-- ------------------------------------------------------------
-- Broadened visibility needed for the features above:
-- ------------------------------------------------------------

-- Users previously could only select their OWN row. Task assignee pickers
-- (Client picking their Manager/Accountant, Manager picking a Client or
-- Accountant, etc.) need to read other users' name + role within the same
-- firm. This is a deliberate simplification — exposes name/role only,
-- nothing sensitive — scoped to same tenant, not cross-firm.
create policy "users_select_tenant" on users
  for select using (tenant_id = current_user_tenant());

-- Accountant workload visibility (Architecture Section 8.1): a Manager
-- needs to see which OTHER clients an Accountant already serves — not
-- just the ones the current Manager assigned. Existing policy
-- accountant_assignments_own only covered the Manager's own clients;
-- this adds the tenant-wide view for Managers specifically.
create policy "accountant_assignments_tenant_managers" on accountant_assignments
  for select using (
    current_user_role() = 'manager'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );