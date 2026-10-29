-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Add_chat.sql
-- Run after every previous migration. Safe to run more than once.
--
-- ADDITIVE ONLY: three new tables and new functions. No existing table,
-- rule, trigger or function is changed, so testers' current app is not
-- affected (it never reads these tables).
--
-- Rules confirmed with Venkatesh (Part 5) and agreed 22-23 Oct 2026:
--   1. Everyone in a firm can chat with everyone, EXCEPT people from two
--      different client organisations. Staff (Super Admin, Managers,
--      Accountants) can chat with any Client, assigned or not.
--   2. Like Teams: many chats, anyone can start one. Picking one person
--      opens a 1:1 chat (the existing one is reused); picking several
--      creates a group with an optional name.
--   3. A group can hold any staff, but people from only ONE client
--      organisation.
--   4. The group's creator adds, removes and renames; anyone can leave.
--      If the creator leaves, the longest-standing member takes over.
--   5. People edit or delete their OWN messages ("edited" / "message
--      deleted" shown; the row stays). Max 4,000 characters.
--   6. Deactivated people stay in old chats, but can't be added or sent
--      new 1:1 messages. They lose all access (restrictive rule below).
--   7. Only members can read a chat — Super Admin included.
--   8. History is kept; chats don't depend on Client assignments, so a
--      change of Manager/Accountant changes nothing here.
--   Not in this version: attachments, read receipts, notifications.
--   Unread counts come from last_read_at.
--
-- How the app talks to it
--   Reading: chat_messages directly (members only); my_chats(),
--   chat_member_list() and chat_people() for lists.
--   Writing: ONLY through the functions below — there are no insert/
--   update/delete rules on the tables, so every write passes the checks.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  is_group boolean not null,
  -- Groups only, optional. 1:1 chats show the other person's name.
  name text null check (name is null or length(trim(name)) between 1 and 80),
  -- The one client organisation whose people are in this chat (null =
  -- staff only so far). Enforces rule 3.
  client_org_id uuid null references public.client_organizations(id),
  -- 1:1 chats only: '<smaller user id>:<larger user id>', so the same two
  -- people always get the same chat.
  dm_key text null unique,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz null,
  constraint chats_kind_check check (
    (is_group and dm_key is null)
    or (not is_group and dm_key is not null and name is null)
  )
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.users(id),
  joined_at timestamptz not null default now(),
  -- Everything after this is "unread" for this person.
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid null references public.users(id),
  -- Kept on the row so a message still shows its sender after they leave.
  sender_name text null,
  -- 'system' = "Priya added Kavya", "Priya renamed the group", etc.
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text null,
  created_at timestamptz not null default now(),
  -- Changes on send, edit and delete — the app polls on this, so it picks
  -- up edits and deletes, not just new messages.
  updated_at timestamptz not null default now(),
  edited_at timestamptz null,
  deleted_at timestamptz null,
  constraint chat_messages_body_check check (
    (deleted_at is not null and body is null)
    or (deleted_at is null and body is not null and length(body) between 1 and 4000)
  )
);

create index if not exists chat_messages_chat_created_idx on public.chat_messages (chat_id, created_at);
create index if not exists chat_messages_chat_updated_idx on public.chat_messages (chat_id, updated_at);


-- ------------------------------------------------------------
-- 2. Read rules: members only. No write rules at all (functions below).
-- ------------------------------------------------------------

create or replace function public.is_chat_member(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from chat_members where chat_id = p_chat_id and user_id = auth.uid());
$$;

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chats_select_member" on public.chats;
create policy "chats_select_member" on public.chats
  for select to authenticated using (public.is_chat_member(id));

drop policy if exists "chat_members_select_member" on public.chat_members;
create policy "chat_members_select_member" on public.chat_members
  for select to authenticated using (public.is_chat_member(chat_id));

drop policy if exists "chat_messages_select_member" on public.chat_messages;
create policy "chat_messages_select_member" on public.chat_messages
  for select to authenticated using (public.is_chat_member(chat_id));

-- Same cut-off as every other table (Add_user_deactivation.sql): a
-- deactivated person can read nothing, whichever rule would allow it.
do $$
declare
  t text;
begin
  foreach t in array array['chats', 'chat_members', 'chat_messages'] loop
    execute format('drop policy if exists "zz_active_users_only" on public.%I', t);
    execute format(
      'create policy "zz_active_users_only" on public.%I as restrictive for all to authenticated
         using ((select public.is_active_user())) with check ((select public.is_active_user()))',
      t);
  end loop;
