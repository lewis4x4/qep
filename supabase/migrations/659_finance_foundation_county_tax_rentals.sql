-- 659_finance_foundation_county_tax_rentals.sql
--
-- Finance foundation Part 5: Florida county tax, destination sourcing, and
-- rental DR-15 reporting.
--
-- Rollback notes:
--   drop view if exists public.finance_foundation_fl_dr15_monthly_breakout;
--   drop function if exists public.qep_resolve_fl_tax_jurisdiction(text, uuid, text, date);
--   alter table public.rental_invoices drop column if exists dr15_reportable;
--   alter table public.rental_invoices drop column if exists dr15_county_name;
--   alter table public.rental_invoices drop column if exists dr15_reporting_period;
--   alter table public.rental_invoices drop column if exists tax_exemption_certificate_id;
--   alter table public.rental_invoices drop column if exists tax_breakdown;
--   alter table public.rental_invoices drop column if exists tax_jurisdiction_id;
--   alter table public.rental_invoices drop column if exists ship_to_address_id;
--   alter table public.rental_contracts drop column if exists tax_exemption_certificate_id;
--   alter table public.rental_contracts drop column if exists tax_sourcing_method;
--   alter table public.rental_contracts drop column if exists tax_jurisdiction_id;
--   alter table public.rental_contracts drop column if exists ship_to_address_id;
--   alter table public.customer_invoices drop column if exists dr15_reportable;
--   alter table public.customer_invoices drop column if exists dr15_county_name;
--   alter table public.customer_invoices drop column if exists tax_jurisdiction_id;
--   alter table public.qrm_company_ship_to_addresses drop column if exists tax_jurisdiction_id;
--   alter table public.qrm_company_ship_to_addresses drop column if exists county_name;
--   alter table public.tax_exemption_certificates drop column if exists covers_rental;
--   alter table public.tax_treatments drop column if exists tax_jurisdiction_id;
--   alter table public.tax_treatments drop column if exists dr15_reporting_code;
--   alter table public.tax_treatments drop column if exists covers_rental;
--   alter table public.tax_treatments drop column if exists destination_sourcing_required;
--   alter table public.tax_treatments drop column if exists county_name;

alter table public.tax_treatments
  add column if not exists county_name text,
  add column if not exists destination_sourcing_required boolean not null default false,
  add column if not exists covers_rental boolean not null default false,
  add column if not exists dr15_reporting_code text,
  add column if not exists tax_jurisdiction_id uuid references public.tax_jurisdictions(id) on delete set null;

comment on column public.tax_treatments.county_name is
  'Optional county name for jurisdiction-specific sales/rental tax treatment rows.';
comment on column public.tax_treatments.destination_sourcing_required is
  'True when the treatment must source tax from the customer ship-to destination instead of the selling branch.';
comment on column public.tax_treatments.covers_rental is
  'True when the treatment is valid for rental invoices and contracts.';
comment on column public.tax_treatments.dr15_reporting_code is
  'Florida DR-15 reporting bucket/code for Finance monthly tax summaries.';

alter table public.tax_exemption_certificates
  add column if not exists covers_rental boolean not null default false;

comment on column public.tax_exemption_certificates.covers_rental is
  'True when the certificate has been verified as valid for rental charges, not only equipment, parts, or service.';

alter table public.qrm_company_ship_to_addresses
  add column if not exists county_name text,
  add column if not exists tax_jurisdiction_id uuid references public.tax_jurisdictions(id) on delete set null;

comment on column public.qrm_company_ship_to_addresses.county_name is
  'Ship-to county used for destination-sourced Florida discretionary surtax and DR-15 reporting.';
comment on column public.qrm_company_ship_to_addresses.tax_jurisdiction_id is
  'Resolved destination tax jurisdiction for quote, invoice, and rental tax calculations.';

alter table public.customer_invoices
  add column if not exists tax_jurisdiction_id uuid references public.tax_jurisdictions(id) on delete set null,
  add column if not exists dr15_county_name text,
  add column if not exists dr15_reportable boolean not null default true;

comment on column public.customer_invoices.tax_jurisdiction_id is
  'Destination tax jurisdiction resolved at invoice posting time.';
comment on column public.customer_invoices.dr15_county_name is
  'County bucket used for Florida DR-15 monthly reporting.';
