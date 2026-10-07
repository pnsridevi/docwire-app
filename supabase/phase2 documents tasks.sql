-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_phase2_documents_tasks.sql
-- Phase 2 (Phase2_Change_List.md), sections A (documents) and B (tasks).
-- Implements the client_assignments-resolved RLS rewrite that item 7 of
-- the session summary diagnosed as missing, plus the sharing model and
-- work-document upload support from the Architecture doc.
--
-- Requires, already applied, in order:
--   DocWire_Full_Schema_Rebuild.sql
--   Migration_client_assignment_foundation.sql
--   Migration_manager_assignments_tenant_scope.sql
--
-- This migration is NOT fully idempotent — it's a real schema change with
-- a manual verification gate (see the tasks.client_id NOT NULL step near
-- the end). Read through before running; don't just paste-and-run blind
-- the way the smaller tenant-scope fix was safe to.
-- ============================================================


-- ============================================================
-- SECTION A — documents
-- ============================================================

-- ------------------------------------------------------------
-- A.1 — client_id. Nullable: null means "general to the whole org",
-- set means "about this one specific Client" (Architecture §5.1/§6.4).
-- ------------------------------------------------------------

alter table documents add column client_id uuid references users(id);

-- ------------------------------------------------------------
-- A.2 — four independent sharing booleans, all default false so every
-- existing row starts unshared (safe default — nothing leaks on
-- migration day that wasn't already visible before).
-- ------------------------------------------------------------

alter table documents add column shared_with_manager boolean not null default false;
alter table documents add column shared_with_accountant boolean not null default false;
alter table documents add column shared_with_client_admin boolean not null default false;
alter table documents add column shared_with_clients boolean not null default false;

-- ------------------------------------------------------------
-- A.3 — source. Decided (change list §E.1): role-specific, not a generic
-- 'staff' value, so the UI can show "from your Manager" vs "from your
-- Accountant" without an extra join. Auto-set at creation, never
-- user-picked.
-- ------------------------------------------------------------

alter table documents add column source text not null default 'client'
  check (source in ('client','manager','accountant'));

-- Backfill: every row that exists today was uploaded under the old
-- client-only flow (there was never an INSERT policy for Manager/
-- Accountant on this table — see A.8's comment) — so source='client'
-- (the column default) is already correct for all of them. This update
-- is a no-op in practice but documents the reasoning rather than relying
-- on silence.
update documents set source = 'client' where source = 'client';

-- Backfill client_id for existing rows: a client-source document's
-- client_id is always its own uploader.
update documents set client_id = uploaded_by where source = 'client';

-- ------------------------------------------------------------
-- A.4 — trigger: force client_org_id/client_id from the uploader's own
-- row on every client-source insert, rather than trusting whatever the
-- app sent. Closes the "client_org_id never verified" gap the
-- Architecture doc's change log flagged. Fires before the WITH CHECK on
-- the insert policies below is evaluated (Postgres evaluates RLS against
-- the row as it stands after BEFORE triggers run), so A.9's tightened
-- policy can rely on this having already run.
-- ------------------------------------------------------------

create or replace function public.fix_client_document_org()
returns trigger
language plpgsql
security definer
as $$
declare
  v_client_org_id uuid;
begin
  if new.source = 'client' then
    select client_org_id into v_client_org_id from users where id = new.uploaded_by;
    new.client_org_id := v_client_org_id;
    new.client_id := new.uploaded_by;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_fix_client_org on documents;
create trigger documents_fix_client_org
  before insert on documents
  for each row execute function public.fix_client_document_org();

-- ------------------------------------------------------------
-- A.5 — remove the tenant-wide fallback (the "All Clients" toggle's
-- backing policies, Architecture §6.6 removes that toggle in Revision 3)
-- and resolve the per-client policies through client_assignments instead
-- of accountant_assignments/manager_assignments. Scoped to
-- source = 'client' — the shared-work-document case gets its own
-- policies in A.6, kept separate so each stays readable.
-- ------------------------------------------------------------

drop policy if exists "documents_accountant_select_tenant" on documents;
drop policy if exists "documents_manager_select_tenant" on documents;

drop policy if exists "documents_accountant_select" on documents;
create policy "documents_accountant_select" on documents
  for select using (
    current_user_role() = 'accountant'
    and source = 'client'
    and client_id in (select client_id from client_assignments where accountant_id = auth.uid())
  );

drop policy if exists "documents_manager_select" on documents;
create policy "documents_manager_select" on documents
  for select using (
    current_user_role() = 'manager'
    and source = 'client'
    and client_id in (select client_id from client_assignments where manager_id = auth.uid())
  );

drop policy if exists "documents_accountant_update" on documents;
create policy "documents_accountant_update" on documents
  for update using (
    current_user_role() = 'accountant'
    and source = 'client'
    and client_id in (select client_id from client_assignments where accountant_id = auth.uid())
  );

drop policy if exists "documents_manager_update" on documents;
create policy "documents_manager_update" on documents
  for update using (
    current_user_role() = 'manager'
    and source = 'client'
    and client_id in (select client_id from client_assignments where manager_id = auth.uid())
  );

-- ------------------------------------------------------------
-- A.6 — new SELECT policies for shared staff work documents. One each
-- for Manager, Accountant, Client Admin, Client. Two shapes per role:
-- doc is about one specific Client (client_id set) -> viewer must be
-- assigned to that Client; doc is org-general (client_id null) -> viewer
-- must be assigned to at least one Client in that org. client_assignments
-- carries client_org_id directly (Migration_client_assignment_foundation.sql),
-- so both shapes resolve through the same table without a join back to
-- client_organizations.
-- ------------------------------------------------------------

create policy "documents_manager_select_shared_work" on documents
  for select using (
    current_user_role() = 'manager'
    and source in ('manager','accountant')
    and shared_with_manager = true
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where manager_id = auth.uid()))
      or
      (client_id is null and client_org_id in (select client_org_id from client_assignments where manager_id = auth.uid()))
    )
  );

