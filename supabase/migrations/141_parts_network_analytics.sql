-- ============================================================================
-- Migration 141: Parts Network Optimization + Analytics (Wave 4)
--
-- 4A: Branch transfer recommendations (network optimizer output)
-- 4B: Analytics snapshots for fast P&L reporting
-- 4C: Customer parts intelligence materialized data
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 4A: Branch Transfer Recommendations
-- ══════════════════════════════════════════════════════════════════════════════

create table public.parts_transfer_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  part_number text not null,
  from_branch_id text not null,
  to_branch_id text not null,
  recommended_qty integer not null check (recommended_qty > 0),

  -- Decision drivers
  from_qty_on_hand integer not null default 0,
  to_qty_on_hand integer not null default 0,
  to_reorder_point integer,
  to_forecast_demand numeric(10, 2),
  estimated_transfer_cost numeric(10, 2),
  estimated_stockout_cost_avoided numeric(10, 2),
  net_savings numeric(10, 2),

  -- Scoring
  priority text not null default 'normal' check (
    priority in ('critical', 'high', 'normal', 'low')
  ),
  confidence numeric(5, 4) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  reason text not null,

  -- Lifecycle
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'executed', 'expired')
  ),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  executed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),

  -- Computation
  computation_batch_id text,
  model_version text not null default 'v1',
  drivers jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_transfer_recommendations is
  'AI-generated inter-branch transfer recommendations. Minimizes total network cost (holding + stockout + transfer) across branches.';

alter table public.parts_transfer_recommendations enable row level security;

create policy "transfer_recs_select"
  on public.parts_transfer_recommendations for select
  using (workspace_id = public.get_my_workspace());

create policy "transfer_recs_mutate"
  on public.parts_transfer_recommendations for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "transfer_recs_service_all"
  on public.parts_transfer_recommendations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_transfer_recommendations_updated_at
  before update on public.parts_transfer_recommendations
  for each row execute function public.set_updated_at();

create index idx_transfer_recs_ws_status
  on public.parts_transfer_recommendations(workspace_id, status)
  where status = 'pending';

create index idx_transfer_recs_expiry
  on public.parts_transfer_recommendations(expires_at)
  where status = 'pending';

-- ══════════════════════════════════════════════════════════════════════════════
-- 4B: Analytics Snapshots (daily pre-aggregated P&L data)
-- ══════════════════════════════════════════════════════════════════════════════

create table public.parts_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  snapshot_date date not null,

  -- Revenue
  total_revenue numeric(14, 2) not null default 0,
  total_cost numeric(14, 2) not null default 0,
  total_margin numeric(14, 2) not null default 0,
  order_count integer not null default 0,
  line_count integer not null default 0,

  -- By category (top 20)
  revenue_by_category jsonb not null default '[]'::jsonb,
  -- [{category, revenue, cost, margin, line_count}]

  -- By branch
  revenue_by_branch jsonb not null default '[]'::jsonb,
  -- [{branch_id, revenue, cost, margin, order_count}]

  -- By source
  revenue_by_source jsonb not null default '[]'::jsonb,
  -- [{order_source, revenue, order_count}]

  -- By customer (top 20)
  top_customers jsonb not null default '[]'::jsonb,
  -- [{company_id, company_name, revenue, order_count}]

  -- Velocity
  fastest_moving jsonb not null default '[]'::jsonb,
  -- [{part_number, description, total_qty, total_revenue}]
  slowest_moving jsonb not null default '[]'::jsonb,
  -- [{part_number, description, last_sold_date, days_since_sold, qty_on_hand}]

  -- Inventory health
  total_inventory_value numeric(14, 2) not null default 0,
  dead_stock_value numeric(14, 2) not null default 0,
  dead_stock_count integer not null default 0,

  computation_batch_id text,
  created_at timestamptz not null default now(),

  unique (workspace_id, snapshot_date)
);

comment on table public.parts_analytics_snapshots is
  'Daily pre-aggregated analytics for fast P&L reporting without expensive real-time joins.';

alter table public.parts_analytics_snapshots enable row level security;

create policy "analytics_snapshots_select"
  on public.parts_analytics_snapshots for select
  using (workspace_id = public.get_my_workspace());

create policy "analytics_snapshots_service_all"
  on public.parts_analytics_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_analytics_snapshots_ws_date
  on public.parts_analytics_snapshots(workspace_id, snapshot_date desc);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4C: Customer Parts Intelligence (per-company aggregates)
-- ══════════════════════════════════════════════════════════════════════════════

create table public.customer_parts_intelligence (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  crm_company_id uuid not null references public.crm_companies(id) on delete cascade,

  -- Spend
  total_spend_12m numeric(14, 2) not null default 0,
  total_spend_prior_12m numeric(14, 2) not null default 0,
  spend_trend text not null default 'stable' check (
    spend_trend in ('growing', 'stable', 'declining', 'new', 'churned')
  ),
  monthly_spend jsonb not null default '[]'::jsonb,
  -- [{month: "2026-01", revenue}]

  -- Orders
  order_count_12m integer not null default 0,
  avg_order_value numeric(14, 2) not null default 0,
  last_order_date date,
  days_since_last_order integer,

  -- Fleet
  fleet_count integer not null default 0,
  machines_approaching_service integer not null default 0,
  predicted_next_quarter_spend numeric(14, 2) not null default 0,

  -- Categories
  top_categories jsonb not null default '[]'::jsonb,
  -- [{category, revenue, pct}]

  -- Intelligence
  churn_risk text not null default 'none' check (
    churn_risk in ('none', 'low', 'medium', 'high')
  ),
  recommended_outreach text,
  opportunity_value numeric(14, 2) not null default 0,

  -- Lifecycle
  computed_at timestamptz not null default now(),
  computation_batch_id text,

  unique (workspace_id, crm_company_id)
);

comment on table public.customer_parts_intelligence is
  'Per-CRM-company parts intelligence: spend trends, fleet health, churn risk, and proactive outreach recommendations.';

alter table public.customer_parts_intelligence enable row level security;

create policy "customer_parts_intel_select"
  on public.customer_parts_intelligence for select
  using (workspace_id = public.get_my_workspace());

create policy "customer_parts_intel_service_all"
  on public.customer_parts_intelligence for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_customer_parts_intel_company
  on public.customer_parts_intelligence(crm_company_id);

create index idx_customer_parts_intel_churn
  on public.customer_parts_intelligence(workspace_id, churn_risk)
  where churn_risk in ('medium', 'high');
