-- Fix list speed.sql (P-29), 20 Nov 2026. Run once in the Supabase SQL editor. No change to the app or the data.
-- Documents, Tasks and opening files were slow because every access rule ran its helper functions
-- (auth.uid(), current_user_role(), current_user_tenant(), is_active_user(), current_user_client_org())
-- again for EVERY ROW of the table, and the columns the rules look rows up by had no indexes.
-- 1. 82 rules are rewritten word for word, except that each of those calls is written "( SELECT <call>)",
--    so the database works it out once per request (Supabase's own advice for fast rules). All five are
--    STABLE functions with no inputs: within one request each gives one answer, so who sees what can't change.
-- 2. Indexes on the columns the rules and screens look rows up by (firm, organisation, Client, uploader,
--    assignee, file path).
-- 3. Documents and tasks: a rule that only the person's own firm's rows are read. Every rule already keeps
--    people to their own firm; this one lets the database skip other firms' rows through the index.
-- Proved on a copy: what each of 34 people can read in all 19 protected tables is identical before and after
-- (fix/list_speed/snapshot.sh), and every database, regression and screen check passes.
begin;

-- 0. Safety check: every rule this file rewrites must still be worded exactly as on live (20 Nov 2026).
--    If one differs, nothing below runs; the error lists the rules that differ.
do $guard$
declare differ text;
begin
  select string_agg(e.s || '.' || e.t || ' "' || e.n || '"', ', ') into differ
  from (values
    ('public', 'accountant_assignments', 'accountant_assignments_insert_super_admin', '9bc49942c6dd3f9ddb684d16241e741b'),
    ('public', 'accountant_assignments', 'accountant_assignments_own', 'd2b7c4cf885da0478221ca3c75d72309'),
    ('public', 'accountant_assignments', 'accountant_assignments_select_client', '7b40d66f70c051e93f3cab0dec587c07'),
    ('public', 'accountant_assignments', 'accountant_assignments_select_client_admin', 'ec9f420b824851290d7ed38a914e8f4f'),
    ('public', 'accountant_assignments', 'accountant_assignments_select_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'accountant_assignments', 'accountant_assignments_tenant_managers', '0ee317b23076b6197ece386cb95eefa1'),
    ('public', 'accountant_assignments', 'accountant_assignments_update_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'client_assignment_history', 'client_assignment_history_select_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'client_assignments', 'client_assignments_insert_super_admin', '9bc49942c6dd3f9ddb684d16241e741b'),
    ('public', 'client_assignments', 'client_assignments_select_accountant', 'fbdf210c51026a55fd9e1f881cbfa143'),
    ('public', 'client_assignments', 'client_assignments_select_client_admin', 'ec9f420b824851290d7ed38a914e8f4f'),
    ('public', 'client_assignments', 'client_assignments_select_manager', '00e5188abd00c56e29d465e13136a4d5'),
    ('public', 'client_assignments', 'client_assignments_select_self', '4d8b1a17f60bb4e47992a12ea4206062'),
    ('public', 'client_assignments', 'client_assignments_select_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'client_assignments', 'client_assignments_update_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'client_organizations', 'client_org_same_tenant', '86b3d3d0826e9052522f8c9462219e6d'),
    ('public', 'client_organizations', 'client_organizations_insert_super_admin', '96d6e6ba0eae83716e4f969393c7d77e'),
    ('public', 'client_organizations', 'client_organizations_update_super_admin', '004fc426b145f63bd89cc09fccd4c9b7'),
    ('public', 'document_versions', 'document_versions_insert_own', 'f0acf5cacaedcbba874c356c95880aff'),
    ('public', 'documents', 'documents_accountant_insert_direct_share', '16174e38d9f2a2b5c131adaf53e2a063'),
    ('public', 'documents', 'documents_accountant_insert_firm_wide', '4e069b9c60f5b2da09cf54ef8a456cb9'),
    ('public', 'documents', 'documents_accountant_insert_work_doc', '9fb4994c2b89776e9c26ffd36df6f4e0'),
    ('public', 'documents', 'documents_accountant_select', '78ff2bbbf084b2c695b68e32a6fcaf94'),
    ('public', 'documents', 'documents_accountant_select_firm_wide', 'fab90ff869e6227927ff95df94319936'),
    ('public', 'documents', 'documents_accountant_select_work', '5ee66f7656c6cf9705d5c9b4dd31627d'),
    ('public', 'documents', 'documents_accountant_update', '78ff2bbbf084b2c695b68e32a6fcaf94'),
    ('public', 'documents', 'documents_accountant_update_firm_wide', 'fab90ff869e6227927ff95df94319936'),
    ('public', 'documents', 'documents_accountant_update_staff_entry', 'b421661cb5085f31c8d32bfc02d87b16'),
    ('public', 'documents', 'documents_accountant_update_work', 'b57156951b8b7e8e9f85106b662fbad5'),
    ('public', 'documents', 'documents_client_admin_select_staff_shared_with_clients', 'ed52b3a9025a1b8351493e90da04476a'),
    ('public', 'documents', 'documents_client_insert_own', 'f0e804fd8d8ee12dc4a6e9bafdffce5b'),
    ('public', 'documents', 'documents_client_select_firm_wide_broadcast', '0944be1f72a3581e042f26349afaa082'),
    ('public', 'documents', 'documents_client_select_own', 'c6000a12a189637783fc99058c3b5a3c'),
    ('public', 'documents', 'documents_client_select_shared_work', 'e354dbc032528194d0366d51170760d9'),
    ('public', 'documents', 'documents_client_update_own_rework_reupload', '2955786bc085507a5094964eaf38817c'),
    ('public', 'documents', 'documents_manager_insert_direct_share', 'd2fc1419ddf0530ca58cdc19154e4100'),
    ('public', 'documents', 'documents_manager_insert_firm_wide', 'f35d7943e27e50dd79131b57349f1e99'),
    ('public', 'documents', 'documents_manager_insert_work_doc', 'c3a14c8ea6ce06697c0d82107e4d6b06'),
    ('public', 'documents', 'documents_manager_select', '1fe67037f6822f8af81e5eeddfed1122'),
    ('public', 'documents', 'documents_manager_select_firm_wide', 'a6671c00f11119152667649741eef917'),
    ('public', 'documents', 'documents_manager_select_work', '86e495b383d488ef4d6afd9eeaedff70'),
    ('public', 'documents', 'documents_manager_update', '1fe67037f6822f8af81e5eeddfed1122'),
    ('public', 'documents', 'documents_manager_update_firm_wide', 'a6671c00f11119152667649741eef917'),
    ('public', 'documents', 'documents_manager_update_staff_entry', 'f9b40c4a2e0b933e5fce3fc62f649652'),
    ('public', 'documents', 'documents_manager_update_work', '779eb509d6008849e486479b8f004e7f'),
    ('public', 'documents', 'documents_select_client_admin', '97fd553406736e5d0d06a6737dd4181b'),
    ('public', 'documents', 'documents_select_direct_share', '97fe105c2b081ac27b55d4c836a960a0'),
    ('public', 'documents', 'documents_select_super_admin', '004fc426b145f63bd89cc09fccd4c9b7'),
    ('public', 'manager_assignments', 'manager_assignments_insert_super_admin', '9bc49942c6dd3f9ddb684d16241e741b'),
    ('public', 'manager_assignments', 'manager_assignments_own', '2e9baea84748278666da5625fc05414e'),
    ('public', 'manager_assignments', 'manager_assignments_select_accountant', '65d5b0e41af60a7db3f8c4981bdc4972'),
    ('public', 'manager_assignments', 'manager_assignments_select_client', '7b40d66f70c051e93f3cab0dec587c07'),
    ('public', 'manager_assignments', 'manager_assignments_select_client_admin', 'ec9f420b824851290d7ed38a914e8f4f'),
    ('public', 'manager_assignments', 'manager_assignments_select_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'manager_assignments', 'manager_assignments_update_super_admin', 'aca3e30cb3d0eadb59c49d57c2da5d9c'),
    ('public', 'master_categories', 'master_categories_insert_staff_admin', '3c071e3941d64117ac34adf418ec4d21'),
    ('public', 'master_categories', 'master_categories_select_tenant', '0704c3049e2aef07306719610bec4632'),
    ('public', 'master_categories', 'master_categories_update_staff_admin', '54c86dd9022972f192bbf5437723827e'),
    ('public', 'master_documents', 'master_documents_insert', '8b19d840ed4b2cc55b35f786862131c6'),
    ('public', 'master_documents', 'master_documents_select', 'e5007d1db384a14ef8bb528f38685c9c'),
    ('public', 'master_documents', 'master_documents_update', '5ccb42afa290e36c3a572465725ff04e'),
    ('public', 'tasks', 'tasks_insert_accountant', 'c01b689f6db36c9f98af06592f3d3b40'),
    ('public', 'tasks', 'tasks_insert_accountant_direct', 'eae6382e52f45493404458875f093910'),
    ('public', 'tasks', 'tasks_insert_client', 'daf49bf92694bf94a0c674565e17d0cb'),
    ('public', 'tasks', 'tasks_insert_manager', '2c8f9ea4711b8ee18d00c37c989cfcda'),
    ('public', 'tasks', 'tasks_insert_manager_direct', 'e1baeb37d6a8459ce59c32395ae5d176'),
    ('public', 'tasks', 'tasks_select_accountant', '4920618ffd6c9f2aa85f534ab427cd7b'),
    ('public', 'tasks', 'tasks_select_client', 'ee2b7687b85133aa654b88741aba0bba'),
    ('public', 'tasks', 'tasks_select_client_admin', '619c243b872ba173025169c703179cca'),
    ('public', 'tasks', 'tasks_select_client_shared', 'e38ddd7d17f9da260be46b6ac816a926'),
    ('public', 'tasks', 'tasks_select_manager', 'e8e4471e1aec42620145ca5b51e8f1fb'),
    ('public', 'tasks', 'tasks_select_staff_direct_no_client', '25c1ff3a26231444b5c3fc5d7e28aae6'),
    ('public', 'tasks', 'tasks_select_super_admin', '004fc426b145f63bd89cc09fccd4c9b7'),
    ('public', 'tasks', 'tasks_update_participant', '0d57112178c4a70d49b683433c15d803'),
    ('public', 'tenants', 'tenants_select_own', '85976fc6776af9a88977614f5bb0666e'),
    ('public', 'users', 'users_select_own', 'bd301ab91c482f43f9fd893c5783c3c0'),
    ('public', 'users', 'users_select_tenant', 'fc9823740cad892b73db0c0f23bfb672'),
    ('public', 'users', 'users_update_firm_wide_staff_super_admin', 'a88da03856f9cebf8a6607062b3a2ec1'),
    ('public', 'users', 'zz_active_users_only', 'c4d46609844fe61beaf2383f5eadd9db'),
    ('storage', 'objects', 'documents_storage_delete_own_folder', 'e11c5ab641e14fad49c05b219c297c51'),
    ('storage', 'objects', 'documents_storage_insert_own_folder', '07922ddb26294073e5c06fd6f4bcd18e'),
    ('storage', 'objects', 'documents_storage_select_own_unused', 'e11c5ab641e14fad49c05b219c297c51')) e(s, t, n, h)
  left join pg_policies p on p.schemaname = e.s and p.tablename = e.t and p.policyname = e.n
  where p.policyname is null or md5(coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')) <> e.h;
  if differ is not null then
    raise exception 'Stopped, nothing changed: these rules differ from live as of 20 Nov (or are missing): %', differ;
  end if;
end $guard$;

-- 1. The access rules, with their helper calls worked out once per request

alter policy "accountant_assignments_insert_super_admin" on public.accountant_assignments
  with check (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "accountant_assignments_own" on public.accountant_assignments
  using (((accountant_id = ( SELECT auth.uid())) OR is_manager_of_client(client_org_id)));

alter policy "accountant_assignments_select_client" on public.accountant_assignments
  using (((( SELECT current_user_role()) = 'client'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "accountant_assignments_select_client_admin" on public.accountant_assignments
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "accountant_assignments_select_super_admin" on public.accountant_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "accountant_assignments_tenant_managers" on public.accountant_assignments
  using (((( SELECT current_user_role()) = 'manager'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "accountant_assignments_update_super_admin" on public.accountant_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "client_assignment_history_select_super_admin" on public.client_assignment_history
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "client_assignments_insert_super_admin" on public.client_assignments
  with check (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "client_assignments_select_accountant" on public.client_assignments
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (accountant_id = ( SELECT auth.uid()))));

alter policy "client_assignments_select_client_admin" on public.client_assignments
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "client_assignments_select_manager" on public.client_assignments
  using (((( SELECT current_user_role()) = 'manager'::text) AND (manager_id = ( SELECT auth.uid()))));

alter policy "client_assignments_select_self" on public.client_assignments
  using ((client_id = ( SELECT auth.uid())));

alter policy "client_assignments_select_super_admin" on public.client_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "client_assignments_update_super_admin" on public.client_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "client_org_same_tenant" on public.client_organizations
  using ((tenant_id = ( SELECT current_user_tenant())));

alter policy "client_organizations_insert_super_admin" on public.client_organizations
  with check (((( SELECT current_user_role()) = 'super_admin'::text) AND (tenant_id = ( SELECT current_user_tenant()))));

alter policy "client_organizations_update_super_admin" on public.client_organizations
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (tenant_id = ( SELECT current_user_tenant()))));

alter policy "document_versions_insert_own" on public.document_versions
  with check ((EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.id = document_versions.document_id) AND (d.client_id = ( SELECT auth.uid()))))));

alter policy "documents_accountant_insert_direct_share" on public.documents
  with check (((( SELECT current_user_role()) = 'accountant'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'accountant'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (client_id IS NULL) AND (client_org_id IS NULL) AND (shared_with_user_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.accountant_id = ( SELECT auth.uid())) AND (ca.manager_id = documents.shared_with_user_id))))));

alter policy "documents_accountant_insert_firm_wide" on public.documents
  with check (((( SELECT current_user_role()) = 'accountant'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'accountant'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (client_id IS NULL) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant())))) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_accountant_insert_work_doc" on public.documents
  with check (((( SELECT current_user_role()) = 'accountant'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'accountant'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (client_org_id IN ( SELECT client_assignments.client_org_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))))));

alter policy "documents_accountant_select" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'client'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))));

