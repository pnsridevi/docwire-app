-- migration_add_staff_direct_tasks_and_docs.sql
--
-- Enables: a Manager can create a task for (or share a document with) an
-- Accountant directly, with no Client involved at all — and vice versa.
-- Previously every task/document required a real client_id (Phase 2
-- decision: "purely staff-to-staff coordination stays out of Tasks
-- entirely"). This migration deliberately reverses that decision.

-- 1. Both tasks and documents required client_id/client_org_id — make
--    them nullable so a genuinely internal, no-client record can exist.
alter table public.tasks alter column client_id drop not null;
alter table public.tasks alter column client_org_id drop not null;
alter table public.documents alter column client_org_id drop not null;
-- documents.client_id was already nullable (used for org-general
-- broadcasts) — no change needed there.

-- 2. A direct document share needs to target exactly ONE specific
--    person, not a role-wide group. shared_with_manager/
--    shared_with_accountant are deliberately broad ("any Manager/
--    Accountant who shares a client with me") — reusing them here would
--    let every Manager in the firm see a document meant for one specific
--    Accountant, since there is no client_assignments relationship left
--    to scope by once client_id is null. A dedicated column keeps a
--    direct share exactly as point-to-point as the task it's attached
--    to (a task always has exactly one assignee already).
alter table public.documents
  add column if not exists shared_with_user_id uuid null references public.users(id);

-- 3. RLS — both new policies are scoped to `client_id is null`, so they
--    can only ever apply to the NEW direct case. Every existing
--    client-scoped policy on tasks/documents is untouched — Postgres
--    permissive policies OR together, so this only WIDENS visibility for
--    rows that no earlier policy could have matched anyway (client_id
--    was never null before this migration).

drop policy if exists "tasks_select_staff_direct_no_client" on public.tasks;
create policy "tasks_select_staff_direct_no_client"
on public.tasks for select
to authenticated
using (
  client_id is null
  and (creator_id = auth.uid() or assignee_id = auth.uid())
);

drop policy if exists "documents_select_direct_share" on public.documents;
create policy "documents_select_direct_share"
on public.documents for select
to authenticated
using (
  client_id is null
  and (uploaded_by = auth.uid() or shared_with_user_id = auth.uid())
);

-- Note: this migration does NOT touch INSERT policies on tasks/documents.
-- If your existing INSERT policies check client_id (e.g. "client_id in
-- my assigned clients"), a direct no-client insert could still be
-- rejected — verify against your actual live INSERT policies before
-- relying on this in production. Flagged here rather than guessed at,
-- since this session doesn't have those policies' exact text to edit
-- safely.