-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Update_master_documents_permissions.sql
-- Run after every previous migration (Add_master_documents.sql and
-- Fix_recurring_task_catchup.sql included). Safe to run once.
--
-- Agreed 7 Oct 2026 (Part 5 summary, P5) plus the loophole review:
--
-- 1. Ownership. Every Master Document is either client-owned or
--    staff-owned, fixed when it is created (a marked document takes the
--    owner of the original regular document). Clients and Client Admins
--    can replace/edit client-owned documents of their own organisation;
--    staff-owned ones are read-only for them. Only staff and Super Admin
--    can delete or restore. Deleted documents are hidden from Clients
--    and Client Admins (their versions, log and files follow
--    automatically, because those all check the parent row).
--
-- 2. "Make this the current version". Setting file_path back to one of
--    the document's own older files is now recognised as a restore: the
--    current file is kept as a version as usual, the old file comes back
--    as a NEW version number, and the log says which version was
--    restored. Allowed for whoever can replace the document.
--
-- 3. Category management. Managers and Super Admin can add, rename and
--    hide categories and sub-tags (defaults included). Nothing is ever
--    deleted. Hidden ones can't be chosen for new uploads or edits, but
--    still show on documents already using them.
--
-- Loopholes closed in the same pass:
--   a. A Master Document's file could point at ANY stored file whose
--      path the person knew — and the storage rule would then let the
--      whole organisation open it. Now a new upload/replacement must be
--      a file the person uploaded themselves (their own storage folder),
--      a marked document must use exactly the original document's file,
--      and a restore must use one of the document's own older files.
--   b. Anyone could delete any file in their own storage folder,
--      including files still used by a document, a Master Document or a
--      kept version — breaking "nothing is ever deleted" for both
--      Documents and Master Documents. Now only files that nothing
--      points at can be deleted (which is all the app ever needed: the
--      clean-up after a failed upload).
--   c. A hidden category could still be sent directly in a request.
--      The database now refuses it.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Owner column + backfill for existing rows.
-- ------------------------------------------------------------

alter table public.master_documents
  add column if not exists owner text not null default 'staff'
  check (owner in ('client', 'staff'));

update public.master_documents m
set owner = case
  when m.source_document_id is not null then
    case when (select d.source from documents d where d.id = m.source_document_id) = 'client'
         then 'client' else 'staff' end
  else
    case when (select u.role from users u where u.id = m.uploaded_by) in ('client', 'client_admin')
         then 'client' else 'staff' end
end;


-- ------------------------------------------------------------
-- 2. Hidden flag on categories / sub-tags.
-- ------------------------------------------------------------

alter table public.master_categories
  add column if not exists hidden boolean not null default false;


-- ------------------------------------------------------------
-- 3. New log action for restores.
-- ------------------------------------------------------------

alter table public.master_document_log drop constraint if exists master_document_log_action_check;
alter table public.master_document_log add constraint master_document_log_action_check
  check (action in ('created', 'marked', 'replaced', 'renamed', 'recategorised', 'deleted', 'restored', 'version_restored'));


-- ------------------------------------------------------------
-- 4. BEFORE trigger — same as Add_master_documents.sql, plus: owner,
-- the client-side permission rules, hidden-category refusal, and the
-- file-path rules (fresh upload / own older version only).
--
-- All checks are skipped when there is no signed-in user (auth.uid()
-- is null), i.e. when someone runs SQL directly in the dashboard.
-- ------------------------------------------------------------

create or replace function public.master_documents_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_client_side boolean := current_user_role() in ('client', 'client_admin');
  v_restore record;