alter policy "documents_accountant_select_firm_wide" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'accountant'::text) AND (client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_accountant_select_work" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = ANY (ARRAY['manager'::text, 'accountant'::text])) AND (((source = 'accountant'::text) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid()))))) OR ((source = 'manager'::text) AND (shared_with_accountant = true) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE ((client_assignments.accountant_id = ( SELECT auth.uid())) AND (client_assignments.manager_id = documents.uploaded_by))))) OR ((client_id IS NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments
  WHERE ((client_assignments.accountant_id = ( SELECT auth.uid())) AND (client_assignments.manager_id = documents.uploaded_by) AND (client_assignments.client_org_id = documents.client_org_id))))))))));

alter policy "documents_accountant_update" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'client'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))));

alter policy "documents_accountant_update_firm_wide" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'accountant'::text) AND (client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_accountant_update_staff_entry" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'manager'::text) AND (needs_entry = true) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))));

alter policy "documents_accountant_update_work" on public.documents
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (source = 'accountant'::text) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND ((EXISTS ( SELECT 1
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid())))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true)))))))));

alter policy "documents_client_admin_select_staff_shared_with_clients" on public.documents
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid())))) AND (source = ANY (ARRAY['manager'::text, 'accountant'::text])) AND (shared_with_clients = true)));

