-- 804_n7_performance_hot_paths.sql
-- N7.1 — Performance remediation, verified hot-path set (DB half).
--
-- 1. Index pack (all five confirmed absent in prod):
--    inspection_runs.rental_contract_id, rental_reservation_holds.
--    rental_contract_line_id, qrm_equipment rental-fleet partial,
--    qrm_deals.margin_check_status partial, analytics_events dedup-probe
--    composite (the m775/m778 rental scanners and the m802 service delay
--    scanner all probe flow_event_type + entity_id + occurred_at).
-- 2. list_parts_catalog_page / get_part_branch_detail: the parts catalog
--    page pulled four whole tables to the browser and joined them in JS —
--    silently truncated at PostgREST max_rows=1000 (parts_catalog is
--    already at 4,309 live rows, so the page is wrong TODAY, finding
--    RF-011). Server-side pagination + dedup + stock aggregation.
-- 3. floor_pulse_kpis: BuPulseStrip fired 7 whole-table queries and
--    ExecRevenuePace 3 more, all summed in JS — one invoker RPC returns
--    every scalar (analytics_quick_kpi pattern, m193).
-- 4. crm_weighted_pipeline_totals: QrmPipelinePage reduced the entire
--    crm_deals_weighted view to three scalars client-side.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Index pack
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists idx_inspection_runs_rental_contract
  on public.inspection_runs (rental_contract_id)
  where rental_contract_id is not null;

create index if not exists idx_rental_holds_contract_line
  on public.rental_reservation_holds (rental_contract_line_id)
  where rental_contract_line_id is not null;

-- m774 availability view scans ownership='rental_fleet' and availability
-- <> 'decommissioned'.
create index if not exists idx_qrm_equipment_rental_fleet
  on public.qrm_equipment (workspace_id, availability)
  where ownership = 'rental_fleet' and deleted_at is null;

-- Iron Manager polls crm_deals.eq(margin_check_status,'flagged') every 60s;
-- margin_analytics_view aggregates the same predicate.
create index if not exists idx_qrm_deals_margin_flagged
  on public.qrm_deals (margin_check_status)
  where margin_check_status = 'flagged' and deleted_at is null;

-- Dedup probe shape shared by the m775/m778 rental scanners and the m802
-- service delay scanner: flow_event_type = X and entity_id = Y and
-- occurred_at > now() - interval.
create index if not exists idx_ae_flow_dedup_probe
  on public.analytics_events (flow_event_type, entity_id, occurred_at desc)
  where flow_event_type is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Parts catalog: paginated page RPC + branch-detail RPC
