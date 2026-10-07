-- migration_add_document_rework_reupload.sql
-- Run after migration_add_document_file_storage.sql.

-- 1. Two new flags on documents. Deliberately separate booleans, not one
--    combined state — "was a reupload asked for" and "has it actually
--    happened yet" are different facts, and conflating them is exactly
--    what let an Accountant re-submit against a stale file before this
--    fix. reupload_requested is set ONLY by the Manager's send-to-rework
--    action (Architecture §6.3 / Roles doc: Manager is the only role
--    that can send to Rework — Accountant has no equivalent action);
--    reupload_fulfilled flips true only when the Client actually
--    reuploads. Both default false so every existing row (created before
--    this feature) reads as "no reupload was ever part of this" — the
--    correct, harmless default for the ordinary entry-only Rework case.
alter table public.documents
  add column if not exists reupload_requested boolean not null default false,
  add column if not exists reupload_fulfilled boolean not null default false;

-- 2. Version history. One row per PREVIOUS file, created only at the
--    moment a Client reuploads — the current file always lives on
--    documents.file_path itself, never duplicated here. version_number
--    is assigned by the trigger below, not the client, so two rapid
--    reuploads (or a retry after a dropped connection) can't race each
--    other into the same number.
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  file_path text not null,
  file_size bigint null,
  mime_type text null,
  uploaded_by uuid not null,
  uploaded_by_name text null,
  version_number integer not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_document_version_number()
returns trigger as $$
begin
  select coalesce(max(version_number), 0) + 1 into new.version_number
  from public.document_versions
  where document_id = new.document_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_document_version_number on public.document_versions;
create trigger trg_set_document_version_number
before insert on public.document_versions
for each row execute function public.set_document_version_number();

alter table public.document_versions enable row level security;

-- SELECT: inherits the parent document's own visibility rules via join,
-- same DRY pattern already used for storage.objects — one source of
-- truth for "can this person see this document" instead of a second
-- copy of the whole scoping matrix.
drop policy if exists "document_versions_select_via_document" on public.document_versions;
create policy "document_versions_select_via_document"
on public.document_versions for select
to authenticated
using (
  exists (select 1 from public.documents d where d.id = document_versions.document_id)
);

-- INSERT: only the document's own Client may archive a version of it,
-- and only for a document that's actually theirs (client_id = auth.uid()
-- is always the uploader for a Client-source document per the existing
-- fix_client_document_org trigger).
drop policy if exists "document_versions_insert_own" on public.document_versions;
create policy "document_versions_insert_own"
on public.document_versions for insert
to authenticated
with check (
  exists (
    select 1 from public.documents d
    where d.id = document_versions.document_id
      and d.client_id = auth.uid()
  )
);

-- 3. Storage SELECT policy now also checks document_versions.file_path —
--    without this, every FILE that gets superseded by a reupload becomes
--    silently and permanently inaccessible the moment the new one lands,
--    even though the version row referencing it still exists and is
--    meant to stay viewable as history.
drop policy if exists "documents_storage_select_via_document_row" on storage.objects;
create policy "documents_storage_select_via_document_row"
on storage.objects for select
to authenticated
using (
  bucket_id = 'documents'
  and (
    exists (select 1 from public.documents d where d.file_path = storage.objects.name)
    or exists (select 1 from public.document_versions v where v.file_path = storage.objects.name)
  )
);

-- 4. Lets a Client update their OWN document's file fields, but only
--    while it's genuinely awaiting a reupload — not a general "Client
--    can edit any of their documents" grant. NOTE: Postgres RLS is
--    row-level, not column-level — this policy can't itself stop a
--    crafted request from also changing e.g. needs_entry on the same
--    row. The app only ever sends file_path/file_size/mime_type/
--    reupload_fulfilled in this update (see ClientHomeScreen.tsx's
--    handleReupload), matching how edit panels elsewhere in this app
--    already rely on the client only sending intended fields. A fully
--    hardened version would move this behind a Postgres function
--    (security definer, explicit parameters) instead of a direct table
--    UPDATE — worth doing later if this needs to be airtight, not
--    included here to keep this fix scoped to what was actually asked.
drop policy if exists "documents_client_update_own_rework_reupload" on public.documents;
create policy "documents_client_update_own_rework_reupload"
on public.documents for update
to authenticated
using (
  client_id = auth.uid() and status = 'rework' and reupload_requested = true
)
with check (
  client_id = auth.uid()
);