alter policy "documents_client_insert_own" on public.documents
  with check (((( SELECT current_user_role()) = 'client'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (tenant_id = ( SELECT current_user_tenant())) AND (source = 'client'::text)));

alter policy "documents_client_select_firm_wide_broadcast" on public.documents
  using (((( SELECT current_user_role()) = 'client'::text) AND (source = ANY (ARRAY['manager'::text, 'accountant'::text])) AND (shared_with_clients = true) AND (client_id IS NULL) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid())))) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = documents.uploaded_by) AND (u.firm_wide_staff = true))))));

alter policy "documents_client_select_own" on public.documents
  using (((( SELECT current_user_role()) = 'client'::text) AND (uploaded_by = ( SELECT auth.uid()))));

alter policy "documents_client_select_shared_work" on public.documents
  using (((( SELECT current_user_role()) = 'client'::text) AND (source = ANY (ARRAY['manager'::text, 'accountant'::text])) AND (shared_with_clients = true) AND ((client_id = ( SELECT auth.uid())) OR ((client_id IS NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = ( SELECT auth.uid())) AND (ca.client_org_id = documents.client_org_id) AND (((documents.source = 'manager'::text) AND (ca.manager_id = documents.uploaded_by)) OR ((documents.source = 'accountant'::text) AND (ca.accountant_id = documents.uploaded_by))))))))));