comment on column public.customer_invoices.dr15_reportable is
  'False for non-tax/reporting rows that should be excluded from Florida DR-15 summaries.';

alter table public.rental_contracts
  add column if not exists ship_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists tax_jurisdiction_id uuid references public.tax_jurisdictions(id) on delete set null,
  add column if not exists tax_sourcing_method text not null default 'destination_ship_to',
  add column if not exists tax_exemption_certificate_id uuid references public.tax_exemption_certificates(id) on delete set null;

alter table public.rental_contracts
  drop constraint if exists rental_contracts_tax_sourcing_method_chk;
alter table public.rental_contracts
  add constraint rental_contracts_tax_sourcing_method_chk
  check (tax_sourcing_method in ('destination_ship_to', 'branch_origin', 'manual_override'));

comment on column public.rental_contracts.ship_to_address_id is
  'Ship-to destination used for rental destination sourcing.';
comment on column public.rental_contracts.tax_jurisdiction_id is
  'Resolved tax jurisdiction for rental tax estimates and invoices.';
comment on column public.rental_contracts.tax_sourcing_method is
  'Sourcing basis used to resolve rental tax. Default is customer ship-to destination.';
comment on column public.rental_contracts.tax_exemption_certificate_id is
  'Verified exemption certificate applied to the rental contract when covers_rental is true.';

alter table public.rental_invoices
  add column if not exists ship_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists tax_jurisdiction_id uuid references public.tax_jurisdictions(id) on delete set null,
  add column if not exists tax_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists tax_exemption_certificate_id uuid references public.tax_exemption_certificates(id) on delete set null,
  add column if not exists dr15_reporting_period date,
  add column if not exists dr15_county_name text,
  add column if not exists dr15_reportable boolean not null default true;

comment on column public.rental_invoices.ship_to_address_id is
  'Ship-to destination carried forward from the rental contract for posted invoice tax evidence.';
comment on column public.rental_invoices.tax_jurisdiction_id is
  'Resolved tax jurisdiction applied to this rental invoice.';
comment on column public.rental_invoices.tax_breakdown is
  'Structured state/county rental tax breakdown used by Finance and DR-15 reporting.';
comment on column public.rental_invoices.dr15_reporting_period is
  'Month bucket used for Florida DR-15 filing summaries. Defaults to period_start month when null.';
comment on column public.rental_invoices.dr15_county_name is
  'County bucket used for Florida DR-15 monthly rental reporting.';
comment on column public.rental_invoices.dr15_reportable is
  'False for non-tax/reporting rows that should be excluded from Florida DR-15 summaries.';

create index if not exists idx_tax_treatments_jurisdiction_county
  on public.tax_treatments (workspace_id, jurisdiction, lower(county_name), applies_to, is_active)
  where is_active = true;

create index if not exists idx_ship_to_tax_jurisdiction
  on public.qrm_company_ship_to_addresses (workspace_id, tax_jurisdiction_id)
  where tax_jurisdiction_id is not null and deleted_at is null;

create index if not exists idx_customer_invoices_dr15
  on public.customer_invoices (workspace_id, dr15_reportable, invoice_date, dr15_county_name)
  where dr15_reportable = true;

create index if not exists idx_rental_contracts_tax_sourcing
  on public.rental_contracts (workspace_id, ship_to_address_id, tax_jurisdiction_id)
  where ship_to_address_id is not null or tax_jurisdiction_id is not null;

create index if not exists idx_rental_invoices_dr15
  on public.rental_invoices (workspace_id, dr15_reportable, coalesce(dr15_reporting_period, date_trunc('month', period_start::timestamp)::date), dr15_county_name)
  where dr15_reportable = true;

