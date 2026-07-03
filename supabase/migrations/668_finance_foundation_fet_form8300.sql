-- 668_finance_foundation_fet_form8300.sql
--
-- Finance foundation Part 7: federal excise tax liability and Form 8300
-- compliance flags.
--
-- Rollback notes:
--   drop trigger if exists form_8300_event_from_payment_validation on public.payment_validations;
--   drop trigger if exists payment_validations_form_8300_defaults on public.payment_validations;
--   drop function if exists public.create_form_8300_event_from_payment_validation();
--   drop function if exists public.payment_validations_apply_form_8300_defaults();
--   drop table if exists public.form_8300_compliance_events;
--   drop table if exists public.fet_liability_events;
--   drop table if exists public.fet_exemption_certificates;
--   alter table public.payment_validations drop column if exists form_8300_window_end;
--   alter table public.payment_validations drop column if exists form_8300_window_start;
--   alter table public.payment_validations drop column if exists form_8300_cash_aggregate_amount;
--   alter table public.payment_validations drop column if exists form_8300_status;
--   alter table public.payment_validations drop column if exists form_8300_required;
--   alter table public.customer_invoice_line_items drop column if exists liability_type;
--   alter table public.customer_invoices drop column if exists form_8300_notes;
--   alter table public.customer_invoices drop column if exists form_8300_reference;
--   alter table public.customer_invoices drop column if exists form_8300_filed_at;
--   alter table public.customer_invoices drop column if exists form_8300_due_date;
--   alter table public.customer_invoices drop column if exists form_8300_cash_amount;
--   alter table public.customer_invoices drop column if exists form_8300_status;
--   alter table public.customer_invoices drop column if exists form_8300_required;
--   alter table public.customer_invoices drop column if exists fet_liability_status;
--   alter table public.customer_invoices drop column if exists fet_exemption_certificate_id;
--   alter table public.customer_invoices drop column if exists fet_taxable_amount;
--   alter table public.customer_invoices drop column if exists fet_rate;
--   alter table public.customer_invoices drop column if exists fet_amount;
--   alter table public.quote_tax_breakdowns drop column if exists liability_type;
--   alter table public.quote_package_line_items drop constraint if exists quote_package_line_items_line_type_check;
--   alter table public.quote_packages drop column if exists form_8300_cash_badge_status;
--   alter table public.quote_packages drop column if exists estimated_cash_received;
--   alter table public.quote_packages drop column if exists fet_exemption_certificate_id;
--   alter table public.quote_packages drop column if exists fet_taxable_amount;
--   alter table public.quote_packages drop column if exists fet_rate;
--   alter table public.quote_packages drop column if exists fet_total;

alter table public.tax_treatments
  drop constraint if exists tax_treatments_tax_type_check;

alter table public.tax_treatments
  add constraint tax_treatments_tax_type_check
  check (tax_type in ('sales_tax', 'use_tax', 'rental_tax', 'exemption', 'federal_excise_tax'));

create table if not exists public.fet_exemption_certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  crm_company_id uuid,
  portal_customer_id uuid references public.portal_customers(id) on delete set null,
  certificate_number text not null,
  authority text not null default 'IRS',
  exemption_type text not null,
  covers_equipment boolean not null default true,
  covers_attachments boolean not null default false,
  effective_date date not null,
  expiration_date date,
  document_url text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'revoked')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.fet_exemption_certificates
  add column if not exists crm_company_id uuid,
  add column if not exists portal_customer_id uuid references public.portal_customers(id) on delete set null,
  add column if not exists certificate_number text,
  add column if not exists authority text not null default 'IRS',
  add column if not exists exemption_type text not null default 'unknown',
  add column if not exists covers_equipment boolean not null default true,
  add column if not exists covers_attachments boolean not null default false,
  add column if not exists effective_date date not null default current_date,
  add column if not exists expiration_date date,
  add column if not exists document_url text,
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists status text not null default 'pending',
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

comment on table public.fet_exemption_certificates is
  'Federal excise tax exemption certificate domain. Kept separate from state sales-tax certificates because FET authority, coverage, and evidence differ.';
comment on column public.fet_exemption_certificates.authority is
  'Issuing authority for FET exemption evidence, typically IRS or federal program authority.';

