-- 508_intellidealer_customer_import_staging.sql
--
-- Lossless staging layer for the delivered IntelliDealer customer workbook:
--   docs/IntelliDealer/Customer Master.xlsx
--
-- The canonical QRM tables already hold many IntelliDealer-compatible fields,
-- but this import needs an auditable buffer that can preserve every source
-- column, validate relationships, and retry canonical upserts without rereading
-- the XLSX/PDF artifacts.

create table public.qrm_intellidealer_customer_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source_file_name text not null,
  source_file_hash text,
  status text not null default 'audited'
    check (status in ('audited', 'staged', 'committing', 'committed', 'completed_with_errors', 'failed', 'cancelled')),
  master_rows integer not null default 0,
  contact_rows integer not null default 0,
  contact_memo_rows integer not null default 0,
  ar_agency_rows integer not null default 0,
  profitability_rows integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.qrm_intellidealer_customer_import_runs is
  'Audit ledger for IntelliDealer customer master imports. One run covers MAST, CONTACTS, contact memos, AR agency, and profitability sheets.';
comment on column public.qrm_intellidealer_customer_import_runs.source_file_hash is
  'SHA-256 of the workbook/PDF-derived source file, used for idempotency and provenance.';

create index idx_qrm_intellidealer_customer_import_runs_workspace
  on public.qrm_intellidealer_customer_import_runs (workspace_id, started_at desc);

alter type public.ar_type add value if not exists 'true_balance_forward';

create table public.qrm_customer_ar_agencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  agency_id uuid references public.ar_agencies(id) on delete set null,
  agency_code text not null,
  card_number text,
  expiration_year_month text,
  active boolean not null default true,
  is_default_agency boolean not null default false,
  credit_rating text,
  default_promotion_code text,
  credit_limit_cents bigint,
  transaction_limit_cents bigint,
  source_system text not null default 'intellidealer',
  source_company_code text,
  source_division_code text,
  source_customer_number text,
  raw_source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_customer_ar_agencies is
  'Customer-to-A/R-agency assignments imported from IntelliDealer CMASAA. Supports multiple agencies/cards per customer while qrm_companies.ar_agency_id remains the default pointer.';
comment on column public.qrm_customer_ar_agencies.expiration_year_month is
  'Raw IntelliDealer CGEXP value normalized as YYYYMM when present; null for 0/blank.';
comment on column public.qrm_customer_ar_agencies.credit_limit_cents is
  'CMASAA credit limit in cents for this customer/agency/card assignment.';

create index idx_qrm_customer_ar_agencies_company
  on public.qrm_customer_ar_agencies (workspace_id, company_id)
  where deleted_at is null;
create index idx_qrm_customer_ar_agencies_default
  on public.qrm_customer_ar_agencies (workspace_id, company_id)
  where is_default_agency = true and deleted_at is null;
create index idx_qrm_customer_ar_agencies_agency
  on public.qrm_customer_ar_agencies (workspace_id, agency_code)
  where deleted_at is null;
create unique index idx_qrm_customer_ar_agencies_unique_source
  on public.qrm_customer_ar_agencies (workspace_id, company_id, agency_code, coalesce(card_number, ''))
  where deleted_at is null;

create table public.qrm_customer_profitability_import_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  source_system text not null default 'intellidealer',
  source_company_code text,
  source_division_code text,
  source_customer_number text,
  area_code text not null,
  area_label text,
  ytd_sales_last_month_end_cents bigint,
  ytd_costs_last_month_end_cents bigint,
  current_month_sales_cents bigint,
  current_month_costs_cents bigint,
  ytd_margin_cents bigint,
  ytd_margin_pct numeric(8, 4),
  current_month_margin_cents bigint,
  current_month_margin_pct numeric(8, 4),
  last_11_sales_last_month_end_cents bigint,
  last_11_costs_last_month_end_cents bigint,
  last_12_margin_cents bigint,
  last_12_margin_pct numeric(8, 4),
  last_ytd_sales_last_month_end_cents bigint,
  last_ytd_costs_last_month_end_cents bigint,
  current_month_sales_last_year_cents bigint,
  current_month_costs_last_year_cents bigint,
  last_ytd_margin_cents bigint,
  last_ytd_margin_pct numeric(8, 4),
  fiscal_last_year_sales_cents bigint,
  fiscal_last_year_costs_cents bigint,
  fiscal_last_year_margin_cents bigint,
  fiscal_last_year_margin_pct numeric(8, 4),
  territory_code text,
  salesperson_code text,
  county_code text,
  business_class_code text,
  type_code text,
  owner_code text,
  equipment_code text,
  dunn_bradstreet text,
  location_code text,
  country text,
  as_of_date date,
  raw_source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, company_id, source_system, area_code)
);

comment on table public.qrm_customer_profitability_import_facts is
  'Imported IntelliDealer CMASPRO customer profitability facts by customer and area. Kept separate from QEP-native computed profitability views.';