--    (security invoker — the page reads these tables with the caller's
--    JWT today, so RLS semantics are unchanged)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.list_parts_catalog_page(
  p_search text default null,
  p_category text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  part_number text,
  description text,
  category text,
  manufacturer text,
  list_price numeric,
  cost_price numeric,
  updated_at timestamptz,
  variant_count integer,
  total_qty numeric,
  branch_count integer,
  worst_status text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
with cat as (
  -- Collapse multi-branch catalog duplicates (m257 uniqueness is per
  -- workspace/co/div/branch, so one part_number appears many times).
  select
    lower(pc.part_number) as key,
    (array_agg(pc.id order by pc.updated_at desc))[1] as id,
    (array_agg(pc.part_number order by pc.part_number))[1] as part_number,
    max(pc.description) as description,
    max(pc.category) as category,
    max(pc.manufacturer) as manufacturer,
    max(pc.list_price) as list_price,
    max(pc.cost_price) as cost_price,
    max(pc.updated_at) as updated_at,
    count(*)::int as variant_count
  from public.parts_catalog pc
  where pc.deleted_at is null
    and (
      p_search is null or btrim(p_search) = ''
      or pc.part_number ilike '%' || btrim(p_search) || '%'
      or pc.description ilike '%' || btrim(p_search) || '%'
      or pc.manufacturer ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_category is null or btrim(p_category) = ''
      or pc.category ilike '%' || btrim(p_category) || '%'
    )
  group by lower(pc.part_number)
),
inv_branch as (
  select lower(pi.part_number) as key, pi.branch_id,
         sum(pi.qty_on_hand) as qty
  from public.parts_inventory pi
  where pi.deleted_at is null
  group by lower(pi.part_number), pi.branch_id
),
inv_status as (
  -- Same thresholds the page computed in JS: stockout <= 0,
  -- critical <= ceil(rp*0.5), reorder <= rp, else healthy; no profile =
  -- no status.
  select ib.key, ib.qty,
    case
      when rp.reorder_point is null then 0
      when ib.qty <= 0 then 4
      when ib.qty <= ceil(rp.reorder_point * 0.5) then 3
      when ib.qty <= rp.reorder_point then 2
      else 1
    end as status_rank
  from inv_branch ib
  left join public.parts_reorder_profiles rp
    on rp.branch_id = ib.branch_id and lower(rp.part_number) = ib.key
),
inv as (
  select key,
         sum(qty) as total_qty,
         count(*)::int as branch_count,
         max(status_rank) as worst_rank
  from inv_status
  group by key
)
select
  c.id, c.part_number, c.description, c.category, c.manufacturer,
  c.list_price, c.cost_price, c.updated_at, c.variant_count,
  coalesce(i.total_qty, 0) as total_qty,
  coalesce(i.branch_count, 0) as branch_count,
  case coalesce(i.worst_rank, 0)
    when 4 then 'stockout'
    when 3 then 'critical'
    when 2 then 'reorder'
    when 1 then 'healthy'
    else null
  end as worst_status,
  count(*) over () as total_count
from cat c
left join inv i on i.key = c.key
order by c.part_number
limit greatest(1, least(coalesce(p_limit, 100), 500))
offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.list_parts_catalog_page(text, text, integer, integer) from public;
grant execute on function public.list_parts_catalog_page(text, text, integer, integer) to authenticated, service_role;

create or replace function public.get_part_branch_detail(p_part_number text)
returns table (
  branch_id text,
  qty numeric,
  bin text,
  reorder_point numeric,
  velocity numeric,
  days_to_stockout numeric,
  stock_status text,
  forecast_qty numeric,
  forecast_risk text
)
language sql
stable
security invoker
set search_path = ''
as $$
with inv as (
  select pi.branch_id, sum(pi.qty_on_hand) as qty,
         (array_agg(pi.bin_location)
            filter (where nullif(btrim(pi.bin_location), '') is not null))[1] as bin
  from public.parts_inventory pi
  where pi.deleted_at is null
    and lower(pi.part_number) = lower(p_part_number)
  group by pi.branch_id
)
select
  i.branch_id::text,
  i.qty,
  i.bin,
  rp.reorder_point,
  rp.consumption_velocity as velocity,
  case when coalesce(rp.consumption_velocity, 0) > 0
       then round((i.qty / rp.consumption_velocity)::numeric, 1)
       else null end as days_to_stockout,
  case
    when rp.reorder_point is null then null
    when i.qty <= 0 then 'stockout'
    when i.qty <= ceil(rp.reorder_point * 0.5) then 'critical'
    when i.qty <= rp.reorder_point then 'reorder'
    else 'healthy'
  end as stock_status,
  fc.predicted_qty as forecast_qty,
  fc.stockout_risk::text as forecast_risk
from inv i
left join public.parts_reorder_profiles rp
  on rp.branch_id = i.branch_id and lower(rp.part_number) = lower(p_part_number)
left join public.parts_demand_forecasts fc
  on fc.branch_id = i.branch_id and lower(fc.part_number) = lower(p_part_number)
 and fc.forecast_month = (date_trunc('month', now()) + interval '1 month')::date
order by i.branch_id
$$;

revoke all on function public.get_part_branch_detail(text) from public;
grant execute on function public.get_part_branch_detail(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Floor pulse scalars (BuPulseStrip + ExecRevenuePace in one call)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.floor_pulse_kpis()
returns table (
  equipment_mtd numeric,
  equipment_pipeline_count integer,
  parts_mtd numeric,
  parts_stockouts integer,
  service_mtd numeric,
  service_sla_pct integer,
  rentals_active integer,
  rentals_monthly_rate numeric,
  pace_today numeric,
  pace_pipeline numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
with won as (
  -- Same stage-name list both widgets hardcode today.
  select s.id from public.qrm_deal_stages s
  where s.name in ('Invoice Closed', 'Post-Sale Follow-Up', 'Sales Order Signed', 'Deposit Collected')
),
bounds as (
  select date_trunc('month', now()) as month_start,
         date_trunc('day', now()) as day_start
)
select
  coalesce((select sum(d.amount) from public.qrm_deals d, bounds b
            where d.stage_id in (select id from won)
              and d.hubspot_deal_id is not null
              and d.closed_at >= b.month_start
              and d.deleted_at is null), 0) as equipment_mtd,
  (select count(*)::int from public.qrm_deals d
   where d.hubspot_deal_id is not null and d.deleted_at is null
     and d.closed_at is null) as equipment_pipeline_count,
  coalesce((select sum(ci.total) from public.customer_invoices ci, bounds b
            where ci.parts_order_id is not null
              and ci.created_at >= b.month_start), 0) as parts_mtd,
  (select count(*)::int
   from public.parts_inventory pi
   join public.parts_catalog pc on pc.id = pi.catalog_id
   where pi.deleted_at is null
     and coalesce(pi.qty_on_hand, 0) < coalesce(pc.reorder_point, 0)) as parts_stockouts,
  coalesce((select sum(sj.invoice_total) from public.service_jobs sj, bounds b
            where sj.closed_at >= b.month_start and sj.deleted_at is null), 0) as service_mtd,
  coalesce((select round(
      100.0 * count(*) filter (
        where t.actual_duration_hours is not null
          and t.actual_duration_hours <= coalesce(t.target_duration_hours, 0))
      / nullif(count(*), 0))::int
    from public.service_tat_metrics t), 0) as service_sla_pct,
  (select count(*)::int from public.rental_contracts rc where rc.status = 'active') as rentals_active,
  coalesce((select sum(rc.agreed_monthly_rate) from public.rental_contracts rc
            where rc.status = 'active'), 0) as rentals_monthly_rate,
  coalesce((select sum(d.amount) from public.qrm_deals d, bounds b
            where d.stage_id in (select id from won)
              and d.hubspot_deal_id is not null
              and d.closed_at >= b.day_start
              and d.deleted_at is null), 0) as pace_today,
  coalesce((select sum(d.amount) from public.qrm_deals d
            where d.hubspot_deal_id is not null and d.deleted_at is null
              and d.closed_at is null), 0) as pace_pipeline
where public.get_my_role() in ('admin', 'manager', 'owner')
$$;

revoke all on function public.floor_pulse_kpis() from public;
grant execute on function public.floor_pulse_kpis() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Weighted pipeline totals (QrmPipelinePage summary strip)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.crm_weighted_pipeline_totals()
returns table (
  open_deals integer,
  pipeline_amount numeric,
  weighted_pipeline numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int as open_deals,
         coalesce(sum(w.amount), 0) as pipeline_amount,
         coalesce(sum(w.weighted_amount), 0) as weighted_pipeline
  from public.crm_deals_weighted w
$$;

revoke all on function public.crm_weighted_pipeline_totals() from public;
grant execute on function public.crm_weighted_pipeline_totals() to authenticated, service_role;

COMMIT;
