-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_phase2_staff_docs_refinement.sql
--
-- Two corrections found via direct user testing, both real.
--
-- 1. Client Admin gate for STAFF work documents. Migration_phase2_
-- client_admin_full_visibility.sql made documents_select_client_admin
-- fully unconditional — correct for Client-sourced documents (matches
-- Architecture §6.6's literal "every document uploaded by any user in
-- that org," no sharing gate described), but wrong for staff work
-- documents: a private Manager<->Accountant exchange
-- (shared_with_clients = false) must stay private from Client Admin
-- too, not leak just because Client Admin's baseline is otherwise
-- unconditional. Client-sourced documents are unaffected — still fully
-- unconditional, unchanged.
--
-- 2. "Inactive" staff losing edit rights on their own Tier 3 documents.
-- Migration_phase2_documents_reassignment_visibility_fix.sql correctly
-- kept a private (Tier 3) document permanently with its uploader rather
-- than transferring it — but "permanently with the uploader" shouldn't
-- mean a Manager/Accountant who now has ZERO current client
-- relationships anywhere (and isn't firm-wide staff) can still edit it.
-- Someone with no active assignment at all isn't currently acting in
-- that role in any capacity — editing implies ongoing participation.
-- Viewing is unaffected (they can still see their own history); this
-- only tightens EDIT rights specifically, per what was actually flagged.
--
-- Requires every previous Phase 2 documents/firm-wide-staff migration
-- already applied. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Fix 1 — Client Admin gate
-- ------------------------------------------------------------

drop policy if exists "documents_select_client_admin" on documents;
create policy "documents_select_client_admin" on documents
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
    and source = 'client'
  );

drop policy if exists "documents_client_admin_select_staff_shared_with_clients" on documents;
create policy "documents_client_admin_select_staff_shared_with_clients" on documents
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
    and source in ('manager','accountant')
    and shared_with_clients = true
  );

-- ------------------------------------------------------------
-- Fix 2 — Tier 3 edit rights require the uploader to still be active
-- ------------------------------------------------------------

drop policy if exists "documents_manager_update_work" on documents;
create policy "documents_manager_update_work" on documents
  for update using (
    current_user_role() = 'manager'
    and source = 'manager'
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where manager_id = auth.uid()))
      or
      (client_id is null and shared_with_clients = true and client_org_id in (select client_org_id from client_assignments where manager_id = auth.uid()))
      or
      (
        client_id is null and shared_with_clients = false and uploaded_by = auth.uid()
        and (
          exists (select 1 from client_assignments where manager_id = auth.uid())
          or exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
        )
      )
    )
  );

drop policy if exists "documents_accountant_update_work" on documents;
create policy "documents_accountant_update_work" on documents
  for update using (
    current_user_role() = 'accountant'
    and source = 'accountant'
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where accountant_id = auth.uid()))
      or
      (client_id is null and shared_with_clients = true and client_org_id in (select client_org_id from client_assignments where accountant_id = auth.uid()))
      or
      (
        client_id is null and shared_with_clients = false and uploaded_by = auth.uid()
        and (
          exists (select 1 from client_assignments where accountant_id = auth.uid())
          or exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
        )
      )
    )
  );

-- Verify:
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname in ('documents_select_client_admin','documents_client_admin_select_staff_shared_with_clients');
--   -- 2 rows expected
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname in ('documents_manager_update_work','documents_accountant_update_work');
--   -- 2 rows expected
-- ============================================================