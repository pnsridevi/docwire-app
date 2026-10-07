-- Links a Task to the Document created alongside it at task-creation time
-- (Architecture §7.2). Each column is added independently with IF NOT
-- EXISTS, since linked_document_id already exists on this table —
-- safe to re-run regardless of which of the three columns are already
-- present.
alter table public.tasks
  add column if not exists linked_document_id uuid null references public.documents(id);

alter table public.tasks
  add column if not exists linked_document_name text null;

alter table public.tasks
  add column if not exists linked_document_needs_entry boolean null;