end $$;

-- Belt and braces: the app can only read these tables.
revoke insert, update, delete, truncate on public.chats, public.chat_members, public.chat_messages from anon, authenticated;
revoke select on public.chats, public.chat_members, public.chat_messages from anon;


-- ------------------------------------------------------------
-- 3. Internal helpers (not callable from the app)
-- ------------------------------------------------------------

-- The signed-in person, active, or an error.
create or replace function public._chat_me()
returns public.users
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v users;
begin
  select * into v from users where id = auth.uid();
  if not found or v.deactivated_at is not null then
    raise exception 'You are not signed in.';
  end if;
  return v;
end;
$$;

-- The chat, with the caller a member, or an error. Locks the row so two
-- people changing the same group at once can't break rule 3.
create or replace function public._chat_get(p_chat_id uuid, p_lock boolean default false)
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  c chats;
begin
  if p_lock then
    select * into c from chats where id = p_chat_id for update;
  else
    select * into c from chats where id = p_chat_id;
  end if;
  if not found or not is_chat_member(p_chat_id) then
    raise exception 'Chat not found.';
  end if;
  return c;
end;
$$;

-- Adds one person to a chat, enforcing: same firm, active, and at most
-- one client organisation per chat (rule 3). Returns false if they were
-- already a member.
create or replace function public._chat_add_member(p_chat_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c chats;
  u users;
begin
  select * into c from chats where id = p_chat_id for update;
  select * into u from users where id = p_user_id;

  if not found or u.tenant_id <> c.tenant_id then
    raise exception 'That person was not found.';
  end if;
  if u.deactivated_at is not null then
    raise exception '% has been deactivated and can''t be added to a chat.', coalesce(u.name, 'This person');
  end if;

  if u.client_org_id is not null then
    if c.client_org_id is null then
      update chats set client_org_id = u.client_org_id where id = p_chat_id;
    elsif c.client_org_id <> u.client_org_id then
      raise exception 'People from two different client organisations can''t be in the same chat.';
    end if;
  end if;

  insert into chat_members (chat_id, user_id) values (p_chat_id, p_user_id)
  on conflict do nothing;
  return found;
end;
$$;

-- After someone leaves or is removed: the chat's client organisation is
-- whichever one its remaining members belong to (or none).
create or replace function public._chat_refresh_org(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update chats
     set client_org_id = (
       select u.client_org_id from chat_members m join users u on u.id = m.user_id
       where m.chat_id = p_chat_id and u.client_org_id is not null
       limit 1)
   where id = p_chat_id;
$$;

create or replace function public._chat_system_line(p_chat_id uuid, p_actor users, p_text text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into chat_messages (chat_id, sender_id, sender_name, kind, body)
  values (p_chat_id, p_actor.id, p_actor.name, 'system', left(p_text, 4000));
  update chats set last_message_at = now() where id = p_chat_id;
$$;

revoke all on function public._chat_me() from public, anon, authenticated;
revoke all on function public._chat_get(uuid, boolean) from public, anon, authenticated;
revoke all on function public._chat_add_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public._chat_refresh_org(uuid) from public, anon, authenticated;
revoke all on function public._chat_system_line(uuid, public.users, text) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 4. Starting chats
-- ------------------------------------------------------------

-- 1:1 chat with one person. Returns the existing chat if there is one.
create or replace function public.start_direct_chat(p_other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  v_other users;
  v_key text;
  v_chat_id uuid;
begin
  if p_other_id = me.id then
    raise exception 'You can''t start a chat with yourself.';
  end if;

  v_key := least(me.id::text, p_other_id::text) || ':' || greatest(me.id::text, p_other_id::text);
  select id into v_chat_id from chats where dm_key = v_key;
  if v_chat_id is not null then
    return v_chat_id;
  end if;

  select * into v_other from users where id = p_other_id;
  if not found or v_other.tenant_id <> me.tenant_id then
    raise exception 'That person was not found.';
  end if;
  if v_other.deactivated_at is not null then
    raise exception '% has been deactivated and can''t be messaged.', coalesce(v_other.name, 'This person');
  end if;
  if me.client_org_id is not null and v_other.client_org_id is not null
     and me.client_org_id <> v_other.client_org_id then
    raise exception 'People from two different client organisations can''t chat with each other.';
  end if;

  insert into chats (tenant_id, is_group, client_org_id, dm_key, created_by)
  values (me.tenant_id, false, coalesce(me.client_org_id, v_other.client_org_id), v_key, me.id)
  on conflict (dm_key) do nothing
  returning id into v_chat_id;

  if v_chat_id is null then
    -- Created by the other person at the same moment.
    select id into v_chat_id from chats where dm_key = v_key;
    return v_chat_id;
  end if;

  insert into chat_members (chat_id, user_id) values (v_chat_id, me.id), (v_chat_id, p_other_id);
  return v_chat_id;
end;
$$;

-- Group with the caller plus the people chosen.
create or replace function public.create_group_chat(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  v_chat_id uuid;
  v_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if coalesce(array_length(array_remove(p_member_ids, me.id), 1), 0) < 1 then
    raise exception 'Choose at least one other person for the group.';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'Group name can be at most 80 characters.';
  end if;

  insert into chats (tenant_id, is_group, name, created_by)
  values (me.tenant_id, true, v_name, me.id)
  returning id into v_chat_id;

  perform _chat_add_member(v_chat_id, me.id);
  foreach v_id in array p_member_ids loop
    if v_id <> me.id then
      perform _chat_add_member(v_chat_id, v_id);
    end if;
  end loop;

  perform _chat_system_line(v_chat_id, me, coalesce(me.name, 'Someone') || ' created the group');
  return v_chat_id;
end;
$$;


-- ------------------------------------------------------------
-- 5. Managing a group (creator), leaving (anyone)
-- ------------------------------------------------------------

create or replace function public.add_chat_members(p_chat_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  c chats := _chat_get(p_chat_id, true);
  v_id uuid;
  v_added text[] := array[]::text[];
begin
  if not c.is_group then
    raise exception 'People can only be added to a group chat. Start a group instead.';
  end if;
  if c.created_by <> me.id then
    raise exception 'Only the person who manages this group can add people.';
  end if;

  foreach v_id in array coalesce(p_member_ids, array[]::uuid[]) loop
    if _chat_add_member(p_chat_id, v_id) then
      v_added := v_added || (select coalesce(name, 'someone') from users where id = v_id);
    end if;
  end loop;

  if array_length(v_added, 1) > 0 then
    perform _chat_system_line(p_chat_id, me, coalesce(me.name, 'Someone') || ' added ' || array_to_string(v_added, ', '));
  end if;
end;
$$;

create or replace function public.remove_chat_member(p_chat_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  c chats := _chat_get(p_chat_id, true);
  v_name text;
begin
  if not c.is_group then
    raise exception 'Nobody can be removed from a 1:1 chat.';
  end if;
  if c.created_by <> me.id then
    raise exception 'Only the person who manages this group can remove people.';
  end if;
  if p_user_id = me.id then
    raise exception 'Use "Leave group" to leave.';
  end if;

  select name into v_name from users where id = p_user_id;
  delete from chat_members where chat_id = p_chat_id and user_id = p_user_id;
  if not found then
    return;
  end if;

  perform _chat_refresh_org(p_chat_id);
  perform _chat_system_line(p_chat_id, me, coalesce(me.name, 'Someone') || ' removed ' || coalesce(v_name, 'someone'));
end;
$$;

create or replace function public.leave_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  c chats := _chat_get(p_chat_id, true);
  v_next uuid;
begin
  if not c.is_group then
    raise exception 'You can''t leave a 1:1 chat.';
  end if;

  delete from chat_members where chat_id = p_chat_id and user_id = me.id;

  if c.created_by = me.id then
    -- Hand the group to the longest-standing active member.
    select m.user_id into v_next
      from chat_members m join users u on u.id = m.user_id
     where m.chat_id = p_chat_id
     order by (u.deactivated_at is null) desc, m.joined_at, m.user_id
     limit 1;
    if v_next is not null then
      update chats set created_by = v_next where id = p_chat_id;
    end if;
  end if;

  perform _chat_refresh_org(p_chat_id);
  perform _chat_system_line(p_chat_id, me, coalesce(me.name, 'Someone') || ' left the group');
end;
$$;

create or replace function public.rename_chat(p_chat_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  c chats := _chat_get(p_chat_id, true);
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not c.is_group then
    raise exception 'Only a group can be renamed.';
  end if;
  if c.created_by <> me.id then
    raise exception 'Only the person who manages this group can rename it.';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'Group name can be at most 80 characters.';
  end if;
  if v_name is not distinct from c.name then
    return;
  end if;

  update chats set name = v_name where id = p_chat_id;
  perform _chat_system_line(p_chat_id, me,
    coalesce(me.name, 'Someone') ||
    case when v_name is null then ' removed the group name' else ' renamed the group to "' || v_name || '"' end);
end;
$$;


-- ------------------------------------------------------------
-- 6. Messages
-- ------------------------------------------------------------

create or replace function public.send_chat_message(p_chat_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  c chats := _chat_get(p_chat_id);
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_other users;
  v_row chat_messages;
begin
  if v_body = '' then
    raise exception 'Type a message first.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A message can be at most 4,000 characters.';
  end if;

  if not c.is_group then
    select u.* into v_other from chat_members m join users u on u.id = m.user_id
     where m.chat_id = p_chat_id and m.user_id <> me.id;
    if v_other.deactivated_at is not null then
      raise exception '% has been deactivated and can''t receive messages.', coalesce(v_other.name, 'This person');
    end if;
  end if;

  insert into chat_messages (chat_id, sender_id, sender_name, kind, body)
  values (p_chat_id, me.id, me.name, 'text', v_body)
  returning * into v_row;

  update chats set last_message_at = v_row.created_at where id = p_chat_id;
  update chat_members set last_read_at = v_row.created_at where chat_id = p_chat_id and user_id = me.id;
  return v_row;
end;
$$;

create or replace function public.edit_chat_message(p_message_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  m chat_messages;
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
begin
  select * into m from chat_messages where id = p_message_id for update;
  if not found or not is_chat_member(m.chat_id) or m.sender_id is distinct from me.id or m.kind <> 'text' then
    raise exception 'You can only edit your own messages.';
  end if;
  if m.deleted_at is not null then
    raise exception 'This message was deleted.';
  end if;
  if v_body = '' then
    raise exception 'A message can''t be empty. Delete it instead.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A message can be at most 4,000 characters.';
  end if;
  if v_body = m.body then
    return m;
  end if;

  update chat_messages
     set body = v_body, edited_at = now(), updated_at = now()
   where id = p_message_id
  returning * into m;
  return m;
end;
$$;

create or replace function public.delete_chat_message(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me users := _chat_me();
  m chat_messages;
begin
  select * into m from chat_messages where id = p_message_id for update;
  if not found or not is_chat_member(m.chat_id) or m.sender_id is distinct from me.id or m.kind <> 'text' then
    raise exception 'You can only delete your own messages.';
  end if;
  if m.deleted_at is not null then
    return m;
  end if;

  update chat_messages
     set body = null, deleted_at = now(), updated_at = now()
   where id = p_message_id
  returning * into m;
  return m;
end;
$$;

create or replace function public.mark_chat_read(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update chat_members set last_read_at = now()
   where chat_id = p_chat_id and user_id = auth.uid()
     and (select public.is_active_user());
$$;


-- ------------------------------------------------------------
-- 7. Lists for the app
-- ------------------------------------------------------------

-- Every chat the caller is in, newest activity first, with what the chat
-- list needs: display name, last message, unread count, and for a 1:1 the
-- other person.
create or replace function public.my_chats()
returns table (
  chat_id uuid,
  is_group boolean,
  display_name text,
  group_name text,
  created_by uuid,
  client_org_id uuid,
  member_count integer,
  other_user_id uuid,
  other_user_role text,
  other_deactivated boolean,
  last_activity_at timestamptz,
  last_kind text,
  last_body text,
  last_sender_id uuid,
  last_sender_name text,
  last_deleted boolean,
  unread_count integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id,
    c.is_group,
    case
      when not c.is_group then coalesce(o.name, 'Unknown')
      when c.name is not null then c.name
      else coalesce((
        select string_agg(coalesce(u.name, '?'), ', ' order by u.name)
        from (select u2.name from chat_members m2 join users u2 on u2.id = m2.user_id
              where m2.chat_id = c.id and m2.user_id <> auth.uid()
              order by u2.name limit 4) u), 'Group')
    end,
    c.name,
    c.created_by,
    c.client_org_id,
    (select count(*)::int from chat_members m3 where m3.chat_id = c.id),
    o.id,
    o.role,
    coalesce(o.deactivated_at is not null, false),
    coalesce(c.last_message_at, c.created_at),
    lm.kind,
    lm.body,
    lm.sender_id,
    lm.sender_name,
    lm.deleted_at is not null,
    (select count(*)::int from chat_messages x
      where x.chat_id = c.id and x.kind = 'text' and x.deleted_at is null
        and x.created_at > me.last_read_at and x.sender_id is distinct from auth.uid())
  from chat_members me
  join chats c on c.id = me.chat_id
  left join lateral (
    select u.* from chat_members m join users u on u.id = m.user_id
    where not c.is_group and m.chat_id = c.id and m.user_id <> auth.uid()
    limit 1
  ) o on true
  left join lateral (
    select x.* from chat_messages x where x.chat_id = c.id
    order by x.created_at desc, x.id desc limit 1
  ) lm on true
  where me.user_id = auth.uid()
    and (select public.is_active_user())
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

-- Members of a chat the caller is in.
create or replace function public.chat_member_list(p_chat_id uuid)
returns table (
  user_id uuid,
  name text,
  role text,
  client_org_name text,
  deactivated boolean,
  joined_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.name, u.role, o.name, u.deactivated_at is not null, m.joined_at
  from chat_members m
  join users u on u.id = m.user_id
  left join client_organizations o on o.id = u.client_org_id
  where m.chat_id = p_chat_id
    and public.is_chat_member(p_chat_id)
    and (select public.is_active_user())
  order by u.name;
$$;

-- People the caller may start a chat with (rule 1): active people of the
-- same firm, except themselves; a client-side person sees firm staff and
-- their own organisation only.
create or replace function public.chat_people()
returns table (
  user_id uuid,
  name text,
  role text,
  client_org_id uuid,
  client_org_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.name, u.role, u.client_org_id, o.name
  from users me
  join users u on u.tenant_id = me.tenant_id
  left join client_organizations o on o.id = u.client_org_id
  where me.id = auth.uid()
    and me.deactivated_at is null
    and u.id <> me.id
    and u.deactivated_at is null
    and (me.client_org_id is null or u.client_org_id is null or u.client_org_id = me.client_org_id)
  order by u.name;
$$;


-- ------------------------------------------------------------
-- 8. Who can call what: signed-in users only.
-- ------------------------------------------------------------

revoke all on function public.is_chat_member(uuid) from public, anon;
revoke all on function public.start_direct_chat(uuid) from public, anon;
revoke all on function public.create_group_chat(text, uuid[]) from public, anon;
revoke all on function public.add_chat_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_chat_member(uuid, uuid) from public, anon;
revoke all on function public.leave_chat(uuid) from public, anon;
revoke all on function public.rename_chat(uuid, text) from public, anon;
revoke all on function public.send_chat_message(uuid, text) from public, anon;
revoke all on function public.edit_chat_message(uuid, text) from public, anon;
revoke all on function public.delete_chat_message(uuid) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.my_chats() from public, anon;
revoke all on function public.chat_member_list(uuid) from public, anon;
revoke all on function public.chat_people() from public, anon;

grant execute on function public.is_chat_member(uuid) to authenticated;
grant execute on function public.start_direct_chat(uuid) to authenticated;
grant execute on function public.create_group_chat(text, uuid[]) to authenticated;
grant execute on function public.add_chat_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_chat_member(uuid, uuid) to authenticated;
grant execute on function public.leave_chat(uuid) to authenticated;
grant execute on function public.rename_chat(uuid, text) to authenticated;
grant execute on function public.send_chat_message(uuid, text) to authenticated;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.my_chats() to authenticated;
grant execute on function public.chat_member_list(uuid) to authenticated;
grant execute on function public.chat_people() to authenticated;

commit;


-- ============================================================
-- Check after running:
--   select tablename from pg_tables where tablename like 'chat%';
--     -- chat_members, chat_messages, chats
--   select count(*) from pg_policies where tablename in ('chats','chat_members','chat_messages');
--     -- 6 (one read rule + one zz_active_users_only per table)
--   select count(*) from pg_proc where proname in ('start_direct_chat','create_group_chat',
--     'add_chat_members','remove_chat_member','leave_chat','rename_chat','send_chat_message',
--     'edit_chat_message','delete_chat_message','mark_chat_read','my_chats','chat_member_list','chat_people');
--     -- 13
-- ============================================================