with fl_rates(county_name, county_surtax_rate) as (
  values
    ('Alachua', 0.015::numeric),
    ('Baker', 0.010::numeric),
    ('Bay', 0.010::numeric),
    ('Bradford', 0.010::numeric),
    ('Brevard', 0.010::numeric),
    ('Broward', 0.010::numeric),
    ('Calhoun', 0.015::numeric),
    ('Charlotte', 0.010::numeric),
    ('Citrus', 0.000::numeric),
    ('Clay', 0.015::numeric),
    ('Collier', 0.000::numeric),
    ('Columbia', 0.015::numeric),
    ('DeSoto', 0.015::numeric),
    ('Dixie', 0.010::numeric),
    ('Duval', 0.015::numeric),
    ('Escambia', 0.015::numeric),
    ('Flagler', 0.010::numeric),
    ('Franklin', 0.015::numeric),
    ('Gadsden', 0.015::numeric),
    ('Gilchrist', 0.010::numeric),
    ('Glades', 0.010::numeric),
    ('Gulf', 0.010::numeric),
    ('Hamilton', 0.020::numeric),
    ('Hardee', 0.010::numeric),
    ('Hendry', 0.015::numeric),
    ('Hernando', 0.005::numeric),
    ('Highlands', 0.015::numeric),
    ('Hillsborough', 0.015::numeric),
    ('Holmes', 0.015::numeric),
    ('Indian River', 0.010::numeric),
    ('Jackson', 0.015::numeric),
    ('Jefferson', 0.010::numeric),
    ('Lafayette', 0.010::numeric),
    ('Lake', 0.010::numeric),
    ('Lee', 0.005::numeric),
    ('Leon', 0.015::numeric),
    ('Levy', 0.010::numeric),
    ('Liberty', 0.015::numeric),
    ('Madison', 0.015::numeric),
    ('Manatee', 0.010::numeric),
    ('Marion', 0.015::numeric),
    ('Martin', 0.005::numeric),
    ('Miami-Dade', 0.010::numeric),
    ('Monroe', 0.015::numeric),
    ('Nassau', 0.010::numeric),
    ('Okaloosa', 0.010::numeric),
    ('Okeechobee', 0.010::numeric),
    ('Orange', 0.005::numeric),
    ('Osceola', 0.015::numeric),
    ('Palm Beach', 0.005::numeric),
    ('Pasco', 0.010::numeric),
    ('Pinellas', 0.010::numeric),
    ('Polk', 0.010::numeric),
    ('Putnam', 0.010::numeric),
    ('St. Johns', 0.005::numeric),
    ('St. Lucie', 0.010::numeric),
    ('Santa Rosa', 0.010::numeric),
    ('Sarasota', 0.010::numeric),
    ('Seminole', 0.010::numeric),
    ('Sumter', 0.010::numeric),
    ('Suwannee', 0.010::numeric),
    ('Taylor', 0.010::numeric),
    ('Union', 0.010::numeric),
    ('Volusia', 0.005::numeric),
    ('Wakulla', 0.015::numeric),
    ('Walton', 0.010::numeric),
    ('Washington', 0.015::numeric)
)
insert into public.tax_jurisdictions (
  workspace_id,
  state_code,
  county_name,
  jurisdiction_name,
  state_rate,
  county_surtax_rate,
  surtax_cap_amount,
  source_label,
  effective_date,
  expires_at,
  is_active,
  metadata
)
select
  'global',
  'FL',
  fr.county_name,
  fr.county_name || ' County, FL',
  0.060,
  fr.county_surtax_rate,
  5000.00,
  'Florida DR-15DSS 2026',
  date '2026-01-01',
  date '2026-12-31',
  true,
  jsonb_build_object(
    'source_url', 'https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf',
    'source_form', 'DR-15DSS',
    'calendar_year', 2026,
    'dr15_reporting', true
  )
from fl_rates fr
on conflict (workspace_id, state_code, county_name, effective_date)
do update set
  jurisdiction_name = excluded.jurisdiction_name,
  state_rate = excluded.state_rate,
  county_surtax_rate = excluded.county_surtax_rate,
  surtax_cap_amount = excluded.surtax_cap_amount,
  source_label = excluded.source_label,
  expires_at = excluded.expires_at,
  is_active = true,
  metadata = public.tax_jurisdictions.metadata || excluded.metadata,
  updated_at = now();