alter policy "documents_client_update_own_rework_reupload" on public.documents
  using (((client_id = ( SELECT auth.uid())) AND (status = 'rework'::text) AND (reupload_requested = true)))
  with check ((client_id = ( SELECT auth.uid())));

alter policy "documents_manager_insert_direct_share" on public.documents
  with check (((( SELECT current_user_role()) = 'manager'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'manager'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (client_id IS NULL) AND (client_org_id IS NULL) AND (shared_with_user_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.manager_id = ( SELECT auth.uid())) AND (ca.accountant_id = documents.shared_with_user_id))))));

alter policy "documents_manager_insert_firm_wide" on public.documents
  with check (((( SELECT current_user_role()) = 'manager'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'manager'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (client_id IS NULL) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant())))) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_manager_insert_work_doc" on public.documents
  with check (((( SELECT current_user_role()) = 'manager'::text) AND (uploaded_by = ( SELECT auth.uid())) AND (source = 'manager'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (client_org_id IN ( SELECT client_assignments.client_org_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))))));

alter policy "documents_manager_select" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'client'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))));

alter policy "documents_manager_select_firm_wide" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'manager'::text) AND (client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_manager_select_work" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = ANY (ARRAY['manager'::text, 'accountant'::text])) AND (((source = 'manager'::text) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid()))))) OR ((source = 'accountant'::text) AND (shared_with_manager = true) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE ((client_assignments.manager_id = ( SELECT auth.uid())) AND (client_assignments.accountant_id = documents.uploaded_by))))) OR ((client_id IS NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments
  WHERE ((client_assignments.manager_id = ( SELECT auth.uid())) AND (client_assignments.accountant_id = documents.uploaded_by) AND (client_assignments.client_org_id = documents.client_org_id))))))))));

