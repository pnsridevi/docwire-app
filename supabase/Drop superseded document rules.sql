-- Drop superseded document rules.sql, 20 Nov 2026
-- Already done on your live Supabase, but never saved in the repo. "Fix document visibiltiy.sql" replaced the
-- staff work-file rules with documents_manager_select_work / _accountant_select_work / _update_work, which show
-- an organisation-wide work file only to that Client's own Manager and Accountant. These six older rules were
-- left behind in the repo's files; the two "_shared_work" rules still show such files to any Manager or
-- Accountant with a Client in that organisation (the leak that file fixed), and the four "_own_upload" rules
-- are covered by the newer ones. On live they are already gone, so running this there changes nothing.
drop policy if exists "documents_manager_select_shared_work" on public.documents;
drop policy if exists "documents_accountant_select_shared_work" on public.documents;
drop policy if exists "documents_manager_select_own_upload" on public.documents;
drop policy if exists "documents_accountant_select_own_upload" on public.documents;
drop policy if exists "documents_manager_update_own_upload" on public.documents;
drop policy if exists "documents_accountant_update_own_upload" on public.documents;
