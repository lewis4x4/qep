-- 475_qb_quote_wave2_columns.sql
-- Wave 2 column extensions for qb_quotes from Phase-2 Sales Intelligence.

alter table public.qb_quotes
  add column if not exists estimated_close_date date,
  add column if not exists po_number text,
  add column if not exists ship_via text,
  add column if not exists sold_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists ship_to_address_id uuid references public.qrm_company_ship_to_addresses(id) on delete set null,
  add column if not exists tax_code_1 text,
  add column if not exists tax_code_2 text,
  add column if not exists tax_code_3 text,
  add column if not exists tax_code_4 text,
  add column if not exists discount_code text,
  add column if not exists financing_lender text;

comment on column public.qb_quotes.estimated_close_date is 'IntelliDealer equipment quote estimated close date.';
comment on column public.qb_quotes.po_number is 'Customer PO number captured on equipment quote header.';
comment on column public.qb_quotes.sold_to_address_id is 'Sold-to address from Wave 1 qrm_company_ship_to_addresses.';
comment on column public.qb_quotes.ship_to_address_id is 'Ship-to address from Wave 1 qrm_company_ship_to_addresses.';
comment on column public.qb_quotes.discount_code is 'IntelliDealer equipment quote discount code.';

create index if not exists idx_qb_quotes_ship_to_address
  on public.qb_quotes (workspace_id, ship_to_address_id)
  where ship_to_address_id is not null;
comment on index public.idx_qb_quotes_ship_to_address is 'Purpose: quote fulfillment/tax routing by ship-to address.';
