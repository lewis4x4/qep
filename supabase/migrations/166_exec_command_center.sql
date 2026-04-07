-- ============================================================================
-- Migration 166: Executive Command Center (Wave 6.10 — new in v2)
--
-- Owner / COO layer above all other waves. All views ship with
-- security_invoker = true so RLS on the underlying tables flows through.
--
-- Refreshed nightly by an exec-refresh cron (the actual cron registration
-- lives in the existing cron-worker pattern; this migration just creates
-- the views).
--
-- ar_credit_blocks materializations are deferred until Phase 2C ships
-- the table — the v2 spec lists exec_ar_blocks but the underlying table
-- does not yet exist in main.
-- ============================================================================

-- ── 1. Quote risk: open quotes by status with dollar weight ───────────────

create or replace view public.exec_quote_risk as
select
  q.workspace_id,
  q.status,
  count(*)::int as quote_count,
  coalesce(sum(q.net_total), 0)::numeric as total_dollars,
  count(*) filter (
    where q.expires_at is not null and q.expires_at < now() + interval '7 days'
  )::int as expiring_soon_count
from public.quote_packages q
where q.status in ('draft', 'sent', 'negotiating')
group by q.workspace_id, q.status;
alter view public.exec_quote_risk set (security_invoker = true);

comment on view public.exec_quote_risk is 'Open-quote pipeline weight + expiring-soon counter for the exec dashboard.';

-- ── 2. Service backlog ────────────────────────────────────────────────────

create or replace view public.exec_service_backlog as
select
  sj.workspace_id,
  count(*) filter (
    where sj.scheduled_end_at < now() and sj.current_stage::text not in ('closed', 'invoiced', 'cancelled')
  )::int as overdue,
  count(*) filter (where sj.current_stage::text = 'in_progress')::int as in_progress,
  count(*) filter (where sj.current_stage::text = 'parts_waiting')::int as parts_waiting,
  count(*) filter (where sj.current_stage::text in ('closed', 'invoiced'))::int as closed_recent
from public.service_jobs sj
group by sj.workspace_id;
alter view public.exec_service_backlog set (security_invoker = true);

-- ── 3. Health score movers (top deltas in last 30 days) ──────────────────
--
-- customer_profiles_extended has no workspace_id column (it's a DGE-scoped
-- table). Resolve workspace via the linked crm_contacts row when available,
-- falling back to NULL so the view still returns unscoped profiles. Drop
-- first because prior versions of this view had a different column set and
-- CREATE OR REPLACE VIEW cannot rename columns (SQLSTATE 42P16).

drop view if exists public.exec_health_movers;

create view public.exec_health_movers as
select
  (select c.workspace_id
   from public.crm_contacts c
   where c.dge_customer_profile_id = cpe.id
   limit 1) as workspace_id,
  cpe.id as customer_profile_id,
  cpe.health_score,
  cpe.health_score_components,
  cpe.health_score_updated_at
from public.customer_profiles_extended cpe
where cpe.health_score_updated_at > now() - interval '30 days';
alter view public.exec_health_movers set (security_invoker = true);

-- ── 4. Branch comparison summary ─────────────────────────────────────────

create or replace view public.exec_branch_comparison as
select
  workspace_id,
  branch_id,
  sum(overdue_count)::int as overdue,
  sum(active_count)::int as active,
  sum(closed_count)::int as closed
from public.service_dashboard_rollup
group by workspace_id, branch_id;
alter view public.exec_branch_comparison set (security_invoker = true);

-- ── 5. Exception inbox summary ───────────────────────────────────────────

create or replace view public.exec_exception_summary as
select
  workspace_id,
  source,
  severity,
  count(*)::int as open_count,
  max(created_at) as latest
from public.exception_queue
where status = 'open'
group by workspace_id, source, severity;
alter view public.exec_exception_summary set (security_invoker = true);

-- ── 6. Data quality summary ──────────────────────────────────────────────

create or replace view public.exec_data_quality_summary as
select
  workspace_id,
  issue_class,
  count(*)::int as open_count
from public.admin_data_issues
where status = 'open'
group by workspace_id, issue_class;
alter view public.exec_data_quality_summary set (security_invoker = true);
