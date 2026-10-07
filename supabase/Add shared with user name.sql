-- migration_add_shared_with_user_name.sql
-- Run after migration_add_staff_direct_tasks_and_docs.sql.
--
-- Gap found immediately after shipping that migration: shared_with_user_id
-- was added with no denormalized name, unlike every other "who" field in
-- this schema (client_name, client_org_name, uploaded_by_name, creator_name,
-- assignee_name all exist specifically to avoid a per-row join in list
-- screens). Without this, every Documents screen would need to resolve
-- shared_with_user_id -> a name itself just to display who a direct share
-- went to.
alter table public.documents
  add column if not exists shared_with_user_name text null;