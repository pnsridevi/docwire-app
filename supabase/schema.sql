-- ============================================================
-- DocWire MVP schema: Tenant, User, ClientOrganization, Document
-- + assignment tables + Row Level Security policies
-- Paste this whole file into the Supabase SQL editor and run it.
-- ============================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  firm_name text not null,
  created_at timestamptz default now()
);

create table client_organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  name text not null,
  created_at timestamptz default now()
);

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  client_org_id uuid references client_organizations(id),
  name text,
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
  name text not null,
  needs_entry boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending','accounted','reviewed','rework','filed')),
  comment text,
  uploaded_by uuid references users(id) not null,
  created_at timestamptz default now()
);

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

alter table users enable row level security;
alter table client_organizations enable row level security;
alter table manager_assignments enable row level security;
alter table accountant_assignments enable row level security;
alter table documents enable row level security;

create policy "users_select_own" on users
  for select using (id = auth.uid());

create policy "client_org_same_tenant" on client_organizations
  for select using (tenant_id = current_user_tenant());

-- ------------------------------------------------------------
-- manager_assignments
-- ------------------------------------------------------------
create policy "manager_assignments_own" on manager_assignments
  for select using (manager_id = auth.uid());

-- Only Super Admin assigns a Client Org to a Manager (Architecture Section 8).
-- No client_org_id ownership check needed here since Super Admin is platform-wide.
create policy "manager_assignments_insert_super_admin" on manager_assignments
  for insert with check (current_user_role() = 'super_admin');

create policy "manager_assignments_update_super_admin" on manager_assignments
  for update using (current_user_role() = 'super_admin');

create policy "manager_assignments_delete_super_admin" on manager_assignments
  for delete using (current_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- accountant_assignments
-- ------------------------------------------------------------
create policy "accountant_assignments_own" on accountant_assignments
  for select using (
    accountant_id = auth.uid()
    or client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

-- A Manager can only assign an Accountant to a client THEY are themselves
-- assigned to (Architecture Section 8: "a Manager cannot assign an Accountant
-- to a client they have not themselves been assigned").
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
-- documents
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

create policy "documents_manager_update" on documents
  for update using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );