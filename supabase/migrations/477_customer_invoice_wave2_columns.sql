-- 477_customer_invoice_wave2_columns.sql
-- Wave 2 column extensions for customer_invoices from Phase-2/3/8/9.
-- Phase-3 parts_invoices audit fields map here because Wave 1 established
-- customer_invoices as the canonical invoice header; no parts_invoices table is created.

alter table public.customer_invoices
  add column if not exists esign_status text,
  add column if not exists esign_envelope_id text,
  add column if not exists esign_signed_at timestamptz,
  add column if not exists cash_code text,
  add column if not exists invoice_source_code text,
  add column if not exists ar_agency_id uuid references public.ar_agencies(id) on delete set null,
  add column if not exists ar_account_number text,
  add column if not exists aging_bucket text,
  add column if not exists statement_run_id uuid references public.ar_statement_runs(id) on delete set null,
  add column if not exists tax_breakdown jsonb,
  add column if not exists order_number text,
  add column if not exists salesperson_id uuid references public.profiles(id) on delete set null,
  add column if not exists po_number text,
  add column if not exists ship_via text,
  add column if not exists freight_terms text,
  add column if not exists tax_code_1 text,
  add column if not exists tax_code_2 text,
  add column if not exists tax_code_3 text,
  add column if not exists tax_code_4 text,
  add column if not exists discount_code text,
  add column if not exists sold_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists ship_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists print_parameters jsonb;

comment on column public.customer_invoices.esign_status is 'VESign/e-signature status for equipment invoice compatibility.';
comment on column public.customer_invoices.invoice_source_code is 'IntelliDealer invoice first-digit equivalent: EQUIPMENT/PARTS/RENTAL/SERVICE/GENERAL.';
comment on column public.customer_invoices.aging_bucket is 'Mutable/cache aging bucket for AR UI; authoritative Wave 4 views compute live aging.';
comment on column public.customer_invoices.order_number is 'Parts invoice order number mapped to canonical customer_invoices header; no parts_invoices parent table is created.';
comment on column public.customer_invoices.print_parameters is 'Parts invoice print parameter payload from IntelliDealer.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_invoices_esign_status_chk') then
    alter table public.customer_invoices
      add constraint customer_invoices_esign_status_chk
      check (esign_status is null or esign_status in ('awaiting','partially_signed','signed','declined','not_required')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customer_invoices_source_code_chk') then
    alter table public.customer_invoices
      add constraint customer_invoices_source_code_chk
      check (invoice_source_code is null or invoice_source_code in ('EQUIPMENT','PARTS','RENTAL','SERVICE','GENERAL')) not valid;
  end if;
end $$;

create index if not exists idx_customer_invoices_source
  on public.customer_invoices (workspace_id, invoice_source_code)
  where invoice_source_code is not null;
comment on index public.idx_customer_invoices_source is 'Purpose: AR aging and sub-ledger reconciliation by source system.';

create index if not exists idx_customer_invoices_ar_account
  on public.customer_invoices (workspace_id, ar_account_number)
  where ar_account_number is not null;
comment on index public.idx_customer_invoices_ar_account is 'Purpose: AR account-number lookup from Finance invoice history.';

create unique index if not exists idx_customer_invoices_parts_order_number
  on public.customer_invoices (workspace_id, order_number)
  where order_number is not null and invoice_type = 'parts';
comment on index public.idx_customer_invoices_parts_order_number is 'Purpose: parts invoice order number lookup on canonical customer_invoices header.';