comment on column public.qrm_customer_profitability_import_facts.area_code is
  'CMASPRO area code: L labor, S work-order parts, P parts invoicing, R rental, E equipment, T total.';

create index idx_qrm_customer_profitability_import_facts_company
  on public.qrm_customer_profitability_import_facts (workspace_id, company_id)
  where deleted_at is null;
create index idx_qrm_customer_profitability_import_facts_area
  on public.qrm_customer_profitability_import_facts (workspace_id, area_code, ytd_margin_cents desc)
  where deleted_at is null;

alter table public.qrm_customer_ar_agencies enable row level security;
alter table public.qrm_customer_profitability_import_facts enable row level security;

create policy "qrm_customer_ar_agencies_service_all"
  on public.qrm_customer_ar_agencies for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_customer_ar_agencies_elevated_all"
  on public.qrm_customer_ar_agencies for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));
create policy "qrm_customer_ar_agencies_rep_select"
  on public.qrm_customer_ar_agencies for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
    and public.crm_rep_can_access_company(company_id)
  );

create policy "qrm_customer_profitability_import_facts_service_all"
  on public.qrm_customer_profitability_import_facts for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_customer_profitability_import_facts_elevated_all"
  on public.qrm_customer_profitability_import_facts for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));
create policy "qrm_customer_profitability_import_facts_rep_select"
  on public.qrm_customer_profitability_import_facts for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_qrm_customer_ar_agencies_updated_at
  before update on public.qrm_customer_ar_agencies
  for each row execute function public.set_updated_at();
create trigger set_qrm_customer_profitability_import_facts_updated_at
  before update on public.qrm_customer_profitability_import_facts
  for each row execute function public.set_updated_at();

create table public.qrm_intellidealer_customer_master_stage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null default 'MAST',
  row_number integer not null,
  company_code text not null,
  division_code text not null,
  customer_number text not null,
  status_code text,
  branch_code text,
  ar_type_code text,
  category_code text,
  business_class_code text,
  customer_name text not null,
  sold_to_address_1 text,
  sold_to_address_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  phone text,
  fax text,
  cell text,
  terms_code text,
  county_code text,
  territory_code text,
  salesperson_code text,
  search_1 text,
  search_2 text,
  pricing_level integer,
  pricing_group_code text,
  opt_out_pi boolean,
  do_not_call boolean,
  date_added_raw text,
  date_last_modified_raw text,
  date_last_billed_raw text,
  last_payment_date_raw text,
  raw_row jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  canonical_company_id uuid references public.qrm_companies(id) on delete set null,
  staged_at timestamptz not null default now(),
  unique (run_id, company_code, division_code, customer_number)
);

comment on table public.qrm_intellidealer_customer_master_stage is
  'Lossless staging rows for the IntelliDealer CMASTR/MAST customer master export. raw_row keeps every workbook column.';
comment on column public.qrm_intellidealer_customer_master_stage.customer_number is
  'Legacy IntelliDealer customer key. Canonical target is qrm_companies.legacy_customer_number.';

create index idx_qrm_intellidealer_customer_master_stage_key
  on public.qrm_intellidealer_customer_master_stage (workspace_id, company_code, division_code, customer_number);
create index idx_qrm_intellidealer_customer_master_stage_canonical
  on public.qrm_intellidealer_customer_master_stage (canonical_company_id)
  where canonical_company_id is not null;

create table public.qrm_intellidealer_customer_contacts_stage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null default 'CONTACTS',
  row_number integer not null,
  company_code text not null,
  division_code text not null,
  customer_number text not null,
  contact_number text not null,
  job_title text,
  first_name text not null,
  middle_initial text,
  last_name text not null,
  comment text,
  business_address_1 text,
  business_address_2 text,
  business_address_3 text,
  business_postal_code text,
  business_phone text,
  business_phone_extension text,
  business_fax text,
  business_cell text,
  business_email text,
  business_web_address text,
  home_phone text,
  home_cell text,
  home_email text,
  user_id text,
  birth_date_raw text,
  status_code text,
  salesperson_code text,
  mydealer_user boolean,
  raw_row jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  canonical_contact_id uuid references public.qrm_contacts(id) on delete set null,
  canonical_company_id uuid references public.qrm_companies(id) on delete set null,
  staged_at timestamptz not null default now(),
  unique (run_id, company_code, division_code, customer_number, contact_number)
);

comment on table public.qrm_intellidealer_customer_contacts_stage is
  'Lossless staging rows for IntelliDealer customer contacts, including MyDealer access and contact preferences in raw_row.';

create index idx_qrm_intellidealer_customer_contacts_stage_customer
  on public.qrm_intellidealer_customer_contacts_stage (workspace_id, company_code, division_code, customer_number);
create index idx_qrm_intellidealer_customer_contacts_stage_canonical
  on public.qrm_intellidealer_customer_contacts_stage (canonical_contact_id)
  where canonical_contact_id is not null;

