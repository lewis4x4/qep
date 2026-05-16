-- 578_equipment_override_price_column.sql
-- Promote equipment override from JSON metadata to typed cents column.

alter table public.quote_package_line_items
  add column if not exists equipment_override_price_cents bigint;

comment on column public.quote_package_line_items.equipment_override_price_cents is
  'Optional rep override of equipment base price in cents. Null = use system base price. Approval gate evaluates against system base for margin math; PDF uses override.';

update public.quote_package_line_items
set equipment_override_price_cents = round(((metadata->>'equipment_override_price')::numeric) * 100)::bigint
where line_type = 'equipment'
  and metadata ? 'equipment_override_price'
  and equipment_override_price_cents is null;
