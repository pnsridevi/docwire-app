-- LOCATION: Supabase Dashboard -> SQL Editor
-- ============================================================
-- Seed_standard_master_categories.sql
--
-- Creates the STANDARD Master Document category list — ONE copy, sharedgi
-- by every firm. Run ONCE per database, never per firm: a new firm needs
-- nothing, it sees this list automatically.
--
-- When to run it
--   Production / any brand-new database: once, after all migrations
--   (including Shared_master_categories.sql). A schema-only export copies
--   the rules but not this list, so this file is what fills it.
--   Testing database: not needed — the list already exists there.
--
-- Safe to run more than once: anything already in the standard list is
-- skipped, so it can also be used to ADD a new standard category later
-- (add a line below and run it again).
-- ============================================================

begin;

do $$
declare
  cat record;
  sub text;
  v_parent uuid;
begin
  for cat in
    select * from (values
      ('Income Tax',               array['ITR Filings', 'Assessment Orders', 'Tax Notices']),
      ('GST',                      array['GSTR-1', 'GSTR-3B', 'GSTR-9 Annual Return', 'GST Notices']),
      ('TDS',                      array['TDS Returns', 'Form 16 / 16A']),
      ('Bank Records',             array['Bank Statements', 'Loan Documents']),
      ('Registration & Licences',  array['PAN', 'GST Registration', 'Incorporation', 'Trade Licence']),
      ('Agreements & Contracts',   array[]::text[]),
      ('Financial Statements',     array['Balance Sheet', 'Profit & Loss']),
      ('Audit',                    array['Audit Reports']),
      ('Payroll',                  array['PF', 'ESI']),
      ('Identity & KYC',           array[]::text[])
    ) as t(name, subs)
  loop
    select id into v_parent from public.master_categories
     where tenant_id is null and parent_id is null and lower(name) = lower(cat.name);

    if v_parent is null then
      insert into public.master_categories (tenant_id, name, is_default)
      values (null, cat.name, true)
      returning id into v_parent;
    end if;

    foreach sub in array cat.subs loop
      if not exists (
        select 1 from public.master_categories
         where tenant_id is null and parent_id = v_parent and lower(name) = lower(sub)
      ) then
        insert into public.master_categories (tenant_id, name, parent_id, is_default)
        values (null, sub, v_parent, true);
      end if;
    end loop;
  end loop;
end $$;

commit;

-- Check: should return 30 (10 categories + 20 sub-tags), more if you've
-- added standard entries since.
--   select count(*) from master_categories where tenant_id is null;