create policy "documents_accountant_select_shared_work" on documents
  for select using (
    current_user_role() = 'accountant'
    and source in ('manager','accountant')
    and shared_with_accountant = true
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where accountant_id = auth.uid()))
      or
      (client_id is null and client_org_id in (select client_org_id from client_assignments where accountant_id = auth.uid()))
    )
  );

create policy "documents_client_admin_select_shared_work" on documents
  for select using (
    current_user_role() = 'client_admin'
    and source in ('manager','accountant')
    and shared_with_client_admin = true
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

-- Decided (change list §E.2): a Client-specific shared doc reaches only
-- that one Client, not the whole org; an org-general shared doc reaches
-- every Client in the org, per the Architecture doc's original wording.
create policy "documents_client_select_shared_work" on documents
  for select using (
    current_user_role() = 'client'
    and source in ('manager','accountant')
    and shared_with_clients = true
    and (
      client_id = auth.uid()
      or (client_id is null and client_org_id = (select client_org_id from users where id = auth.uid()))
    )
  );

-- ------------------------------------------------------------
-- A.7 — rewrite documents_select_client_admin. The old version was
-- unconditional org-wide, which is now too permissive under the sharing
-- model: an unshared staff work doc would leak to Client Admin just by
-- client_org_id matching. Client-source docs stay org-wide (unchanged
-- behavior); staff work docs now require the explicit share, which
-- documents_client_admin_select_shared_work (A.6) already grants when
-- true — Postgres ORs multiple SELECT policies together, same pattern
-- the schema's own comments already establish for the old "All Clients"
-- toggle.
-- ------------------------------------------------------------

drop policy if exists "documents_select_client_admin" on documents;
create policy "documents_select_client_admin" on documents
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select client_org_id from users where id = auth.uid())
    and source = 'client'
  );

-- ------------------------------------------------------------
-- A.8 — new INSERT policies for Manager/Accountant work documents.
-- Neither existed before this migration — there was no INSERT policy for
-- either role on `documents` at all, which is the actual reason "Upload
-- Work Document" has only ever been a placeholder Alert in
-- AccountantHomeScreen.tsx/ManagerHomeScreen.tsx, not a missing frontend
-- feature. client_id null (org-general) requires the uploader be
-- assigned to at least one Client in that org; client_id set requires
-- they're assigned to that specific Client.
-- ------------------------------------------------------------

