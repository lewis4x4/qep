-- ============================================================================
-- Migration 137: Parts Demand Forecast Engine — 90-day forward projections
--
-- Stores computed demand forecasts per part per branch per month.
-- Fed by parts-demand-forecast cron (weekly); consumed by command center,
-- catalog page, and auto-replenishment workflows.
-- ============================================================================

-- ── parts_demand_forecasts ──────────────────────────────────────────────────

create table public.parts_demand_forecasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  part_number text not null,
  branch_id text not null,

  -- Forecast period (first day of the month)
  forecast_month date not null,

  -- Predicted demand
  predicted_qty numeric(10, 2) not null default 0,
  confidence_low numeric(10, 2) not null default 0,
  confidence_high numeric(10, 2) not null default 0,

  -- Current stock position at forecast time
  qty_on_hand_at_forecast integer,
  reorder_point_at_forecast integer,

  -- Risk assessment
  stockout_risk text not null default 'low' check (
    stockout_risk in ('none', 'low', 'medium', 'high', 'critical')
  ),

  -- Demand drivers (what contributed to this forecast)
  drivers jsonb not null default '{}'::jsonb,
  -- e.g. { "order_history": 12, "service_reqs": 5, "seasonal_factor": 1.3,
  --        "fleet_hours_signal": 2, "base_velocity": 0.8 }

  -- Model metadata
  model_version text not null default 'v1_weighted_avg',
  computation_batch_id text,
  computed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, part_number, branch_id, forecast_month)
);

comment on table public.parts_demand_forecasts is
  'Forward-looking demand forecasts per part per branch per month. Computed weekly by parts-demand-forecast cron.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_demand_forecasts_ws_month
  on public.parts_demand_forecasts(workspace_id, forecast_month);

create index idx_demand_forecasts_risk
  on public.parts_demand_forecasts(workspace_id, stockout_risk)
  where stockout_risk in ('high', 'critical');

create index idx_demand_forecasts_part
  on public.parts_demand_forecasts(workspace_id, part_number);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.parts_demand_forecasts enable row level security;

create policy "demand_forecasts_select"
  on public.parts_demand_forecasts for select
  using (workspace_id = public.get_my_workspace());

create policy "demand_forecasts_mutate_elevated"
  on public.parts_demand_forecasts for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "demand_forecasts_service_all"
  on public.parts_demand_forecasts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger ─────────────────────────────────────────────────────────────────

create trigger set_parts_demand_forecasts_updated_at
  before update on public.parts_demand_forecasts
  for each row execute function public.set_updated_at();

-- ── Forecast risk summary view ──────────────────────────────────────────────

create or replace view public.parts_forecast_risk_summary as
select
  df.workspace_id,
  df.part_number,
  df.branch_id,
  df.forecast_month,
  df.predicted_qty,
  df.confidence_low,
  df.confidence_high,
  df.stockout_risk,
  df.qty_on_hand_at_forecast,
  df.reorder_point_at_forecast,
  df.drivers,
  df.computed_at,
  pi.qty_on_hand as current_qty_on_hand,
  rp.consumption_velocity,
  rp.reorder_point as current_reorder_point,
  case
    when pi.qty_on_hand is null then 'no_inventory'
    when df.predicted_qty > pi.qty_on_hand and df.stockout_risk in ('high', 'critical') then 'action_required'
    when df.predicted_qty > pi.qty_on_hand then 'watch'
    else 'covered'
  end as coverage_status,
  case
    when rp.consumption_velocity > 0
    then round(pi.qty_on_hand / rp.consumption_velocity, 1)
    else null
  end as days_of_stock_remaining
from public.parts_demand_forecasts df
left join public.parts_inventory pi
  on pi.workspace_id = df.workspace_id
  and pi.branch_id = df.branch_id
  and lower(pi.part_number) = lower(df.part_number)
  and pi.deleted_at is null
left join public.parts_reorder_profiles rp
  on rp.workspace_id = df.workspace_id
  and rp.branch_id = df.branch_id
  and lower(rp.part_number) = lower(df.part_number)
where df.forecast_month >= date_trunc('month', current_date);

comment on view public.parts_forecast_risk_summary is
  'Joins forecasts with live inventory and reorder profiles to surface coverage gaps and action items.';
