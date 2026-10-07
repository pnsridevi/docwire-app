-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_phase2_documents_own_upload_fix.sql
-- Patches a real gap found while building D.2 (AccountantHomeScreen.tsx /
-- ManagerHomeScreen.tsx's real Upload Work Document form).
--
-- Migration_phase2_documents_tasks.sql (section A) gave Manager/
-- Accountant visibility into SHARED staff work documents
-- (documents_manager_select_shared_work / _accountant_select_shared_work,
-- both gated on shared_with_<role> = true), but never gave either role
-- visibility into their OWN uploads independent of sharing. A Manager who
-- uploads a work document and leaves every sharing checkbox off
-- (perfectly valid — sharing is optional) would be unable to see or edit
-- their own document afterward, since no existing policy covers
-- "uploaded_by = me" for source in ('manager','accountant'). This adds
-- exactly that — select AND update, since D.2 also requires the upload
-- being editable after the fact.
--
-- Requires Migration_phase2_documents_tasks.sql already applied. Safe to
-- run once, any time after that.
-- ============================================================

create policy "documents_manager_select_own_upload" on documents
  for select using (
    current_user_role() = 'manager'
    and source = 'manager'
    and uploaded_by = auth.uid()
  );

create policy "documents_accountant_select_own_upload" on documents
  for select using (
    current_user_role() = 'accountant'
    and source = 'accountant'
    and uploaded_by = auth.uid()
  );

create policy "documents_manager_update_own_upload" on documents
  for update using (
    current_user_role() = 'manager'
    and source = 'manager'
    and uploaded_by = auth.uid()
  );

create policy "documents_accountant_update_own_upload" on documents
  for update using (
    current_user_role() = 'accountant'
    and source = 'accountant'
    and uploaded_by = auth.uid()
  );

-- Verify:
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname like '%own_upload%';
-- Should list all four policies above.
-- ============================================================