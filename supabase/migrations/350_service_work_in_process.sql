-- ============================================================================
-- Migration 350: Service Work In Process
--
-- Rollback notes:
--   1. Drop view public.service_work_in_process_summary.
--   2. Restore public.service_dashboard_rollup from migration 161 if needed.
-- ============================================================================

create or replace view public.service_dashboard_rollup as
with bucketed as (
  select
    sj.workspace_id,
    sj.branch_id,
    case
      when sj.closed_at is null
        and sj.scheduled_end_at is not null
        and sj.scheduled_end_at < now()
        and sj.current_stage::text not in ('invoiced', 'paid_closed')
        then 'overdue'
      when sj.closed_at is null
        and sj.current_stage::text in (
          'request_received',
          'triaging',
          'diagnosis_selected',
          'quote_drafted',
          'quote_sent',
          'approved'
        )
        then 'pending'
      when sj.closed_at is null
        and sj.current_stage::text in (
          'parts_pending',
          'parts_staged',
          'haul_scheduled',
          'scheduled',
          'in_progress',
          'blocked_waiting',
          'quality_check',
          'ready_for_pickup',
          'invoice_ready'
        )
        then 'active'
      when sj.closed_at is not null
        or sj.current_stage::text in ('invoiced', 'paid_closed')
        then 'closed'
      else 'other'
    end as bucket,
    sj.id
  from public.service_jobs sj
  where sj.deleted_at is null
)
select
  workspace_id,
  branch_id,
  count(*) filter (where bucket = 'overdue') as overdue_count,
  count(*) filter (where bucket = 'pending') as pending_count,
  count(*) filter (where bucket = 'active') as active_count,
  count(*) filter (where bucket = 'closed') as closed_count,
  count(*) as total_count
from bucketed
group by workspace_id, branch_id;

alter view public.service_dashboard_rollup set (security_invoker = true);

comment on view public.service_dashboard_rollup is
  'Bucket aggregates for the Service Dashboard using the current service stage enum set. security_invoker=true honors caller RLS on service_jobs.';

create or replace view public.service_work_in_process_summary as
with open_jobs as (
  select
    sj.id,
    sj.workspace_id,
    sj.branch_id,
    sj.current_stage,
    sj.created_at,
    coalesce(sj.current_stage_entered_at, sj.created_at) as stage_started_at,
    coalesce(sj.invoice_total, sj.quote_total, 0)::numeric(12, 2) as current_value,
    case
      when sj.status_flags @> array['internal']::public.service_status_flag[] then 'internal'
      when sj.status_flags @> array['warranty_recall']::public.service_status_flag[] then 'warranty'
      else 'customer'
    end as billing_status
  from public.service_jobs sj
  where sj.deleted_at is null
    and sj.closed_at is null
    and sj.current_stage::text not in ('invoiced', 'paid_closed')
),
bucketed as (
  select
    workspace_id,
    branch_id,
    billing_status,
    case
      when now() - created_at < interval '31 days' then 'current'
      when now() - created_at < interval '61 days' then '31_60'
      when now() - created_at < interval '91 days' then '61_90'
      when now() - created_at < interval '121 days' then '91_120'
      else 'over_120'
    end as aging_bucket,
    current_value,
    extract(epoch from (now() - stage_started_at)) / 3600.0 as stage_age_hours
  from open_jobs
)
select
  workspace_id,
  branch_id,
  billing_status,
  aging_bucket,
  count(*)::integer as job_count,
  round(coalesce(sum(current_value), 0)::numeric, 2) as total_value,
  round(coalesce(avg(stage_age_hours), 0)::numeric, 2) as avg_stage_hours
from bucketed
group by workspace_id, branch_id, billing_status, aging_bucket;

alter view public.service_work_in_process_summary set (security_invoker = true);

comment on view public.service_work_in_process_summary is
  'Aging-bucket WIP rollup for open service jobs. Uses current service stages and billing_status derived from status_flags.';
