-- ============================================================
-- Add_password_change.sql
-- Run AFTER Add_staff_book_entry.sql.
--
-- What this does
--   1. Adds users.must_change_password.
--        * Every account that already exists gets FALSE (nobody is
--          interrupted).
--        * Every account created from now on gets TRUE automatically
--          (admin-create-user inserts the row without this column, so
--          the default applies - no Edge Function change needed).
--   2. Clears the flag ONLY when the person's password really changes
--      (trigger on auth.users). The app cannot just switch it off.
--   3. Refuses any direct change of the flag from the app
--      (signed-in users and anonymous callers).
--
-- Safe to run more than once.
-- ============================================================

begin;

-- 1. The column -----------------------------------------------------------
-- Added with DEFAULT FALSE first so every existing row is filled with
-- false; the default is then switched to TRUE for new rows only.
alter table public.users
  add column if not exists must_change_password boolean not null default false;

alter table public.users
  alter column must_change_password set default true;

-- 2. Clear the flag when the password really changes ----------------------
-- Fires when Supabase Auth writes a new password hash (the app's
-- supabase.auth.updateUser({ password }) call). SECURITY DEFINER so it
-- can update public.users whatever role Supabase Auth runs as.
create or replace function public.clear_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.users
       set must_change_password = false
     where id = new.id
       and must_change_password;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed
  after update of encrypted_password on auth.users
  for each row
  execute function public.clear_must_change_password();

-- 3. Nobody can switch the flag from the app -------------------------------
-- Only the trigger above (runs as the function owner) and the service
-- role (Edge Functions, e.g. a future admin "Reset password") may change
-- it. A signed-in person trying to set it to false directly is refused.
create or replace function public.guard_must_change_password()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and current_user in ('authenticated', 'anon') then
    raise exception 'must_change_password can only be changed by changing the password'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_must_change_password on public.users;
create trigger guard_must_change_password
  before update of must_change_password on public.users
  for each row
  execute function public.guard_must_change_password();

commit;

-- ------------------------------------------------------------
-- Optional: make some EXISTING test accounts change their password at
-- next login. Edit the emails, then run on its own.
--
-- update public.users
--    set must_change_password = true
--  where id in (select id from auth.users where email in (
--    'deepak@example.com',
--    'leela@example.com'
--  ));
-- ------------------------------------------------------------

-- Quick check after running (should show the new column, false for
-- everyone who existed before):
-- select name, role, must_change_password from public.users order by name;