alter policy "documents_manager_update" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'client'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))));

alter policy "documents_manager_update_firm_wide" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'manager'::text) AND (client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true))))));

alter policy "documents_manager_update_staff_entry" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'accountant'::text) AND (needs_entry = true) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))));

alter policy "documents_manager_update_work" on public.documents
  using (((( SELECT current_user_role()) = 'manager'::text) AND (source = 'manager'::text) AND (((client_id IS NOT NULL) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))) OR ((client_id IS NULL) AND (uploaded_by = ( SELECT auth.uid())) AND ((EXISTS ( SELECT 1
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid())))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid())) AND (u.firm_wide_staff = true)))))))));

alter policy "documents_select_client_admin" on public.documents
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid())))) AND (source = 'client'::text)));

alter policy "documents_select_direct_share" on public.documents
  using (((client_id IS NULL) AND ((uploaded_by = ( SELECT auth.uid())) OR (shared_with_user_id = ( SELECT auth.uid())))));

alter policy "documents_select_super_admin" on public.documents
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (tenant_id = ( SELECT current_user_tenant()))));

alter policy "manager_assignments_insert_super_admin" on public.manager_assignments
  with check (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "manager_assignments_own" on public.manager_assignments
  using ((manager_id = ( SELECT auth.uid())));

alter policy "manager_assignments_select_accountant" on public.manager_assignments
  using (((( SELECT current_user_role()) = 'accountant'::text) AND is_accountant_of_client(client_org_id)));

alter policy "manager_assignments_select_client" on public.manager_assignments
  using (((( SELECT current_user_role()) = 'client'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "manager_assignments_select_client_admin" on public.manager_assignments
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "manager_assignments_select_super_admin" on public.manager_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "manager_assignments_update_super_admin" on public.manager_assignments
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (client_org_id IN ( SELECT client_organizations.id
   FROM client_organizations
  WHERE (client_organizations.tenant_id = ( SELECT current_user_tenant()))))));

alter policy "master_categories_insert_staff_admin" on public.master_categories
  with check (((( SELECT current_user_role()) = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND (tenant_id = ( SELECT current_user_tenant())) AND (created_by = ( SELECT auth.uid()))));

alter policy "master_categories_select_tenant" on public.master_categories
  using (((tenant_id IS NULL) OR (tenant_id = ( SELECT current_user_tenant()))));

alter policy "master_categories_update_staff_admin" on public.master_categories
  using (((( SELECT current_user_role()) = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND (tenant_id = ( SELECT current_user_tenant()))))
  with check (((( SELECT current_user_role()) = ANY (ARRAY['manager'::text, 'super_admin'::text])) AND (tenant_id = ( SELECT current_user_tenant()))));

alter policy "master_documents_insert" on public.master_documents
  with check (((tenant_id = ( SELECT current_user_tenant())) AND (uploaded_by = ( SELECT auth.uid())) AND can_access_master_org(client_org_id) AND (((source_document_id IS NULL) AND ((storage.foldername(file_path))[1] = (( SELECT auth.uid()))::text)) OR ((source_document_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.id = master_documents.source_document_id) AND (d.file_path = master_documents.file_path) AND (d.client_org_id = master_documents.client_org_id))))))));

alter policy "master_documents_select" on public.master_documents
  using (((tenant_id = ( SELECT current_user_tenant())) AND can_access_master_org(client_org_id) AND ((deleted_at IS NULL) OR (( SELECT current_user_role()) <> ALL (ARRAY['client'::text, 'client_admin'::text])))));

alter policy "master_documents_update" on public.master_documents
  using (((tenant_id = ( SELECT current_user_tenant())) AND can_access_master_org(client_org_id)))
  with check (((tenant_id = ( SELECT current_user_tenant())) AND can_access_master_org(client_org_id)));

alter policy "tasks_insert_accountant" on public.tasks
  with check (((( SELECT current_user_role()) = 'accountant'::text) AND (creator_id = ( SELECT auth.uid())) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))));