with fl_rates(county_name, county_surtax_rate) as (
  values
    ('Alachua', 0.015::numeric), ('Baker', 0.010::numeric), ('Bay', 0.010::numeric),
    ('Bradford', 0.010::numeric), ('Brevard', 0.010::numeric), ('Broward', 0.010::numeric),
    ('Calhoun', 0.015::numeric), ('Charlotte', 0.010::numeric), ('Citrus', 0.000::numeric),
    ('Clay', 0.015::numeric), ('Collier', 0.000::numeric), ('Columbia', 0.015::numeric),
    ('DeSoto', 0.015::numeric), ('Dixie', 0.010::numeric), ('Duval', 0.015::numeric),
    ('Escambia', 0.015::numeric), ('Flagler', 0.010::numeric), ('Franklin', 0.015::numeric),
    ('Gadsden', 0.015::numeric), ('Gilchrist', 0.010::numeric), ('Glades', 0.010::numeric),
    ('Gulf', 0.010::numeric), ('Hamilton', 0.020::numeric), ('Hardee', 0.010::numeric),
    ('Hendry', 0.015::numeric), ('Hernando', 0.005::numeric), ('Highlands', 0.015::numeric),
    ('Hillsborough', 0.015::numeric), ('Holmes', 0.015::numeric), ('Indian River', 0.010::numeric),
    ('Jackson', 0.015::numeric), ('Jefferson', 0.010::numeric), ('Lafayette', 0.010::numeric),
    ('Lake', 0.010::numeric), ('Lee', 0.005::numeric), ('Leon', 0.015::numeric),
    ('Levy', 0.010::numeric), ('Liberty', 0.015::numeric), ('Madison', 0.015::numeric),
    ('Manatee', 0.010::numeric), ('Marion', 0.015::numeric), ('Martin', 0.005::numeric),
    ('Miami-Dade', 0.010::numeric), ('Monroe', 0.015::numeric), ('Nassau', 0.010::numeric),
    ('Okaloosa', 0.010::numeric), ('Okeechobee', 0.010::numeric), ('Orange', 0.005::numeric),
    ('Osceola', 0.015::numeric), ('Palm Beach', 0.005::numeric), ('Pasco', 0.010::numeric),
    ('Pinellas', 0.010::numeric), ('Polk', 0.010::numeric), ('Putnam', 0.010::numeric),
    ('St. Johns', 0.005::numeric), ('St. Lucie', 0.010::numeric), ('Santa Rosa', 0.010::numeric),
    ('Sarasota', 0.010::numeric), ('Seminole', 0.010::numeric), ('Sumter', 0.010::numeric),
    ('Suwannee', 0.010::numeric), ('Taylor', 0.010::numeric), ('Union', 0.010::numeric),
    ('Volusia', 0.005::numeric), ('Wakulla', 0.015::numeric), ('Walton', 0.010::numeric),
    ('Washington', 0.015::numeric)
)
update public.tax_jurisdictions tj
set
  state_rate = 0.060,
  county_surtax_rate = fr.county_surtax_rate,
  surtax_cap_amount = 5000.00,
  source_label = 'Florida DR-15DSS 2026',
  expires_at = date '2026-12-31',
  is_active = true,
  metadata = tj.metadata || jsonb_build_object(
    'source_url', 'https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf',
    'source_form', 'DR-15DSS',
    'calendar_year', 2026,
    'dr15_reporting', true,
    'corrected_preliminary_seed', true
  ),
  updated_at = now()
from fl_rates fr
where tj.workspace_id = 'global'
  and tj.state_code = 'FL'
  and lower(tj.county_name) = lower(fr.county_name)
  and tj.effective_date >= date '2026-01-01'
  and tj.source_label is distinct from 'Florida DR-15DSS 2026';

create or replace function public.qep_resolve_fl_tax_jurisdiction(
  p_workspace_id text,
  p_ship_to_address_id uuid,
  p_county_name text default null,
  p_effective_date date default current_date
)
returns public.tax_jurisdictions
language sql
stable
security invoker
set search_path = ''
as $$
  select tj
  from public.tax_jurisdictions tj
  left join public.qrm_company_ship_to_addresses sta
    on sta.id = p_ship_to_address_id
  where tj.state_code = 'FL'
    and lower(tj.county_name) = lower(coalesce(
      nullif(p_county_name, ''),
      nullif(sta.county_name, ''),
      nullif(sta.tax_jurisdiction_override, '')
    ))
    and tj.is_active = true
    and tj.effective_date <= p_effective_date
    and (tj.expires_at is null or tj.expires_at >= p_effective_date)
    and (tj.workspace_id = p_workspace_id or tj.workspace_id = 'global')
  order by
    case when tj.workspace_id = p_workspace_id then 0 else 1 end,
    tj.effective_date desc
  limit 1;