create policy "documents_manager_insert_work_doc" on documents
  for insert with check (
    current_user_role() = 'manager'
    and uploaded_by = auth.uid()
    and source = 'manager'
    and tenant_id = current_user_tenant()
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where manager_id = auth.uid()))
      or
      (client_id is null and client_org_id in (select client_org_id from client_assignments where manager_id = auth.uid()))
    )
  );

create policy "documents_accountant_insert_work_doc" on documents
  for insert with check (
    current_user_role() = 'accountant'
    and uploaded_by = auth.uid()
    and source = 'accountant'
    and tenant_id = current_user_tenant()
    and (
      (client_id is not null and client_id in (select client_id from client_assignments where accountant_id = auth.uid()))
      or
      (client_id is null and client_org_id in (select client_org_id from client_assignments where accountant_id = auth.uid()))
    )
  );

-- ------------------------------------------------------------
-- A.9 — tighten documents_client_insert_own so a Client can't insert a
-- row that looks like a staff work document. Safe to check source
-- directly here (rather than re-deriving it) because A.4's trigger has
-- already run and set client_id/client_org_id by the time this WITH
-- CHECK is evaluated.
-- ------------------------------------------------------------

drop policy if exists "documents_client_insert_own" on documents;
create policy "documents_client_insert_own" on documents
  for insert with check (
    current_user_role() = 'client'
    and uploaded_by = auth.uid()
    and tenant_id = current_user_tenant()
    and source = 'client'
  );


-- ============================================================
-- SECTION B — tasks
-- ============================================================

-- ------------------------------------------------------------
-- B.1 — client_id. Added nullable first, backfilled, then locked to
-- NOT NULL as a separate, manually-gated step below — every existing
-- task needs a real value before the constraint can hold, and a handful
-- of old staff-to-staff tasks (pre-dating the "every Task has a Client"
-- rule) have no client_id derivable automatically.
-- ------------------------------------------------------------

alter table tasks add column client_id uuid references users(id);

update tasks t
set client_id = t.creator_id
where exists (select 1 from users u where u.id = t.creator_id and u.role = 'client');

update tasks t
set client_id = t.assignee_id
where client_id is null
  and exists (select 1 from users u where u.id = t.assignee_id and u.role = 'client');

do $$
declare
  v_count int;
begin
  select count(*) into v_count from tasks where client_id is null;
  if v_count > 0 then
    raise notice
      '% task(s) have no derivable client_id — staff-to-staff tasks that predate the "every Task has a Client" rule. Assign one manually (update tasks set client_id = ... where id = ...) before running the NOT NULL step at the bottom of this file.',
      v_count;
  else
    raise notice 'All existing tasks have a client_id. Safe to run the NOT NULL step below.';
  end if;
end $$;

-- ------------------------------------------------------------
-- B.2 — trigger: auto-fill client_id when either party is a Client.
-- Staff-to-staff tasks (neither party is a Client) must supply client_id
-- explicitly — the trigger raises if it's missing, per Architecture §7.1
-- and the Phase 2 decision (change list §E.3) that Tasks keeps its "every
-- task has a real Client" rule with no exceptions.
-- ------------------------------------------------------------

create or replace function public.derive_task_client_id()
returns trigger
language plpgsql
security definer
as $$
declare
  v_creator_role text;
  v_assignee_role text;
begin
  select role into v_creator_role from users where id = new.creator_id;
  select role into v_assignee_role from users where id = new.assignee_id;

  if v_creator_role = 'client' then
    new.client_id := new.creator_id;
  elsif v_assignee_role = 'client' then
    new.client_id := new.assignee_id;
  elsif new.client_id is null then
    raise exception
      'A staff-to-staff task (neither creator nor assignee is a Client) must be given client_id explicitly — every Task needs a real Client behind it.';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_derive_client_id on tasks;
