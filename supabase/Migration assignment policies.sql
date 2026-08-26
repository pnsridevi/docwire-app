-- ============================================================
-- Incremental migration — run this on top of the schema you already applied.
-- Adds the missing insert/update/delete policies for manager_assignments
-- and accountant_assignments. Nothing else in this file duplicates what
-- you've already run — safe to paste as-is into the SQL editor.
-- ============================================================

-- ------------------------------------------------------------
-- manager_assignments
-- Only Super Admin assigns a Client Org to a Manager (Architecture Section 8).
-- ------------------------------------------------------------
create policy "manager_assignments_insert_super_admin" on manager_assignments
  for insert with check (current_user_role() = 'super_admin');

create policy "manager_assignments_update_super_admin" on manager_assignments
  for update using (current_user_role() = 'super_admin');

create policy "manager_assignments_delete_super_admin" on manager_assignments
  for delete using (current_user_role() = 'super_admin');

-- ------------------------------------------------------------
-- accountant_assignments
-- A Manager can only assign an Accountant to a client THEY are themselves
-- assigned to (Architecture Section 8: "a Manager cannot assign an Accountant
-- to a client they have not themselves been assigned").
-- ------------------------------------------------------------
create policy "accountant_assignments_insert_manager" on accountant_assignments
  for insert with check (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "accountant_assignments_update_manager" on accountant_assignments
  for update using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );

create policy "accountant_assignments_delete_manager" on accountant_assignments
  for delete using (
    current_user_role() = 'manager'
    and client_org_id in (select client_org_id from manager_assignments where manager_id = auth.uid())
  );