create index if not exists idx_fet_exemption_certificates_company
  on public.fet_exemption_certificates (workspace_id, crm_company_id, status, expiration_date)
  where deleted_at is null and crm_company_id is not null;

alter table public.fet_exemption_certificates enable row level security;

drop policy if exists "fet_exemption_certificates_service_all" on public.fet_exemption_certificates;
create policy "fet_exemption_certificates_service_all"
  on public.fet_exemption_certificates for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "fet_exemption_certificates_finance_read" on public.fet_exemption_certificates;
create policy "fet_exemption_certificates_finance_read"
  on public.fet_exemption_certificates for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

drop policy if exists "fet_exemption_certificates_finance_mutate" on public.fet_exemption_certificates;
create policy "fet_exemption_certificates_finance_mutate"
  on public.fet_exemption_certificates for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

drop trigger if exists set_fet_exemption_certificates_updated_at on public.fet_exemption_certificates;
create trigger set_fet_exemption_certificates_updated_at
  before update on public.fet_exemption_certificates
  for each row execute function public.set_updated_at();

alter table public.quote_packages
  add column if not exists fet_total numeric(14,2) not null default 0,
  add column if not exists fet_rate numeric(8,6),
  add column if not exists fet_taxable_amount numeric(14,2),
  add column if not exists fet_exemption_certificate_id uuid references public.fet_exemption_certificates(id) on delete set null,
  add column if not exists estimated_cash_received numeric(14,2) not null default 0,
  add column if not exists form_8300_cash_badge_status text not null default 'not_required';

alter table public.quote_packages
  drop constraint if exists quote_packages_form_8300_cash_badge_status_chk;
alter table public.quote_packages
  add constraint quote_packages_form_8300_cash_badge_status_chk
  check (form_8300_cash_badge_status in ('not_required', 'review_required', 'filed', 'void'));

comment on column public.quote_packages.fet_total is
  'Estimated federal excise tax total. This is separate from state/local tax_total.';
comment on column public.quote_packages.form_8300_cash_badge_status is
  'Quote-side compliance badge only; invoice/payment records remain the source of truth for Form 8300.';

alter table public.quote_package_line_items
  drop constraint if exists quote_package_line_items_line_type_check;

alter table public.quote_package_line_items
  add constraint quote_package_line_items_line_type_check
  check (line_type in (
    'equipment', 'attachment', 'option', 'accessory', 'part', 'warranty', 'financing',
    'pdi', 'freight', 'good_faith', 'doc_fee', 'title', 'tag', 'registration',
    'discount', 'trade_allowance', 'rebate_mfg', 'rebate_dealer',
    'loyalty_discount', 'tax_state', 'tax_county', 'tax_fet', 'custom'
  ));

alter table public.quote_tax_breakdowns
  add column if not exists liability_type text not null default 'state_local_sales_tax';

alter table public.quote_tax_breakdowns
  drop constraint if exists quote_tax_breakdowns_liability_type_chk;
alter table public.quote_tax_breakdowns
  add constraint quote_tax_breakdowns_liability_type_chk
  check (liability_type in ('state_local_sales_tax', 'federal_excise_tax'));

drop index if exists public.uq_qtb_quote;
create unique index if not exists uq_qtb_quote_liability
  on public.quote_tax_breakdowns (quote_package_id, liability_type);

comment on column public.quote_tax_breakdowns.liability_type is
  'Separates state/local sales tax estimates from federal excise tax estimates so one quote can carry both liabilities.';

alter table public.customer_invoices
  add column if not exists fet_amount numeric(14,2) not null default 0,
  add column if not exists fet_rate numeric(8,6),
  add column if not exists fet_taxable_amount numeric(14,2),
  add column if not exists fet_exemption_certificate_id uuid references public.fet_exemption_certificates(id) on delete set null,
  add column if not exists fet_liability_status text not null default 'not_applicable',
  add column if not exists form_8300_required boolean not null default false,
  add column if not exists form_8300_status text not null default 'not_required',
  add column if not exists form_8300_cash_amount numeric(14,2) not null default 0,
  add column if not exists form_8300_due_date date,
  add column if not exists form_8300_filed_at timestamptz,
  add column if not exists form_8300_reference text,
  add column if not exists form_8300_notes text;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_fet_liability_status_chk;
