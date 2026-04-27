-- 481_parts_vendor_price_wave2_columns.sql
-- Wave 2 quantity-break columns for parts_vendor_prices from Phase-3.

alter table public.parts_vendor_prices
  add column if not exists min_qty integer,
  add column if not exists max_qty integer;

comment on column public.parts_vendor_prices.min_qty is 'Minimum quantity for vendor price break.';
comment on column public.parts_vendor_prices.max_qty is 'Maximum quantity for vendor price break; NULL means no upper bound.';
