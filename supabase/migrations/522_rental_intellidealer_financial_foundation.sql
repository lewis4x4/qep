-- 522_rental_intellidealer_financial_foundation.sql
--
-- Phase 6 rental foundation blockers for IntelliDealer gap audit.
-- Additive/idempotent only: enum guards, table-if-not-exists, column-if-not-exists,
-- index-if-not-exists, guarded policies, and trigger recreation.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rental_billing_cycle'
  ) then
    create type public.rental_billing_cycle as enum (
      'hourly',
      'daily',
      'weekly',
      'monthly',
      'cycle_28_day',
      'custom'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rental_proration_rule'
  ) then
    create type public.rental_proration_rule as enum (
      'none',
      'hourly',
      'daily',
      'calendar_day',
      'half_day',
      'thirty_day_month'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rental_invoice_status'
  ) then
    create type public.rental_invoice_status as enum (
      'draft',
      'open',
      'posted',
      'sent',
      'partial',
      'paid',
      'overdue',
      'void',
      'reversed'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'rental_contract_line_status'
  ) then
    create type public.rental_contract_line_status as enum (
      'quoted',
      'reserved',
      'active',
      'exchanged',
      'returned',
      'cancelled',
      'lost',
      'damaged'
    );
  end if;
end $$;

alter table public.rental_contracts
  add column if not exists contract_number text,
  add column if not exists billing_cycle public.rental_billing_cycle,
  add column if not exists proration_rule public.rental_proration_rule,
  add column if not exists tax_jurisdiction_code text,
  add column if not exists tax_exempt boolean not null default false,
  add column if not exists tax_exemption_certificate_url text,
  add column if not exists coi_required boolean not null default false,
  add column if not exists coi_received_at timestamptz,
  add column if not exists coi_expires_at date,
  add column if not exists coi_document_url text,
  add column if not exists insurance_provider text,
  add column if not exists insurance_policy_number text,
  add column if not exists insurance_expires_at date,
  add column if not exists insurance_minimum_coverage_cents bigint,
  add column if not exists damage_waiver_accepted boolean,
  add column if not exists damage_waiver_rate_pct numeric(7, 4),
  add column if not exists damage_waiver_amount_cents bigint,
  add column if not exists delivery_required boolean not null default false,
  add column if not exists pickup_required boolean not null default false,
  add column if not exists delivery_address jsonb not null default '{}'::jsonb,
  add column if not exists pickup_address jsonb not null default '{}'::jsonb,
  add column if not exists delivery_fee_cents bigint,
  add column if not exists pickup_fee_cents bigint,
  add column if not exists promised_delivery_at timestamptz,
  add column if not exists promised_pickup_at timestamptz,
  add column if not exists hourly_rate_cents bigint,
  add column if not exists included_hours_per_day numeric(10, 2),
  add column if not exists overage_hourly_rate_cents bigint,
  add column if not exists rpo_eligible boolean not null default false,
  add column if not exists rpo_purchase_price_cents bigint,
  add column if not exists rpo_rental_credit_pct numeric(7, 4),
  add column if not exists rpo_term_months integer,
  add column if not exists rpo_exercise_deadline date,
  add column if not exists po_required boolean not null default false,
  add column if not exists po_number text,
  add column if not exists po_received_at timestamptz,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists salesperson_id uuid references public.profiles(id) on delete set null,
  add column if not exists print_pdf_url text,
  add column if not exists print_pdf_generated_at timestamptz,
  add column if not exists print_pdf_generated_by uuid references public.profiles(id) on delete set null,
  add column if not exists rate_override_reason text,
  add column if not exists rate_override_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists rate_override_approved_at timestamptz;

comment on column public.rental_contracts.contract_number is
  'IntelliDealer rental contract number for contract lookup and billing audit evidence.';
comment on column public.rental_contracts.billing_cycle is
  'Rental billing cycle used for recurring invoice period generation.';
comment on column public.rental_contracts.proration_rule is
  'Proration rule applied when invoice periods do not match the contract billing cycle.';
comment on column public.rental_contracts.tax_jurisdiction_code is
  'Tax jurisdiction code captured for rental quote/contract taxation evidence.';
comment on column public.rental_contracts.coi_required is
  'Certificate of insurance requirement flag for rental release controls.';
comment on column public.rental_contracts.damage_waiver_accepted is
  'Loss/damage waiver election captured on the rental contract header.';
comment on column public.rental_contracts.rpo_eligible is
  'Rent-purchase-option eligibility captured from IntelliDealer rental terms.';
comment on column public.rental_contracts.po_number is
  'Customer purchase order number required for rental billing where applicable.';
