-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_phase2_client_admin_full_visibility.sql
--
-- Corrects a design decision from earlier in the Phase 2 build that did
-- not actually trace back to the Architecture doc. §6.6 states Client
-- Admin's Documents scope plainly: "own client organization only, but
-- organization-wide: every document uploaded by any user in that org
-- (uses Document.client_org_id only)." No sharing gate is described —
-- Migration_phase2_documents_tasks.sql's documents_select_client_admin
-- (section A.7) added one anyway (source = 'client' only, with staff
-- work docs requiring shared_with_client_admin = true). This reverts
-- that gate: Client Admin sees every document in their org, staff work
-- or Client-source, shared or not — same as the pre-Phase-2 behavior,
-- now confirmed correct against the actual spec rather than assumed.
--
-- shared_with_client_admin (the column) is left in place, just no
-- longer referenced by any policy or by the upload/edit UI — simpler to
-- leave unused than to drop and risk losing whatever's already been
-- written to it. Safe to run any time after
-- Migration_phase2_documents_tasks.sql.
-- ============================================================

drop policy if exists "documents_select_client_admin" on documents;
create policy "documents_select_client_admin" on documents
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

-- No longer needed — the unconditional policy above already covers every
-- case this one used to gate.
drop policy if exists "documents_client_admin_select_shared_work" on documents;

-- Verify:
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname like '%client_admin%';
-- Should show exactly one Client Admin SELECT policy now, unconditional.
-- ============================================================