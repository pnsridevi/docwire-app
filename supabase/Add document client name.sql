-- Denormalized client name, same pattern as creator_name/assignee_name/
-- uploaded_by_name/client_org_name already on this schema. Without this,
-- there is no way to show "which client this document is about" in a
-- table without a lookup per row — and for Super Admin (platform-wide)
-- that lookup would span every org in the tenant, not just one
-- Manager/Accountant's own clients.
--
-- Null for org-general documents (client_id also null) — same meaning
-- as client_id itself: "not about one specific client."
alter table public.documents
  add column if not exists client_name text null;