-- 497_wave3_cross_table_relationships.sql
--
-- Wave 3 cross-table relationship pass. Wave 2 added many references inline;
-- this migration is intentionally additive/idempotent and only adds NOT VALID
-- constraints when a relationship column exists without an FK yet.
--
-- Rollback notes:
--   alter table ... drop constraint if exists <constraint name> for any
--   constraint created below. Existing Wave 1/2 inline constraints are not
--   touched by this migration.

create or replace function public.qep_column_has_fk(
  p_table regclass,
  p_column text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = p_table
      and c.contype = 'f'
      and a.attname = p_column
  );
$$;

comment on function public.qep_column_has_fk(regclass, text) is
  'Migration helper: true when a table column already participates in any foreign key constraint.';

revoke execute on function public.qep_column_has_fk(regclass, text) from public;

do $$
begin
  -- Ship-to address relationships.
  if to_regclass('public.qrm_company_ship_to_addresses') is not null then
    if to_regclass('public.qb_quotes') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qb_quotes' and column_name = 'sold_to_address_id')
      and not public.qep_column_has_fk('public.qb_quotes'::regclass, 'sold_to_address_id') then
      alter table public.qb_quotes
        add constraint qb_quotes_sold_to_address_id_wave3_fkey
        foreign key (sold_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;

    if to_regclass('public.qb_quotes') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qb_quotes' and column_name = 'ship_to_address_id')
      and not public.qep_column_has_fk('public.qb_quotes'::regclass, 'ship_to_address_id') then
      alter table public.qb_quotes
        add constraint qb_quotes_ship_to_address_id_wave3_fkey
        foreign key (ship_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;

    if to_regclass('public.customer_invoices') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'sold_to_address_id')
      and not public.qep_column_has_fk('public.customer_invoices'::regclass, 'sold_to_address_id') then
      alter table public.customer_invoices
        add constraint customer_invoices_sold_to_address_id_wave3_fkey
        foreign key (sold_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;

    if to_regclass('public.customer_invoices') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoices' and column_name = 'ship_to_address_id')
      and not public.qep_column_has_fk('public.customer_invoices'::regclass, 'ship_to_address_id') then
      alter table public.customer_invoices
        add constraint customer_invoices_ship_to_address_id_wave3_fkey
        foreign key (ship_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;

    if to_regclass('public.service_jobs') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_jobs' and column_name = 'sold_to_address_id')
      and not public.qep_column_has_fk('public.service_jobs'::regclass, 'sold_to_address_id') then
      alter table public.service_jobs
        add constraint service_jobs_sold_to_address_id_wave3_fkey
        foreign key (sold_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;

    if to_regclass('public.service_jobs') is not null
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_jobs' and column_name = 'ship_to_address_id')
      and not public.qep_column_has_fk('public.service_jobs'::regclass, 'ship_to_address_id') then
      alter table public.service_jobs
        add constraint service_jobs_ship_to_address_id_wave3_fkey
        foreign key (ship_to_address_id) references public.qrm_company_ship_to_addresses(id) on delete set null not valid;
    end if;
  end if;

  -- Wave 1 lookup/table relationships consumed by Wave 2 columns.
  if to_regclass('public.service_timecards') is not null
    and to_regclass('public.service_job_segments') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'service_timecards' and column_name = 'segment_id')
    and not public.qep_column_has_fk('public.service_timecards'::regclass, 'segment_id') then
    alter table public.service_timecards
      add constraint service_timecards_segment_id_wave3_fkey
      foreign key (segment_id) references public.service_job_segments(id) on delete set null not valid;
  end if;

  if to_regclass('public.qb_trade_ins') is not null
    and to_regclass('public.inspection_runs') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qb_trade_ins' and column_name = 'inspection_run_id')
    and not public.qep_column_has_fk('public.qb_trade_ins'::regclass, 'inspection_run_id') then
    alter table public.qb_trade_ins
      add constraint qb_trade_ins_inspection_run_id_wave3_fkey
      foreign key (inspection_run_id) references public.inspection_runs(id) on delete set null not valid;
  end if;

  if to_regclass('public.qrm_equipment') is not null
    and to_regclass('public.equipment_base_codes') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qrm_equipment' and column_name = 'base_code_id')
    and not public.qep_column_has_fk('public.qrm_equipment'::regclass, 'base_code_id') then
    alter table public.qrm_equipment
      add constraint qrm_equipment_base_code_id_wave3_fkey
      foreign key (base_code_id) references public.equipment_base_codes(id) on delete set null not valid;
  end if;

  if to_regclass('public.qrm_equipment') is not null
    and to_regclass('public.price_matrices') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qrm_equipment' and column_name = 'price_matrix_id')
    and not public.qep_column_has_fk('public.qrm_equipment'::regclass, 'price_matrix_id') then
    alter table public.qrm_equipment
      add constraint qrm_equipment_price_matrix_id_wave3_fkey
      foreign key (price_matrix_id) references public.price_matrices(id) on delete set null not valid;
  end if;

  if to_regclass('public.parts_catalog') is not null
    and to_regclass('public.price_matrices') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parts_catalog' and column_name = 'price_matrix_id')
    and not public.qep_column_has_fk('public.parts_catalog'::regclass, 'price_matrix_id') then
    alter table public.parts_catalog
      add constraint parts_catalog_price_matrix_id_wave3_fkey
      foreign key (price_matrix_id) references public.price_matrices(id) on delete set null not valid;
  end if;

  if to_regclass('public.qrm_companies') is not null
    and to_regclass('public.customer_pricing_groups') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qrm_companies' and column_name = 'pricing_group_id')
    and not public.qep_column_has_fk('public.qrm_companies'::regclass, 'pricing_group_id') then
    alter table public.qrm_companies
      add constraint qrm_companies_pricing_group_id_wave3_fkey
      foreign key (pricing_group_id) references public.customer_pricing_groups(id) on delete set null not valid;
  end if;

  if to_regclass('public.qrm_companies') is not null
    and to_regclass('public.payment_terms') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qrm_companies' and column_name = 'payment_terms_id')
    and not public.qep_column_has_fk('public.qrm_companies'::regclass, 'payment_terms_id') then
    alter table public.qrm_companies
      add constraint qrm_companies_payment_terms_id_wave3_fkey
      foreign key (payment_terms_id) references public.payment_terms(id) on delete set null not valid;
  end if;
end $$;

-- Keep the helper private to this migration history; later migrations can
-- recreate it if they need the same add-if-missing FK guard.
drop function if exists public.qep_column_has_fk(regclass, text);
