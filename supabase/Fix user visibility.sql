-- DocWire: Fix_user_visibility.sql
-- Purpose: clients and client admins can no longer see users from OTHER client organisations.
--
-- Who sees which user rows after this change:
--   Super Admin, Manager, Accountant : everyone in the firm (no change)
--   Client Admin, Client             : themselves, people in their own organisation, and firm staff
--   Nobody                           : users of another firm (no change)
--
-- Only the rule "users_select_tenant" is replaced. No other rule, table or app file changes.
-- Safe to run more than once. Run in Supabase -> SQL Editor.

begin;

-- Helper: the logged-in person's client organisation (null for staff).
-- SECURITY DEFINER, like current_user_role(), so it can read the users table without looping
-- back through the users rules.
create or replace function public.current_user_client_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select client_org_id from public.users where id = auth.uid();
$$;

drop policy if exists users_select_tenant on public.users;

create policy users_select_tenant on public.users
  for select
  using (
    tenant_id = public.current_user_tenant()
    and (
      -- staff see everyone in the firm
      public.current_user_role() in ('super_admin', 'manager', 'accountant')
      -- everyone in the firm can see staff
      or role in ('super_admin', 'manager', 'accountant')
      -- clients see people in their own organisation only
      or (client_org_id is not null and client_org_id = public.current_user_client_org())
    )
  );

commit;