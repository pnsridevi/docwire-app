-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Migration_manager_assignments_tenant_scope.sql
--
-- Closes a gap in DocWire_Full_Schema_Rebuild.sql: manager_assignments'
-- three Super Admin write policies (insert/update/delete) only checked
-- current_user_role() = 'super_admin', with no check that client_org_id
-- actually belongs to the caller's own tenant. Every sibling table that
-- got this right already —
--   accountant_assignments_insert_super_admin / _update_super_admin /
--   _delete_super_admin (Migration_client_assignment_foundation.sql)
--   client_assignments_insert_super_admin / _update_super_admin
--     (same file)
-- — includes "and client_org_id in (select id from client_organizations
-- where tenant_id = current_user_tenant())". This brings
-- manager_assignments in line with that pattern.
--
-- Not currently exploitable through the app (every screen that writes
-- here — SuperAdminClientAssignmentsScreen — only ever passes a
-- client_org_id it already loaded scoped to the caller's own tenant),
-- but the DB itself shouldn't rely on the app being the only caller.
--
-- Safe to run once, any time after DocWire_Full_Schema_Rebuild.sql.
-- ============================================================

drop policy if exists "manager_assignments_insert_super_admin" on manager_assignments;
drop policy if exists "manager_assignments_update_super_admin" on manager_assignments;
drop policy if exists "manager_assignments_delete_super_admin" on manager_assignments;

create policy "manager_assignments_insert_super_admin" on manager_assignments
  for insert with check (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "manager_assignments_update_super_admin" on manager_assignments
  for update using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

create policy "manager_assignments_delete_super_admin" on manager_assignments
  for delete using (
    current_user_role() = 'super_admin'
    and client_org_id in (select id from client_organizations where tenant_id = current_user_tenant())
  );

-- Verify:
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check
--   from pg_policy where polrelid = 'manager_assignments'::regclass
--   and polname like '%super_admin%';
-- Each with_check should now include the client_organizations subquery,
-- matching accountant_assignments' and client_assignments' equivalents.