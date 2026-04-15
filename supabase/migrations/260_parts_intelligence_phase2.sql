-- ============================================================================
-- Migration 260: Parts Intelligence Engine — Phase 2 Analytics Layer
--
-- Builds on Phase 1 (migrations 257–259) by turning the ingested CDK history
-- into decisions. Adds:
--
--   1. v_parts_velocity        — classifies each part as dead/slow/normal/hot
--                                using 24-month CDK history
--   2. v_parts_stockout_risk   — days-until-stockout projection per part+branch
--   3. v_parts_dead_capital    — tied-up inventory $ for parts with 0 sales 12mo
--   4. v_parts_intelligence    — unified row-per-part view (forecast + stock +
--                                margin + velocity + machine connection)
--   5. compute_seeded_forecast — SQL helper that writes parts_demand_forecasts
--                                seeded from parts_history_monthly (no cold start)
--   6. parts_intelligence_summary — dashboard RPC (top KPIs + top-N lists)
--   7. Input-source tracking columns on parts_demand_forecasts
-- ============================================================================

-- ── Extend parts_demand_forecasts with input source tracking ────────────────

alter table public.parts_demand_forecasts
  add column if not exists input_sources jsonb not null default '{}'::jsonb,
  add column if not exists seeded_from_history boolean not null default false;

comment on column public.parts_demand_forecasts.input_sources is
  'Which signals contributed to this forecast: { cdk_history_months: 24, internal_txns: 12, fleet_signals: 2 }';

-- ── View: parts_velocity ────────────────────────────────────────────────────
-- Classify each part by 12mo velocity. Uses parts_history_monthly as primary source.

create or replace view public.v_parts_velocity as
with history_stats as (
  select
    pc.id                                     as part_id,
    pc.workspace_id,
    pc.part_number,
    pc.co_code,
    pc.div_code,
    pc.branch_code,
    pc.description,
    pc.vendor_code,
    pc.class_code,
    pc.movement_code,
    pc.activity_code,
    pc.on_hand,
    pc.cost_price,
    pc.list_price,
    pc.average_cost,
    pc.reorder_point,
    coalesce(pc.last_12mo_sales, 0)           as recorded_last_12mo_sales,
    -- sum last 12 months from parts_history_monthly
    (select coalesce(sum(h.sales_qty), 0) from public.parts_history_monthly h
      where h.part_id = pc.id and h.month_offset between 1 and 12)
                                              as history_12mo_sales,
    (select coalesce(sum(h.sales_qty), 0) from public.parts_history_monthly h
      where h.part_id = pc.id and h.month_offset between 13 and 24)
                                              as history_13_24mo_sales,
    (select coalesce(sum(h.demands), 0) from public.parts_history_monthly h
      where h.part_id = pc.id and h.month_offset between 1 and 12)
                                              as history_12mo_demands,
    (select coalesce(sum(h.bin_trips), 0) from public.parts_history_monthly h
      where h.part_id = pc.id and h.month_offset between 1 and 12)
                                              as history_12mo_bin_trips,
    (select count(*) from public.parts_history_monthly h
      where h.part_id = pc.id and h.month_offset between 1 and 12 and h.sales_qty > 0)
                                              as history_12mo_active_months
  from public.parts_catalog pc
  where pc.deleted_at is null
)
select
  hs.*,
  -- Classification
  case
    when hs.history_12mo_sales <= 0 and hs.history_13_24mo_sales <= 0
      then 'dead'
    when hs.history_12mo_sales <= 0 and hs.history_13_24mo_sales > 0
      then 'cooling'
    when hs.history_12mo_active_months <= 2 and hs.history_12mo_sales > 0
      then 'slow'
    when hs.history_12mo_active_months >= 6 and hs.history_12mo_sales >= hs.history_13_24mo_sales * 2
      then 'hot'
    when hs.history_12mo_active_months >= 4
      then 'normal'
    else 'slow'
  end                                         as velocity_class,
  -- Daily consumption velocity (for stockout math)
  round((hs.history_12mo_sales / 365.0)::numeric, 4)  as daily_velocity,
  -- Tied-up capital at cost
  round((coalesce(hs.on_hand, 0) * coalesce(hs.cost_price, hs.average_cost, 0))::numeric, 2)
                                              as capital_on_hand,
  -- Year-over-year growth %
  case
    when hs.history_13_24mo_sales > 0
      then round((((hs.history_12mo_sales - hs.history_13_24mo_sales)
                    / hs.history_13_24mo_sales) * 100.0)::numeric, 1)
    else null
  end                                         as yoy_growth_pct