comment on column public.rental_contracts.quote_expires_at is
  'Quote expiration timestamp for unapproved rental quotes.';
comment on column public.rental_contracts.print_pdf_url is
  'Most recent printed rental contract PDF artifact for audit traceability.';
comment on column public.rental_contracts.rate_override_reason is
  'Reason for manual rental rate override, with approver and timestamp fields.';

create table if not exists public.sub_rental_vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_profile_id uuid references public.vendor_profiles(id) on delete set null,
  company_id uuid references public.qrm_companies(id) on delete set null,
  vendor_number text,
  name text not null,
  phone text,
  email text,
  insurance_provider text,
  insurance_policy_number text,
  insurance_expires_at date,
  coi_document_url text,
  default_markup_pct numeric(7, 4),
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.sub_rental_vendors is
  'Sub-rental vendor master for third-party units rented to satisfy customer rental contracts.';
comment on column public.sub_rental_vendors.vendor_number is
  'External vendor number from IntelliDealer or rental supplier records.';
comment on column public.sub_rental_vendors.default_markup_pct is
  'Default markup applied when passing sub-rental vendor costs through to rental invoices.';

create table if not exists public.rental_contract_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  rental_contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  line_number integer not null,
  quantity integer not null default 1 check (quantity > 0),
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  requested_category text,
  requested_make text,
  requested_model text,
  return_code text,
  rental_start_at timestamptz,
  rental_end_at timestamptz,
  actual_returned_at timestamptz,
  outbound_meter_hours numeric(12, 2),
  return_meter_hours numeric(12, 2),
  outbound_odometer numeric(12, 2),
  return_odometer numeric(12, 2),
  daily_rate_cents bigint,
  weekly_rate_cents bigint,
  monthly_rate_cents bigint,
  hourly_rate_cents bigint,
  rate_override_cents bigint,
  rate_override_reason text,
  included_hours numeric(12, 2),
  overage_hourly_rate_cents bigint,
  is_sub_rental boolean not null default false,
  sub_rental_vendor_id uuid references public.sub_rental_vendors(id) on delete set null,
  sub_rental_po_number text,
  sub_rental_cost_cents bigint,
  exchange_parent_line_id uuid references public.rental_contract_lines(id) on delete set null,
  substitution_reason text,
  rpo_eligible boolean,
  rpo_purchase_price_cents bigint,
  rpo_rental_credit_pct numeric(7, 4),
  damage_waiver_accepted boolean,
  damage_waiver_rate_pct numeric(7, 4),
  damage_waiver_amount_cents bigint,
  status public.rental_contract_line_status not null default 'reserved',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (rental_contract_id, line_number)
);

comment on table public.rental_contract_lines is
  'Multi-unit rental contract lines with equipment assignment, meters, rates, RPO, waiver, sub-rental, and exchange chain evidence.';
comment on column public.rental_contract_lines.line_number is
  'Stable rental contract line number from IntelliDealer or contract print.';
comment on column public.rental_contract_lines.return_code is
  'Return condition/code captured at rental return for downstream charge decisions.';
comment on column public.rental_contract_lines.exchange_parent_line_id is
  'Previous line in an exchange/substitution chain when a rental unit is swapped.';
comment on column public.rental_contract_lines.sub_rental_vendor_id is
  'Third-party vendor supplying this line when the dealer sub-rents equipment.';

create table if not exists public.rental_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  rental_contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  invoice_number text not null,
  period_start date not null,
  period_end date not null,
  billing_cycle public.rental_billing_cycle,
  proration_rule public.rental_proration_rule,
  rental_charge_cents bigint not null default 0,
  hourly_charge_cents bigint not null default 0,
  overage_charge_cents bigint not null default 0,
  delivery_charge_cents bigint not null default 0,
  pickup_charge_cents bigint not null default 0,
  damage_waiver_charge_cents bigint not null default 0,
  fuel_charge_cents bigint not null default 0,
  cleaning_charge_cents bigint not null default 0,
  damage_charge_cents bigint not null default 0,
  sub_rental_charge_cents bigint not null default 0,
  other_charge_cents bigint not null default 0,
  discount_cents bigint not null default 0,
  taxable_amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  amount_paid_cents bigint not null default 0,
  balance_cents bigint generated always as (coalesce(total_cents, 0) - coalesce(amount_paid_cents, 0)) stored,
  status public.rental_invoice_status not null default 'draft',
  due_date date,
  posted_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  reversal_of_invoice_id uuid references public.rental_invoices(id) on delete set null,
  reversed_by_invoice_id uuid references public.rental_invoices(id) on delete set null,
  reversal_reason text,
  reversed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (period_end >= period_start),
  unique (workspace_id, invoice_number)
);