create trigger tasks_derive_client_id
  before insert on tasks
  for each row execute function public.derive_task_client_id();

-- ------------------------------------------------------------
-- B.3 — RLS: swap the per-client resolution from client_org_id against
-- manager_assignments/accountant_assignments to client_id against
-- client_assignments. No tenant-wide fallback exists for tasks today
-- (unlike documents before this migration), so this is a straight swap,
-- not also a removal.
--
-- tasks_select_client, tasks_select_super_admin, tasks_select_client_admin,
-- tasks_insert_client, tasks_update_participant are UNCHANGED —
-- Architecture §7.6 is explicit these roles' Tasks scoping doesn't move
-- in Revision 3.
-- ------------------------------------------------------------

drop policy if exists "tasks_select_manager" on tasks;
create policy "tasks_select_manager" on tasks
  for select using (
    current_user_role() = 'manager'
    and client_id in (select client_id from client_assignments where manager_id = auth.uid())
  );

drop policy if exists "tasks_select_accountant" on tasks;
create policy "tasks_select_accountant" on tasks
  for select using (
    current_user_role() = 'accountant'
    and client_id in (select client_id from client_assignments where accountant_id = auth.uid())
  );

drop policy if exists "tasks_insert_manager" on tasks;
create policy "tasks_insert_manager" on tasks
  for insert with check (
    current_user_role() = 'manager'
    and creator_id = auth.uid()
    and client_id in (select client_id from client_assignments where manager_id = auth.uid())
  );

drop policy if exists "tasks_insert_accountant" on tasks;
create policy "tasks_insert_accountant" on tasks
  for insert with check (
    current_user_role() = 'accountant'
    and creator_id = auth.uid()
    and client_id in (select client_id from client_assignments where accountant_id = auth.uid())
  );

-- ------------------------------------------------------------
-- B.4 — carry client_id through to auto-generated recurring occurrences.
-- Same pattern already used for client_org_name; couldn't be done before
-- because the column didn't exist. The new occurrence's client_id then
-- also passes through derive_task_client_id (B.2) on its own insert —
-- since it's already non-null and matches the parent's client, the
-- trigger's elsif branch doesn't fire and the value is left as-is.
-- ------------------------------------------------------------

create or replace function public.generate_recurring_task_occurrences()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  new_due date;
begin
  for r in
    select * from tasks
    where recurring = true
      and due_date = current_date
      and next_occurrence_generated_at is null
  loop
    new_due := case r.recurrence_term
      when 'weekly'    then r.due_date + interval '7 days'
      when 'monthly'   then r.due_date + interval '1 month'
      when 'quarterly' then r.due_date + interval '3 months'
      when 'yearly'    then r.due_date + interval '1 year'
    end;

    insert into tasks (
      tenant_id, client_org_id, client_org_name, client_id, title, description,
      creator_id, creator_name, creator_role,
      assignee_id, assignee_name, assignee_role,
      priority, due_date, status,
      recurring, recurrence_term, parent_task_id
    ) values (
      r.tenant_id, r.client_org_id, r.client_org_name, r.client_id, r.title, r.description,
      r.creator_id, r.creator_name, r.creator_role,
      r.assignee_id, r.assignee_name, r.assignee_role,
      r.priority, new_due, 'in_progress',
      true, r.recurrence_term, r.id
    );

    update tasks set next_occurrence_generated_at = now() where id = r.id;
  end loop;
end;
$$;


-- ============================================================
-- MANUAL GATE — run this only after the NOTICE above confirms zero
-- tasks with a null client_id (or after you've hand-assigned the
-- stragglers). Not run automatically as part of this file.
-- ============================================================

-- alter table tasks alter column client_id set not null;


-- ============================================================
-- Verify after running:
--   select count(*) from documents where source = 'client' and client_id is null;   -- expect 0
--   select count(*) from tasks where client_id is null;                              -- expect 0 (after the manual gate)
--   select polname from pg_policy where polrelid = 'documents'::regclass;
--   select polname from pg_policy where polrelid = 'tasks'::regclass;
-- ============================================================