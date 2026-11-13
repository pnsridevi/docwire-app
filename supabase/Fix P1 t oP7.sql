-- =====================================================================
-- Fix security P1 to P7.sql
-- Closes the 7 problems found by the database tests on 12 Nov 2026
-- (Findings tab of "DocWire — Test Case Register"):
--   P-1  Tasks ignore the firm boundary
--   P-2  A document can point at anyone's file
--   P-3  A document can be moved into another firm
--   P-4  An Accountant can change a Client's document
--   P-5  The book-entry order is enforced only by the app's screens
--   P-6  Names and roles sent by the app are trusted
--   P-7  A task can be saved with a blank title
--
-- How it works: three "before" triggers that check every insert/update
-- that comes straight from a signed-in user (current_user =
-- 'authenticated'), the same way the existing guards do. Your own
-- SECURITY DEFINER functions (Send for book entry, Cancel book entry,
-- Reassign, Supervise, deactivation, the daily jobs), Edge Functions
-- (service role) and the Supabase dashboard are NOT affected.
--
-- Safe to run more than once. Changes no existing rows.
-- Rollback: drop the three triggers at the bottom of this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: facts about one user, readable by the triggers regardless of
-- what the signed-in person is allowed to see. Returns nothing for a
-- user who does not exist.
-- They live in their own schema (dw_private), which the app's API does
-- not publish, so nobody can call them from the app or the browser.
-- ---------------------------------------------------------------------
create schema if not exists dw_private;
revoke all on schema dw_private from public, anon;
grant usage on schema dw_private to authenticated;
-- ---------------------------------------------------------------------
create or replace function dw_private.user_facts(p_user uuid)
returns table (tenant_id uuid, client_org_id uuid, role text, name text, active boolean)
language sql stable security definer set search_path = public as $$
  select u.tenant_id, u.client_org_id, u.role, u.name, u.deactivated_at is null
  from users u where u.id = p_user
$$;
revoke all on function dw_private.user_facts(uuid) from public, anon;
grant execute on function dw_private.user_facts(uuid) to authenticated;

