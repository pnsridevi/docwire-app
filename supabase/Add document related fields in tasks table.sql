alter table public.tasks
  add column linked_document_id uuid null references public.documents(id),
  add column linked_document_name text null;