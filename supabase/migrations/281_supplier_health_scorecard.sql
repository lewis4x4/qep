-- ============================================================================
-- Migration 281: Supplier Health Scorecard (Slice 3.5)
--
-- Per-vendor metrics tracked over time so the parts manager / owner can spot
-- which suppliers are drifting on price, fill rate, or lead time.
--
-- Data sources that exist today:
--   - parts_vendor_prices (for price creep — YoY % change per vendor)
--   - parts_auto_replenish_queue (for fill rate — approved vs ordered)
--   - parts_orders (for actual dealer-side outflow per vendor)
--   - parts_import_runs (for vendor-file freshness)
--   - vendor_profiles.avg_lead_time_hours (snapshot of current lead time)
--
-- Everything is security_invoker-safe (RLS on base tables is the fence).
-- ============================================================================

-- ── v_supplier_price_creep ─────────────────────────────────────────────────
-- For each vendor, computes the weighted avg price change for parts whose
-- list_price has more than one `effective_date` in parts_vendor_prices.
-- Weight by Jan-of-prior-year price so a 5% hike on a $200 filter weighs more
-- than a 10% hike on a $2 O-ring.

create or replace view public.v_supplier_price_creep as
with vendor_part_windows as (
  select
    vp.workspace_id,
    vp.vendor_id,
    vp.vendor_code,
    vp.part_number,
    max(vp.list_price) filter (where vp.effective_date >= date_trunc('year', now()))
      as current_price,
    max(vp.list_price) filter (where vp.effective_date >= date_trunc('year', now() - interval '1 year')
                               and vp.effective_date < date_trunc('year', now()))
      as prior_price
  from public.parts_vendor_prices vp
  group by vp.workspace_id, vp.vendor_id, vp.vendor_code, vp.part_number
)
select
  workspace_id,
  vendor_id,
  vendor_code,
  count(*)::int                                              as parts_compared,
  count(*) filter (where current_price > prior_price)::int   as parts_up,
  count(*) filter (where current_price < prior_price)::int   as parts_down,
  count(*) filter (where current_price > prior_price * 1.05)::int
                                                             as parts_up_more_than_5pct,
  round(
    sum((current_price - prior_price) * prior_price)
    / nullif(sum(prior_price * prior_price), 0)
    * 100, 2
  )                                                          as weighted_change_pct,
  max(current_price)                                         as max_current_price,
  max(prior_price)                                           as max_prior_price
from vendor_part_windows
where current_price is not null
  and prior_price is not null
  and prior_price > 0
group by workspace_id, vendor_id, vendor_code;

comment on view public.v_supplier_price_creep is
  'Per-vendor weighted YoY price-change percentage for parts with prices in both prior and current year.';

-- ── v_supplier_fill_rate ───────────────────────────────────────────────────
-- Fill rate per vendor over the last 90 days: what % of approved replenish
-- queue items actually became ordered / received vs rejected / expired.

create or replace view public.v_supplier_fill_rate as
with queue_90d as (
  select
    q.workspace_id,
    q.selected_vendor_id as vendor_id,
    q.status,
    q.ordered_at,
    q.approved_at,
    q.created_at
  from public.parts_auto_replenish_queue q
  where q.created_at >= now() - interval '90 days'
    and q.selected_vendor_id is not null
)
select
  workspace_id,
  vendor_id,
  count(*)::int                                          as items_90d,
  count(*) filter (where status in ('approved','ordered'))::int as items_approved,
  count(*) filter (where status = 'ordered')::int        as items_ordered,
  count(*) filter (where status = 'rejected')::int       as items_rejected,
  count(*) filter (where status = 'expired')::int        as items_expired,
  round(
    count(*) filter (where status = 'ordered')::numeric
    / nullif(count(*) filter (where status in ('approved','ordered','rejected','expired')), 0)
    * 100, 1
  )                                                       as fill_rate_pct,
  round(
    avg(extract(epoch from (ordered_at - approved_at)) / 3600)
      filter (where status = 'ordered' and ordered_at is not null and approved_at is not null),
    1
  )                                                       as avg_approve_to_order_hours
from queue_90d
group by workspace_id, vendor_id;

comment on view public.v_supplier_fill_rate is
  'Per-vendor replenish fill rate over trailing 90 days from parts_auto_replenish_queue lifecycle.';

-- ── v_supplier_health_scorecard ────────────────────────────────────────────
-- One-stop rollup joining vendor_profiles + price creep + fill rate + a
-- freshness signal from parts_import_runs so the owner can see everything
-- in a single row per vendor.

