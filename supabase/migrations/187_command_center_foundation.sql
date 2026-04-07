-- ============================================================================
-- Migration 187: QEP Moonshot Command Center — Foundation (Slice 1)
--
-- Establishes the formal KPI registry and snapshot store for the executive
-- command center per `qep_command_center_codex_spec.md` §6 + §7.
--
-- Design notes:
-- 1. Registry-first: every KPI rendered in the UI MUST have a row in
--    `analytics_metric_definitions`. The UI never renders a magic metric.
-- 2. Snapshots are append-only. Recalculation creates a new row pointing
--    at its predecessor via `supersedes_id`. Historical trends stay stable.
-- 3. RLS: owner-only read on snapshots/definitions per the locked role gate.
--    `role_target` is preserved on later tables for future role expansion
--    without a schema break.
-- 4. We seed 8 CEO metrics here; CFO/COO seeds land in slices 3 + 4.
-- ============================================================================

-- ── 1. Metric registry ──────────────────────────────────────────────────────

create table if not exists public.analytics_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  label text not null,
  description text,
  formula_text text not null,
  formula_sql text,
  display_category text not null check (display_category in (
    'financial', 'pipeline', 'operations', 'finance_controls',
    'logistics', 'inventory', 'synthetic', 'data_quality'
  )),
  owner_role text not null default 'ceo' check (owner_role in ('ceo', 'cfo', 'coo', 'shared')),
  source_tables jsonb not null default '[]'::jsonb,
  refresh_cadence text not null default 'hourly' check (refresh_cadence in (
    'event', 'minutely', 'quarter_hourly', 'hourly', 'daily', 'weekly'
  )),
  drill_contract jsonb not null default '{}'::jsonb,
  threshold_config jsonb not null default '{}'::jsonb,
  synthetic_weights jsonb,
  is_executive_metric boolean not null default true,
  enabled boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analytics_metric_definitions is
  'QEP Command Center: formal KPI registry. Every metric rendered in /exec must have a row here. Spec §6.';
comment on column public.analytics_metric_definitions.formula_sql is
  'Optional executable SQL the snapshot runner uses. Null means the runner has a hard-coded computation for this metric_key.';
comment on column public.analytics_metric_definitions.synthetic_weights is
  'For moonshot synthetic metrics (branch_health_score, cash_pressure_index, trust_velocity, friction_index): JSONB of input_key -> weight. Transparent + tunable, not hidden magic.';

create index if not exists idx_amd_owner_role
  on public.analytics_metric_definitions(owner_role) where enabled = true;
create index if not exists idx_amd_category
  on public.analytics_metric_definitions(display_category) where enabled = true;

-- updated_at trigger reuses the global helper
create trigger trg_amd_updated_at
  before update on public.analytics_metric_definitions
  for each row execute function public.set_updated_at();

-- RLS: owner-only read; service role full
alter table public.analytics_metric_definitions enable row level security;

create policy "amd_owner_read" on public.analytics_metric_definitions
  for select using (public.get_my_role() = 'owner');

create policy "amd_service_all" on public.analytics_metric_definitions
  for all to service_role using (true) with check (true);

-- ── 2. KPI snapshots (immutable append-only) ────────────────────────────────