begin
  select name into v_actor_name from users where id = v_actor;

  -- Category must be a top-level category; sub-tag (optional) must sit
  -- under that same category. Both must be this firm's own.
  if not exists (
    select 1 from master_categories c
    where c.id = new.category_id and c.parent_id is null and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Pick a valid category for this Master Document.';
  end if;
  if new.subtag_id is not null and not exists (
    select 1 from master_categories s
    where s.id = new.subtag_id and s.parent_id = new.category_id
  ) then
    raise exception 'That sub-tag does not belong to the chosen category.';
  end if;

  -- Hidden categories / sub-tags can't be newly chosen. A document that
  -- already uses one keeps it (only checked when the value changes).
  if (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and exists (select 1 from master_categories c where c.id = new.category_id and c.hidden) then
    raise exception 'That category is hidden and can no longer be chosen. Pick another one.';
  end if;
  if new.subtag_id is not null
     and (tg_op = 'INSERT' or new.subtag_id is distinct from old.subtag_id)
     and exists (select 1 from master_categories s where s.id = new.subtag_id and s.hidden) then
    raise exception 'That sub-tag is hidden and can no longer be chosen. Pick another one.';
  end if;

  new.name := trim(new.name);

  if tg_op = 'INSERT' then
    -- Owner: a marked document takes the owner of the original regular
    -- document; a direct upload takes the uploader's side.
    if new.source_document_id is not null then
      select case when d.source = 'client' then 'client' else 'staff' end
        into new.owner
        from documents d where d.id = new.source_document_id;
      -- The Master Document always records the original's file exactly.
      new.source_file_path := new.file_path;
    else
      select case when u.role in ('client', 'client_admin') then 'client' else 'staff' end
        into new.owner
        from users u where u.id = new.uploaded_by;
      new.source_file_path := null;
    end if;
    new.owner := coalesce(new.owner, 'staff');

    select name into new.client_org_name from client_organizations where id = new.client_org_id;
    new.uploaded_by_name := v_actor_name;
    new.file_uploaded_by := new.uploaded_by;
    new.file_uploaded_by_name := v_actor_name;
    new.current_version := 1;
    new.created_at := now();
    new.updated_by := v_actor;
    new.updated_by_name := v_actor_name;
    new.updated_at := now();
    new.deleted_at := null;
    new.deleted_by := null;
    new.deleted_by_name := null;
    return new;
  end if;

  -- ---------- UPDATE ----------

  -- Client-side rules (Client and Client Admin are one side).
  if v_actor is not null and v_client_side then
    if old.owner = 'staff' then
      raise exception 'This document was added by your firm and can only be viewed, not changed.';
    end if;
    if (old.deleted_at is null) <> (new.deleted_at is null) then
      raise exception 'Only your firm can delete or restore Master Documents.';
    end if;
  end if;

  -- Who/where a Master Document belongs to never changes.
  new.tenant_id := old.tenant_id;
  new.client_org_id := old.client_org_id;
  new.client_org_name := old.client_org_name;
  new.uploaded_by := old.uploaded_by;
  new.uploaded_by_name := old.uploaded_by_name;
  new.created_at := old.created_at;
  new.source_document_id := old.source_document_id;
  new.source_file_path := old.source_file_path;
  new.owner := old.owner;

  if new.file_path is distinct from old.file_path then
    -- Restore of one of this document's own older files?
    select v.version_number, v.file_size, v.mime_type
      into v_restore
      from master_document_versions v
      where v.master_document_id = old.id and v.file_path = new.file_path
      order by v.version_number desc
      limit 1;

    if found then
      -- Size/type come from the kept version, never from the request.
      new.file_size := v_restore.file_size;
      new.mime_type := v_restore.mime_type;
    elsif v_actor is not null
          and coalesce((storage.foldername(new.file_path))[1], '') <> v_actor::text then
      -- A fresh file must be one this person just uploaded (their own
      -- storage folder) — never someone else's existing file.
      raise exception 'The new file must be one you uploaded yourself.';
    end if;

    insert into master_document_versions (
      master_document_id, version_number, file_path, file_size, mime_type,
      uploaded_by, uploaded_by_name, replaced_by, replaced_by_name
    ) values (
      old.id, old.current_version, old.file_path, old.file_size, old.mime_type,
      old.file_uploaded_by, old.file_uploaded_by_name, v_actor, v_actor_name
    );
    new.current_version := old.current_version + 1;
    new.file_uploaded_by := v_actor;
    new.file_uploaded_by_name := v_actor_name;
  else
    new.current_version := old.current_version;
    new.file_uploaded_by := old.file_uploaded_by;
    new.file_uploaded_by_name := old.file_uploaded_by_name;
    new.file_size := old.file_size;
    new.mime_type := old.mime_type;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := now();
    new.deleted_by := v_actor;
    new.deleted_by_name := v_actor_name;
  elsif old.deleted_at is not null and new.deleted_at is null then
    new.deleted_by := null;
    new.deleted_by_name := null;
  else
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
    new.deleted_by_name := old.deleted_by_name;
  end if;

  new.updated_by := v_actor;
  new.updated_by_name := v_actor_name;
  new.updated_at := now();
  return new;
end;
$$;


-- ------------------------------------------------------------
-- 5. AFTER trigger (the log) — same as before, except a file change
-- that brought back an older file is logged as 'version_restored'.
-- ------------------------------------------------------------

create or replace function public.master_documents_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_src_name text;
  v_old_cat text;
  v_new_cat text;
  v_restored_from integer;
begin
  select name into v_actor_name from users where id = v_actor;

  if tg_op = 'INSERT' then
    if new.source_document_id is not null then
      select name into v_src_name from documents where id = new.source_document_id;
      insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
      values (new.id, 'marked', 'Marked as master from document "' || coalesce(v_src_name, new.name) || '"', v_actor, v_actor_name);
    else
      insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
      values (new.id, 'created', 'Uploaded', v_actor, v_actor_name);
    end if;
    return new;
  end if;

  if new.file_path is distinct from old.file_path then
    -- The BEFORE trigger has already archived the old current file as
    -- version old.current_version, so look only at versions before it.
    select max(v.version_number) into v_restored_from
      from master_document_versions v
      where v.master_document_id = new.id
        and v.file_path = new.file_path
        and v.version_number < old.current_version;

    if v_restored_from is not null then
      insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
      values (new.id, 'version_restored',
              'Made version ' || v_restored_from || ' the current file again (saved as version ' || new.current_version
              || '; version ' || old.current_version || ' kept in history)',
              v_actor, v_actor_name);
    else
      insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
      values (new.id, 'replaced', 'Replaced file (version ' || old.current_version || ' kept in history)', v_actor, v_actor_name);
    end if;
  end if;

  if new.name is distinct from old.name then
    insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
    values (new.id, 'renamed', 'Renamed from "' || old.name || '" to "' || new.name || '"', v_actor, v_actor_name);
  end if;

  if new.category_id is distinct from old.category_id or new.subtag_id is distinct from old.subtag_id then
    select c.name || coalesce(' › ' || s.name, '') into v_old_cat
      from master_categories c left join master_categories s on s.id = old.subtag_id
      where c.id = old.category_id;
    select c.name || coalesce(' › ' || s.name, '') into v_new_cat
      from master_categories c left join master_categories s on s.id = new.subtag_id
      where c.id = new.category_id;
    insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
    values (new.id, 'recategorised', 'Moved from ' || coalesce(v_old_cat, '?') || ' to ' || coalesce(v_new_cat, '?'), v_actor, v_actor_name);
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
    values (new.id, 'deleted', 'Deleted (hidden, can be restored)', v_actor, v_actor_name);
  elsif old.deleted_at is not null and new.deleted_at is null then
    insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
    values (new.id, 'restored', 'Restored', v_actor, v_actor_name);
  end if;

  return new;
end;
$$;


-- ------------------------------------------------------------
-- 6. RLS — master_documents.
-- SELECT: Clients / Client Admins don't see deleted documents.
-- INSERT: the file must be the uploader's own (direct upload) or exactly
--   the original document's file, which the person must be able to see
--   and which must belong to the same organisation (marking). The
--   documents lookup runs under the person's own RLS, so they can only
--   mark a document they can actually see.
-- UPDATE: unchanged here; the client-side rules are in the trigger.
-- ------------------------------------------------------------

drop policy if exists "master_documents_select" on public.master_documents;
create policy "master_documents_select" on public.master_documents
  for select using (
    tenant_id = current_user_tenant()
    and can_access_master_org(client_org_id)
    and (deleted_at is null or current_user_role() not in ('client', 'client_admin'))
  );

drop policy if exists "master_documents_insert" on public.master_documents;
create policy "master_documents_insert" on public.master_documents
  for insert with check (
    tenant_id = current_user_tenant()
    and uploaded_by = auth.uid()
    and can_access_master_org(client_org_id)
    and (
      (source_document_id is null
        and (storage.foldername(file_path))[1] = auth.uid()::text)
      or
      (source_document_id is not null
        and exists (
          select 1 from public.documents d
          where d.id = master_documents.source_document_id
            and d.file_path = master_documents.file_path
            and d.client_org_id = master_documents.client_org_id
        ))
    )
  );


-- ------------------------------------------------------------
-- 7. Categories — Managers AND Super Admin add, rename and hide.
-- Nothing is deleted (still no DELETE policy). The trigger keeps a
-- category's place in the tree, its firm and its "default" flag fixed;
-- only the name and hidden flag can change. The existing unique index
-- keeps renames duplicate-free (ignoring capitals and spaces).
-- ------------------------------------------------------------

drop policy if exists "master_categories_insert_manager" on public.master_categories;
drop policy if exists "master_categories_insert_staff_admin" on public.master_categories;
create policy "master_categories_insert_staff_admin" on public.master_categories
  for insert with check (
    current_user_role() in ('manager', 'super_admin')
    and tenant_id = current_user_tenant()
    and created_by = auth.uid()
  );

drop policy if exists "master_categories_update_staff_admin" on public.master_categories;
create policy "master_categories_update_staff_admin" on public.master_categories
  for update
  using (current_user_role() in ('manager', 'super_admin') and tenant_id = current_user_tenant())
  with check (current_user_role() in ('manager', 'super_admin') and tenant_id = current_user_tenant());

create or replace function public.check_master_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := trim(new.name);

  if tg_op = 'UPDATE' then
    new.tenant_id := old.tenant_id;
    new.parent_id := old.parent_id;
    new.is_default := old.is_default;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    return new;
  end if;

  if new.parent_id is not null and not exists (
    select 1 from master_categories p
    where p.id = new.parent_id and p.parent_id is null and p.tenant_id = new.tenant_id
  ) then
    raise exception 'A sub-tag must sit under a top-level category in the same firm.';
  end if;
  return new;
end;
$$;


-- ------------------------------------------------------------
-- 8. Storage — a file can be deleted only by its uploader AND only if
-- nothing points at it. The lookup is a security definer function so it
-- sees every row (a Client must not be able to delete a file just
-- because the row using it is hidden from them, e.g. a deleted Master
-- Document).
-- ------------------------------------------------------------

create or replace function public.is_document_file_in_use(p_path text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from documents where file_path = p_path)
      or exists (select 1 from document_versions where file_path = p_path)
      or exists (select 1 from master_documents where file_path = p_path)
      or exists (select 1 from master_document_versions where file_path = p_path);
$$;

drop policy if exists "documents_storage_delete_own_folder" on storage.objects;
create policy "documents_storage_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_document_file_in_use(name)
);

-- Supabase Storage only deletes files the person can also SELECT, and
-- until now nobody could select a file that no row points at — so the
-- app's clean-up after a failed upload (deleteUploadedFile) silently did
-- nothing and left the file behind. This lets an uploader see their OWN
-- files that nothing uses yet (which is exactly the clean-up case). It
-- is a separate, additive SELECT policy; the existing one is unchanged.
drop policy if exists "documents_storage_select_own_unused" on storage.objects;
create policy "documents_storage_select_own_unused"
on storage.objects for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_document_file_in_use(name)
);


-- ============================================================
-- Verify after running:
--   select owner, count(*) from master_documents group by owner;
--     -- every existing row has 'client' or 'staff'
--   select column_name from information_schema.columns
--   where table_name = 'master_categories' and column_name = 'hidden';   -- 1 row
--   select polname from pg_policy where polrelid = 'master_categories'::regclass;
--     -- master_categories_select_tenant, _insert_staff_admin, _update_staff_admin
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass;
--     -- 4 rows (insert, select, select_own_unused, delete)
-- ============================================================