alter policy "tasks_insert_accountant_direct" on public.tasks
  with check (((( SELECT current_user_role()) = 'accountant'::text) AND (creator_id = ( SELECT auth.uid())) AND (client_id IS NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.accountant_id = ( SELECT auth.uid())) AND (ca.manager_id = tasks.assignee_id))))));

alter policy "tasks_insert_client" on public.tasks
  with check (((( SELECT current_user_role()) = 'client'::text) AND (creator_id = ( SELECT auth.uid())) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid()))))));

alter policy "tasks_insert_manager" on public.tasks
  with check (((( SELECT current_user_role()) = 'manager'::text) AND (creator_id = ( SELECT auth.uid())) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))));

alter policy "tasks_insert_manager_direct" on public.tasks
  with check (((( SELECT current_user_role()) = 'manager'::text) AND (creator_id = ( SELECT auth.uid())) AND (client_id IS NULL) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.manager_id = ( SELECT auth.uid())) AND (ca.accountant_id = tasks.assignee_id))))));

alter policy "tasks_select_accountant" on public.tasks
  using (((( SELECT current_user_role()) = 'accountant'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.accountant_id = ( SELECT auth.uid()))))));

alter policy "tasks_select_client" on public.tasks
  using (((( SELECT current_user_role()) = 'client'::text) AND ((creator_id = ( SELECT auth.uid())) OR (assignee_id = ( SELECT auth.uid())))));

alter policy "tasks_select_client_admin" on public.tasks
  using (((( SELECT current_user_role()) = 'client_admin'::text) AND (client_org_id = ( SELECT users.client_org_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid())))) AND ((creator_role = 'client'::text) OR (assignee_role = 'client'::text) OR (shared_with_client = true))));

alter policy "tasks_select_client_shared" on public.tasks
  using (((( SELECT current_user_role()) = 'client'::text) AND (client_id = ( SELECT auth.uid())) AND (shared_with_client = true)));

alter policy "tasks_select_manager" on public.tasks
  using (((( SELECT current_user_role()) = 'manager'::text) AND (client_id IN ( SELECT client_assignments.client_id
   FROM client_assignments
  WHERE (client_assignments.manager_id = ( SELECT auth.uid()))))));

