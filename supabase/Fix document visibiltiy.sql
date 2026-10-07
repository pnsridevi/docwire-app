-- Fixes cross-manager / cross-client leakage on org-general ("shared with
-- clients", client_id null) staff work documents.
--
-- Root cause: the affected policies scoped visibility by "is this ORG one
-- I have any client in", via client_org_id IN (client_assignments...).
-- That was correct back when an org had exactly one Manager and one
-- Accountant. Now that a single org can be split across multiple
-- Managers (e.g. Aarthi handling one client, Damo handling another in
-- the same org "Moto - client 1"), that org-level check made an
-- org-general broadcast from either of them visible to both — and made
-- it visible to every Client in the org, not just the ones actually
-- assigned to that specific Manager/Accountant.
--
-- Fix: for a document's own uploader, visibility is unconditional (you
-- always see your own org-general uploads, shared or not). For everyone
-- else — the counterpart role (Manager<->Accountant) and Clients — the
-- correct check is "does this specific uploader currently show up as MY
-- assigned Manager/Accountant, via client_assignments", not "do we
-- happen to share an org."
--
-- Client-specific documents (client_id IS NOT NULL) are UNCHANGED here —
-- those already worked correctly, since they were always scoped by the
-- live client_assignments.client_id, not the org.

-- ============================================================
-- 1. Manager viewing manager/accountant-sourced work documents
-- ============================================================
drop policy if exists documents_manager_select_work on public.documents;
create policy documents_manager_select_work on public.documents
for select
using (
  (current_user_role() = 'manager')
  and (source = any (array['manager','accountant']))
  and (
    -- Own role's org-general docs: always visible to the uploader,
    -- regardless of shared_with_clients — that flag controls whether
    -- CLIENTS see it, not whether other staff should.
    (source = 'manager' and (
      (client_id is not null and client_id in (
        select client_id from client_assignments where manager_id = auth.uid()
      ))
      or (client_id is null and uploaded_by = auth.uid())
    ))
    -- Counterpart role's docs (Accountant sharing with Manager): only
    -- visible if that specific Accountant is genuinely MY counterpart
    -- for at least one client (in that org, for an org-general doc) —
    -- not just any Accountant active somewhere in the same org.
    or (source = 'accountant' and shared_with_manager = true and (
      (client_id is not null and client_id in (
        select client_id from client_assignments
        where manager_id = auth.uid() and accountant_id = documents.uploaded_by
      ))
      or (client_id is null and exists (
        select 1 from client_assignments
        where manager_id = auth.uid()
          and accountant_id = documents.uploaded_by
          and client_org_id = documents.client_org_id
      ))
    ))
  )
);

-- ============================================================
-- 2. Accountant viewing manager/accountant-sourced work documents
--    (exact mirror of #1)
-- ============================================================
drop policy if exists documents_accountant_select_work on public.documents;
create policy documents_accountant_select_work on public.documents
for select
using (
  (current_user_role() = 'accountant')
  and (source = any (array['manager','accountant']))
  and (
    (source = 'accountant' and (
      (client_id is not null and client_id in (
        select client_id from client_assignments where accountant_id = auth.uid()
      ))
      or (client_id is null and uploaded_by = auth.uid())
    ))
    or (source = 'manager' and shared_with_accountant = true and (
      (client_id is not null and client_id in (
        select client_id from client_assignments
        where accountant_id = auth.uid() and manager_id = documents.uploaded_by
      ))
      or (client_id is null and exists (
        select 1 from client_assignments
        where accountant_id = auth.uid()
          and manager_id = documents.uploaded_by
          and client_org_id = documents.client_org_id
      ))
    ))
  )
);

-- ============================================================
-- 3. Manager editing their own manager-sourced work documents
--    (same leak existed here too — a Manager could previously EDIT
--    another Manager's org-general doc just by sharing an org)
-- ============================================================
drop policy if exists documents_manager_update_work on public.documents;
create policy documents_manager_update_work on public.documents
for update
using (
  (current_user_role() = 'manager')
  and (source = 'manager')
  and (
    (client_id is not null and client_id in (
      select client_id from client_assignments where manager_id = auth.uid()
    ))
    or (client_id is null and uploaded_by = auth.uid() and (
      exists (select 1 from client_assignments where manager_id = auth.uid())
      or exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
    ))
  )
);

-- ============================================================
-- 4. Accountant editing their own accountant-sourced work documents
--    (exact mirror of #3)
-- ============================================================
drop policy if exists documents_accountant_update_work on public.documents;
create policy documents_accountant_update_work on public.documents
for update
using (
  (current_user_role() = 'accountant')
  and (source = 'accountant')
  and (
    (client_id is not null and client_id in (
      select client_id from client_assignments where accountant_id = auth.uid()
    ))
    or (client_id is null and uploaded_by = auth.uid() and (
      exists (select 1 from client_assignments where accountant_id = auth.uid())
      or exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
    ))
  )
);

-- ============================================================
-- 5. Client viewing staff-shared work documents — THE actual fix for
--    what you saw: Gandhi and Nandini, in the same org but with
--    different Managers, both seeing each other's staff broadcasts.
-- ============================================================
drop policy if exists documents_client_select_shared_work on public.documents;
create policy documents_client_select_shared_work on public.documents
for select
using (
  (current_user_role() = 'client')
  and (source = any (array['manager','accountant']))
  and (shared_with_clients = true)
  and (
    (client_id = auth.uid())
    or (client_id is null and exists (
      select 1 from client_assignments ca
      where ca.client_id = auth.uid()
        and ca.client_org_id = documents.client_org_id
        and (
          (documents.source = 'manager' and ca.manager_id = documents.uploaded_by)
          or (documents.source = 'accountant' and ca.accountant_id = documents.uploaded_by)
        )
    ))
  )
);