alter table public.customer_invoices
  add constraint customer_invoices_fet_liability_status_chk
  check (fet_liability_status in ('not_applicable', 'estimated', 'posted', 'exempt', 'reversed'));

alter table public.customer_invoices
  drop constraint if exists customer_invoices_form_8300_status_chk;
alter table public.customer_invoices
  add constraint customer_invoices_form_8300_status_chk
  check (form_8300_status in ('not_required', 'pending', 'filed', 'void'));

comment on column public.customer_invoices.fet_amount is
  'Invoice-level federal excise tax amount. Do not combine with state/local tax.';
comment on column public.customer_invoices.form_8300_required is
  'True when cash or cash-equivalent receipts require Form 8300 compliance review.';

alter table public.customer_invoice_line_items
  add column if not exists liability_type text;

alter table public.customer_invoice_line_items
  drop constraint if exists customer_invoice_line_items_liability_type_chk;
alter table public.customer_invoice_line_items
  add constraint customer_invoice_line_items_liability_type_chk
  check (liability_type is null or liability_type in ('state_local_sales_tax', 'federal_excise_tax', 'form_8300_notice'));

create table if not exists public.fet_liability_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid references public.quote_packages(id) on delete set null,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  crm_company_id uuid,
  fet_exemption_certificate_id uuid references public.fet_exemption_certificates(id) on delete set null,
  liability_source text not null check (liability_source in ('quote_estimate', 'invoice_posting', 'credit_memo_reversal')),
  taxable_amount numeric(14,2) not null default 0,
  rate numeric(8,6) not null default 0.120000,
  amount numeric(14,2) not null default 0,
  status text not null default 'estimated' check (status in ('estimated', 'posted', 'exempt', 'reversed')),
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fet_liability_events
  add column if not exists quote_package_id uuid references public.quote_packages(id) on delete set null,
  add column if not exists customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  add column if not exists crm_company_id uuid,
  add column if not exists fet_exemption_certificate_id uuid references public.fet_exemption_certificates(id) on delete set null,
  add column if not exists liability_source text not null default 'quote_estimate',
  add column if not exists taxable_amount numeric(14,2) not null default 0,
  add column if not exists rate numeric(8,6) not null default 0.120000,
  add column if not exists amount numeric(14,2) not null default 0,
  add column if not exists status text not null default 'estimated',
  add column if not exists source_reference text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on table public.fet_liability_events is
  'Separate federal excise tax liability ledger for quotes, invoices, and credit memo reversals.';

create index if not exists idx_fet_liability_events_invoice
  on public.fet_liability_events (workspace_id, customer_invoice_id, created_at desc)
  where customer_invoice_id is not null;

alter table public.fet_liability_events enable row level security;

drop policy if exists "fet_liability_events_service_all" on public.fet_liability_events;
create policy "fet_liability_events_service_all"
  on public.fet_liability_events for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "fet_liability_events_finance_read" on public.fet_liability_events;
create policy "fet_liability_events_finance_read"
  on public.fet_liability_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

drop policy if exists "fet_liability_events_finance_mutate" on public.fet_liability_events;
create policy "fet_liability_events_finance_mutate"
  on public.fet_liability_events for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

alter table public.payment_validations
  add column if not exists form_8300_required boolean not null default false,
  add column if not exists form_8300_status text not null default 'not_required',
  add column if not exists form_8300_cash_aggregate_amount numeric(14,2),
  add column if not exists form_8300_window_start date,
  add column if not exists form_8300_window_end date;

alter table public.payment_validations
  drop constraint if exists payment_validations_form_8300_status_chk;
alter table public.payment_validations
  add constraint payment_validations_form_8300_status_chk
  check (form_8300_status in ('not_required', 'pending', 'filed', 'void'));