alter policy "tasks_select_staff_direct_no_client" on public.tasks
  using (((client_id IS NULL) AND ((creator_id = ( SELECT auth.uid())) OR (assignee_id = ( SELECT auth.uid())))));

alter policy "tasks_select_super_admin" on public.tasks
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (tenant_id = ( SELECT current_user_tenant()))));

alter policy "tasks_update_participant" on public.tasks
  using (((assignee_id = ( SELECT auth.uid())) OR (creator_id = ( SELECT auth.uid()))));

alter policy "tenants_select_own" on public.tenants
  using ((id IN ( SELECT users.tenant_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid())))));

alter policy "users_select_own" on public.users
  using ((id = ( SELECT auth.uid())));

alter policy "users_select_tenant" on public.users
  using (((tenant_id = ( SELECT current_user_tenant())) AND ((( SELECT current_user_role()) = ANY (ARRAY['super_admin'::text, 'manager'::text, 'accountant'::text])) OR (role = ANY (ARRAY['super_admin'::text, 'manager'::text, 'accountant'::text])) OR ((client_org_id IS NOT NULL) AND (client_org_id = ( SELECT current_user_client_org()))))));

alter policy "users_update_firm_wide_staff_super_admin" on public.users
  using (((( SELECT current_user_role()) = 'super_admin'::text) AND (tenant_id = ( SELECT current_user_tenant())) AND (role = ANY (ARRAY['manager'::text, 'accountant'::text]))));

alter policy "zz_active_users_only" on public.users
  using ((( SELECT is_active_user() AS is_active_user) OR (id = ( SELECT auth.uid()))))
  with check (( SELECT is_active_user() AS is_active_user));

alter policy "documents_storage_delete_own_folder" on storage.objects
  using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text) AND (NOT dw_private.is_document_file_in_use(name))));

alter policy "documents_storage_insert_own_folder" on storage.objects
  with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text)));

alter policy "documents_storage_select_own_unused" on storage.objects
  using (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid()))::text) AND (NOT dw_private.is_document_file_in_use(name))));

-- 2. Indexes
create index if not exists documents_tenant_created_idx on public.documents (tenant_id, created_at desc);
create index if not exists documents_client_idx on public.documents (client_id);
create index if not exists documents_org_idx on public.documents (client_org_id);
create index if not exists documents_uploaded_by_idx on public.documents (uploaded_by);
create index if not exists documents_shared_with_user_idx on public.documents (shared_with_user_id) where shared_with_user_id is not null;
create index if not exists documents_file_path_idx on public.documents (file_path);
create index if not exists document_versions_file_path_idx on public.document_versions (file_path);
create index if not exists master_documents_file_path_idx on public.master_documents (file_path);
create index if not exists master_document_versions_file_path_idx on public.master_document_versions (file_path);
create index if not exists master_documents_tenant_updated_idx on public.master_documents (tenant_id, updated_at desc);
create index if not exists tasks_tenant_created_idx on public.tasks (tenant_id, created_at desc);
create index if not exists tasks_client_idx on public.tasks (client_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_creator_idx on public.tasks (creator_id);
create index if not exists tasks_org_idx on public.tasks (client_org_id);
create index if not exists client_assignments_manager_idx on public.client_assignments (manager_id);
create index if not exists client_assignments_accountant_idx on public.client_assignments (accountant_id);
create index if not exists client_assignments_org_idx on public.client_assignments (client_org_id);
create index if not exists users_tenant_idx on public.users (tenant_id);
create index if not exists users_org_idx on public.users (client_org_id);

-- 3. Only the person's own firm's documents and tasks are read
drop policy if exists documents_own_firm_only on public.documents;
create policy documents_own_firm_only on public.documents as restrictive for select to authenticated
  using (tenant_id = ( SELECT current_user_tenant()));
drop policy if exists tasks_own_firm_only on public.tasks;
create policy tasks_own_firm_only on public.tasks as restrictive for select to authenticated
  using (tenant_id = ( SELECT current_user_tenant()));

commit;
analyze public.documents; analyze public.tasks; analyze public.document_versions; analyze public.master_documents;
analyze public.master_document_versions; analyze public.client_assignments; analyze public.users;