create table public.qrm_intellidealer_customer_contact_memos_stage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null default 'Cust Contact Memos',
  row_number integer not null,
  company_code text not null,
  division_code text not null,
  customer_number text not null,
  contact_number text not null,
  sequence_number integer not null,
  memo text,
  raw_row jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  canonical_memo_id uuid references public.qrm_company_memos(id) on delete set null,
  canonical_company_id uuid references public.qrm_companies(id) on delete set null,
  staged_at timestamptz not null default now(),
  unique (run_id, company_code, division_code, customer_number, contact_number, sequence_number)
);

comment on table public.qrm_intellidealer_customer_contact_memos_stage is
  'Lossless staging rows for IntelliDealer customer/contact memo records before writing QRM company memo history.';

create index idx_qrm_intellidealer_customer_contact_memos_stage_customer
  on public.qrm_intellidealer_customer_contact_memos_stage (workspace_id, company_code, division_code, customer_number);

create table public.qrm_intellidealer_customer_ar_agency_stage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null default 'AR AGENCY',
  row_number integer not null,
  company_code text not null,
  division_code text not null,
  customer_number text not null,
  agency_code text not null,
  card_number text not null,
  expiration_date_raw text,
  status_code text,
  is_default_agency boolean not null default false,
  credit_rating text,
  default_promotion_code text,
  credit_limit numeric(14, 2),
  transaction_limit numeric(14, 2),
  raw_row jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  canonical_company_id uuid references public.qrm_companies(id) on delete set null,
  canonical_agency_id uuid references public.ar_agencies(id) on delete set null,
  staged_at timestamptz not null default now(),
  unique (run_id, company_code, division_code, customer_number, agency_code, card_number)
);

comment on table public.qrm_intellidealer_customer_ar_agency_stage is
  'Lossless staging rows for IntelliDealer customer AR agency, card, credit-rating, credit-limit, and transaction-limit records.';

create index idx_qrm_intellidealer_customer_ar_agency_stage_customer
  on public.qrm_intellidealer_customer_ar_agency_stage (workspace_id, company_code, division_code, customer_number);
create index idx_qrm_intellidealer_customer_ar_agency_stage_default
  on public.qrm_intellidealer_customer_ar_agency_stage (workspace_id, company_code, division_code, customer_number)
  where is_default_agency = true;

create table public.qrm_intellidealer_customer_profitability_stage (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null default 'PROFITABILITY',
  row_number integer not null,
  company_code text not null,
  division_code text not null,
  customer_number text not null,
  area_code text not null,
  ytd_sales_last_month_end numeric(14, 2),
  ytd_costs_last_month_end numeric(14, 2),
  current_month_sales numeric(14, 2),
  current_month_costs numeric(14, 2),
  ytd_margin numeric(14, 2),
  ytd_margin_pct numeric(8, 4),
  current_month_margin numeric(14, 2),
  current_month_margin_pct numeric(8, 4),
  last_11_sales_last_month_end numeric(14, 2),
  last_11_costs_last_month_end numeric(14, 2),
  last_12_margin numeric(14, 2),
  last_12_margin_pct numeric(8, 4),
  last_ytd_sales_last_month_end numeric(14, 2),
  last_ytd_costs_last_month_end numeric(14, 2),
  current_month_sales_last_year numeric(14, 2),
  current_month_costs_last_year numeric(14, 2),
  last_ytd_margin numeric(14, 2),
  last_ytd_margin_pct numeric(8, 4),
  fiscal_last_year_sales numeric(14, 2),
  fiscal_last_year_costs numeric(14, 2),
  fiscal_last_year_margin numeric(14, 2),
  fiscal_last_year_margin_pct numeric(8, 4),
  territory_code text,
  salesperson_code text,
  county_code text,
  business_class_code text,
  type_code text,
  owner_code text,
  equipment_code text,
  dunn_bradstreet text,
  location_code text,
  country text,
  raw_row jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  canonical_company_id uuid references public.qrm_companies(id) on delete set null,
  staged_at timestamptz not null default now(),
  unique (run_id, company_code, division_code, customer_number, area_code)
);

comment on table public.qrm_intellidealer_customer_profitability_stage is
  'Lossless staging rows for IntelliDealer customer profitability export. Canonical reporting can use these rows until QEP-native sales/cost history is fully reconciled.';

create index idx_qrm_intellidealer_customer_profitability_stage_customer
  on public.qrm_intellidealer_customer_profitability_stage (workspace_id, company_code, division_code, customer_number);
create index idx_qrm_intellidealer_customer_profitability_stage_area
  on public.qrm_intellidealer_customer_profitability_stage (workspace_id, area_code, ytd_margin desc);

create table public.qrm_intellidealer_customer_import_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_intellidealer_customer_import_runs(id) on delete cascade,
  workspace_id text not null,
  source_sheet text not null,
  row_number integer,
  company_code text,
  division_code text,
  customer_number text,
  severity text not null default 'error' check (severity in ('info', 'warning', 'error')),
  reason_code text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.qrm_intellidealer_customer_import_errors is
  'Row-level audit findings for IntelliDealer customer import validation, staging, and canonical commit.';

