-- ============================================================================
-- Migration 286: QB Quotes and Deals
--
-- qb_quotes           — the quote record, full pricing snapshot (frozen at creation)
-- qb_quote_line_items — attachments, adjustments, trade-in lines
-- qb_deals            — what a quote converts into when won
-- qb_trade_ins        — trade-in detail linked to a deal or quote
--
-- FK note: company/contact/equipment refs point to qrm_* BASE TABLES (not crm_* views).
-- Money: all amounts as bigint cents. Percentages as numeric(5,4).
-- ============================================================================

-- ── Quote number sequence ────────────────────────────────────────────────────

create sequence public.qb_quote_number_seq;

create or replace function public.generate_qb_quote_number()
returns text
language plpgsql
set search_path = ''
as $$
begin
  return 'Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.qb_quote_number_seq')::text, 6, '0');
end;
$$;

-- ── qb_quotes ────────────────────────────────────────────────────────────────

create table public.qb_quotes (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                text not null default 'default',
  quote_number                text unique not null default public.generate_qb_quote_number(),
  version                     int not null default 1,
  parent_quote_id             uuid references public.qb_quotes(id),

  status                      text not null default 'draft' check (status in (
    'draft','pending_approval','approved','sent','accepted','rejected',
    'expired','converted_to_deal','archived'
  )),

  -- Who / what / for whom
  salesman_id                 uuid not null references auth.users(id),
  company_id                  uuid references public.qrm_companies(id),
  contact_id                  uuid references public.qrm_contacts(id),
  customer_equipment_id       uuid references public.qrm_equipment(id),

  -- Equipment being quoted
  equipment_model_id          uuid references public.qb_equipment_models(id),
  customer_type               text not null default 'standard'
    check (customer_type in ('standard','gmu')),
  customer_type_details       jsonb,

  -- Pricing snapshot (frozen at creation — never recompute from live data)
  list_price_cents            bigint not null,
  dealer_discount_pct         numeric(5,4) not null,
  dealer_discount_cents       bigint not null,
  pdi_cents                   bigint not null,
  good_faith_pct              numeric(5,4) not null,
  good_faith_cents            bigint not null,
  freight_cents               bigint not null,
  tariff_pct                  numeric(5,4) not null,
  tariff_cents                bigint not null,
  equipment_cost_cents        bigint not null,
  markup_pct                  numeric(5,4) not null,
  markup_cents                bigint not null,
  baseline_sales_price_cents  bigint not null,

  -- Attachments rolled up
  attachments_list_price_cents  bigint not null default 0,
  attachments_cost_cents        bigint not null default 0,
  attachments_markup_cents      bigint not null default 0,
  attachments_sales_price_cents bigint not null default 0,

  -- Totals
  subtotal_cents              bigint not null,
  tax_rate_pct                numeric(5,4),
  tax_cents                   bigint not null default 0,
  doc_fee_cents               bigint not null default 0,
  total_cents                 bigint not null,

  -- Programs applied
  applied_program_ids         uuid[],
  financing_scenario          jsonb,
  cil_amount_cents            bigint not null default 0,
  rebate_total_cents          bigint not null default 0,

  -- Trade-in
  trade_in_allowance_cents    bigint not null default 0,
  trade_in_book_value_cents   bigint not null default 0,

  -- Margin
  gross_margin_cents          bigint,
  gross_margin_pct            numeric(5,4),
  markup_achieved_pct         numeric(5,4),

  -- Approval
  requires_approval           boolean not null default false,
  approval_reason             text,
  approved_by                 uuid references auth.users(id),
  approved_at                 timestamptz,

  -- Delivery and validity
  valid_until                 date,
  delivery_date               date,
  notes                       text,
  internal_notes              text,
  pdf_url                     text,
  sent_at                     timestamptz,
  created_by                  uuid references auth.users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_qb_quotes_workspace       on public.qb_quotes(workspace_id);
create index idx_qb_quotes_salesman        on public.qb_quotes(salesman_id);
create index idx_qb_quotes_company         on public.qb_quotes(company_id);
create index idx_qb_quotes_status          on public.qb_quotes(status);
create index idx_qb_quotes_equipment_model on public.qb_quotes(equipment_model_id);
create index idx_qb_quotes_created_at      on public.qb_quotes(created_at desc);

create trigger set_qb_quotes_updated_at
  before update on public.qb_quotes
  for each row execute function public.set_updated_at();

-- ── qb_quote_line_items ──────────────────────────────────────────────────────

create table public.qb_quote_line_items (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  quote_id              uuid not null references public.qb_quotes(id) on delete cascade,
  line_type             text not null check (line_type in (
    'attachment','trade_in','discount','credit','adjustment'
  )),
  attachment_id         uuid references public.qb_attachments(id),
  description           text not null,
  quantity              int not null default 1,
  list_price_cents      bigint,
  discount_pct          numeric(5,4) not null default 0,
  unit_price_cents      bigint not null,
  extended_price_cents  bigint not null,
  display_order         int not null default 0,
  created_at            timestamptz not null default now()
);

create index idx_qb_quote_line_items_quote on public.qb_quote_line_items(quote_id);

-- ── Deal number sequence ─────────────────────────────────────────────────────

create sequence public.qb_deal_number_seq;

create or replace function public.generate_qb_deal_number()
returns text
language plpgsql
set search_path = ''
as $$
begin
  return 'D-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.qb_deal_number_seq')::text, 6, '0');
