-- 472_qrm_company_wave2_columns.sql
--
-- Wave 2 column extensions for canonical customer table public.qrm_companies.
-- Sources:
--   docs/intellidealer-gap-audit/phase-1-crm.yaml customer.* column hints
--   docs/intellidealer-gap-audit/phase-8-financial-operations.yaml customer_ar.*
--   docs/intellidealer-gap-audit/phase-9-advanced-intelligence.yaml customer.*
--
-- Phase-8 names crm_companies, but public.crm_companies is a compatibility view
-- over qrm_companies. Add columns to qrm_companies and refresh the view later.
-- Existing qrm_companies.ein/search_1/search_2 are intentionally left intact.
--
-- Rollback notes: drop indexes below, drop added columns, then drop enum types
-- only if no later migration still depends on them.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_category') then
    create type public.customer_category as enum ('business','individual','government','non_profit','internal');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_industry') then
    create type public.customer_industry as enum ('construction','agriculture','landscaping','forestry','trucking','government','utility','mining','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_size') then
    create type public.customer_size as enum ('small','medium','large','enterprise');
  end if;
  if not exists (select 1 from pg_type where typname = 'avatax_entity_use_code') then
    create type public.avatax_entity_use_code as enum ('A','B','C','D','E','F','G','H','I','J','K','L','M','N');
  end if;
  if not exists (select 1 from pg_type where typname = 'ar_type') then
    create type public.ar_type as enum ('open_item','balance_forward');
  end if;
  if not exists (select 1 from pg_type where typname = 'invoice_print_control') then
    create type public.invoice_print_control as enum ('use_default','yes','no');
  end if;
  if not exists (select 1 from pg_type where typname = 'customer_language') then
    create type public.customer_language as enum ('en','fr','es');
  end if;
end $$;

alter table public.qrm_companies
  add column if not exists legacy_customer_number text,
  add column if not exists product_category public.customer_category,
  add column if not exists industry public.customer_industry,
  add column if not exists size public.customer_size,
  add column if not exists owner_name text,
  add column if not exists brand_of_interest text[],
  add column if not exists township text,
  add column if not exists lot text,
  add column if not exists concession text,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists business_fax text,
  add column if not exists business_cell text,
  add column if not exists business_email text,
  add column if not exists tax_code_equipment text,
  add column if not exists tax_code_parts text,
  add column if not exists tax_code_service text,
  add column if not exists tax_code_rental text,
  add column if not exists labor_tax_code_1 text,
  add column if not exists labor_tax_code_2 text,
  add column if not exists exempt_status_notes text,
  add column if not exists avatax_entity_use_code public.avatax_entity_use_code,
  add column if not exists duns_number text,
  add column if not exists naics_code text,
  add column if not exists opt_out_sale_pi boolean not null default false,
  add column if not exists opt_out_sale_pi_at timestamptz,
  add column if not exists opt_out_sale_pi_source text,
  add column if not exists ar_type public.ar_type not null default 'open_item',
  add column if not exists combine_statement_with_parent boolean not null default false,
  add column if not exists statement_message text,
  add column if not exists statement_date date,
  add column if not exists payment_terms_id uuid references public.payment_terms(id) on delete set null,
  add column if not exists payment_terms_code text,
  add column if not exists terms_code text,
  add column if not exists default_po_number text,
  add column if not exists default_po_expires_at date,
  add column if not exists po_required_on_invoice boolean not null default false,
  add column if not exists assess_late_charges boolean not null default true,
  add column if not exists print_retail_price public.invoice_print_control not null default 'use_default',
  add column if not exists print_parts_invoices public.invoice_print_control not null default 'use_default',
  add column if not exists auto_email_inspection public.invoice_print_control not null default 'use_default',
  add column if not exists ibe_account_number text,
  add column if not exists credit_limit_cents bigint,
  add column if not exists credit_limit_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists credit_limit_set_at timestamptz,
  add column if not exists credit_limit_review_at date,
  add column if not exists pricing_group_id uuid references public.customer_pricing_groups(id) on delete set null,
  add column if not exists pricing_level integer,
  add column if not exists discount_group text,
  add column if not exists preferred_language public.customer_language not null default 'en',
  add column if not exists home_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists notify_payment_issues boolean not null default false,
  add column if not exists notify_multiple_accounts boolean not null default false,
  add column if not exists notify_legal_concerns boolean not null default false,
  add column if not exists notify_birthday boolean not null default false,
  add column if not exists requires_hazmat_certified_carrier boolean not null default false,
  add column if not exists requires_lift_gate boolean not null default false,
  add column if not exists requires_signature boolean not null default false,
  add column if not exists allow_after_hours_dropoff boolean not null default false,
  add column if not exists preferred_carrier text,
  add column if not exists shipping_notes text,
  add column if not exists header_alert text,
  add column if not exists primary_contact_id uuid references public.qrm_contacts(id) on delete set null,
  add column if not exists ar_agency_id uuid references public.ar_agencies(id) on delete set null,
  add column if not exists total_ar_cents bigint,
  add column if not exists total_ar_computed_at timestamptz,
  add column if not exists responsible_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists last_invoice_date date,
  add column if not exists avg_payment_days numeric,
  add column if not exists avg_payment_days_calculated_at timestamptz,
  add column if not exists last_payment_date date,
  add column if not exists highest_ar_balance numeric,
  add column if not exists highest_ar_balance_date date,
  add column if not exists current_ar_balance numeric default 0,
  add column if not exists current_ar_balance_updated_at timestamptz,
  add column if not exists credit_rating text,
  add column if not exists credit_rating_source text,
  add column if not exists credit_rating_updated_at timestamptz;