create index idx_qrm_intellidealer_customer_import_errors_run
  on public.qrm_intellidealer_customer_import_errors (run_id, severity, source_sheet, row_number);
create index idx_qrm_intellidealer_customer_import_errors_customer
  on public.qrm_intellidealer_customer_import_errors (workspace_id, company_code, division_code, customer_number);

alter table public.qrm_intellidealer_customer_import_runs enable row level security;
alter table public.qrm_intellidealer_customer_master_stage enable row level security;
alter table public.qrm_intellidealer_customer_contacts_stage enable row level security;
alter table public.qrm_intellidealer_customer_contact_memos_stage enable row level security;
alter table public.qrm_intellidealer_customer_ar_agency_stage enable row level security;
alter table public.qrm_intellidealer_customer_profitability_stage enable row level security;
alter table public.qrm_intellidealer_customer_import_errors enable row level security;

create policy "qrm_intellidealer_customer_import_runs_service_all"
  on public.qrm_intellidealer_customer_import_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_import_runs_elevated_all"
  on public.qrm_intellidealer_customer_import_runs for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_master_stage_service_all"
  on public.qrm_intellidealer_customer_master_stage for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_master_stage_elevated_all"
  on public.qrm_intellidealer_customer_master_stage for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_contacts_stage_service_all"
  on public.qrm_intellidealer_customer_contacts_stage for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_contacts_stage_elevated_all"
  on public.qrm_intellidealer_customer_contacts_stage for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_contact_memos_stage_service_all"
  on public.qrm_intellidealer_customer_contact_memos_stage for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_contact_memos_stage_elevated_all"
  on public.qrm_intellidealer_customer_contact_memos_stage for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_ar_agency_stage_service_all"
  on public.qrm_intellidealer_customer_ar_agency_stage for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_ar_agency_stage_elevated_all"
  on public.qrm_intellidealer_customer_ar_agency_stage for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_profitability_stage_service_all"
  on public.qrm_intellidealer_customer_profitability_stage for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_profitability_stage_elevated_all"
  on public.qrm_intellidealer_customer_profitability_stage for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create policy "qrm_intellidealer_customer_import_errors_service_all"
  on public.qrm_intellidealer_customer_import_errors for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_customer_import_errors_elevated_all"
  on public.qrm_intellidealer_customer_import_errors for all
  using ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()))
  with check ((select public.get_my_role()) in ('admin', 'manager', 'owner') and workspace_id = (select public.get_my_workspace()));

create trigger set_qrm_intellidealer_customer_import_runs_updated_at
  before update on public.qrm_intellidealer_customer_import_runs
  for each row execute function public.set_updated_at();

create or replace function public.qrm_intellidealer_date_yyyymmdd(p_raw text)
returns date
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(p_raw, '')), '') is null then null::date
    when trim(p_raw) in ('0', '00000000') then null::date
    when trim(p_raw) ~ '^\d{8}$'
      and substring(trim(p_raw), 5, 2)::integer between 1 and 12
      and substring(trim(p_raw), 7, 2)::integer between 1 and 31
      then to_date(trim(p_raw), 'YYYYMMDD')
    else null::date
  end;
$$;

create or replace function public.qrm_intellidealer_money_to_cents(p_amount numeric)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case when p_amount is null then null else round(p_amount * 100)::bigint end;
$$;

create or replace function public.qrm_intellidealer_ar_type_code(p_code text)
returns public.ar_type
language sql
immutable
set search_path = public
as $$
  select case trim(coalesce(p_code, ''))
    when 'O' then 'open_item'::public.ar_type
    when 'B' then 'balance_forward'::public.ar_type
    when 'T' then 'balance_forward'::public.ar_type
    else 'open_item'::public.ar_type
  end;
$$;

