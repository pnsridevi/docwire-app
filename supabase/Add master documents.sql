-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Add_master_documents.sql
--
-- Master Documents: a permanent reference repository per CLIENT
-- ORGANISATION, separate from the day-to-day Documents pipeline.
-- Decisions confirmed with Venkatesh (October 2026):
--
--   Visibility  Every user of an org (Client Admin + all Clients) sees
--               that org's Master Documents. Managers/Accountants see
--               every org where they have at least one assigned Client
--               (client_assignments). Firm-wide staff and Super Admin see
--               every org in the tenant.
--   Upload      Everyone, within the orgs they can see.
--   Two ways in Uploaded directly, OR an existing regular document is
--               marked as master (the regular document stays where it is
--               and shows a "Master" tag in Documents).
--   Changes     No approval step. Every file replacement is kept as a
--               version, and every change is written to a log. Delete is
--               a soft delete (hidden, restorable), never a hard delete.
--   Categories  One firm-wide list, category + optional sub-tag. A
--               default list is seeded; Managers can add more.
--
-- Nothing in the existing documents / document_versions tables or their
-- policies is changed. The ONLY existing object touched is the storage
-- SELECT policy, which gains two more "this file belongs to a row you
-- can see" checks so Master Document files can be opened.
--
-- Requires every previous migration applied. Safe to run once.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Access helper — "can the current user see/act on this org's Master
-- Documents?" One function, used by every policy below, so the rule lives
-- in exactly one place. security definer so it reads users /
-- client_assignments / client_organizations directly without
-- re-triggering their own RLS (same pattern as is_manager_of_client).
-- ------------------------------------------------------------

create or replace function public.can_access_master_org(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when check_org_id is null then false
    -- Org must always belong to the caller's own firm.
    when not exists (
      select 1 from client_organizations o
      where o.id = check_org_id and o.tenant_id = current_user_tenant()
    ) then false
    when current_user_role() = 'super_admin' then true
    when current_user_role() in ('client_admin', 'client') then
      check_org_id = (select u.client_org_id from users u where u.id = auth.uid())
    when current_user_role() = 'manager' then
      exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
      or exists (select 1 from client_assignments ca
                 where ca.manager_id = auth.uid() and ca.client_org_id = check_org_id)
    when current_user_role() = 'accountant' then
      exists (select 1 from users u where u.id = auth.uid() and u.firm_wide_staff = true)
      or exists (select 1 from client_assignments ca
                 where ca.accountant_id = auth.uid() and ca.client_org_id = check_org_id)
    else false
  end;
$$;


-- ------------------------------------------------------------
-- 2. master_categories — one firm-wide list. A row with parent_id null
-- is a category; a row with parent_id set is a sub-tag under it. Only
-- two levels: a sub-tag can't have sub-tags of its own (enforced by the
-- trigger below).
-- ------------------------------------------------------------

create table if not exists public.master_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) > 0),
  parent_id uuid null references public.master_categories(id),
  is_default boolean not null default false,
  created_by uuid null references users(id),
  created_at timestamptz not null default now()
);