create or replace function dw_private.org_facts(p_org uuid)
returns table (tenant_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select o.tenant_id, o.name from client_organizations o where o.id = p_org
$$;
revoke all on function dw_private.org_facts(uuid) from public, anon;
grant execute on function dw_private.org_facts(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- DOCUMENTS (P-2, P-3, P-4, P-5, P-6)
-- ---------------------------------------------------------------------
create or replace function public.documents_enforce_rules()
returns trigger language plpgsql as $$
declare
  me        record;
  org       record;
  person    record;
  my_folder text;
  changed   text[];
  allowed   text[];
  c         text;
begin
  -- Only direct requests from signed-in users. Definer functions, jobs,
  -- Edge Functions and the dashboard run as other roles and skip this.
  if current_user <> 'authenticated' then
    return new;
  end if;

  select * into me from dw_private.user_facts(auth.uid());
  if me.tenant_id is null then
    raise exception 'Your account could not be found. Sign in again.';
  end if;
  my_folder := auth.uid()::text;

  if tg_op = 'INSERT' then
    -- P-3: a new document always belongs to your own firm
    if new.tenant_id is distinct from me.tenant_id then
      raise exception 'A document can only be added to your own firm.';
    end if;
    -- P-2: the file must be one you uploaded yourself (your own folder)
    if new.file_path is null or split_part(new.file_path, '/', 1) <> my_folder then
      raise exception 'The file must be one you uploaded yourself.';
    end if;
    -- P-6: names come from the accounts, not from what the app typed
    new.uploaded_by_name := me.name;
    if new.client_org_id is not null then
      select * into org from dw_private.org_facts(new.client_org_id);
      if org.tenant_id is distinct from me.tenant_id then
        raise exception 'That client organisation is not in your firm.';
      end if;
      new.client_org_name := org.name;
    end if;
    if new.client_id is not null then
      select * into person from dw_private.user_facts(new.client_id);
      if person.tenant_id is distinct from me.tenant_id then
        raise exception 'That client is not in your firm.';
      end if;
      new.client_name := person.name;
    end if;
    if new.shared_with_user_id is not null then
      select * into person from dw_private.user_facts(new.shared_with_user_id);
      if person.tenant_id is distinct from me.tenant_id then
        raise exception 'You can only share a document with someone in your own firm.';
      end if;
      new.shared_with_user_name := person.name;
    end if;
    -- P-5: a new document starts at the start of the book-entry steps
    new.status := case when new.needs_entry then 'pending' else 'filed' end;
    new.comment := null;
    new.reupload_requested := false;
    new.reupload_fulfilled := false;
    return new;
  end if;

  -- UPDATE --------------------------------------------------------------
  select array_agg(n.key) into changed
  from jsonb_each(to_jsonb(new)) n
  where n.value is distinct from (to_jsonb(old) -> n.key);
  changed := coalesce(changed, '{}');

  -- P-3: who a document belongs to never changes
  foreach c in array array['id', 'tenant_id', 'client_org_id', 'client_org_name', 'client_id', 'client_name',
                           'uploaded_by', 'uploaded_by_name', 'source', 'created_at'] loop
    if c = any(changed) then
      raise exception 'A document''s firm, client and uploader cannot be changed.';
    end if;
  end loop;

  -- P-2: a replaced file must be one you uploaded yourself
  if 'file_path' = any(changed) and split_part(coalesce(new.file_path, ''), '/', 1) <> my_folder then
    raise exception 'The file must be one you uploaded yourself.';
  end if;

  if me.role in ('client', 'client_admin') then
    -- Clients only ever reupload a file that was asked for (P-3, P-5)
    allowed := array['file_path', 'file_size', 'mime_type', 'reupload_fulfilled'];
  elsif new.uploaded_by = auth.uid() then
    -- Staff on their own upload: details and sharing, plus workflow steps
    allowed := array['name', 'shared_with_manager', 'shared_with_accountant', 'shared_with_client_admin',
                     'shared_with_clients', 'shared_with_user_id', 'shared_with_user_name',
                     'status', 'comment', 'reupload_requested', 'reupload_fulfilled'];
  else
    -- P-4: staff on someone else's upload: only the book-entry steps
    allowed := array['status', 'comment', 'reupload_requested', 'reupload_fulfilled'];
  end if;
  foreach c in array changed loop
    if not c = any(allowed) then
      raise exception 'You can only move this document through the book-entry steps; its details belong to the person who uploaded it.';
    end if;
  end loop;

  if 'shared_with_user_id' = any(changed) then
    if new.shared_with_user_id is not null then
      select * into person from dw_private.user_facts(new.shared_with_user_id);
      if person.tenant_id is distinct from me.tenant_id then
        raise exception 'You can only share a document with someone in your own firm.';
      end if;
      new.shared_with_user_name := person.name;
    else
      new.shared_with_user_name := null;
    end if;
  end if;

  -- P-5: who may ask for, or stop waiting for, a reupload
  if 'reupload_requested' = any(changed) and me.role <> 'manager' then
    raise exception 'Only a Manager can ask for, or stop waiting for, a reupload.';
  end if;
  if 'reupload_fulfilled' = any(changed) then
    if me.role in ('client', 'client_admin') then
      if not (new.reupload_fulfilled and old.reupload_requested and 'file_path' = any(changed)) then
        raise exception 'A reupload is marked done only by uploading the new file.';
      end if;
    elsif me.role <> 'manager' then
      raise exception 'Only a Manager can change a reupload request.';
    end if;
  end if;

  -- P-5: the book-entry steps, in order, by the right role
  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status = 'accounted' and me.role = 'accountant' then
      null;
    elsif old.status = 'accounted' and new.status in ('reviewed', 'rework') and me.role = 'manager' then
      null;
    elsif old.status = 'rework' and new.status = 'accounted' and me.role = 'accountant' then
      if old.reupload_requested and not old.reupload_fulfilled then
        raise exception 'This document is waiting for the Client to reupload it. Re-submit it after the new file arrives.';
      end if;
    else
      raise exception 'This step is not allowed: % cannot move a document from % to %.',
        initcap(replace(me.role, '_', ' ')), initcap(old.status), initcap(new.status);
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- DOCUMENT VERSIONS (P-2): a version's file must be your own upload
-- ---------------------------------------------------------------------
create or replace function public.document_versions_enforce_rules()
returns trigger language plpgsql as $$
declare
  me record;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  select * into me from dw_private.user_facts(auth.uid());
  if split_part(coalesce(new.file_path, ''), '/', 1) <> auth.uid()::text then
    raise exception 'The file must be one you uploaded yourself.';
  end if;
  new.uploaded_by := auth.uid();
  new.uploaded_by_name := me.name;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- TASKS (P-1, P-6, P-7)
-- Direct updates are already limited to status and the linked document
-- by tasks_guard_direct_update, so the firm checks are on INSERT, plus
-- the linked document on UPDATE.
-- ---------------------------------------------------------------------
create or replace function public.tasks_enforce_rules()
returns trigger language plpgsql as $$
declare
  me       record;
  assignee record;
  person   record;
  org      record;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select * into me from dw_private.user_facts(auth.uid());
  if me.tenant_id is null then
    raise exception 'Your account could not be found. Sign in again.';
  end if;

  if tg_op = 'UPDATE' then
    if new.linked_document_id is distinct from old.linked_document_id and new.linked_document_id is not null
       and not exists (select 1 from documents d where d.id = new.linked_document_id and d.tenant_id = me.tenant_id) then
      raise exception 'You can only link a document you can see, from your own firm.';
    end if;
    return new;
  end if;

  -- INSERT --------------------------------------------------------------
  -- P-7: a task needs a title
  if btrim(coalesce(new.title, '')) = '' then
    raise exception 'Please give the task a title.';
  end if;
  new.title := btrim(new.title);

  -- P-1: the task belongs to your own firm
  if new.tenant_id is distinct from me.tenant_id then
    raise exception 'A task can only be created in your own firm.';
  end if;
  -- P-6: who created it comes from your account
  new.creator_id := auth.uid();
  new.creator_role := me.role;
  new.creator_name := me.name;

  -- P-1: the assignee is an active person in your firm
  select * into assignee from dw_private.user_facts(new.assignee_id);
  if assignee.tenant_id is distinct from me.tenant_id then
    raise exception 'You can only give a task to someone in your own firm.';
  end if;
  new.assignee_role := assignee.role;
  new.assignee_name := assignee.name;

  if me.role in ('client', 'client_admin') then
    -- A Client gives tasks to staff, or to people in their own organisation
    if new.client_org_id is distinct from me.client_org_id then
      raise exception 'A task can only be created for your own organisation.';
    end if;
    if assignee.role in ('client', 'client_admin') and assignee.client_org_id is distinct from me.client_org_id then
      raise exception 'You can only give a task to your firm''s staff or to people in your own organisation.';
    end if;
  elsif assignee.role in ('client', 'client_admin') and new.client_org_id is distinct from assignee.client_org_id then
    raise exception 'The task''s client organisation must be the assignee''s own organisation.';
  end if;

  if new.client_org_id is not null then
    select * into org from dw_private.org_facts(new.client_org_id);
    if org.tenant_id is distinct from me.tenant_id then
      raise exception 'That client organisation is not in your firm.';
    end if;
    new.client_org_name := org.name;
  end if;

  if new.client_id is not null then
    select * into person from dw_private.user_facts(new.client_id);
    if person.tenant_id is distinct from me.tenant_id
       or (new.client_org_id is not null and person.client_org_id is distinct from new.client_org_id) then
      raise exception 'That client is not in this organisation.';
    end if;
  end if;

  if new.linked_document_id is not null
     and not exists (select 1 from documents d where d.id = new.linked_document_id and d.tenant_id = me.tenant_id) then
    raise exception 'You can only link a document you can see, from your own firm.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers. Names start with "zy" so they run after the existing
-- "before" triggers that fill in client_id (they run in name order) and
-- before documents_zz_book_entry_on_insert.
-- ---------------------------------------------------------------------
drop trigger if exists documents_zy_enforce_rules on public.documents;
create trigger documents_zy_enforce_rules
  before insert or update on public.documents
  for each row execute function public.documents_enforce_rules();

drop trigger if exists document_versions_zy_enforce_rules on public.document_versions;
create trigger document_versions_zy_enforce_rules
  before insert on public.document_versions
  for each row execute function public.document_versions_enforce_rules();

drop trigger if exists tasks_zy_enforce_rules on public.tasks;
create trigger tasks_zy_enforce_rules
  before insert or update on public.tasks
  for each row execute function public.tasks_enforce_rules();

-- To undo this fix:
--   drop trigger documents_zy_enforce_rules on public.documents;
--   drop trigger document_versions_zy_enforce_rules on public.document_versions;
--   drop trigger tasks_zy_enforce_rules on public.tasks;