create or replace function public.commit_intellidealer_customer_import(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.qrm_intellidealer_customer_import_runs%rowtype;
  v_companies integer := 0;
  v_contacts integer := 0;
  v_contact_links integer := 0;
  v_memos integer := 0;
  v_agencies integer := 0;
  v_customer_agencies integer := 0;
  v_profitability integer := 0;
begin
  select * into v_run
  from public.qrm_intellidealer_customer_import_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'IMPORT_RUN_NOT_FOUND';
  end if;

  if (select auth.role()) <> 'service_role'
    and (select public.get_my_role()) not in ('admin', 'manager', 'owner') then
    raise exception 'FORBIDDEN_INTELLIDEALER_IMPORT_COMMIT';
  end if;

  update public.qrm_intellidealer_customer_import_runs
  set status = 'committing',
      completed_at = null
  where id = p_run_id;

  insert into public.qrm_companies (
    workspace_id,
    name,
    legal_name,
    assigned_rep_id,
    address_line_1,
    address_line_2,
    city,
    state,
    postal_code,
    country,
    phone,
    legacy_customer_number,
    product_category,
    ar_type,
    business_fax,
    business_cell,
    payment_terms_code,
    terms_code,
    county,
    territory_code,
    pricing_level,
    pricing_group_id,
    opt_out_sale_pi,
    do_not_contact,
    status,
    home_branch_id,
    responsible_branch_id,
    metadata
  )
  select
    s.workspace_id,
    s.customer_name,
    s.customer_name,
    null::uuid,
    s.sold_to_address_1,
    s.sold_to_address_2,
    s.city,
    s.state,
    s.postal_code,
    s.country,
    s.phone,
    s.customer_number,
    case s.category_code
      when 'B' then 'business'::public.customer_category
      when 'I' then 'individual'::public.customer_category
      when 'N' then 'internal'::public.customer_category
      else null::public.customer_category
    end,
    public.qrm_intellidealer_ar_type_code(s.ar_type_code),
    s.fax,
    s.cell,
    s.terms_code,
    s.terms_code,
    s.county_code,
    s.territory_code,
    case when s.pricing_level between 1 and 4 then s.pricing_level else null end,
    null::uuid,
    coalesce(s.opt_out_pi, false),
    coalesce(s.do_not_call, false),
    case s.status_code
      when 'D' then 'inactive'
      when 'X' then 'prospect'
      else 'active'
    end,
    null::uuid,
    null::uuid,
    jsonb_build_object(
      'source_system', 'intellidealer',
      'source_company_code', s.company_code,
      'source_division_code', s.division_code,
      'source_customer_number', s.customer_number,
      'status_code', s.status_code,
      'branch_code', s.branch_code,
      'business_class_code', s.business_class_code,
      'salesperson_code', s.salesperson_code,
      'pricing_group_code', s.pricing_group_code,
      'dates', jsonb_build_object(
        'date_added_raw', s.date_added_raw,
        'date_last_modified_raw', s.date_last_modified_raw,
        'date_last_billed_raw', s.date_last_billed_raw,
        'last_payment_date_raw', s.last_payment_date_raw,
        'date_added', public.qrm_intellidealer_date_yyyymmdd(s.date_added_raw),
        'date_last_modified', public.qrm_intellidealer_date_yyyymmdd(s.date_last_modified_raw),
        'date_last_billed', public.qrm_intellidealer_date_yyyymmdd(s.date_last_billed_raw),
        'last_payment_date', public.qrm_intellidealer_date_yyyymmdd(s.last_payment_date_raw)
      ),
      'raw_row', s.raw_row
    )
  from public.qrm_intellidealer_customer_master_stage s
  where s.run_id = p_run_id
  on conflict (workspace_id, legacy_customer_number) where legacy_customer_number is not null
  do update set
    name = excluded.name,
    legal_name = excluded.legal_name,
    address_line_1 = excluded.address_line_1,
    address_line_2 = excluded.address_line_2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    country = excluded.country,
    phone = excluded.phone,
    product_category = excluded.product_category,
    ar_type = excluded.ar_type,
    business_fax = excluded.business_fax,
    business_cell = excluded.business_cell,
    payment_terms_code = excluded.payment_terms_code,
    terms_code = excluded.terms_code,
    county = excluded.county,
    territory_code = excluded.territory_code,
    pricing_level = excluded.pricing_level,
    opt_out_sale_pi = excluded.opt_out_sale_pi,
    do_not_contact = excluded.do_not_contact,
    status = excluded.status,
    metadata = qrm_companies.metadata || excluded.metadata,
    updated_at = now();
  get diagnostics v_companies = row_count;

  update public.qrm_intellidealer_customer_master_stage s
  set canonical_company_id = c.id
  from public.qrm_companies c
  where s.run_id = p_run_id
    and c.workspace_id = s.workspace_id
    and c.legacy_customer_number = s.customer_number;

  insert into public.qrm_contacts (
    workspace_id,
    first_name,
    last_name,
    email,
    phone,
    title,
    primary_company_id,
    cell,
    direct_phone,
    birth_date,
    metadata
  )
  select
    s.workspace_id,
    s.first_name,
    s.last_name,
    s.business_email,
    coalesce(s.business_phone, s.home_phone),
    s.job_title,
    m.canonical_company_id,
    coalesce(s.business_cell, s.home_cell),
    s.business_phone,
    public.qrm_intellidealer_date_yyyymmdd(s.birth_date_raw),
    jsonb_build_object(
      'source_system', 'intellidealer',
      'source_company_code', s.company_code,
      'source_division_code', s.division_code,
      'source_customer_number', s.customer_number,
      'source_contact_number', s.contact_number,
      'middle_initial', s.middle_initial,
      'comment', s.comment,
      'business_address', jsonb_build_object(
        'address_1', s.business_address_1,
        'address_2', s.business_address_2,
        'address_3', s.business_address_3,
        'postal_code', s.business_postal_code
      ),
      'business_phone_extension', s.business_phone_extension,
      'business_fax', s.business_fax,
      'business_web_address', s.business_web_address,
      'home_email', s.home_email,
      'user_id', s.user_id,
      'status_code', s.status_code,
      'salesperson_code', s.salesperson_code,
      'mydealer_user', s.mydealer_user,
      'raw_row', s.raw_row
    )
  from public.qrm_intellidealer_customer_contacts_stage s
  join public.qrm_intellidealer_customer_master_stage m
    on m.run_id = s.run_id
   and m.company_code = s.company_code
   and m.division_code = s.division_code
   and m.customer_number = s.customer_number
  where s.run_id = p_run_id
    and m.canonical_company_id is not null
    and not exists (
      select 1
      from public.qrm_contacts existing
      where existing.workspace_id = s.workspace_id
        and existing.primary_company_id = m.canonical_company_id
        and existing.deleted_at is null
        and existing.metadata->>'source_system' = 'intellidealer'
        and existing.metadata->>'source_customer_number' = s.customer_number
        and existing.metadata->>'source_contact_number' = s.contact_number
    );
  get diagnostics v_contacts = row_count;

  update public.qrm_intellidealer_customer_contacts_stage s
  set canonical_company_id = m.canonical_company_id,
      canonical_contact_id = c.id
  from public.qrm_intellidealer_customer_master_stage m,
       public.qrm_contacts c
  where s.run_id = p_run_id
    and m.run_id = s.run_id
    and m.company_code = s.company_code
    and m.division_code = s.division_code
    and m.customer_number = s.customer_number
    and c.workspace_id = m.workspace_id
    and c.primary_company_id = m.canonical_company_id
    and c.metadata->>'source_system' = 'intellidealer'
    and c.metadata->>'source_contact_number' = s.contact_number
    and c.metadata->>'source_customer_number' = s.customer_number;

  insert into public.qrm_contact_companies (
    workspace_id,
    contact_id,
    company_id,
    is_primary
  )
  select
    s.workspace_id,
    s.canonical_contact_id,
    s.canonical_company_id,
    true
  from public.qrm_intellidealer_customer_contacts_stage s
  where s.run_id = p_run_id
    and s.canonical_contact_id is not null
    and s.canonical_company_id is not null
  on conflict (workspace_id, contact_id, company_id)
  do update set is_primary = true;
  get diagnostics v_contact_links = row_count;

  insert into public.qrm_company_memos (
    workspace_id,
    company_id,
    body,
    pinned
  )
  select
    s.workspace_id,
    m.canonical_company_id,
    coalesce(nullif(s.memo, ''), '[blank IntelliDealer memo]'),
    false
  from public.qrm_intellidealer_customer_contact_memos_stage s
  join public.qrm_intellidealer_customer_master_stage m
    on m.run_id = s.run_id
   and m.company_code = s.company_code
   and m.division_code = s.division_code
   and m.customer_number = s.customer_number
  where s.run_id = p_run_id
    and m.canonical_company_id is not null
    and nullif(s.memo, '') is not null
    and not exists (
      select 1
      from public.qrm_company_memos existing
      where existing.workspace_id = s.workspace_id
        and existing.company_id = m.canonical_company_id
        and existing.deleted_at is null
        and existing.body = s.memo
    );
  get diagnostics v_memos = row_count;

  insert into public.ar_agencies (
    workspace_id,
    code,
    name,
    gl_receivable_account,
    active
  )
  select distinct
    s.workspace_id,
    s.agency_code,
    'IntelliDealer agency ' || s.agency_code,
    'unmapped',
    true
  from public.qrm_intellidealer_customer_ar_agency_stage s
  where s.run_id = p_run_id
    and s.agency_code is not null
  on conflict (workspace_id, code)
  do update set active = true,
                deleted_at = null,
                updated_at = now();
  get diagnostics v_agencies = row_count;

  insert into public.qrm_customer_ar_agencies (
    workspace_id,
    company_id,
    agency_id,
    agency_code,
    card_number,
    expiration_year_month,
    active,
    is_default_agency,
    credit_rating,
    default_promotion_code,
    credit_limit_cents,
    transaction_limit_cents,
    source_company_code,
    source_division_code,
    source_customer_number,
    raw_source_row
  )
  select
    s.workspace_id,
    m.canonical_company_id,
    a.id,
    s.agency_code,
    s.card_number,
    case when s.expiration_date_raw in ('0', '000000') then null else s.expiration_date_raw end,
    coalesce(s.status_code = 'Y', true),
    s.is_default_agency,
    s.credit_rating,
    s.default_promotion_code,
    public.qrm_intellidealer_money_to_cents(s.credit_limit),
    public.qrm_intellidealer_money_to_cents(s.transaction_limit),
    s.company_code,
    s.division_code,
    s.customer_number,
    s.raw_row
  from public.qrm_intellidealer_customer_ar_agency_stage s
  join public.qrm_intellidealer_customer_master_stage m
    on m.run_id = s.run_id
   and m.company_code = s.company_code
   and m.division_code = s.division_code
   and m.customer_number = s.customer_number
  left join public.ar_agencies a
    on a.workspace_id = s.workspace_id
   and a.code = s.agency_code
  where s.run_id = p_run_id
    and m.canonical_company_id is not null
  on conflict (workspace_id, company_id, agency_code, coalesce(card_number, '')) where deleted_at is null
  do update set
    agency_id = excluded.agency_id,
    expiration_year_month = excluded.expiration_year_month,
    active = excluded.active,
    is_default_agency = excluded.is_default_agency,
    credit_rating = excluded.credit_rating,
    default_promotion_code = excluded.default_promotion_code,
    credit_limit_cents = excluded.credit_limit_cents,
    transaction_limit_cents = excluded.transaction_limit_cents,
    raw_source_row = excluded.raw_source_row,
    updated_at = now();
  get diagnostics v_customer_agencies = row_count;

  update public.qrm_intellidealer_customer_ar_agency_stage s
  set canonical_company_id = m.canonical_company_id,
      canonical_agency_id = a.id
  from public.qrm_intellidealer_customer_master_stage m,
       public.ar_agencies a
  where s.run_id = p_run_id
    and m.run_id = s.run_id
    and m.company_code = s.company_code
    and m.division_code = s.division_code
    and m.customer_number = s.customer_number
    and a.workspace_id = s.workspace_id
    and a.code = s.agency_code;

  update public.qrm_companies c
  set ar_agency_id = a.agency_id,
      credit_rating = coalesce(a.credit_rating, c.credit_rating),
      credit_limit_cents = coalesce(a.credit_limit_cents, c.credit_limit_cents),
      updated_at = now()
  from public.qrm_customer_ar_agencies a
  where a.workspace_id = c.workspace_id
    and a.company_id = c.id
    and a.is_default_agency = true
    and a.deleted_at is null
    and a.source_system = 'intellidealer';

  insert into public.qrm_customer_profitability_import_facts (
    workspace_id,
    company_id,
    source_company_code,
    source_division_code,
    source_customer_number,
    area_code,
    area_label,
    ytd_sales_last_month_end_cents,
    ytd_costs_last_month_end_cents,
    current_month_sales_cents,
    current_month_costs_cents,
    ytd_margin_cents,
    ytd_margin_pct,
    current_month_margin_cents,
    current_month_margin_pct,
    last_11_sales_last_month_end_cents,
    last_11_costs_last_month_end_cents,
    last_12_margin_cents,
    last_12_margin_pct,
    last_ytd_sales_last_month_end_cents,
    last_ytd_costs_last_month_end_cents,
    current_month_sales_last_year_cents,
    current_month_costs_last_year_cents,
    last_ytd_margin_cents,
    last_ytd_margin_pct,
    fiscal_last_year_sales_cents,
    fiscal_last_year_costs_cents,
    fiscal_last_year_margin_cents,
    fiscal_last_year_margin_pct,
    territory_code,
    salesperson_code,
    county_code,
    business_class_code,
    type_code,
    owner_code,
    equipment_code,
    dunn_bradstreet,
    location_code,
    country,
    as_of_date,
    raw_source_row
  )
  select
    s.workspace_id,
    m.canonical_company_id,
    s.company_code,
    s.division_code,
    s.customer_number,
    s.area_code,
    case s.area_code
      when 'L' then 'labor sales'
      when 'S' then 'parts on work orders'
      when 'P' then 'parts invoicing'
      when 'R' then 'rental'
      when 'E' then 'equipment'
      when 'T' then 'total sales'
      else null
    end,
    public.qrm_intellidealer_money_to_cents(s.ytd_sales_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.ytd_costs_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.current_month_sales),
    public.qrm_intellidealer_money_to_cents(s.current_month_costs),
    public.qrm_intellidealer_money_to_cents(s.ytd_margin),
    s.ytd_margin_pct,
    public.qrm_intellidealer_money_to_cents(s.current_month_margin),
    s.current_month_margin_pct,
    public.qrm_intellidealer_money_to_cents(s.last_11_sales_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.last_11_costs_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.last_12_margin),
    s.last_12_margin_pct,
    public.qrm_intellidealer_money_to_cents(s.last_ytd_sales_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.last_ytd_costs_last_month_end),
    public.qrm_intellidealer_money_to_cents(s.current_month_sales_last_year),
    public.qrm_intellidealer_money_to_cents(s.current_month_costs_last_year),
    public.qrm_intellidealer_money_to_cents(s.last_ytd_margin),
    s.last_ytd_margin_pct,
    public.qrm_intellidealer_money_to_cents(s.fiscal_last_year_sales),
    public.qrm_intellidealer_money_to_cents(s.fiscal_last_year_costs),
    public.qrm_intellidealer_money_to_cents(s.fiscal_last_year_margin),
    s.fiscal_last_year_margin_pct,
    s.territory_code,
    s.salesperson_code,
    s.county_code,
    s.business_class_code,
    s.type_code,
    s.owner_code,
    s.equipment_code,
    s.dunn_bradstreet,
    s.location_code,
    s.country,
    current_date,
    s.raw_row
  from public.qrm_intellidealer_customer_profitability_stage s
  join public.qrm_intellidealer_customer_master_stage m
    on m.run_id = s.run_id
   and m.company_code = s.company_code
   and m.division_code = s.division_code
   and m.customer_number = s.customer_number
  where s.run_id = p_run_id
    and m.canonical_company_id is not null
  on conflict (workspace_id, company_id, source_system, area_code)
  do update set
    area_label = excluded.area_label,
    ytd_sales_last_month_end_cents = excluded.ytd_sales_last_month_end_cents,
    ytd_costs_last_month_end_cents = excluded.ytd_costs_last_month_end_cents,
    current_month_sales_cents = excluded.current_month_sales_cents,
    current_month_costs_cents = excluded.current_month_costs_cents,
    ytd_margin_cents = excluded.ytd_margin_cents,
    ytd_margin_pct = excluded.ytd_margin_pct,
    current_month_margin_cents = excluded.current_month_margin_cents,
    current_month_margin_pct = excluded.current_month_margin_pct,
    last_11_sales_last_month_end_cents = excluded.last_11_sales_last_month_end_cents,
    last_11_costs_last_month_end_cents = excluded.last_11_costs_last_month_end_cents,
    last_12_margin_cents = excluded.last_12_margin_cents,
    last_12_margin_pct = excluded.last_12_margin_pct,
    last_ytd_sales_last_month_end_cents = excluded.last_ytd_sales_last_month_end_cents,
    last_ytd_costs_last_month_end_cents = excluded.last_ytd_costs_last_month_end_cents,
    current_month_sales_last_year_cents = excluded.current_month_sales_last_year_cents,
    current_month_costs_last_year_cents = excluded.current_month_costs_last_year_cents,
    last_ytd_margin_cents = excluded.last_ytd_margin_cents,
    last_ytd_margin_pct = excluded.last_ytd_margin_pct,
    fiscal_last_year_sales_cents = excluded.fiscal_last_year_sales_cents,
    fiscal_last_year_costs_cents = excluded.fiscal_last_year_costs_cents,
    fiscal_last_year_margin_cents = excluded.fiscal_last_year_margin_cents,
    fiscal_last_year_margin_pct = excluded.fiscal_last_year_margin_pct,
    territory_code = excluded.territory_code,
    salesperson_code = excluded.salesperson_code,
    county_code = excluded.county_code,
    business_class_code = excluded.business_class_code,
    type_code = excluded.type_code,
    owner_code = excluded.owner_code,
    equipment_code = excluded.equipment_code,
    dunn_bradstreet = excluded.dunn_bradstreet,
    location_code = excluded.location_code,
    country = excluded.country,
    as_of_date = excluded.as_of_date,
    raw_source_row = excluded.raw_source_row,
    deleted_at = null,
    updated_at = now();
  get diagnostics v_profitability = row_count;

  update public.qrm_intellidealer_customer_profitability_stage s
  set canonical_company_id = m.canonical_company_id
  from public.qrm_intellidealer_customer_master_stage m
  where s.run_id = p_run_id
    and m.run_id = s.run_id
    and m.company_code = s.company_code
    and m.division_code = s.division_code
    and m.customer_number = s.customer_number;

  insert into public.qrm_external_id_map (
    workspace_id,
    source_system,
    object_type,
    external_id,
    internal_id
  )
  select
    s.workspace_id,
    'intellidealer',
    'company',
    s.company_code || ':' || s.division_code || ':' || s.customer_number,
    s.canonical_company_id
  from public.qrm_intellidealer_customer_master_stage s
  where s.run_id = p_run_id
    and s.canonical_company_id is not null
  on conflict (workspace_id, source_system, object_type, external_id)
  do update set internal_id = excluded.internal_id,
                updated_at = now();

  update public.qrm_intellidealer_customer_import_runs
  set status = 'committed',
      completed_at = now(),
      metadata = metadata || jsonb_build_object(
        'commit_summary', jsonb_build_object(
          'companies', v_companies,
          'contacts', v_contacts,
          'contact_links', v_contact_links,
          'memos', v_memos,
          'ar_agencies', v_agencies,
          'customer_ar_agencies', v_customer_agencies,
          'profitability_facts', v_profitability
        )
      )
  where id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'companies', v_companies,
    'contacts', v_contacts,
    'contact_links', v_contact_links,
    'memos', v_memos,
    'ar_agencies', v_agencies,
    'customer_ar_agencies', v_customer_agencies,
    'profitability_facts', v_profitability
  );
exception
  when others then
    update public.qrm_intellidealer_customer_import_runs
    set status = 'failed',
        error_count = error_count + 1,
        metadata = metadata || jsonb_build_object(
          'last_commit_error', sqlerrm,
          'last_commit_error_at', now()
        )
    where id = p_run_id;
    raise;
end;
$$;

comment on function public.commit_intellidealer_customer_import(uuid) is
  'Commits staged IntelliDealer Customer Master workbook rows into canonical QRM companies, contacts, memos, AR agency assignments, profitability facts, and external ID map.';

revoke execute on function public.commit_intellidealer_customer_import(uuid) from public;