comment on table public.rental_invoices is
  'Rental invoice headers with period, charge breakdown, tax, balance, status, and reversal audit fields.';
comment on column public.rental_invoices.balance_cents is
  'Generated rental invoice balance from total less amount paid.';
comment on column public.rental_invoices.reversal_of_invoice_id is
  'Original invoice reversed by this rental invoice record.';
comment on column public.rental_invoices.reversed_by_invoice_id is
  'Reversal invoice that offsets this rental invoice record.';

alter table public.rental_returns
  add column if not exists rental_invoice_id uuid references public.rental_invoices(id) on delete set null,
  add column if not exists fuel_charge_cents bigint,
  add column if not exists cleaning_charge_cents bigint,
  add column if not exists damage_charge_cents bigint,
  add column if not exists damage_labor_cents bigint,
  add column if not exists damage_parts_cents bigint,
  add column if not exists environmental_fee_cents bigint,
  add column if not exists other_charge_cents bigint,
  add column if not exists charge_breakdown jsonb not null default '{}'::jsonb;

comment on column public.rental_returns.fuel_charge_cents is
  'Return fuel charge component for rental return charge audit evidence.';
comment on column public.rental_returns.cleaning_charge_cents is
  'Return cleaning charge component for rental return charge audit evidence.';
comment on column public.rental_returns.damage_charge_cents is
  'Return damage charge total component for rental return charge audit evidence.';
comment on column public.rental_returns.charge_breakdown is
  'Structured return charge breakdown, preserving source details beyond canonical charge columns.';

alter table public.qrm_equipment
  add column if not exists next_available_at timestamptz;

comment on column public.qrm_equipment.next_available_at is
  'Rental fleet availability timestamp after current rental, return inspection, cleanup, or repair hold.';

create index if not exists idx_rental_contracts_contract_number
  on public.rental_contracts (workspace_id, contract_number)
  where contract_number is not null;
comment on index public.idx_rental_contracts_contract_number is
  'Purpose: rental contract lookup by IntelliDealer contract number.';

create index if not exists idx_rental_contracts_quote_expiry
  on public.rental_contracts (workspace_id, quote_expires_at)
  where quote_expires_at is not null;
comment on index public.idx_rental_contracts_quote_expiry is
  'Purpose: expired rental quote queue and quote-validity audit.';

create index if not exists idx_rental_contracts_salesperson
  on public.rental_contracts (workspace_id, salesperson_id, created_at desc)
  where salesperson_id is not null;
comment on index public.idx_rental_contracts_salesperson is
  'Purpose: rental contract worklist and revenue attribution by salesperson.';

create index if not exists idx_rental_contracts_po_number
  on public.rental_contracts (workspace_id, po_number)
  where po_number is not null;
comment on index public.idx_rental_contracts_po_number is
  'Purpose: customer PO lookup for rental billing and dispute research.';

create index if not exists idx_rental_contracts_tax_jurisdiction
  on public.rental_contracts (workspace_id, tax_jurisdiction_code)
  where tax_jurisdiction_code is not null;
comment on index public.idx_rental_contracts_tax_jurisdiction is
  'Purpose: rental tax jurisdiction reconciliation and audit sampling.';

create index if not exists idx_sub_rental_vendors_workspace_status
  on public.sub_rental_vendors (workspace_id, status, name)
  where deleted_at is null;
comment on index public.idx_sub_rental_vendors_workspace_status is
  'Purpose: active sub-rental vendor picker and vendor compliance review.';

create index if not exists idx_sub_rental_vendors_vendor_number
  on public.sub_rental_vendors (workspace_id, vendor_number)
  where vendor_number is not null and deleted_at is null;
comment on index public.idx_sub_rental_vendors_vendor_number is
  'Purpose: exact sub-rental vendor number lookup from source rental records.';

create index if not exists idx_rental_contract_lines_contract
  on public.rental_contract_lines (rental_contract_id, line_number)
  where deleted_at is null;
comment on index public.idx_rental_contract_lines_contract is
  'Purpose: load rental contract detail lines in print/source order.';

create index if not exists idx_rental_contract_lines_equipment_status
  on public.rental_contract_lines (workspace_id, equipment_id, status)
  where equipment_id is not null and deleted_at is null;
comment on index public.idx_rental_contract_lines_equipment_status is
  'Purpose: unit-level rental occupancy and availability analysis.';