create table if not exists public.form_8300_compliance_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  payment_validation_id uuid references public.payment_validations(id) on delete set null,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  crm_company_id uuid,
  customer_id uuid,
  cash_amount numeric(14,2) not null,
  aggregate_window_start date not null,
  aggregate_window_end date not null,
  status text not null default 'pending' check (status in ('pending', 'filed', 'void')),
  due_date date,
  filed_at timestamptz,
  filed_by uuid references public.profiles(id) on delete set null,
  irs_acknowledgement_reference text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.form_8300_compliance_events
  add column if not exists payment_validation_id uuid references public.payment_validations(id) on delete set null,
  add column if not exists customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  add column if not exists crm_company_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists cash_amount numeric(14,2) not null default 0,
  add column if not exists aggregate_window_start date not null default current_date,
  add column if not exists aggregate_window_end date not null default current_date,
  add column if not exists status text not null default 'pending',
  add column if not exists due_date date,
  add column if not exists filed_at timestamptz,
  add column if not exists filed_by uuid references public.profiles(id) on delete set null,
  add column if not exists irs_acknowledgement_reference text,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

comment on table public.form_8300_compliance_events is
  'Finance compliance queue for Form 8300 review when cash receipts exceed the configured threshold. Payment validation flags are non-blocking.';

create unique index if not exists uq_form_8300_payment_validation
  on public.form_8300_compliance_events (payment_validation_id)
  where payment_validation_id is not null and deleted_at is null;

alter table public.form_8300_compliance_events enable row level security;

drop policy if exists "form_8300_compliance_events_service_all" on public.form_8300_compliance_events;
create policy "form_8300_compliance_events_service_all"
  on public.form_8300_compliance_events for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "form_8300_compliance_events_finance_read" on public.form_8300_compliance_events;
create policy "form_8300_compliance_events_finance_read"
  on public.form_8300_compliance_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

drop policy if exists "form_8300_compliance_events_finance_mutate" on public.form_8300_compliance_events;
create policy "form_8300_compliance_events_finance_mutate"
  on public.form_8300_compliance_events for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_mutate()
  );

drop trigger if exists set_form_8300_compliance_events_updated_at on public.form_8300_compliance_events;
create trigger set_form_8300_compliance_events_updated_at
  before update on public.form_8300_compliance_events
  for each row execute function public.set_updated_at();

create or replace function public.payment_validations_apply_form_8300_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_cash_total numeric := 0;
begin
  if new.payment_type = 'cash' then
    select coalesce(sum(pv.amount), 0)
      into v_existing_cash_total
    from public.payment_validations pv
    where pv.workspace_id = new.workspace_id
      and pv.payment_type = 'cash'
      and pv.validation_date = new.validation_date
      and (tg_op = 'INSERT' or pv.id <> new.id)
      and (
        (new.customer_id is not null and pv.customer_id = new.customer_id)
        or (new.customer_id is null and new.invoice_reference is not null and pv.invoice_reference = new.invoice_reference)
      );

    new.form_8300_cash_aggregate_amount := v_existing_cash_total + coalesce(new.amount, 0);
    new.form_8300_window_start := new.validation_date;
    new.form_8300_window_end := new.validation_date;
    if new.form_8300_cash_aggregate_amount > 10000 then
      new.form_8300_required := true;
      if new.form_8300_status = 'not_required' then
        new.form_8300_status := 'pending';
      end if;
    elsif new.form_8300_status = 'pending' and new.form_8300_required = false then
      new.form_8300_status := 'not_required';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payment_validations_form_8300_defaults on public.payment_validations;
create trigger payment_validations_form_8300_defaults
  before insert or update of payment_type, amount, validation_date, customer_id, invoice_reference
  on public.payment_validations
  for each row execute function public.payment_validations_apply_form_8300_defaults();

create or replace function public.create_form_8300_event_from_payment_validation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.form_8300_required then
    insert into public.form_8300_compliance_events (
      workspace_id,
      payment_validation_id,
      customer_id,
      cash_amount,
      aggregate_window_start,
      aggregate_window_end,
      due_date,
      metadata
    ) values (
      new.workspace_id,
      new.id,
      new.customer_id,
      coalesce(new.form_8300_cash_aggregate_amount, new.amount),
      coalesce(new.form_8300_window_start, new.validation_date),
      coalesce(new.form_8300_window_end, new.validation_date),
      new.validation_date + 15,
      jsonb_build_object(
        'invoice_reference', new.invoice_reference,
        'transaction_type', new.transaction_type,
        'rule_applied', new.rule_applied
      )
    )
    on conflict (payment_validation_id) where payment_validation_id is not null and deleted_at is null
    do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists form_8300_event_from_payment_validation on public.payment_validations;