from history_stats hs;

comment on view public.v_parts_velocity is
  'Per-part velocity classification (dead|cooling|slow|normal|hot) with capital-on-hand and YoY growth. '
  'Primary source: parts_history_monthly (seeded from CDK PARTMAST).';

-- ── View: parts_stockout_risk ───────────────────────────────────────────────
-- Projects days-until-stockout per (part, branch).

create or replace view public.v_parts_stockout_risk as
select
  v.part_id,
  v.workspace_id,
  v.part_number,
  v.branch_code,
  v.description,
  v.vendor_code,
  v.on_hand,
  v.reorder_point,
  v.daily_velocity,
  v.velocity_class,
  v.capital_on_hand,
  v.list_price,
  -- Days until stockout (at current burn rate)
  case
    when v.daily_velocity > 0 then
      round((coalesce(v.on_hand, 0) / v.daily_velocity)::numeric, 1)
    else null
  end                                         as days_of_stock,
  -- Risk category
  case
    when coalesce(v.on_hand, 0) <= 0 then 'stocked_out'
    when v.daily_velocity <= 0 then 'no_signal'
    when (v.on_hand / v.daily_velocity) < 7 then 'critical'
    when (v.on_hand / v.daily_velocity) < 14 then 'high'
    when (v.on_hand / v.daily_velocity) < 30 then 'medium'
    when v.reorder_point is not null and v.on_hand <= v.reorder_point then 'at_reorder'
    else 'healthy'
  end                                         as stockout_risk
from public.v_parts_velocity v;

comment on view public.v_parts_stockout_risk is
  'Days-until-stockout per part per branch. Feeds the stockout prevention dashboard (Slice 2.5).';

-- ── View: parts_dead_capital ────────────────────────────────────────────────
-- Surfaces tied-up capital in dead stock (12+ months, no sales).

create or replace view public.v_parts_dead_capital as
select
  v.part_id,
  v.workspace_id,
  v.part_number,
  v.description,
  v.branch_code,
  v.on_hand,
  v.cost_price,
  v.capital_on_hand,
  v.velocity_class,
  case
    when v.history_13_24mo_sales > 0 then 'cooling_down'
    else 'truly_dead'
  end                                         as dead_pattern
from public.v_parts_velocity v
where v.velocity_class in ('dead', 'cooling')
  and coalesce(v.on_hand, 0) > 0
  and coalesce(v.cost_price, v.average_cost, 0) > 0;

comment on view public.v_parts_dead_capital is
  'Parts with >0 inventory and 0 sales in last 12 months. Capital tied up we can free.';

-- ── View: parts_intelligence — unified row-per-part ─────────────────────────
-- One row per (part, branch) with forecast + stock + margin + velocity.

create or replace view public.v_parts_intelligence as
select
  v.part_id,
  v.workspace_id,
  v.part_number,
  v.description,
  v.co_code,
  v.div_code,
  v.branch_code,
  v.vendor_code,
  v.class_code,
  v.on_hand,
  v.reorder_point,
  v.list_price,
  v.cost_price,
  v.average_cost,
  v.velocity_class,
  v.daily_velocity,
  v.history_12mo_sales,
  v.history_12mo_active_months,
  v.capital_on_hand,
  v.yoy_growth_pct,
  sr.days_of_stock,
  sr.stockout_risk,
  ms.vendor_list_price,
  ms.margin_pct_on_cost,
  ms.margin_pct_on_vendor_list,
  ms.potential_overpay,
  (select max(forecast_month) from public.parts_demand_forecasts f
    where f.workspace_id = v.workspace_id and f.part_number = v.part_number
      and f.branch_id = v.branch_code)        as latest_forecast_month,
  (select sum(predicted_qty) from public.parts_demand_forecasts f
    where f.workspace_id = v.workspace_id and f.part_number = v.part_number
      and f.branch_id = v.branch_code
      and f.forecast_month >= current_date
      and f.forecast_month < current_date + interval '90 days')
                                              as forecast_90d_qty,
  (select max(stockout_risk) from public.parts_demand_forecasts f
    where f.workspace_id = v.workspace_id and f.part_number = v.part_number
      and f.branch_id = v.branch_code)        as forecast_stockout_risk
from public.v_parts_velocity v
left join public.v_parts_stockout_risk sr
  on sr.part_id = v.part_id
left join public.v_parts_margin_signal ms
  on ms.part_id = v.part_id;

comment on view public.v_parts_intelligence is
  'Unified per-part intelligence view: velocity + stockout + margin + forecast. '
  'Powers the /parts/companion/intelligence dashboard.';

