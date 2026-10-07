-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_client_assignment_foundation.sql
-- Architecture Document Revision 3, §8.1-8.2. Phase 1 of the per-client
-- staff assignment build — foundation only. Nothing in Documents/Tasks
-- RLS changes here; that's Phase 2, on top of this, once this phase is
-- confirmed correct in isolation.
--
-- Safe to run once on the schema produced by DocWire_Full_Schema_Rebuild.sql
-- (with Migration_tasks_revert_tenant_wide.sql already applied, or never
-- needed). Idempotent-ish via IF NOT EXISTS / OR REPLACE where practical,
-- but this is a real schema change — run once, on a database you can
-- inspect afterward.
-- ============================================================


-- ------------------------------------------------------------
-- 1. accountant_assignments — move write authority Manager -> Super Admin
-- Roles & Responsibilities Revision 2: Manager loses "Assign Accountant
-- -> Client"; Super Admin gains it, at both org level (this table) and
-- per-client level (client_assignments below).
-- ------------------------------------------------------------

drop policy if exists "accountant_assignments_insert_manager" on accountant_assignments;
drop policy if exists "accountant_assignments_update_manager" on accountant_assignments;
drop policy if exists "accountant_assignments_delete_manager" on accountant_assignments;

create policy "accountant_assignments_insert_super_admin" on accountant_assignments
  for insert with check (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "accountant_assignments_update_super_admin" on accountant_assignments
  for update using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "accountant_assignments_delete_super_admin" on accountant_assignments
  for delete using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

-- accountant_assignments_tenant_managers (§8.3 workload visibility — Manager
-- can still SEE tenant-wide Accountant workload) is untouched: read access
-- for Managers is unaffected, only write access moved.


-- ------------------------------------------------------------
-- 2. client_assignments — the live, current-state per-client table
-- Architecture §8.2. One row per individual Client. No default/override
-- distinction: a new Client's row is seeded from the org defaults at
-- creation time, then stands on its own — org-level changes afterward do
-- NOT cascade to already-created rows (§8.2, no bulk reassignment).
-- ------------------------------------------------------------

create table client_assignments (
  client_id     uuid primary key references users(id) on delete cascade,
  client_org_id uuid references client_organizations(id) not null,
  manager_id    uuid references users(id) not null,
  accountant_id uuid references users(id) not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id)
);

alter table client_assignments enable row level security;

-- Read access: every role that currently reads manager_assignments /
-- accountant_assignments gets an equivalent read here, since this table
-- is about to become the actual source of truth Documents/Tasks RLS
-- resolves against (Phase 2).

create policy "client_assignments_select_self" on client_assignments
  for select using (client_id = auth.uid());

create policy "client_assignments_select_manager" on client_assignments
  for select using (current_user_role() = 'manager' and manager_id = auth.uid());

create policy "client_assignments_select_accountant" on client_assignments
  for select using (current_user_role() = 'accountant' and accountant_id = auth.uid());

create policy "client_assignments_select_client_admin" on client_assignments
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "client_assignments_select_super_admin" on client_assignments
  for select using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