create or replace view public.v_supplier_health_scorecard as
with last_import as (
  select
    r.workspace_id,
    r.vendor_code,
    max(r.completed_at) as last_price_file_at
  from public.parts_import_runs r
  where r.file_type = 'vendor_price' and r.status = 'committed'
  group by r.workspace_id, r.vendor_code
),
part_counts as (
  select
    vp.workspace_id,
    vp.vendor_id,
    count(distinct vp.part_number)::int as catalog_parts
  from public.parts_vendor_prices vp
  group by vp.workspace_id, vp.vendor_id
)
select
  vp.workspace_id,
  vp.id                                              as vendor_id,
  vp.name                                            as vendor_name,
  vp.supplier_type,
  vp.avg_lead_time_hours,
  vp.responsiveness_score,
  vp.fill_rate                                       as profile_fill_rate,
  vp.price_competitiveness,
  vp.composite_score                                 as profile_composite_score,

  coalesce(pc.catalog_parts, 0)                      as catalog_parts,
  pcr.parts_compared,
  pcr.parts_up,
  pcr.parts_up_more_than_5pct,
  coalesce(pcr.weighted_change_pct, 0)               as price_change_pct_yoy,

  fr.items_90d                                       as replenish_items_90d,
  fr.items_ordered                                   as replenish_items_ordered,
  fr.fill_rate_pct                                   as fill_rate_pct_90d,
  fr.avg_approve_to_order_hours,

  li.last_price_file_at,
  case
    when li.last_price_file_at is null
      then null
    else greatest(0, extract(days from (now() - li.last_price_file_at))::int)
  end                                                as days_since_last_price_file,

  -- Composite derived health tier:
  --   red    = weighted price creep >= 5% OR fill rate <= 60% OR no file in 120d
  --   yellow = weighted price creep >= 2% OR fill rate <= 80% OR no file in 60d
  --   green  = everything else
  case
    when coalesce(pcr.weighted_change_pct, 0) >= 5
      or coalesce(fr.fill_rate_pct, 100) <= 60
      or (li.last_price_file_at is not null and li.last_price_file_at < now() - interval '120 days')
    then 'red'
    when coalesce(pcr.weighted_change_pct, 0) >= 2
      or coalesce(fr.fill_rate_pct, 100) <= 80
      or (li.last_price_file_at is not null and li.last_price_file_at < now() - interval '60 days')
    then 'yellow'
    else 'green'
  end                                                as health_tier

from public.vendor_profiles vp
left join part_counts pc on pc.vendor_id = vp.id and pc.workspace_id = vp.workspace_id
left join public.v_supplier_price_creep pcr on pcr.vendor_id = vp.id and pcr.workspace_id = vp.workspace_id
left join public.v_supplier_fill_rate fr on fr.vendor_id = vp.id and fr.workspace_id = vp.workspace_id
left join last_import li on li.workspace_id = vp.workspace_id
  and (li.vendor_code is not null and li.vendor_code = vp.name);

-- security_invoker so it respects the caller's RLS on vendor_profiles.
alter view public.v_supplier_health_scorecard set (security_invoker = true);
alter view public.v_supplier_price_creep       set (security_invoker = true);
alter view public.v_supplier_fill_rate         set (security_invoker = true);

comment on view public.v_supplier_health_scorecard is
  'One-row-per-vendor health rollup combining price creep, fill rate, freshness, and profile metrics. Tier in {green, yellow, red}.';

grant select on public.v_supplier_health_scorecard to authenticated;
grant select on public.v_supplier_price_creep       to authenticated;
grant select on public.v_supplier_fill_rate         to authenticated;

-- ── RPC: supplier_health_summary ───────────────────────────────────────────
-- Dashboard payload: counts by tier, top-3 red vendors, top-3 price creep.

create or replace function public.supplier_health_summary(
  p_workspace text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  v_counts jsonb;
  v_red jsonb;
  v_top_creep jsonb;
  v_lowest_fill jsonb;
  v_rows jsonb;
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  begin
    select jsonb_build_object(
      'green',  count(*) filter (where health_tier = 'green'),
      'yellow', count(*) filter (where health_tier = 'yellow'),
      'red',    count(*) filter (where health_tier = 'red'),
      'total',  count(*))
    into v_counts
    from public.v_supplier_health_scorecard
    where workspace_id = ws;
  exception when others then
    v_counts := jsonb_build_object('green',0,'yellow',0,'red',0,'total',0);
  end;

  begin
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_red
    from (
      select vendor_id, vendor_name, price_change_pct_yoy,
             fill_rate_pct_90d, days_since_last_price_file, health_tier
      from public.v_supplier_health_scorecard
      where workspace_id = ws and health_tier = 'red'
      order by coalesce(price_change_pct_yoy, 0) desc,
               coalesce(fill_rate_pct_90d, 0) asc
      limit 3) t;
  exception when others then v_red := '[]'::jsonb; end;

  begin
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_top_creep
    from (
      select vendor_id, vendor_name, price_change_pct_yoy,
             parts_up_more_than_5pct, parts_compared
      from public.v_supplier_health_scorecard
      where workspace_id = ws and price_change_pct_yoy is not null
      order by price_change_pct_yoy desc
      limit 3) t;
  exception when others then v_top_creep := '[]'::jsonb; end;

  begin
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_lowest_fill
    from (
      select vendor_id, vendor_name, fill_rate_pct_90d,
             replenish_items_90d, replenish_items_ordered
      from public.v_supplier_health_scorecard
      where workspace_id = ws
        and fill_rate_pct_90d is not null and replenish_items_90d >= 3
      order by fill_rate_pct_90d asc
      limit 3) t;
  exception when others then v_lowest_fill := '[]'::jsonb; end;

  begin
    select coalesce(jsonb_agg(row_to_json(t) order by
      case t.health_tier when 'red' then 0 when 'yellow' then 1 else 2 end,
      coalesce(t.price_change_pct_yoy, 0) desc
    ), '[]'::jsonb) into v_rows
    from public.v_supplier_health_scorecard t
    where workspace_id = ws;
  exception when others then v_rows := '[]'::jsonb; end;

  return jsonb_build_object(
    'generated_at', now(),
    'workspace_id', ws,
    'counts', v_counts,
    'red_vendors', v_red,
    'top_price_creep', v_top_creep,
    'lowest_fill_rate', v_lowest_fill,
    'rows', v_rows);
end;
$$;

grant execute on function public.supplier_health_summary(text) to authenticated;

-- ============================================================================
-- Migration 281 complete.
-- ============================================================================