create trigger form_8300_event_from_payment_validation
  after insert or update of form_8300_required, form_8300_cash_aggregate_amount, form_8300_status
  on public.payment_validations
  for each row execute function public.create_form_8300_event_from_payment_validation();

create or replace function public.validate_payment(
  p_workspace_id text,
  p_customer_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_transaction_type text,
  p_is_delivery_day boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_total numeric;
  v_cash_total numeric := 0;
  v_rule text;
  v_passed boolean := true;
  v_reason text;
  v_form_8300_required boolean := false;
begin
  if p_is_delivery_day and p_transaction_type = 'equipment_sale' and p_payment_type not in ('cashiers_check', 'wire', 'ach') then
    v_passed := false;
    v_rule := 'delivery_day_cashiers_only';
    v_reason := 'Equipment sales on delivery day require Cashier''s Check, wire, or ACH only.';
  end if;

  if p_transaction_type = 'rental' and p_payment_type in ('business_check', 'personal_check') then
    v_passed := false;
    v_rule := 'rental_no_checks';
    v_reason := 'Equipment rentals do not accept regular checks. Use Cashier''s Check, ACH, card, or wire.';
  end if;

  if p_payment_type = 'business_check' and v_passed then
    select coalesce(sum(amount), 0) into v_daily_total
    from public.payment_validations
    where customer_id = p_customer_id
      and validation_date = current_date
      and payment_type = 'business_check'
      and passed = true;

    if v_daily_total + p_amount > 2500 then
      v_passed := false;
      v_rule := 'business_check_limit';
      v_reason := format('Business check limit exceeded. Daily total: $%s + $%s = $%s (limit: $2,500)',
        v_daily_total, p_amount, v_daily_total + p_amount);
    end if;
  end if;

  if p_payment_type = 'personal_check' and v_passed then
    select coalesce(sum(amount), 0) into v_daily_total
    from public.payment_validations
    where customer_id = p_customer_id
      and validation_date = current_date
      and payment_type = 'personal_check'
      and passed = true;

    if v_daily_total + p_amount > 1000 then
      v_passed := false;
      v_rule := 'personal_check_limit';
      v_reason := format('Personal check limit exceeded. Daily total: $%s + $%s = $%s (limit: $1,000)',
        v_daily_total, p_amount, v_daily_total + p_amount);
    end if;
  end if;

  if p_payment_type = 'cash' then
    select coalesce(sum(amount), 0) into v_cash_total
    from public.payment_validations
    where workspace_id = p_workspace_id
      and customer_id = p_customer_id
      and validation_date = current_date
      and payment_type = 'cash'
      and passed = true;

    v_cash_total := v_cash_total + coalesce(p_amount, 0);
    v_form_8300_required := v_cash_total > 10000;
    if v_form_8300_required then
      v_rule := coalesce(v_rule, 'form_8300_cash_reporting_required');
      v_reason := coalesce(
        v_reason,
        format('Cash aggregate is $%s and requires Form 8300 compliance review. Payment is not blocked by this rule.', v_cash_total)
      );
    end if;
  end if;

  return jsonb_build_object(
    'passed', v_passed,
    'rule_applied', v_rule,
    'reason', v_reason,
    'daily_check_total', v_daily_total,
    'form_8300_required', v_form_8300_required,
    'form_8300_cash_aggregate_amount', case when p_payment_type = 'cash' then v_cash_total else null end,
    'form_8300_status', case when v_form_8300_required then 'pending' else 'not_required' end
  );
end;
$$;

insert into public.tax_treatments (
  workspace_id,
  name,
  jurisdiction,
  tax_type,
  rate,
  applies_to,
  effective_date,
  is_active,
  notes
) values
  (
    'default',
    'Federal excise tax - equipment',
    'US',
    'federal_excise_tax',
    0.12000,
    'equipment_new',
    date '2026-01-01',
    true,
    'Finance foundation default FET estimate. Verify applicability by equipment class before posting.'
  ),
  (
    'default',
    'Federal excise tax - attachments',
    'US',
    'federal_excise_tax',
    0.12000,
    'attachments',
    date '2026-01-01',
    true,
    'Finance foundation default FET estimate for qualifying attachments. Verify applicability before posting.'
  );