create index if not exists idx_rental_contract_lines_sub_vendor
  on public.rental_contract_lines (workspace_id, sub_rental_vendor_id, created_at desc)
  where sub_rental_vendor_id is not null and deleted_at is null;
comment on index public.idx_rental_contract_lines_sub_vendor is
  'Purpose: sub-rental vendor cost and utilization audit.';

create index if not exists idx_rental_contract_lines_exchange_parent
  on public.rental_contract_lines (exchange_parent_line_id)
  where exchange_parent_line_id is not null;
comment on index public.idx_rental_contract_lines_exchange_parent is
  'Purpose: trace rental equipment exchange/substitution chains.';

create index if not exists idx_rental_invoices_contract_period
  on public.rental_invoices (rental_contract_id, period_start, period_end)
  where deleted_at is null;
comment on index public.idx_rental_invoices_contract_period is
  'Purpose: rental invoice period audit by contract.';

create index if not exists idx_rental_invoices_status_due
  on public.rental_invoices (workspace_id, status, due_date)
  where deleted_at is null;
comment on index public.idx_rental_invoices_status_due is
  'Purpose: open rental invoice aging and collections queue.';

create index if not exists idx_rental_invoices_reversal
  on public.rental_invoices (workspace_id, reversal_of_invoice_id, reversed_by_invoice_id)
  where reversal_of_invoice_id is not null or reversed_by_invoice_id is not null;
comment on index public.idx_rental_invoices_reversal is
  'Purpose: rental invoice reversal traceability.';

create index if not exists idx_rental_returns_invoice
  on public.rental_returns (rental_invoice_id)
  where rental_invoice_id is not null;
comment on index public.idx_rental_returns_invoice is
  'Purpose: tie return fuel/cleaning/damage charges to generated rental invoices.';

create index if not exists idx_qrm_equipment_next_available_at
  on public.qrm_equipment (workspace_id, next_available_at)
  where next_available_at is not null and deleted_at is null;
comment on index public.idx_qrm_equipment_next_available_at is
  'Purpose: rental availability search by next available timestamp.';

alter table public.sub_rental_vendors enable row level security;
alter table public.rental_contract_lines enable row level security;
alter table public.rental_invoices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sub_rental_vendors'
      and policyname = 'sub_rental_vendors_service_all'
  ) then
    create policy "sub_rental_vendors_service_all"
      on public.sub_rental_vendors for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sub_rental_vendors'
      and policyname = 'sub_rental_vendors_internal_all'
  ) then
    create policy "sub_rental_vendors_internal_all"
      on public.sub_rental_vendors for all
      using (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
      )
      with check (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_contract_lines'
      and policyname = 'rental_contract_lines_service_all'
  ) then
    create policy "rental_contract_lines_service_all"
      on public.rental_contract_lines for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_contract_lines'
      and policyname = 'rental_contract_lines_internal_all'
  ) then
    create policy "rental_contract_lines_internal_all"
      on public.rental_contract_lines for all
      using (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_contract_lines.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
        )
      )
      with check (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_contract_lines.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_contract_lines'
      and policyname = 'rental_contract_lines_self_select'
  ) then
    create policy "rental_contract_lines_self_select"
      on public.rental_contract_lines for select
      using (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_contract_lines.rental_contract_id
            and rc.portal_customer_id = (select public.get_portal_customer_id())
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_invoices'
      and policyname = 'rental_invoices_service_all'
  ) then
    create policy "rental_invoices_service_all"
      on public.rental_invoices for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_invoices'
      and policyname = 'rental_invoices_internal_all'
  ) then
    create policy "rental_invoices_internal_all"
      on public.rental_invoices for all
      using (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_invoices.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
        )
      )
      with check (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_invoices.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_invoices'
      and policyname = 'rental_invoices_self_select'
  ) then
    create policy "rental_invoices_self_select"
      on public.rental_invoices for select
      using (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_invoices.rental_contract_id
            and rc.portal_customer_id = (select public.get_portal_customer_id())
        )
      );
  end if;
end $$;

drop trigger if exists set_sub_rental_vendors_updated_at on public.sub_rental_vendors;
create trigger set_sub_rental_vendors_updated_at
  before update on public.sub_rental_vendors
  for each row execute function public.set_updated_at();

drop trigger if exists set_rental_contract_lines_updated_at on public.rental_contract_lines;
create trigger set_rental_contract_lines_updated_at
  before update on public.rental_contract_lines
  for each row execute function public.set_updated_at();

drop trigger if exists set_rental_invoices_updated_at on public.rental_invoices;
create trigger set_rental_invoices_updated_at
  before update on public.rental_invoices
  for each row execute function public.set_updated_at();
