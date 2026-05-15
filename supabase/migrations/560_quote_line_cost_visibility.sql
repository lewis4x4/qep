-- ============================================================================
-- Migration 560: quote line customer vs internal visibility
--
-- Adds an explicit line-level visibility tag so pricing can separate:
--   - internal cost adders (non-customer-facing)
--   - customer-facing charges (rendered on quote/proposal)
--
-- Default is customer to preserve legacy behavior unless explicitly marked.
-- ============================================================================

alter table public.quote_package_line_items
  add column if not exists cost_visibility text not null default 'customer';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quote_package_line_items_cost_visibility_check'
  ) then
    alter table public.quote_package_line_items
      add constraint quote_package_line_items_cost_visibility_check
      check (cost_visibility in ('internal', 'customer'));
  end if;
end$$;

-- Backfill known internal cost adders. Keep freight as customer-facing until
-- migration 562 introduces explicit inbound/outbound split.
update public.quote_package_line_items
set cost_visibility = case
  when line_type in ('pdi', 'good_faith') then 'internal'
  when metadata is not null and coalesce(metadata->>'cost_visibility', '') = 'internal' then 'internal'
  else 'customer'
end
where cost_visibility is distinct from case
  when line_type in ('pdi', 'good_faith') then 'internal'
  when metadata is not null and coalesce(metadata->>'cost_visibility', '') = 'internal' then 'internal'
  else 'customer'
end;

create index if not exists idx_quote_package_line_items_visibility
  on public.quote_package_line_items (quote_package_id, cost_visibility, display_order);

comment on column public.quote_package_line_items.cost_visibility is
  'internal = non-customer-facing cost adder; customer = visible proposal line.';
