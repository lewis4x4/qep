-- ============================================================================
-- Migration 155: Price Intelligence Completion
--
-- Gap closure for Moonshot 2:
-- - Yard stock vs factory order distinction (inventory-first logic)
-- - Quote-to-catalog linkage for precise impact analysis
-- - Price change impact view sorted by dollar exposure
-- - Requote draft tracking
-- ============================================================================

-- ── 1. Extend catalog_entries with yard stock fields ────────────────────────

alter table public.catalog_entries
  add column if not exists source_location text
    check (source_location in ('yard_stock', 'factory_order', 'consignment', 'allocated')),
  add column if not exists cost_to_qep numeric,
  add column if not exists quantity_discount_tier text,
  add column if not exists acquired_at date,
  add column if not exists is_yard_stock boolean
    generated always as (source_location = 'yard_stock') stored;

comment on column public.catalog_entries.source_location is 'yard_stock = physically on the lot, factory_order = need to order from OEM';
comment on column public.catalog_entries.cost_to_qep is 'What QEP actually paid for this unit (may differ from dealer_cost when bought at quantity discount)';
comment on column public.catalog_entries.is_yard_stock is 'Generated: true when source_location = yard_stock (enables inventory-first quoting)';

create index if not exists idx_catalog_yard_stock
  on public.catalog_entries(make, model, is_yard_stock)
  where is_yard_stock = true and is_available = true;

-- ── 2. Quote-to-catalog line items (precise impact analysis) ────────────────

create table public.quote_package_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  catalog_entry_id uuid references public.catalog_entries(id) on delete set null,

  -- Snapshot at time of quote (what was quoted)
  make text,
  model text,
  year integer,
  quoted_list_price numeric,
  quoted_dealer_cost numeric,
  quantity integer default 1,

  -- For impact analysis: was this a yard stock quote or factory order?
  source_location text,

  created_at timestamptz not null default now()
);

comment on table public.quote_package_line_items is 'Precise link between quote_packages and catalog_entries for price impact analysis.';

alter table public.quote_package_line_items enable row level security;
create policy "qp_line_items_workspace" on public.quote_package_line_items for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "qp_line_items_service" on public.quote_package_line_items for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_qp_line_items_quote on public.quote_package_line_items(quote_package_id);
create index idx_qp_line_items_catalog on public.quote_package_line_items(catalog_entry_id)
  where catalog_entry_id is not null;

-- ── 3. Price change impact view (sorted by dollar exposure) ─────────────────

create or replace view public.price_change_impact as
select
  qp.id as quote_package_id,
  qp.workspace_id,
  qp.deal_id,
  qp.status as quote_status,
  qp.net_total as quote_total,
  qp.created_at as quote_created_at,
  qpli.id as line_item_id,
  qpli.catalog_entry_id,
  qpli.make,
  qpli.model,
  qpli.quoted_list_price,
  ce.list_price as current_list_price,
  (ce.list_price - qpli.quoted_list_price) * qpli.quantity as price_delta_total,
  case
    when qpli.quoted_list_price > 0 then
      round(((ce.list_price - qpli.quoted_list_price) / qpli.quoted_list_price) * 100, 2)
    else null
  end as price_change_pct,
  cph.changed_at as price_changed_at,
  cph.source as price_change_source
from public.quote_packages qp
join public.quote_package_line_items qpli on qpli.quote_package_id = qp.id
left join public.catalog_entries ce on ce.id = qpli.catalog_entry_id
left join lateral (
  select changed_at, source
  from public.catalog_price_history cph
  where cph.catalog_entry_id = qpli.catalog_entry_id
    and cph.changed_at > qp.created_at
  order by cph.changed_at desc
  limit 1
) cph on true
where qp.status in ('draft', 'ready', 'sent')
  and ce.list_price is distinct from qpli.quoted_list_price
  and ce.list_price is not null
  and qpli.quoted_list_price is not null;

comment on view public.price_change_impact is 'Open quotes with stale pricing. Sorted by dollar impact via ORDER BY in queries.';

-- ── 4. Requote drafts linkage ───────────────────────────────────────────────

alter table public.quote_packages
  add column if not exists requote_draft_email_id uuid references public.email_drafts(id) on delete set null;

comment on column public.quote_packages.requote_draft_email_id is 'Link to email_drafts row for one-click requote messaging';
