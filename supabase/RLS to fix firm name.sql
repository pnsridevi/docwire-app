alter table public.tenants enable row level security;

create policy "tenants_select_own"
on public.tenants for select
to authenticated
using (
  id in (select tenant_id from public.users where id = auth.uid())
);