-- ── RPC: seeded forecast from parts_history_monthly ─────────────────────────
-- Writes baseline forecasts into parts_demand_forecasts using CDK history.
-- Can be called standalone (e.g. post-import) or as part of the cron.

create or replace function public.compute_seeded_forecast(
  p_workspace text default null,
  p_forecast_months integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws              text;
  forecasts_written integer := 0;
  batch_id        text;
  start_ts        timestamptz := now();
begin
  ws := coalesce(p_workspace, public.get_my_workspace());
  if public.get_my_role() not in ('admin', 'manager', 'owner') and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  batch_id := 'seeded-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  with monthly_stats as (
    select
      pc.workspace_id,
      pc.part_number,
      pc.branch_code,
      pc.on_hand,
      pc.reorder_point,
      coalesce(sum(h.sales_qty) filter (where h.month_offset between 1 and 12), 0)
                                              as last_12mo_sum,
      coalesce(sum(h.sales_qty) filter (where h.month_offset between 1 and 3), 0)
                                              as last_3mo_sum,
      coalesce(avg(h.sales_qty) filter (where h.month_offset between 1 and 12), 0)
                                              as avg_monthly_12mo,
      coalesce(avg(h.sales_qty) filter (where h.month_offset between 1 and 3), 0)
                                              as avg_monthly_3mo,
      stddev_samp(h.sales_qty) filter (where h.month_offset between 1 and 12)
                                              as std_dev_12mo,
      count(h.*) filter (where h.month_offset between 1 and 12 and h.sales_qty > 0)
                                              as active_months_12mo
    from public.parts_catalog pc
    left join public.parts_history_monthly h on h.part_id = pc.id
    where pc.workspace_id = ws and pc.deleted_at is null
    group by pc.workspace_id, pc.part_number, pc.branch_code, pc.on_hand, pc.reorder_point
  ),
  forecasts as (
    select
      ms.workspace_id,
      ms.part_number,
      ms.branch_code as branch_id,
      (date_trunc('month', current_date) + (gs || ' month')::interval)::date as forecast_month,
      -- Weighted blend: 70% recent (3mo avg), 30% longer (12mo avg)
      greatest(0, round(((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))::numeric, 2))
                                              as predicted_qty,
      greatest(0, round((((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))
                         - coalesce(ms.std_dev_12mo, 0))::numeric, 2))
                                              as confidence_low,
      round((((ms.avg_monthly_3mo * 0.7) + (ms.avg_monthly_12mo * 0.3))
              + coalesce(ms.std_dev_12mo, 0))::numeric, 2)
                                              as confidence_high,
      ms.on_hand,
      ms.reorder_point,
      ms.avg_monthly_3mo,
      ms.avg_monthly_12mo,
      ms.std_dev_12mo,
      ms.active_months_12mo
    from monthly_stats ms
    cross join generate_series(1, p_forecast_months) gs
    where ms.avg_monthly_12mo > 0 or ms.last_3mo_sum > 0
  )
  insert into public.parts_demand_forecasts (
    workspace_id, part_number, branch_id, forecast_month,
    predicted_qty, confidence_low, confidence_high,
    qty_on_hand_at_forecast, reorder_point_at_forecast,
    stockout_risk, drivers, model_version, computation_batch_id, computed_at,
    input_sources, seeded_from_history
  )
  select
    f.workspace_id, f.part_number, f.branch_id, f.forecast_month,
    f.predicted_qty, f.confidence_low, f.confidence_high,
    f.on_hand::int, f.reorder_point::int,
    case
      when coalesce(f.on_hand, 0) <= 0 then 'critical'
      when f.predicted_qty > 0 and f.on_hand / nullif(f.predicted_qty, 0) < 0.5 then 'critical'
      when f.predicted_qty > 0 and f.on_hand / nullif(f.predicted_qty, 0) < 1.0 then 'high'
      when f.reorder_point is not null and f.on_hand <= f.reorder_point then 'medium'
      when f.predicted_qty > 0 and f.on_hand / nullif(f.predicted_qty, 0) < 1.5 then 'medium'
      else 'low'
    end,
    jsonb_build_object(
      'base_velocity_per_month', f.avg_monthly_12mo,
      'recent_3mo_velocity', f.avg_monthly_3mo,
      'monthly_std_dev', coalesce(f.std_dev_12mo, 0),
      'active_months_12mo', f.active_months_12mo,
      'blend_weights', jsonb_build_object('recent', 0.7, 'long', 0.3)
    ),
    'v2_seeded_cdk',
    batch_id,
    start_ts,
    jsonb_build_object('cdk_history_months', 24, 'blend', '70/30'),
    true
  from forecasts f
  on conflict (workspace_id, part_number, branch_id, forecast_month) do update
  set
    predicted_qty = excluded.predicted_qty,
    confidence_low = excluded.confidence_low,
    confidence_high = excluded.confidence_high,
    qty_on_hand_at_forecast = excluded.qty_on_hand_at_forecast,
    reorder_point_at_forecast = excluded.reorder_point_at_forecast,
    stockout_risk = excluded.stockout_risk,
    drivers = excluded.drivers,
    model_version = excluded.model_version,
    computation_batch_id = excluded.computation_batch_id,
    computed_at = excluded.computed_at,
    input_sources = excluded.input_sources,
    seeded_from_history = excluded.seeded_from_history,
    updated_at = now();

  get diagnostics forecasts_written = row_count;

  return jsonb_build_object(
    'ok', true,
    'forecasts_written', forecasts_written,
    'batch_id', batch_id,
    'elapsed_ms', extract(epoch from (now() - start_ts)) * 1000
  );
