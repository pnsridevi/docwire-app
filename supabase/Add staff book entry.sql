-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Add_staff_book_entry.sql
-- Run after every previous migration (including Add_user_deactivation.sql).
-- Safe to run more than once.
--
-- Agreed 8 Oct 2026:
--
-- B. "Needs book entry" on Upload Work Document (Managers and
--    Accountants), only when the document is for specific Clients. Each
--    Client's copy lands as Pending for that Client's Accountant and
--    follows the normal Accounted -> Reviewed journey.
-- C. "Send for book entry" on any stored-only (Filed) document about
--    one of your Clients, for the Client's Manager or Accountant — e.g. a
--    Client upload where the box wasn't ticked. "Cancel book entry" undoes
--    it, but only while still Pending. The document records who sent it
--    and when.
--
-- What had to change in the database to make this work:
--   1. Three columns recording who sent a document for book entry.
--   2. On insert: a document that needs book entry always starts as
--      Pending, and is automatically shared with the other staff role
--      (a Manager's upload with the Accountant, and vice versa) — the
--      Accountant can't enter what they can't see.
--   3. Two new UPDATE rules: an Accountant can move a Manager's
--      book-entry document through the steps (Mark Accounted, Re-submit)
--      and a Manager can do the same for an Accountant's (Mark Reviewed,
--      Rework). Before this, the database refused those updates — which
--      also affected documents attached to tasks with "book entry" on.
--   4. A guard so those new rules can't be used to edit someone else's
--      document (only the book-entry steps), so "needs book entry" can
--      only change through Send / Cancel, and so a reupload can only be
--      requested for a Client's own upload (staff documents have no
--      Client to reupload them).
--   5. send_document_for_entry() and cancel_document_entry().
-- ============================================================


-- ------------------------------------------------------------
-- 1. Who sent it for book entry, and when.
-- ------------------------------------------------------------

alter table public.documents
  add column if not exists entry_requested_by uuid null references public.users(id),
  add column if not exists entry_requested_by_name text null,
  add column if not exists entry_requested_at timestamptz null;


-- ------------------------------------------------------------
-- 2. On insert. Named so it runs AFTER documents_fix_client_org (which
-- fills client_id for Client uploads) — Postgres runs same-timing
-- triggers in name order.
-- ------------------------------------------------------------

create or replace function public.documents_book_entry_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.needs_entry then
    new.status := 'pending';
    if new.source = 'manager' then
      new.shared_with_accountant := true;
    elsif new.source = 'accountant' then
      new.shared_with_manager := true;
    end if;
    if new.source in ('manager', 'accountant') then
      new.entry_requested_by := new.uploaded_by;
      select name into new.entry_requested_by_name from users where id = new.uploaded_by;
      new.entry_requested_at := now();
    else
      -- A Client ticking the box themselves isn't "sent by staff".
      new.entry_requested_by := null;
      new.entry_requested_by_name := null;
      new.entry_requested_at := null;
    end if;
  else
    new.entry_requested_by := null;
    new.entry_requested_by_name := null;
    new.entry_requested_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_zz_book_entry_on_insert on public.documents;
create trigger documents_zz_book_entry_on_insert
  before insert on public.documents
  for each row execute function public.documents_book_entry_on_insert();


-- ------------------------------------------------------------
-- 3. The other staff role can move a staff book-entry document through
-- the steps. Only documents that need book entry, only about their own
-- Clients. (The guard below limits WHAT they can change.)
-- ------------------------------------------------------------

drop policy if exists "documents_accountant_update_staff_entry" on public.documents;
create policy "documents_accountant_update_staff_entry" on public.documents
  for update using (
    current_user_role() = 'accountant'
    and source = 'manager'
    and needs_entry = true
    and client_id in (select client_id from client_assignments where accountant_id = auth.uid())
  );

drop policy if exists "documents_manager_update_staff_entry" on public.documents;
create policy "documents_manager_update_staff_entry" on public.documents
  for update using (
    current_user_role() = 'manager'
    and source = 'accountant'
    and needs_entry = true
    and client_id in (select client_id from client_assignments where manager_id = auth.uid())
  );


-- ------------------------------------------------------------
-- 4. Guard on direct updates from the app. SECURITY INVOKER on purpose:
-- current_user is 'authenticated' for a request from the app and the
-- owner inside the functions below (which are allowed everything).
-- ------------------------------------------------------------