$$;

revoke execute on function public.qep_resolve_fl_tax_jurisdiction(text, uuid, text, date) from public;
grant execute on function public.qep_resolve_fl_tax_jurisdiction(text, uuid, text, date) to authenticated;
grant execute on function public.qep_resolve_fl_tax_jurisdiction(text, uuid, text, date) to service_role;

drop view if exists public.finance_foundation_fl_dr15_monthly_breakout;
create or replace view public.finance_foundation_fl_dr15_monthly_breakout
with (security_invoker = true) as
select
  ci.workspace_id,
  date_trunc('month', ci.invoice_date::timestamp)::date as filing_month,
  'customer_invoice'::text as source_table,
  ci.id as source_id,
  ci.invoice_number,
  coalesce(ci.dr15_county_name, sta.county_name, tj.county_name, ci.tax_breakdown->>'county_name') as county_name,
  coalesce(tj.state_rate, nullif(ci.tax_breakdown->>'state_rate', '')::numeric, 0.060) as state_rate,
  coalesce(tj.county_surtax_rate, nullif(ci.tax_breakdown->>'county_surtax_rate', '')::numeric, 0) as county_surtax_rate,
  round(coalesce(ci.amount, 0) * 100)::bigint as taxable_amount_cents,
  round(coalesce(ci.tax, 0) * 100)::bigint as tax_cents,
  coalesce(tj.surtax_cap_amount, nullif(ci.tax_breakdown->>'surtax_cap_amount', '')::numeric, 5000.00) as surtax_cap_amount,
  coalesce(tj.source_label, ci.tax_breakdown->>'source_label', 'Florida DR-15DSS 2026') as source_label
from public.customer_invoices ci
left join public.qrm_company_ship_to_addresses sta
  on sta.id = ci.ship_to_address_id
left join public.tax_jurisdictions tj
  on tj.id = coalesce(ci.tax_jurisdiction_id, sta.tax_jurisdiction_id)
where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
  and ci.dr15_reportable = true
  and ci.status <> 'void'
  and coalesce(ci.tax, 0) <> 0
union all
select
  ri.workspace_id,
  coalesce(ri.dr15_reporting_period, date_trunc('month', ri.period_start::timestamp)::date) as filing_month,
  'rental_invoice'::text as source_table,
  ri.id as source_id,
  ri.invoice_number,
  coalesce(ri.dr15_county_name, sta.county_name, tj.county_name, ri.tax_breakdown->>'county_name') as county_name,
  coalesce(tj.state_rate, nullif(ri.tax_breakdown->>'state_rate', '')::numeric, 0.060) as state_rate,
  coalesce(tj.county_surtax_rate, nullif(ri.tax_breakdown->>'county_surtax_rate', '')::numeric, 0) as county_surtax_rate,
  coalesce(ri.taxable_amount_cents, 0) as taxable_amount_cents,
  coalesce(ri.tax_cents, 0) as tax_cents,
  coalesce(tj.surtax_cap_amount, nullif(ri.tax_breakdown->>'surtax_cap_amount', '')::numeric, 5000.00) as surtax_cap_amount,
  coalesce(tj.source_label, ri.tax_breakdown->>'source_label', 'Florida DR-15DSS 2026') as source_label
from public.rental_invoices ri
left join public.rental_contracts rc
  on rc.id = ri.rental_contract_id
left join public.qrm_company_ship_to_addresses sta
  on sta.id = coalesce(ri.ship_to_address_id, rc.ship_to_address_id)
left join public.tax_jurisdictions tj
  on tj.id = coalesce(ri.tax_jurisdiction_id, rc.tax_jurisdiction_id, sta.tax_jurisdiction_id)
where ((select auth.role()) = 'service_role' or public.qep_finance_can_read())
  and ri.dr15_reportable = true
  and ri.status <> 'void'
  and coalesce(ri.tax_cents, 0) <> 0;

comment on view public.finance_foundation_fl_dr15_monthly_breakout is
  'Finance-only monthly Florida DR-15 source detail for customer and rental invoices. Rows are gated by qep_finance_can_read/service_role.';

grant select on public.finance_foundation_fl_dr15_monthly_breakout to authenticated;
grant select on public.finance_foundation_fl_dr15_monthly_breakout to service_role;
