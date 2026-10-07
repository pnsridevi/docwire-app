-- migration_add_document_file_storage.sql
-- Run this once in the Supabase SQL Editor (or via CLI migration).
-- Idempotent: safe to re-run if it partially fails.

-- 1. New columns on documents. All nullable — existing rows (created
--    before real file storage existed) simply have no file attached,
--    which the UI already needs to handle gracefully regardless.
alter table public.documents
  add column if not exists file_path text null,
  add column if not exists file_size bigint null,
  add column if not exists mime_type text null;

-- 2. The private bucket. public=false is deliberate — these are
--    financial documents; access must go through RLS + signed URLs,
--    never a public URL.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- 3. INSERT policy: any authenticated user may write ONLY into a path
--    that starts with their own auth.uid(). This is deliberately a
--    simple ownership check, not a re-implementation of "can this user
--    create a Document for this client" — that's already enforced by
--    documents' own INSERT policies (Architecture §6.6/§9.1) and runs
--    separately when the documents row itself is inserted. This policy
--    only stops User A from writing into User B's storage folder before
--    any documents row exists yet to check against.
drop policy if exists "documents_storage_insert_own_folder" on storage.objects;
create policy "documents_storage_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. SELECT policy: reuse the documents table's own RLS instead of
--    duplicating the whole visibility matrix a second time here (My
--    Clients/All Clients toggle, Client Admin org-wide, Client
--    own-uploads-only, the §9 fix scoping "is this client mine" not "is
--    this org mine"). A storage object is visible only if a documents
--    row exists whose file_path matches it — and since that lookup runs
--    in the same session, it's automatically filtered by every existing
--    SELECT policy on public.documents. One source of truth, not two.
drop policy if exists "documents_storage_select_via_document_row" on storage.objects;
create policy "documents_storage_select_via_document_row"
on storage.objects for select
to authenticated
using (
  bucket_id = 'documents'
  and exists (
    select 1 from public.documents d
    where d.file_path = storage.objects.name
  )
);

-- 5. DELETE policy: only used for cleanup when a file uploads
--    successfully but the follow-up documents insert/update fails (see
--    lib/storage.ts's deleteUploadedFile) — scoped to the uploader's own
--    folder, same ownership check as insert.
drop policy if exists "documents_storage_delete_own_folder" on storage.objects;
create policy "documents_storage_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);