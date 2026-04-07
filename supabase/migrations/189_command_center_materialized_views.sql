-- ============================================================================
-- Migration 189: QEP Moonshot Command Center — Materialized Views (Slice 2)
--
-- These MVs are inputs to the analytics-snapshot-runner edge function.
-- The UI ALWAYS reads `analytics_kpi_snapshots` — never these views directly.
-- That keeps the landing screen sub-100ms regardless of data scale and lets
-- us recompute history without rewriting the trend lines.
--
-- Refresh strategy:
--   - Cron every 15 minutes during business hours via the snapshot runner
--   - Manual REFRESH MATERIALIZED VIEW CONCURRENTLY for ad-hoc recompute
--
-- Slice 2 ships the first 3 MVs that feed CEO KPIs. Slices 3 + 4 add the
-- finance and operations MVs.
-- ============================================================================

-- ── 1. mv_exec_revenue_daily ───────────────────────────────────────────────
--
-- Daily closed-won revenue + margin per workspace. Drives revenue_mtd,
-- gross_margin_dollars_mtd, gross_margin_pct_mtd, and the 30-day sparkline
-- shown under each KPI tile.

drop materialized view if exists public.mv_exec_revenue_daily cascade;
create materialized view public.mv_exec_revenue_daily as
select
  d.workspace_id,
  date_trunc('day', d.closed_at)::date as day,
  count(*)::int as closed_deal_count,
  coalesce(sum(d.amount), 0)::numeric(14,2) as revenue,
  coalesce(sum(d.margin_amount), 0)::numeric(14,2) as margin_dollars,
  case when sum(d.amount) > 0
       then (sum(d.margin_amount) / sum(d.amount) * 100)::numeric(6,2)
       else null end as margin_pct
from public.crm_deals d
join public.crm_deal_stages s on s.id = d.stage_id
where d.deleted_at is null
  and s.is_closed_won = true
  and d.closed_at is not null
group by d.workspace_id, date_trunc('day', d.closed_at)::date;

create unique index if not exists uq_mv_exec_revenue_daily
  on public.mv_exec_revenue_daily(workspace_id, day);

comment on materialized view public.mv_exec_revenue_daily is
  'QEP Command Center: daily closed-won revenue + margin. Feeds revenue_mtd, gross_margin_*, and KPI sparklines.';

-- ── 2. mv_exec_pipeline_stage_summary ──────────────────────────────────────
--
-- Open pipeline by stage with weighted dollars + average age. Drives
-- weighted_pipeline + forecast_confidence_score inputs.

drop materialized view if exists public.mv_exec_pipeline_stage_summary cascade;
create materialized view public.mv_exec_pipeline_stage_summary as
select
  d.workspace_id,
  s.id as stage_id,
  s.name as stage_name,
  s.probability as stage_probability,
  count(*)::int as open_deal_count,
  coalesce(sum(d.amount), 0)::numeric(14,2) as raw_pipeline,
  coalesce(sum(d.amount * (s.probability::numeric / 100.0)), 0)::numeric(14,2) as weighted_pipeline,
  coalesce(avg(extract(epoch from now() - d.created_at) / 86400)::numeric(8,1), 0) as avg_age_days,
  coalesce(avg(extract(epoch from now() - d.last_activity_at) / 86400)::numeric(8,1), 0) as avg_inactivity_days
from public.crm_deals d
join public.crm_deal_stages s on s.id = d.stage_id
where d.deleted_at is null
  and s.is_closed_won = false
  and s.is_closed_lost = false
group by d.workspace_id, s.id, s.name, s.probability;

create unique index if not exists uq_mv_exec_pipeline_stage_summary
  on public.mv_exec_pipeline_stage_summary(workspace_id, stage_id);

comment on materialized view public.mv_exec_pipeline_stage_summary is
  'QEP Command Center: open pipeline by stage with weighted dollars + activity recency. Feeds weighted_pipeline + forecast_confidence_score.';

-- ── 3. mv_exec_margin_daily ────────────────────────────────────────────────
--
-- Daily margin trend with deal count for sparkline + median. Distinct from
-- revenue_daily so we can compute margin separately when revenue is zero.

drop materialized view if exists public.mv_exec_margin_daily cascade;
create materialized view public.mv_exec_margin_daily as
select
  d.workspace_id,
  date_trunc('day', d.closed_at)::date as day,
  coalesce(sum(d.margin_amount), 0)::numeric(14,2) as margin_dollars,
  coalesce(percentile_cont(0.5) within group (order by d.margin_amount), 0)::numeric(14,2) as median_margin,
  count(*) filter (where d.margin_amount < 0)::int as negative_margin_deal_count
from public.crm_deals d
join public.crm_deal_stages s on s.id = d.stage_id
where d.deleted_at is null
  and s.is_closed_won = true
  and d.closed_at is not null
group by d.workspace_id, date_trunc('day', d.closed_at)::date;

create unique index if not exists uq_mv_exec_margin_daily
  on public.mv_exec_margin_daily(workspace_id, day);

comment on materialized view public.mv_exec_margin_daily is
  'QEP Command Center: daily margin trend with median + negative-margin deal count. Margin leakage signal.';

-- ── 4. Refresh helper RPC ──────────────────────────────────────────────────
--
-- Called by the snapshot runner. Falls back to non-concurrent refresh on
-- the first run when the unique index isn't yet populated.

create or replace function public.refresh_exec_materialized_views()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    refresh materialized view concurrently public.mv_exec_revenue_daily;
  exception when feature_not_supported or invalid_table_definition then
    refresh materialized view public.mv_exec_revenue_daily;
  end;
  begin
    refresh materialized view concurrently public.mv_exec_pipeline_stage_summary;
  exception when feature_not_supported or invalid_table_definition then
    refresh materialized view public.mv_exec_pipeline_stage_summary;
  end;
  begin
    refresh materialized view concurrently public.mv_exec_margin_daily;
  exception when feature_not_supported or invalid_table_definition then
    refresh materialized view public.mv_exec_margin_daily;
  end;
end;
$$;

revoke execute on function public.refresh_exec_materialized_views() from public;
grant execute on function public.refresh_exec_materialized_views() to service_role;

comment on function public.refresh_exec_materialized_views is
  'QEP Command Center: refresh all exec MVs. Called by analytics-snapshot-runner cron.';
