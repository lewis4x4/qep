-- ============================================================================
-- Migration 136: Parts Reorder Intelligence — dynamic reorder points
--
-- Replaces static low-stock thresholds with computed per-part-per-branch
-- reorder profiles: consumption velocity, vendor lead time, safety stock,
-- reorder point, and economic order quantity.
-- ============================================================================

-- ── parts_reorder_profiles ──────────────────────────────────────────────────

create table public.parts_reorder_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  branch_id text not null,
  part_number text not null,

  -- Computed demand metrics
  consumption_velocity numeric(12, 4) not null default 0,      -- units/day (rolling window)
  velocity_window_days integer not null default 90,             -- lookback days used
  total_consumed integer not null default 0,                    -- units consumed in window

  -- Vendor/supply metrics
  avg_lead_time_days numeric(8, 2) not null default 7,          -- avg vendor fulfillment days
  lead_time_std_dev numeric(8, 2) not null default 2,           -- lead time variability

  -- Computed thresholds
  safety_stock integer not null default 0,                       -- buffer for demand/lead variability
  reorder_point integer not null default 0,                      -- order when qty_on_hand <= this
  economic_order_qty integer not null default 1 check (economic_order_qty > 0),

  -- Safety factor (z-score for desired service level, default 1.65 = ~95%)
  safety_factor numeric(4, 2) not null default 1.65,

  -- Metadata
  last_computed_at timestamptz not null default now(),
  next_compute_at timestamptz not null default now() + interval '1 day',
  computation_source text not null default 'initial' check (
    computation_source in ('initial', 'cron_compute', 'manual_override')
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, branch_id, part_number)
);

comment on table public.parts_reorder_profiles is
  'Dynamic reorder intelligence per part per branch. Computed by parts-reorder-compute cron, consumed by inventory health checks.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_reorder_profiles_ws_branch
  on public.parts_reorder_profiles(workspace_id, branch_id);

create index idx_reorder_profiles_next_compute
  on public.parts_reorder_profiles(next_compute_at);

create index idx_reorder_profiles_ws_part
  on public.parts_reorder_profiles(workspace_id, part_number);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.parts_reorder_profiles enable row level security;

create policy "reorder_profiles_select"
  on public.parts_reorder_profiles for select
  using (workspace_id = public.get_my_workspace());

create policy "reorder_profiles_mutate_staff"
  on public.parts_reorder_profiles for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "reorder_profiles_service_all"
  on public.parts_reorder_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger ─────────────────────────────────────────────────────────────────

create trigger set_parts_reorder_profiles_updated_at
  before update on public.parts_reorder_profiles
  for each row execute function public.set_updated_at();

-- ── Helper view: inventory with reorder intelligence ────────────────────────

create or replace view public.parts_inventory_reorder_status as
select
  pi.id as inventory_id,
  pi.workspace_id,
  pi.branch_id,
  pi.part_number,
  pi.qty_on_hand,
  pi.bin_location,
  pi.catalog_id,
  rp.reorder_point,
  rp.safety_stock,
  rp.economic_order_qty,
  rp.consumption_velocity,
  rp.avg_lead_time_days,
  rp.last_computed_at as reorder_computed_at,
  case
    when rp.id is null then 'no_profile'
    when pi.qty_on_hand <= 0 then 'stockout'
    when pi.qty_on_hand <= rp.safety_stock then 'critical'
    when pi.qty_on_hand <= rp.reorder_point then 'reorder'
    else 'healthy'
  end as stock_status,
  case
    when rp.consumption_velocity > 0
    then round(pi.qty_on_hand / rp.consumption_velocity, 1)
    else null
  end as days_until_stockout
from public.parts_inventory pi
left join public.parts_reorder_profiles rp
  on rp.workspace_id = pi.workspace_id
  and rp.branch_id = pi.branch_id
  and lower(rp.part_number) = lower(pi.part_number)
where pi.deleted_at is null;

comment on view public.parts_inventory_reorder_status is
  'Joins inventory with reorder intelligence for real-time stock health assessment.';