-- "Tax", "tax" and " Tax " are the same category. Sub-tag names only
-- need to be unique under their own parent.
create unique index if not exists master_categories_unique_name
  on public.master_categories (
    tenant_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

create or replace function public.check_master_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := trim(new.name);
  if new.parent_id is not null and not exists (
    select 1 from master_categories p
    where p.id = new.parent_id and p.parent_id is null and p.tenant_id = new.tenant_id
  ) then
    raise exception 'A sub-tag must sit under a top-level category in the same firm.';
  end if;
  return new;
end;
$$;

drop trigger if exists master_categories_check on public.master_categories;
create trigger master_categories_check
  before insert or update on public.master_categories
  for each row execute function public.check_master_category();

alter table public.master_categories enable row level security;

drop policy if exists "master_categories_select_tenant" on public.master_categories;
create policy "master_categories_select_tenant" on public.master_categories
  for select using (tenant_id = current_user_tenant());

-- Managers add categories and sub-tags (confirmed decision). No update/
-- delete policies yet: renaming/removing categories isn't part of this
-- first version, and a category in use must never disappear from under
-- its documents.
drop policy if exists "master_categories_insert_manager" on public.master_categories;
create policy "master_categories_insert_manager" on public.master_categories
  for insert with check (
    current_user_role() = 'manager'
    and tenant_id = current_user_tenant()
    and created_by = auth.uid()
  );


-- ------------------------------------------------------------
-- 3. Default category list, seeded for every existing firm. The function
-- is kept so a new firm (tenants row) can be seeded the same way:
--   select public.seed_master_categories('<tenant id>');
-- Idempotent — re-running skips anything already there.
-- ------------------------------------------------------------

create or replace function public.seed_master_categories(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cat record;
  sub text;
  v_parent uuid;
begin
  for cat in
    select * from (values
      ('Income Tax',               array['ITR Filings', 'Assessment Orders', 'Tax Notices']),
      ('GST',                      array['GSTR-1', 'GSTR-3B', 'GSTR-9 Annual Return', 'GST Notices']),
      ('TDS',                      array['TDS Returns', 'Form 16 / 16A']),
      ('Bank Records',             array['Bank Statements', 'Loan Documents']),
      ('Registration & Licences',  array['PAN', 'GST Registration', 'Incorporation', 'Trade Licence']),
      ('Agreements & Contracts',   array[]::text[]),
      ('Financial Statements',     array['Balance Sheet', 'Profit & Loss']),
      ('Audit',                    array['Audit Reports']),
      ('Payroll',                  array['PF', 'ESI']),
      ('Identity & KYC',           array[]::text[])
    ) as t(name, subs)
  loop
    insert into master_categories (tenant_id, name, is_default)
    values (p_tenant_id, cat.name, true)
    on conflict do nothing;

    select id into v_parent from master_categories
    where tenant_id = p_tenant_id and parent_id is null and lower(name) = lower(cat.name);

    foreach sub in array cat.subs loop
      insert into master_categories (tenant_id, name, parent_id, is_default)
      values (p_tenant_id, sub, v_parent, true)
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

select public.seed_master_categories(id) from tenants;


-- ------------------------------------------------------------
-- 4. master_documents — one row per Master Document. Belongs to an
-- ORGANISATION (client_org_id), never to one individual Client.
-- ------------------------------------------------------------

create table if not exists public.master_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  client_org_id uuid not null references client_organizations(id),
  client_org_name text null,               -- denormalized, set by trigger
  name text not null check (length(trim(name)) > 0),
  category_id uuid not null references public.master_categories(id),
  subtag_id uuid null references public.master_categories(id),

  -- The CURRENT file. Previous files live in master_document_versions.
  -- Stored in the same private 'documents' bucket as regular documents.
  file_path text not null,
  file_size bigint null,
  mime_type text null,
  file_uploaded_by uuid null references users(id),   -- who put the current file here (trigger)
  file_uploaded_by_name text null,
  current_version integer not null default 1,        -- bumped by trigger on every replacement

  -- Set only when created by marking an existing regular document as
  -- master. source_file_path is the file at the moment of marking; it's
  -- how the "Master" tag in Documents also recognises the other per-Client
  -- copies of the same shared upload (one row per Client, same file).
  source_document_id uuid null references public.documents(id),
  source_file_path text null,

  uploaded_by uuid not null references users(id),
  uploaded_by_name text null,
  created_at timestamptz not null default now(),
  updated_by uuid null references users(id),
  updated_by_name text null,
  updated_at timestamptz not null default now(),

  -- Soft delete: hidden from the default list, restorable, never erased.
  deleted_at timestamptz null,
  deleted_by uuid null references users(id),
  deleted_by_name text null
);

-- One live Master Document per marked file per org — stops the same
-- shared upload being marked twice via two of its per-Client copies.
create unique index if not exists master_documents_one_per_source_file
  on public.master_documents (client_org_id, source_file_path)
  where deleted_at is null and source_file_path is not null;

create index if not exists master_documents_org_idx on public.master_documents (client_org_id);
create index if not exists master_documents_source_doc_idx on public.master_documents (source_document_id);


-- ------------------------------------------------------------
-- 5. master_document_versions — every PREVIOUS file. Written only by the
-- trigger in section 7, at the moment a file is replaced. The app never
-- inserts here directly, so a replacement can never "forget" to archive.
-- ------------------------------------------------------------

create table if not exists public.master_document_versions (
  id uuid primary key default gen_random_uuid(),
  master_document_id uuid not null references public.master_documents(id) on delete cascade,
  version_number integer not null,
  file_path text not null,
  file_size bigint null,
  mime_type text null,
  uploaded_by uuid null,
  uploaded_by_name text null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid null,
  replaced_by_name text null
);

create index if not exists master_document_versions_doc_idx
  on public.master_document_versions (master_document_id);


-- ------------------------------------------------------------
-- 6. master_document_log — who did what, when. Also written only by
-- trigger (section 8), so every action is logged regardless of which
-- screen or code path made the change.
-- ------------------------------------------------------------

create table if not exists public.master_document_log (
  id uuid primary key default gen_random_uuid(),
  master_document_id uuid not null references public.master_documents(id) on delete cascade,
  action text not null check (action in
    ('created', 'marked', 'replaced', 'renamed', 'recategorised', 'deleted', 'restored')),
  details text null,
  actor_id uuid null,
  actor_name text null,
  created_at timestamptz not null default now()
);

create index if not exists master_document_log_doc_idx
  on public.master_document_log (master_document_id);


-- ------------------------------------------------------------
-- 7. BEFORE trigger on master_documents — fills every denormalized/
-- audit field server-side (never trusted from the app), validates the
-- category/sub-tag pair, archives the old file on replacement, and makes
-- the identity fields immutable after creation.
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

  new.name := trim(new.name);

  if tg_op = 'INSERT' then
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
    if new.source_document_id is null then
      new.source_file_path := null;
    end if;
    return new;
  end if;

  -- UPDATE: who/where a Master Document belongs to never changes.
  new.tenant_id := old.tenant_id;
  new.client_org_id := old.client_org_id;
  new.client_org_name := old.client_org_name;
  new.uploaded_by := old.uploaded_by;
  new.uploaded_by_name := old.uploaded_by_name;
  new.created_at := old.created_at;
  new.source_document_id := old.source_document_id;
  new.source_file_path := old.source_file_path;

  if new.file_path is distinct from old.file_path then
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

drop trigger if exists master_documents_before_write on public.master_documents;
create trigger master_documents_before_write
  before insert or update on public.master_documents
  for each row execute function public.master_documents_before_write();


-- ------------------------------------------------------------
-- 8. AFTER trigger — the log. One row per kind of change, so a single
-- edit that renames AND re-categorises produces two clear entries.
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
    insert into master_document_log (master_document_id, action, details, actor_id, actor_name)
    values (new.id, 'replaced', 'Replaced file (version ' || old.current_version || ' kept in history)', v_actor, v_actor_name);
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

drop trigger if exists master_documents_after_write on public.master_documents;
create trigger master_documents_after_write
  after insert or update on public.master_documents
  for each row execute function public.master_documents_after_write();


-- ------------------------------------------------------------
-- 9. RLS — master_documents. Same rule for read and write: you can act
-- on exactly the orgs you can see. No DELETE policy at all — deleting is
-- an UPDATE of deleted_at (soft delete), so a row can never be erased
-- from the app.
-- ------------------------------------------------------------

alter table public.master_documents enable row level security;

drop policy if exists "master_documents_select" on public.master_documents;
create policy "master_documents_select" on public.master_documents
  for select using (
    tenant_id = current_user_tenant()
    and can_access_master_org(client_org_id)
  );

drop policy if exists "master_documents_insert" on public.master_documents;
create policy "master_documents_insert" on public.master_documents
  for insert with check (
    tenant_id = current_user_tenant()
    and uploaded_by = auth.uid()
    and can_access_master_org(client_org_id)
  );

drop policy if exists "master_documents_update" on public.master_documents;
create policy "master_documents_update" on public.master_documents
  for update
  using (tenant_id = current_user_tenant() and can_access_master_org(client_org_id))
  with check (tenant_id = current_user_tenant() and can_access_master_org(client_org_id));


-- ------------------------------------------------------------
-- 10. RLS — versions and log: readable by anyone who can see the parent
-- Master Document (inherits its RLS through the join — same one-source-
-- of-truth pattern as document_versions). No insert/update/delete
-- policies: only the triggers above write to these tables.
-- ------------------------------------------------------------

alter table public.master_document_versions enable row level security;

drop policy if exists "master_document_versions_select" on public.master_document_versions;
create policy "master_document_versions_select" on public.master_document_versions
  for select using (
    exists (select 1 from master_documents m where m.id = master_document_versions.master_document_id)
  );

alter table public.master_document_log enable row level security;

drop policy if exists "master_document_log_select" on public.master_document_log;
create policy "master_document_log_select" on public.master_document_log
  for select using (
    exists (select 1 from master_documents m where m.id = master_document_log.master_document_id)
  );


-- ------------------------------------------------------------
-- 11. Storage — let Master Document files (current and previous) be
-- opened. Same approach as before: a file is readable only if a row you
-- can already see points at it. The two existing checks are kept exactly
-- as they were; two new ones are added.
--
-- Note: when a regular document is marked as master, the Master Document
-- points at the SAME stored file. Everyone who can see that Master
-- Document (e.g. every user in the org) can then open that file, even if
-- they couldn't see the original regular document. That's the intended
-- meaning of "make this a master document for the organisation".
-- ------------------------------------------------------------

drop policy if exists "documents_storage_select_via_document_row" on storage.objects;
create policy "documents_storage_select_via_document_row"
on storage.objects for select
to authenticated
using (
  bucket_id = 'documents'
  and (
    exists (select 1 from public.documents d where d.file_path = storage.objects.name)
    or exists (select 1 from public.document_versions v where v.file_path = storage.objects.name)
    or exists (select 1 from public.master_documents m where m.file_path = storage.objects.name)
    or exists (select 1 from public.master_document_versions mv where mv.file_path = storage.objects.name)
  )
);


-- ============================================================
-- Verify after running:
--   select count(*) from master_categories;                 -- 10 categories + their sub-tags per firm
--   select polname from pg_policy where polrelid = 'master_documents'::regclass;   -- 3 rows
--   select tgname from pg_trigger where tgrelid = 'master_documents'::regclass and not tgisinternal;  -- 2 rows
-- ============================================================