end;
$$;

-- ── qb_deals ─────────────────────────────────────────────────────────────────

create table public.qb_deals (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                text not null default 'default',
  deal_number                 text unique not null default public.generate_qb_deal_number(),
  quote_id                    uuid references public.qb_quotes(id),
  -- Optional link to the CRM pipeline deal for stage progression tracking
  crm_deal_id                 uuid references public.qrm_deals(id) on delete set null,

  company_id                  uuid not null references public.qrm_companies(id),
  salesman_id                 uuid not null references auth.users(id),

  -- 'active' not 'open' — avoids confusion with qrm_deals stage-based model
  status                      text not null default 'active' check (status in (
    'active','in_finance','won','lost','cancelled','delivered'
  )),

  -- Financials copied from quote at conversion (frozen snapshot)
  total_revenue_cents         bigint not null,
  total_cost_cents            bigint not null,
  gross_margin_cents          bigint not null,
  gross_margin_pct            numeric(5,4) not null,

  -- Commission: 15% of gross margin, calculated at deal close
  commission_rate_pct         numeric(5,4) not null default 0.1500,
  commission_cents            bigint,
  commission_paid             boolean not null default false,
  commission_paid_at          timestamptz,

  -- Closing
  close_date                  date,
  delivery_date               date,
  invoice_number              text,

  -- Rebate filing clock: auto-computed from warranty_registration_date
  warranty_registration_date  date,
  rebate_filing_due_date      date,
  rebate_filed_at             timestamptz,
  rebate_filed_by             uuid references auth.users(id),

  applied_program_ids         uuid[],

  won_reason                  text,
  lost_reason                 text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);

create index idx_qb_deals_workspace  on public.qb_deals(workspace_id);
create index idx_qb_deals_salesman   on public.qb_deals(salesman_id);
create index idx_qb_deals_company    on public.qb_deals(company_id);
create index idx_qb_deals_status     on public.qb_deals(status);
create index idx_qb_deals_crm_deal   on public.qb_deals(crm_deal_id) where crm_deal_id is not null;
create index idx_qb_deals_rebate_due
  on public.qb_deals(rebate_filing_due_date)
  where rebate_filed_at is null and rebate_filing_due_date is not null;

create trigger set_qb_deals_updated_at
  before update on public.qb_deals
  for each row execute function public.set_updated_at();

-- Auto-compute rebate_filing_due_date = warranty_registration_date + 45 days
create or replace function public.qb_compute_rebate_due_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.warranty_registration_date is not null then
    new.rebate_filing_due_date := new.warranty_registration_date + interval '45 days';
  end if;
  return new;
end;
$$;

create trigger qb_deals_rebate_due_date
  before insert or update of warranty_registration_date on public.qb_deals
  for each row execute function public.qb_compute_rebate_due_date();

-- ── qb_trade_ins ─────────────────────────────────────────────────────────────

create table public.qb_trade_ins (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  deal_id               uuid references public.qb_deals(id),
  quote_id              uuid references public.qb_quotes(id),
  crm_equipment_id      uuid references public.qrm_equipment(id),
  make                  text not null,
  model                 text not null,
  year                  int,
  serial                text,
  hours                 int,
  allowance_cents       bigint not null,
  book_value_cents      bigint,
  valuation_source      text,
  over_under_cents      bigint,
  disposition           text,
  approved_by           uuid references auth.users(id),
  approved_at           timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_qb_trade_ins_deal  on public.qb_trade_ins(deal_id);
create index idx_qb_trade_ins_quote on public.qb_trade_ins(quote_id);

create trigger set_qb_trade_ins_updated_at
  before update on public.qb_trade_ins
  for each row execute function public.set_updated_at();
