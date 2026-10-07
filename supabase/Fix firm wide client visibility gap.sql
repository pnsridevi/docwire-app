-- migration_fix_firm_wide_client_visibility_gap.sql
-- Run after every previous migration in this project.
--
-- The bug: Phase2_firm_wide_staff.sql's own comment claims "the Share
-- with Clients checkbox already decides whether a firm-wide broadcast
-- also reaches individual Clients" — but Fix_document_visibiltiy.sql's
-- documents_client_select_shared_work (written to close the Gandhi/
-- Nandini leak) requires the Client to have a real, CURRENT
-- client_assignments row pointing at this exact uploader. Firm-wide
-- staff broadcasting into an org they have no real assignment in can
-- never satisfy that — so "Share with Clients" silently does nothing
-- for a firm-wide broadcast. Two migrations, written separately, never
-- cross-checked against each other.
--
-- Fix: one new, narrow, additive rule. Doesn't touch or loosen anything
-- else — a normal (non-firm-wide) Manager/Accountant's documents are
-- completely unaffected, since this only ever matches when the uploader
-- is specifically flagged firm_wide_staff.

drop policy if exists "documents_client_select_firm_wide_broadcast" on documents;
create policy "documents_client_select_firm_wide_broadcast" on documents
  for select using (
    current_user_role() = 'client'
    and source in ('manager', 'accountant')
    and shared_with_clients = true
    and client_id is null
    and client_org_id = (select client_org_id from users where id = auth.uid())
    and exists (
      select 1 from users u
      where u.id = documents.uploaded_by
        and u.firm_wide_staff = true
    )
  );

-- Note: Client Admin needs no equivalent fix — Migration_phase2_client_
-- admin_full_visibility.sql already makes Client Admin's view of their
-- own org fully unconditional, so a firm-wide broadcast was already
-- visible to Client Admin regardless of this gap. Only the Client-level
-- visibility was actually broken.

-- Verify:
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname = 'documents_client_select_firm_wide_broadcast';
-- 1 row expected.