comment on column public.qrm_companies.product_category is 'IntelliDealer customer category for Customer Profile filtering; classification remains unchanged for compatibility.';
comment on column public.qrm_companies.industry is 'IntelliDealer/NAICS-aligned industry bucket for Account 360 segmentation.';
comment on column public.qrm_companies.brand_of_interest is 'Mixed-OEM brand affinity list from Customer Profile.';
comment on column public.qrm_companies.tax_code_equipment is 'Equipment tax routing code from IntelliDealer Customer Profile.';
comment on column public.qrm_companies.avatax_entity_use_code is 'AvaTax entity/use exemption reason code from Customer Profile.';
comment on column public.qrm_companies.payment_terms_id is 'Default AR terms applied to new customer invoices; canonical FK to Wave 1 payment_terms.';
comment on column public.qrm_companies.payment_terms_code is 'Legacy/default terms code for IntelliDealer imports when payment_terms row is not yet linked.';
comment on column public.qrm_companies.terms_code is 'Phase-9 Account 360 payment terms code alias; kept additive for portal imports.';
comment on column public.qrm_companies.credit_limit_cents is 'Approved credit ceiling in cents. NULL = not migrated/unknown; 0 = explicit zero credit.';
comment on column public.qrm_companies.total_ar_cents is 'Cached total outstanding AR in cents. Source of truth remains customer_invoices/payments.';
comment on column public.qrm_companies.header_alert is 'One-line Account 360 banner equivalent to IntelliDealer Customer Portal Comment.';
comment on column public.qrm_companies.responsible_branch_id is 'Canonical target for Phase-8 crm_companies.responsible_branch_id; crm_companies is a view over qrm_companies.';
comment on column public.qrm_companies.current_ar_balance is 'Cached current AR balance for Phase-8 credit-limit analysis; maintained by later triggers/views.';
comment on column public.qrm_companies.credit_rating is 'Credit rating bucket A/B/C/D/F/HOLD/UNRATED for AR and quote gating.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qrm_companies_duns_format_chk') then
    alter table public.qrm_companies
      add constraint qrm_companies_duns_format_chk
      check (duns_number is null or duns_number ~ '^\d{9}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qrm_companies_naics_chk') then
    alter table public.qrm_companies
      add constraint qrm_companies_naics_chk
      check (naics_code is null or naics_code ~ '^\d{6}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qrm_companies_pricing_level_chk') then
    alter table public.qrm_companies
      add constraint qrm_companies_pricing_level_chk
      check (pricing_level is null or pricing_level between 1 and 4) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qrm_companies_credit_rating_chk') then
    alter table public.qrm_companies
      add constraint qrm_companies_credit_rating_chk
      check (credit_rating is null or credit_rating in ('A','B','C','D','F','HOLD','UNRATED')) not valid;
  end if;
end $$;

create unique index if not exists idx_qrm_companies_legacy_customer_number
  on public.qrm_companies (workspace_id, legacy_customer_number)
  where legacy_customer_number is not null;
comment on index public.idx_qrm_companies_legacy_customer_number is 'Purpose: preserve IntelliDealer/CMASTR customer key uniqueness during cutover.';

create index if not exists idx_qrm_companies_search_1_lower
  on public.qrm_companies (workspace_id, lower(search_1))
  where search_1 is not null;
comment on index public.idx_qrm_companies_search_1_lower is 'Purpose: Customer Profile Search 1 fast lookup.';

create index if not exists idx_qrm_companies_search_2_lower
  on public.qrm_companies (workspace_id, lower(search_2))
  where search_2 is not null;
comment on index public.idx_qrm_companies_search_2_lower is 'Purpose: Customer Profile Search 2 fast lookup.';

create index if not exists idx_qrm_companies_home_branch
  on public.qrm_companies (home_branch_id)
  where home_branch_id is not null;
comment on index public.idx_qrm_companies_home_branch is 'Purpose: Customer listing and AR filters by responsible/home branch.';

create index if not exists idx_qrm_companies_pricing_group
  on public.qrm_companies (workspace_id, pricing_group_id)
  where pricing_group_id is not null;
comment on index public.idx_qrm_companies_pricing_group is 'Purpose: customer pricing group rollups and default pricing application.';

create index if not exists idx_qrm_companies_ar_agency
  on public.qrm_companies (workspace_id, ar_agency_id)
  where ar_agency_id is not null;
comment on index public.idx_qrm_companies_ar_agency is 'Purpose: AR agency/collection workflow filters.';
