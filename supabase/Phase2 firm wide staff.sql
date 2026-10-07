-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_phase2_firm_wide_staff.sql
--
-- Resolves the scenario this session's testing surfaced directly: a
-- Manager/Accountant with zero (or currently zero) client_assignments
-- rows cannot upload ANY work document at all — not even an
-- org-general one — because every existing insert/select/update policy
-- for staff work documents resolves "which orgs are mine" through a
-- live client_assignments join, and an empty join is an empty set.
--
-- Fix, per direct product decision (not in the Architecture doc, an
-- explicit extension): Super Admin can flip a per-user flag,
-- firm_wide_staff, on specific Manager/Accountant accounts — e.g. a
-- compliance officer who needs to broadcast firm-wide notices without
-- personally managing any Client. Only flagged users get this; everyone
-- else is completely unaffected, still requiring a real client
-- relationship exactly as before. Deliberately opt-in per account
-- rather than automatic for every Manager/Accountant, to avoid a
-- brand-new hire with zero clients being able to broadcast to the
-- entire client base by default.
--
-- Scope: firm-wide privilege applies ONLY to org-general documents
-- (client_id null) — it does not grant access to any specific Client, a
-- Client-tied document (client_id set) still requires a real
-- client_assignments row exactly as before. No new sharing control is
-- needed on top: the existing "Share with Clients" checkbox already
-- decides whether a firm-wide broadcast also reaches individual Clients
-- (Client Admin already sees every document in their org unconditionally
-- regardless — Migration_phase2_client_admin_full_visibility.sql — so
-- leaving that checkbox off already means "Client Admins only," on
-- means "Client Admins and Clients").
--
-- Requires every previous Phase 2 documents migration already applied.
-- Safe to run once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The flag itself.
-- ------------------------------------------------------------

alter table users add column firm_wide_staff boolean not null default false;

-- ------------------------------------------------------------
-- 2. Super Admin can toggle it, on Manager/Accountant accounts in their
-- own tenant only. Like every other user-editing path in this schema,
-- there's no column-level RLS in Postgres to restrict this to ONLY the
-- firm_wide_staff column — the app is trusted to send just that field in
-- its update payload, same pattern already relied on elsewhere (e.g.
-- client_assignments' saveEdit).
-- ------------------------------------------------------------

create policy "users_update_firm_wide_staff_super_admin" on users
  for update using (
    current_user_role() = 'super_admin'
    and tenant_id = current_user_tenant()
    and role in ('manager','accountant')
  );

-- ------------------------------------------------------------
-- 3. Expanded org-general rights for flagged users — additive policies,
-- layered on top of (not replacing) the existing documents_manager_*_work
-- / documents_accountant_*_work policies from
-- Migration_phase2_documents_reassignment_visibility_fix.sql. Postgres
-- ORs every applicable policy together, so a normally-assigned Manager
-- keeps working exactly as before; these only ever add reach for someone
-- specifically flagged.
-- ------------------------------------------------------------

create policy "documents_manager_insert_firm_wide" on documents
  for insert with check (
    current_user_role() = 'manager'
    and uploaded_by = auth.uid()
    and source = 'manager'
    and tenant_id = current_user_tenant()
    and client_id is null
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

create policy "documents_manager_select_firm_wide" on documents
  for select using (
    current_user_role() = 'manager'
    and source = 'manager'
    and client_id is null
    and uploaded_by = auth.uid()
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

create policy "documents_manager_update_firm_wide" on documents
  for update using (
    current_user_role() = 'manager'
    and source = 'manager'
    and client_id is null
    and uploaded_by = auth.uid()
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

create policy "documents_accountant_insert_firm_wide" on documents
  for insert with check (
    current_user_role() = 'accountant'
    and uploaded_by = auth.uid()
    and source = 'accountant'
    and tenant_id = current_user_tenant()
    and client_id is null
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

create policy "documents_accountant_select_firm_wide" on documents
  for select using (
    current_user_role() = 'accountant'
    and source = 'accountant'
    and client_id is null
    and uploaded_by = auth.uid()
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

create policy "documents_accountant_update_firm_wide" on documents
  for update using (
    current_user_role() = 'accountant'
    and source = 'accountant'
    and client_id is null
    and uploaded_by = auth.uid()
    and exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
  );

-- Note what these three (per role) deliberately do NOT do: they don't
-- make a firm-wide user's own broadcast visible to every OTHER
-- firm-wide user, and they don't touch Tier 1 (client-tied) documents
-- at all. A normally-assigned Manager/Accountant who currently serves an
-- org a firm-wide user broadcasts to will still see it through the
-- EXISTING documents_manager_select_work / documents_accountant_select_work
-- policy (Tier 2, institutional, shared_with_clients = true) — this
-- migration only had to solve the firm-wide UPLOADER's own visibility
-- gap, not duplicate logic that already works.
--
-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'users' and column_name = 'firm_wide_staff';
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname like '%firm_wide%';
-- Second query should return 6 rows.
-- ============================================================