create or replace function public.documents_guard_direct_update()
returns trigger
language plpgsql
as $$
declare
  workflow text[] := array['status', 'comment', 'reupload_requested', 'reupload_fulfilled', 'updated_at'];
begin
  if current_user = 'authenticated' then
    if new.needs_entry is distinct from old.needs_entry
       or new.entry_requested_by is distinct from old.entry_requested_by
       or new.entry_requested_by_name is distinct from old.entry_requested_by_name
       or new.entry_requested_at is distinct from old.entry_requested_at then
      raise exception 'Use "Send for book entry" or "Cancel book entry" to change whether a document needs book entry.';
    end if;

    if new.reupload_requested and not coalesce(old.reupload_requested, false) and new.source <> 'client' then
      raise exception 'Only a Client''s own upload can be sent back for a reupload. Send it to Rework without that option instead.';
    end if;

    -- A Manager acting on an Accountant's document, or the other way
    -- round, may only move it through the book-entry steps.
    if ((new.source = 'manager' and current_user_role() = 'accountant')
        or (new.source = 'accountant' and current_user_role() = 'manager'))
       and (to_jsonb(new) - workflow) is distinct from (to_jsonb(old) - workflow) then
      raise exception 'You can only move this document through the book-entry steps — its details belong to the person who uploaded it.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_guard_direct_update on public.documents;
create trigger documents_guard_direct_update
  before update on public.documents
  for each row execute function public.documents_guard_direct_update();


-- ------------------------------------------------------------
-- 5. Send for book entry / Cancel book entry.
-- Allowed for the CURRENT Manager or Accountant of the Client the
-- document is about.
-- ------------------------------------------------------------

create or replace function public.can_manage_document_entry(d public.documents)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_active_user()
     and current_user_role() in ('manager', 'accountant')
     and d.client_id is not null
     and exists (
       select 1 from client_assignments ca
       where ca.client_id = d.client_id
         and (ca.manager_id = auth.uid() or ca.accountant_id = auth.uid())
     );
$$;

create or replace function public.send_document_for_entry(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents;
  v_name text;
begin
  select * into d from documents where id = p_document_id for update;
  if not found or not can_manage_document_entry(d) then
    raise exception 'You can only send documents of your own Clients for book entry.';
  end if;
  if d.needs_entry then
    raise exception 'This document is already in book entry.';
  end if;
  if d.status <> 'filed' then
    raise exception 'Only a stored (Filed) document can be sent for book entry.';
  end if;

  select name into v_name from users where id = auth.uid();
  update documents
     set needs_entry = true,
         status = 'pending',
         entry_requested_by = auth.uid(),
         entry_requested_by_name = v_name,
         entry_requested_at = now(),
         shared_with_accountant = case when source = 'manager' then true else shared_with_accountant end,
         shared_with_manager = case when source = 'accountant' then true else shared_with_manager end
   where id = p_document_id;
end;
$$;

create or replace function public.cancel_document_entry(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d documents;
begin
  select * into d from documents where id = p_document_id for update;
  if not found or not can_manage_document_entry(d) then
    raise exception 'You can only change documents of your own Clients.';
  end if;
  if not d.needs_entry or d.status <> 'pending' or d.entry_requested_by is null then
    raise exception 'Only a document that staff sent for book entry, and that is still Pending, can be taken back out.';
  end if;

  update documents
     set needs_entry = false,
         status = 'filed',
         entry_requested_by = null,
         entry_requested_by_name = null,
         entry_requested_at = null
   where id = p_document_id;
end;
$$;

revoke all on function public.send_document_for_entry(uuid) from public, anon;
revoke all on function public.cancel_document_entry(uuid) from public, anon;
grant execute on function public.send_document_for_entry(uuid) to authenticated;
grant execute on function public.cancel_document_entry(uuid) to authenticated;


-- ============================================================
-- Verify after running:
--   select column_name from information_schema.columns
--   where table_name = 'documents' and column_name like 'entry_requested%';   -- 3 rows
--   select polname from pg_policy where polrelid = 'documents'::regclass
--   and polname like '%staff_entry';                                         -- 2 rows
--   select tgname from pg_trigger where tgname in
--     ('documents_zz_book_entry_on_insert', 'documents_guard_direct_update');  -- 2 rows
-- ============================================================