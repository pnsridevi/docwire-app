-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Shared_master_categories.sql
-- Run after every previous migration. Safe to run more than once.
--
-- Agreed 23 Oct 2026: ONE standard list of Master Document categories,
-- stored once and shared by every firm (today's and every future one).
-- A firm's own additions stay visible only to that firm.
--
--   Standard category / sub-tag   tenant_id is NULL. Every firm sees it.
--                                 Nobody can rename or hide it from the
--                                 app; it is added or changed only here,
--                                 in SQL, once, for everyone.
--   A firm's own entry            tenant_id = that firm. Only that firm
--                                 sees it; its Managers and Super Admin
--                                 add, rename and hide it (unchanged).
--                                 A firm can add its own sub-tag under a
--                                 standard category, e.g. "GSTR-2B" under
--                                 GST — also visible only to that firm.
--
-- What this file does
--   1. Apex's 30 default rows become the standard list. They keep their
--      ids, so Apex's Master Documents keep their categories.
--   2. Every other firm's copy of the defaults (Moto corp's 30 rows) is
--      removed. The file stops if any Master Document uses one of them.
--   3. Rules: everyone signed in reads the standard list plus their own
--      firm's entries; a firm can't add a name that already exists in the
--      standard list or in its own list (same parent, ignoring capitals
--      and spaces); a Master Document can only use a standard entry or
--      one of its own firm's entries.
--   4. seed_master_categories() is removed — copying the list into each
--      firm is no longer how it works, and running it again would create
--      duplicates. A new firm needs nothing extra.
--
-- To add a standard category later (all firms get it at once):
--   insert into master_categories (tenant_id, name, is_default)
--   values (null, 'New category', true);
-- A standard sub-tag:
--   insert into master_categories (tenant_id, name, parent_id, is_default)
--   values (null, 'New sub-tag',
--     (select id from master_categories where tenant_id is null and parent_id is null and name = 'GST'),
--     true);
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. Stop if the data isn't what this file expects.
-- ------------------------------------------------------------

do $$
declare
  v_source uuid;
begin
  -- Already done (standard rows exist)? Then only the rules below are
  -- re-applied; the data steps are skipped.
  if exists (select 1 from public.master_categories where tenant_id is null) then
    raise notice 'Standard list already exists — data steps skipped, rules re-applied.';
    return;
  end if;

  -- A brand-new database (e.g. production) has no categories at all:
  -- only the rules are applied. Then run Seed_standard_master_categories.sql.
  if not exists (select 1 from public.master_categories) then
    raise notice 'No categories yet (new database) — rules applied only. Now run Seed_standard_master_categories.sql.';
    return;
  end if;

  select id into v_source from public.tenants where firm_name = 'Apex Consultancies Ltd';
  if v_source is null then
    raise exception 'Firm "Apex Consultancies Ltd" not found. Nothing changed.';
  end if;

  if (select count(*) from public.master_categories where tenant_id = v_source and is_default) <> 30 then
    raise exception 'Apex does not have exactly 30 default categories/sub-tags. Nothing changed — send the output of the check query to Claude.';
  end if;

  if exists (
    select 1 from public.master_documents m
    join public.master_categories c on c.id in (m.category_id, m.subtag_id)
    where c.is_default and c.tenant_id <> v_source
  ) then
    raise exception 'A Master Document outside Apex uses that firm''s own copy of a default category. Nothing changed — send this message to Claude.';
  end if;
end $$;


-- ------------------------------------------------------------
-- 1. tenant_id may now be empty (= standard).
-- ------------------------------------------------------------

alter table public.master_categories alter column tenant_id drop not null;


-- ------------------------------------------------------------
-- 2. Data: Apex's defaults become the standard list; other firms'
-- copies are removed (sub-tags first, then categories).
-- ------------------------------------------------------------

do $$
declare
  v_source uuid;
  v_removed integer;