end;
$$;

grant execute on function public.compute_seeded_forecast(text, integer) to authenticated;

-- ── RPC: parts_intelligence_summary — dashboard payload ─────────────────────

create or replace function public.parts_intelligence_summary(p_workspace text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := coalesce(p_workspace, public.get_my_workspace());

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_parts', (
        select count(*)::int from public.parts_catalog
        where workspace_id = ws and deleted_at is null
      ),
      'hot_parts', (
        select count(*)::int from public.v_parts_velocity
        where workspace_id = ws and velocity_class = 'hot'
      ),
      'dead_parts', (
        select count(*)::int from public.v_parts_velocity
        where workspace_id = ws and velocity_class = 'dead' and coalesce(on_hand, 0) > 0
      ),
      'stockout_critical', (
        select count(*)::int from public.v_parts_stockout_risk
        where workspace_id = ws and stockout_risk in ('stocked_out', 'critical')
      ),
      'dead_capital_usd', (
        select coalesce(sum(capital_on_hand), 0)::numeric(14,2)
        from public.v_parts_dead_capital
        where workspace_id = ws
      ),
      'margin_erosion_parts', (
        select count(*)::int from public.v_parts_margin_signal
        where workspace_id = ws and potential_overpay = true
      ),
      'forecast_coverage', (
        select count(distinct f.part_number)::int
        from public.parts_demand_forecasts f
        where f.workspace_id = ws
          and f.forecast_month >= current_date
      )
    ),
    'stockout_heat', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from (
        select part_number, branch_code, description, on_hand, days_of_stock, stockout_risk, daily_velocity, list_price
        from public.v_parts_stockout_risk
        where workspace_id = ws and stockout_risk in ('stocked_out', 'critical', 'high')
        order by
          case stockout_risk
            when 'stocked_out' then 0
            when 'critical'    then 1
            when 'high'        then 2
            else 9
          end,
          days_of_stock asc nulls last
        limit 20
      ) s
    ),
    'hot_movers', (
      select coalesce(jsonb_agg(row_to_json(h)), '[]'::jsonb)
      from (
        select part_number, branch_code, description, history_12mo_sales, yoy_growth_pct, on_hand, capital_on_hand
        from public.v_parts_velocity
        where workspace_id = ws and velocity_class = 'hot'
        order by yoy_growth_pct desc nulls last, history_12mo_sales desc
        limit 10
      ) h
    ),
    'dead_capital', (
      select coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb)
      from (
        select part_number, branch_code, description, on_hand, cost_price, capital_on_hand, dead_pattern
        from public.v_parts_dead_capital
        where workspace_id = ws
        order by capital_on_hand desc
        limit 15
      ) d
    ),
    'margin_erosion', (
      select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb)
      from (
        select part_number, branch_code, list_price, cost_price, vendor_list_price,
               margin_pct_on_cost, margin_pct_on_vendor_list
        from public.v_parts_margin_signal
        where workspace_id = ws and potential_overpay = true
        order by vendor_list_price desc nulls last
        limit 15
      ) m
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.parts_intelligence_summary(text) to authenticated;

-- ── Grants for the new views ────────────────────────────────────────────────

grant select on public.v_parts_velocity to authenticated;
grant select on public.v_parts_stockout_risk to authenticated;
grant select on public.v_parts_dead_capital to authenticated;
grant select on public.v_parts_intelligence to authenticated;

-- ============================================================================
-- Migration 260 complete.
-- ============================================================================
