-- =====================================================================
-- Fix client admin tasks.sql   (OPTION, 17 Nov 2026: apply only if you decide
-- that Client Admins should not see staff-only tasks; not applied anywhere yet)
-- Run once in the Supabase SQL Editor, after "Fix assignments.sql".
-- Closes P-18 (Findings tab of "DocWire — Test Case Register").
--
-- Today a Client Admin sees every task in their organisation, including tasks
-- between staff about one of their Clients that were never shared with that
-- Client (for example "Staff only: chase Pooja for bank statement"), and those
-- tasks' history lines.
--
-- With this change a Client Admin sees a task in their organisation when:
--   * a Client created it, or
--   * it is assigned to a Client, or
--   * staff shared it with the Client ("Share with Client").
-- That is the same line documents already follow: Client Admins see Clients'
-- uploads and staff documents shared with Clients, not staff-only files.
-- Task history lines follow automatically (they are visible only with their task).
--
-- Safe to run more than once. Changes no rows.
-- Undo: see the bottom of this file.
-- =====================================================================

drop policy if exists "tasks_select_client_admin" on public.tasks;
create policy "tasks_select_client_admin" on public.tasks
  for select using (
    current_user_role() = 'client_admin'
    and client_org_id = (select users.client_org_id from users where users.id = auth.uid())
    and (creator_role = 'client' or assignee_role = 'client' or shared_with_client = true)
  );

-- =====================================================================
-- Undo (puts back today's rule: every task in the organisation):
--   drop policy if exists "tasks_select_client_admin" on public.tasks;
--   create policy "tasks_select_client_admin" on public.tasks
--     for select using (
--       current_user_role() = 'client_admin'
--       and client_org_id = (select users.client_org_id from users where users.id = auth.uid())
--     );
-- =====================================================================