-- Write access: Super Admin only, both fields, per §8.2 ("Super Admin is
-- the only actor who can edit a ClientAssignment row, for both the
-- Manager and Accountant fields").

create policy "client_assignments_insert_super_admin" on client_assignments
  for insert with check (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "client_assignments_update_super_admin" on client_assignments
  for update using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

-- No delete policy: a Client's row is removed only via the users(id)
-- on delete cascade above (i.e. when the Client account itself is
-- deleted), never independently.


-- ------------------------------------------------------------
-- 3. client_assignment_history — append-only audit log, no bearing on
-- RLS or visibility anywhere (§8.2, resolves design addendum Open Item 2:
-- reassignment is live, this table is purely a record of what happened).
-- ------------------------------------------------------------

create table client_assignment_history (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null,
  client_org_id     uuid not null,
  old_manager_id    uuid,
  new_manager_id    uuid,
  old_accountant_id uuid,
  new_accountant_id uuid,
  changed_at        timestamptz not null default now(),
  changed_by        uuid
);

alter table client_assignment_history enable row level security;

-- Read-only, Super Admin only — this is an audit trail, not something any
-- other role needs or should see.
create policy "client_assignment_history_select_super_admin" on client_assignment_history
  for select using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

-- No insert/update/delete policies for any role — this table is written
-- exclusively by the trigger below (security definer, bypasses RLS),
-- never directly by the app.


-- ------------------------------------------------------------
-- 4. Trigger — log every client_assignments change to history.
-- Fires on both INSERT (initial seed, old_* = null) and UPDATE
-- (reassignment).
-- ------------------------------------------------------------

create or replace function public.log_client_assignment_change()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into client_assignment_history (
    client_id, client_org_id,
    old_manager_id, new_manager_id,
    old_accountant_id, new_accountant_id,
    changed_by
  ) values (
    new.client_id, new.client_org_id,
    case when tg_op = 'UPDATE' then old.manager_id else null end, new.manager_id,
    case when tg_op = 'UPDATE' then old.accountant_id else null end, new.accountant_id,
    auth.uid()
  );
  return new;
end;
$$;

create trigger client_assignments_log_change
  after insert or update on client_assignments
  for each row execute function public.log_client_assignment_change();


-- ------------------------------------------------------------
-- 5. Trigger — auto-seed a new Client's client_assignments row from the
-- org's current defaults, and BLOCK Client creation if the org doesn't
-- have both a default Manager and a default Accountant yet (§8.1).
--
-- Fires on insert into users where role = 'client'. Runs as the row is
-- created by admin-create-user (service-role, bypasses RLS) — this
-- trigger is the actual enforcement point, not the Edge Function's own
-- logic, so the block holds even if the Edge Function's checks are ever
-- bypassed or out of date.
-- ------------------------------------------------------------

create or replace function public.seed_client_assignment()
returns trigger
language plpgsql
security definer
as $$
declare
  v_manager_id uuid;
  v_accountant_id uuid;
begin
  if new.role <> 'client' then
    return new;
  end if;

  select manager_id into v_manager_id
    from manager_assignments where client_org_id = new.client_org_id;

  select accountant_id into v_accountant_id
    from accountant_assignments where client_org_id = new.client_org_id;

  if v_manager_id is null or v_accountant_id is null then
    raise exception
      'Cannot create a Client under client_org_id % — this organization does not yet have both a default Manager and a default Accountant assigned (Architecture §8.1). Assign both via Super Admin before creating Clients.',
      new.client_org_id;
  end if;

  insert into client_assignments (client_id, client_org_id, manager_id, accountant_id, updated_by)
  values (new.id, new.client_org_id, v_manager_id, v_accountant_id, new.id);

  return new;
end;
$$;

create trigger users_seed_client_assignment
  after insert on users
  for each row execute function public.seed_client_assignment();


-- ------------------------------------------------------------
-- 6. One-time backfill — every EXISTING Client gets a row, copied from
-- their org's current default. Without this, every existing Client
-- simply has no client_assignments row at all (the trigger above only
-- fires on new inserts going forward).
--
-- This does not raise on missing org defaults the way the trigger does —
-- if an existing org somehow has Clients but no complete default pair,
-- that Client is skipped and logged via the NOTICE below rather than
-- blocking the whole backfill. Check the output before moving to Phase 2.
-- ------------------------------------------------------------

do $$
declare
  r record;
  v_manager_id uuid;
  v_accountant_id uuid;
  v_skipped int := 0;
begin
  for r in select id, client_org_id from users where role = 'client' loop
    select manager_id into v_manager_id from manager_assignments where client_org_id = r.client_org_id;
    select accountant_id into v_accountant_id from accountant_assignments where client_org_id = r.client_org_id;

    if v_manager_id is null or v_accountant_id is null then
      v_skipped := v_skipped + 1;
      raise notice 'Skipped client_id % (client_org_id %) — org missing a default Manager and/or Accountant.', r.id, r.client_org_id;
      continue;
    end if;

    insert into client_assignments (client_id, client_org_id, manager_id, accountant_id)
    values (r.id, r.client_org_id, v_manager_id, v_accountant_id)
    on conflict (client_id) do nothing;
  end loop;

  raise notice 'Backfill complete. % client(s) skipped — see NOTICEs above.', v_skipped;
end $$;


-- ============================================================
-- Done with Phase 1. Verify before moving to Phase 2:
--   select count(*) from users where role = 'client';
--   select count(*) from client_assignments;
-- These two counts should match. If they don't, some org is missing a
-- default Manager or Accountant — check the NOTICEs from step 6 above,
-- assign the missing default(s) via Super Admin, then re-run just step 6
-- (the do $$ ... $$ block) to pick up the stragglers.
--
-- Phase 2 (next): rewrite documents/tasks RLS to resolve through
-- client_assignments instead of manager_assignments/accountant_assignments
-- directly, and add the required client_id column to both tables.
-- ============================================================