begin
  if exists (select 1 from public.master_categories where tenant_id is null)
     or not exists (select 1 from public.master_categories) then
    return;
  end if;

  select id into v_source from public.tenants where firm_name = 'Apex Consultancies Ltd';

  delete from public.master_categories
   where is_default and tenant_id <> v_source and parent_id is not null;
  get diagnostics v_removed = row_count;

  delete from public.master_categories
   where is_default and tenant_id <> v_source and parent_id is null;

  -- The category trigger keeps a row's firm fixed on every update, so it
  -- is switched off for this one statement only (same transaction).
  alter table public.master_categories disable trigger master_categories_check;
  update public.master_categories
     set tenant_id = null
   where tenant_id = v_source and is_default;
  alter table public.master_categories enable trigger master_categories_check;

  if (select count(*) from public.master_categories where tenant_id is null) <> 30 then
    raise exception 'Standard list did not come out as 30 entries. Nothing changed.';
  end if;

  raise notice 'Standard list created from Apex''s defaults; other firms'' copies removed.';
end $$;


-- ------------------------------------------------------------
-- 3. One name per place. The old unique index ignored empty tenant_id
-- (Postgres treats empties as all different), so it is rebuilt to treat
-- the standard list as one more "firm". Clashes BETWEEN the standard
-- list and a firm's own list are checked by the trigger in step 4.
-- ------------------------------------------------------------

drop index if exists public.master_categories_unique_name;
create unique index master_categories_unique_name
  on public.master_categories (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );


-- ------------------------------------------------------------
-- 4. Category trigger. Same as Update_master_documents_permissions.sql,
-- plus: a parent may be standard; a firm's new or renamed entry can't
-- repeat a standard name in the same place (and the other way round).
-- The error code 23505 makes the app show its usual "already exists"
-- message.
-- ------------------------------------------------------------

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
  elsif new.parent_id is not null and not exists (
    select 1 from master_categories p
    where p.id = new.parent_id and p.parent_id is null
      and (p.tenant_id is null or p.tenant_id = new.tenant_id)
  ) then
    raise exception 'A sub-tag must sit under a top-level category of your firm or of the standard list.';
  end if;

  if (tg_op = 'INSERT' or lower(new.name) <> lower(old.name)) and exists (
    select 1 from master_categories x
    where x.id <> new.id
      and coalesce(x.parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(new.parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(trim(x.name)) = lower(new.name)
      and (x.tenant_id is null or new.tenant_id is null or x.tenant_id = new.tenant_id)
  ) then
    raise exception '"%" already exists here.', new.name using errcode = '23505';
  end if;

  return new;
end;
$$;


-- ------------------------------------------------------------
-- 5. Who can read what. Signed-in users only (the standard list was
-- never meant for signed-out callers). Add/rename/hide rules are
-- unchanged: they require tenant_id = your firm, so standard entries
-- can't be added, renamed or hidden from the app.
-- ------------------------------------------------------------

drop policy if exists "master_categories_select_tenant" on public.master_categories;
create policy "master_categories_select_tenant" on public.master_categories
  for select to authenticated
  using (tenant_id is null or tenant_id = current_user_tenant());


-- ------------------------------------------------------------
-- 6. Master Documents trigger. Identical to
-- Update_master_documents_permissions.sql except the two category
-- checks at the top: a category or sub-tag may be standard or the
-- firm's own — never another firm's.
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
  -- under that same category. Each must be standard or this firm's own.
  if not exists (
    select 1 from master_categories c
    where c.id = new.category_id and c.parent_id is null
      and (c.tenant_id is null or c.tenant_id = new.tenant_id)
  ) then
    raise exception 'Pick a valid category for this Master Document.';
  end if;
  if new.subtag_id is not null and not exists (
    select 1 from master_categories s
    where s.id = new.subtag_id and s.parent_id = new.category_id
      and (s.tenant_id is null or s.tenant_id = new.tenant_id)
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
-- 7. The per-firm copy function is no longer used.
-- ------------------------------------------------------------

drop function if exists public.seed_master_categories(uuid);

commit;


-- ============================================================
-- Check after running:
--
--   select coalesce(t.firm_name, '(standard)') as owner, count(*)
--   from master_categories c left join tenants t on t.id = c.tenant_id
--   group by 1;
--     -- (standard) 30, and no rows for Apex, Moto corp or Ainsyt
--     -- (unless a firm had added its own entries).
--
--   select count(*) from master_documents m
--   join master_categories c on c.id = m.category_id
--   where c.tenant_id is null;
--     -- 8 (all of Apex's Master Documents, on standard categories)
-- ============================================================