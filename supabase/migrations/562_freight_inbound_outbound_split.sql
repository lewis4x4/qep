-- ============================================================================
-- Migration 562: split inbound and outbound freight amounts
--
-- Preserves existing `freight` lines while introducing explicit split fields
-- for later UI + pricing engine migration.
-- ============================================================================

alter table public.quote_package_line_items
  add column if not exists inbound_freight_amount numeric(12,2),
  add column if not exists outbound_delivery_amount numeric(12,2);

comment on column public.quote_package_line_items.inbound_freight_amount is
  'Internal-only inbound freight cost (manufacturer/transfer to dealer yard).';

comment on column public.quote_package_line_items.outbound_delivery_amount is
  'Customer-facing outbound delivery charge (dealer to customer).';

-- Backfill legacy freight lines as outbound by default.
update public.quote_package_line_items
set outbound_delivery_amount = coalesce(outbound_delivery_amount, unit_price)
where line_type = 'freight'
  and coalesce(cost_visibility, 'customer') = 'customer';

update public.quote_package_line_items
set inbound_freight_amount = coalesce(inbound_freight_amount, unit_price)
where line_type = 'freight'
  and coalesce(cost_visibility, 'customer') = 'internal';