create table if not exists public.analytics_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  metric_key text not null references public.analytics_metric_definitions(metric_key) on delete restrict,
  metric_value numeric,
  comparison_value numeric,
  target_value numeric,
  confidence_score numeric,
  data_quality_score numeric default 1.0,
  role_scope text,
  branch_id text,
  department_id text,
  entity_type text,
  entity_id uuid,
  period_start date not null,
  period_end date not null,
  calculated_at timestamptz not null default now(),
  refresh_state text not null default 'fresh' check (refresh_state in (
    'fresh', 'stale', 'recalculated', 'partial', 'failed'
  )),
  supersedes_id uuid references public.analytics_kpi_snapshots(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.analytics_kpi_snapshots is
  'QEP Command Center: immutable computed KPI values. Spec §7. Recalculation = new row with supersedes_id pointer; never in-place update.';

-- Idempotency for the snapshot runner: same period+scope can only have one
-- "live" row at a time. Recalc creates a new row and the runner sets the
-- prior row to refresh_state='recalculated'.
create unique index if not exists uq_aks_period_scope
  on public.analytics_kpi_snapshots(
    workspace_id,
    metric_key,
    period_start,
    period_end,
    coalesce(role_scope, ''),
    coalesce(branch_id, '')
  )
  where refresh_state in ('fresh', 'partial');

create index if not exists idx_aks_metric_period
  on public.analytics_kpi_snapshots(workspace_id, metric_key, period_end desc);
create index if not exists idx_aks_role_period
  on public.analytics_kpi_snapshots(workspace_id, role_scope, period_end desc);
create index if not exists idx_aks_calculated_at
  on public.analytics_kpi_snapshots(metric_key, calculated_at desc);
create index if not exists idx_aks_metadata_gin
  on public.analytics_kpi_snapshots using gin (metadata);

alter table public.analytics_kpi_snapshots enable row level security;

create policy "aks_owner_read" on public.analytics_kpi_snapshots
  for select using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "aks_service_all" on public.analytics_kpi_snapshots
  for all to service_role using (true) with check (true);

-- ── 3. Seed CEO top-8 metric definitions ────────────────────────────────────
--
-- These are stub registrations. The snapshot runner (Slice 2) will read
-- these rows and compute values. Slice 1 reads source views directly so
-- the UI is functional before the runner ships.

insert into public.analytics_metric_definitions
  (metric_key, label, description, formula_text, display_category, owner_role,
   source_tables, refresh_cadence, drill_contract, threshold_config)
values
  ('revenue_mtd',
   'Revenue (MTD)',
   'Closed-won deal amount month-to-date',
   'sum(crm_deals.amount) where stage.is_closed_won and closed_at >= date_trunc(''month'', now())',
   'financial', 'ceo',
   '["crm_deals", "crm_deal_stages"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deals", "filter": "closed_won_mtd", "sort": "amount_desc"}'::jsonb,
   '{"target_pct_of_quota": 100, "warn_pct": 80, "critical_pct": 60}'::jsonb),

  ('gross_margin_dollars_mtd',
   'Gross Margin $ (MTD)',
   'Sum of margin_amount on closed-won deals month-to-date',
   'sum(crm_deals.margin_amount) where stage.is_closed_won and closed_at >= date_trunc(''month'', now())',
   'financial', 'ceo',
   '["crm_deals"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deals", "filter": "closed_won_mtd"}'::jsonb,
   '{"target_value": null}'::jsonb),

  ('gross_margin_pct_mtd',
   'Gross Margin % (MTD)',
   'Margin dollars divided by revenue, MTD',
   '(sum(margin_amount) / nullif(sum(amount), 0)) * 100',
   'financial', 'ceo',
   '["crm_deals"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deals", "filter": "closed_won_mtd"}'::jsonb,
   '{"target_pct": 22, "warn_pct": 18, "critical_pct": 14}'::jsonb),

  ('weighted_pipeline',
   'Weighted Pipeline',
   'Open-deal pipeline weighted by stage probability',
   'sum(crm_deals_weighted.weighted_amount)',
   'pipeline', 'ceo',
   '["crm_deals_weighted"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "deals", "filter": "open", "sort": "weighted_amount_desc"}'::jsonb,
   '{"target_coverage_ratio": 3.0}'::jsonb),

  ('forecast_confidence_score',
   'Forecast Confidence',
   'Composite confidence score 0–100 across open pipeline',
   'weighted average of stage_quality + activity_recency + deposit_status + quote_status + follow_up_adherence + exception_count',
   'pipeline', 'ceo',
   '["crm_deals", "crm_quote_audit_events", "deposits", "anomaly_alerts"]'::jsonb,
   'hourly',
   '{"drill_view": "deals", "filter": "open"}'::jsonb,
   '{"warn_below": 60, "critical_below": 40}'::jsonb),

  ('net_contribution_after_load',
   'Net Contribution After Load',
   'Revenue minus direct cost minus freight, hauling, reconditioning, demo, internal labor, refunds, goodwill',
   'sum(revenue) - sum(direct_cost + freight + hauling + reconditioning + demo_cost + internal_labor_burden + refunds_writeoffs + goodwill_adjustments)',
   'financial', 'ceo',
   '["crm_deals", "quotes"]'::jsonb,
   'hourly',
   '{"drill_view": "deals", "filter": "closed_won_mtd", "explainer": "load_breakdown"}'::jsonb,
   '{"requires_columns": ["loaded_margin_pct", "net_contribution_after_load"]}'::jsonb),

  ('enterprise_risk_count',
   'Enterprise Risk Count',
   'Open critical exceptions across all sources',
   'count(exception_queue) where status = ''open'' and severity in (''error'', ''critical'')',
   'data_quality', 'ceo',
   '["exception_queue", "anomaly_alerts"]'::jsonb,
   'quarter_hourly',
   '{"drill_view": "exceptions", "filter": "open_critical"}'::jsonb,
   '{"warn_above": 5, "critical_above": 15}'::jsonb),

  ('cash_pressure_index',
   'Cash Pressure Index',
   'Synthetic 0–100 score: AR aging + unverified deposits + open refunds + payment exceptions',
   'rule-weighted: 0.30 * ar_aging_score + 0.30 * unverified_deposit_score + 0.20 * refund_exposure_score + 0.20 * payment_exception_score',
   'synthetic', 'ceo',
   '["deposits", "payment_validations", "rental_returns"]'::jsonb,
   'hourly',
   '{"drill_view": "synthetic_breakdown"}'::jsonb,
   '{"warn_above": 50, "critical_above": 75}'::jsonb)
on conflict (metric_key) do nothing;

-- Seed synthetic moonshot metric weights via the dedicated column.
update public.analytics_metric_definitions
set synthetic_weights = jsonb_build_object(
  'ar_aging_score', 0.30,
  'unverified_deposit_score', 0.30,
  'refund_exposure_score', 0.20,
  'payment_exception_score', 0.20
)
where metric_key = 'cash_pressure_index';

-- ── 4. Helper function: latest snapshot per metric ──────────────────────────
--
-- The UI uses this RPC instead of querying the table directly so we can
-- evolve the "freshest visible row" rules (e.g., prefer fresh > stale)
-- without changing every consumer.

create or replace function public.analytics_latest_snapshots(
  p_metric_keys text[] default null,
  p_role_scope text default null
) returns table (
  metric_key text,
  metric_value numeric,
  comparison_value numeric,
  target_value numeric,
  confidence_score numeric,
  data_quality_score numeric,
  period_start date,
  period_end date,
  calculated_at timestamptz,
  refresh_state text,
  metadata jsonb
)
language sql
security invoker
stable
as $$
  select distinct on (s.metric_key)
    s.metric_key,
    s.metric_value,
    s.comparison_value,
    s.target_value,
    s.confidence_score,
    s.data_quality_score,
    s.period_start,
    s.period_end,
    s.calculated_at,
    s.refresh_state,
    s.metadata
  from public.analytics_kpi_snapshots s
  where s.workspace_id = public.get_my_workspace()
    and (p_metric_keys is null or s.metric_key = any(p_metric_keys))
    and (p_role_scope is null or s.role_scope is null or s.role_scope = p_role_scope)
    and s.refresh_state in ('fresh', 'partial', 'recalculated')
  order by s.metric_key, s.calculated_at desc;
$$;

comment on function public.analytics_latest_snapshots(text[], text) is
  'QEP Command Center: returns the freshest snapshot per metric_key for the calling workspace. Owner-only access via RLS on the underlying table.';

revoke execute on function public.analytics_latest_snapshots(text[], text) from public;
grant execute on function public.analytics_latest_snapshots(text[], text) to authenticated, service_role;
