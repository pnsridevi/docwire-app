-- ============================================================
-- Incremental migration #3 — run after migration_tasks_and_assignments.sql.
-- Fixes two RLS gaps found on recheck: TasksScreen's assignee picker
-- queries manager_assignments/accountant_assignments directly, but no
-- policy existed granting Client or Accountant read access to them.
-- Without this, those queries silently return zero rows under RLS
-- (no error) — the picker just shows "No one to assign yet."
-- ============================================================

-- Client needs to read their own org's manager/accountant assignment,
-- to know who they're allowed to raise a task for.
create policy "manager_assignments_select_client" on manager_assignments
  for select using (
    current_user_role() = 'client'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

create policy "accountant_assignments_select_client" on accountant_assignments
  for select using (
    current_user_role() = 'client'
    and client_org_id = (select client_org_id from users where id = auth.uid())
  );

-- Accountant needs to read the Manager assignment for their own clients,
-- to know who manages the clients they're assigned to (task assignee list).
create policy "manager_assignments_select_accountant" on manager_assignments
  for select using (
    current_user_role() = 'accountant'
    and client_org_id in (select client_org_id from accountant_assignments where accountant_id = auth.uid())
  );