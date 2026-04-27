-- 503_wave4_service_reporting_views.sql
--
-- Wave 4 service WIP, last-activity, technician recovery, and capacity views.
-- Sources:
--   docs/intellidealer-gap-audit/phase-4-service.yaml#work_order.current_value
--   docs/intellidealer-gap-audit/phase-4-service.yaml#wip.aging_buckets
--   docs/intellidealer-gap-audit/phase-4-service.yaml#work_order.last_activity
--   docs/intellidealer-gap-audit/phase-4-service.yaml#tech.recovery_pct
--   docs/intellidealer-gap-audit/phase-4-service.yaml#intellitech.schedule_grid
--
-- Rollback notes:
--   drop view if exists public.v_tech_daily_capacity;
--   drop view if exists public.v_tech_recovery_30d;
--   drop view if exists public.v_service_jobs_last_activity;
--   drop materialized view if exists public.mv_service_wip_aging;
--   drop materialized view if exists public.mv_service_jobs_wip;

create or replace view public.v_service_jobs_last_activity
  with (security_invoker = true) as
select
  j.id as service_job_id,
  j.workspace_id,
  greatest(
    j.updated_at,
    max(tc.clocked_in_at),
    max(tc.clocked_out_at),
    max(spa.created_at),
    max(spa.completed_at),
    max(sjs.last_activity_at)
  ) as last_activity_at
from public.service_jobs j
left join public.service_timecards tc on tc.service_job_id = j.id
left join public.service_parts_actions spa on spa.job_id = j.id
left join public.service_job_segments sjs on sjs.service_job_id = j.id and sjs.deleted_at is null
where j.deleted_at is null
group by j.id, j.workspace_id, j.updated_at;

comment on view public.v_service_jobs_last_activity is
  'Wave 4 IntelliDealer computed last activity per service job from timecards, parts actions, segments, and job updates.';

drop materialized view if exists public.mv_service_wip_aging;
drop materialized view if exists public.mv_service_jobs_wip;

create materialized view public.mv_service_jobs_wip as
with labor as (
  select
    j.id as service_job_id,
    coalesce(sum(
      coalesce(tc.hours, 0)::numeric
      * coalesce(tp.work_order_rate_per_hour_cents, lp.rate_per_hour_cents, 0)::numeric
    ), 0)::bigint as labor_wip_cents,
    min(tc.clocked_in_at) as first_labor_at,
    max(tc.clocked_out_at) as last_labor_at
  from public.service_jobs j
  left join public.service_timecards tc on tc.service_job_id = j.id
  left join public.technician_profiles tp
    on tp.user_id = tc.technician_id
   and tp.workspace_id = tc.workspace_id
  left join public.service_job_segments sjs
    on sjs.id = tc.segment_id
   and sjs.deleted_at is null
  left join lateral (
    select lpm.rate_per_hour_cents
    from public.labor_pricing_matrix lpm
    where lpm.workspace_id = j.workspace_id
      and (lpm.expiration_date is null or lpm.expiration_date >= current_date)
      and (lpm.effective_date <= current_date)
      and (
        (sjs.job_code_id is not null and lpm.job_code_id = sjs.job_code_id)
        or (sjs.rate_code is not null and lpm.rate_code = sjs.rate_code)
      )
    order by lpm.effective_date desc
    limit 1
  ) lp on true
  where j.deleted_at is null
  group by j.id
), parts as (
  select
    spr.job_id as service_job_id,
    coalesce(sum(
      spr.quantity::numeric * round(coalesce(spr.unit_cost, 0) * 100)::numeric
    ), 0)::bigint as parts_wip_cents,
    min(spr.created_at) as first_parts_at,
    max(spr.updated_at) as last_parts_at
  from public.service_parts_requirements spr
  where spr.status not in ('cancelled', 'returned')
  group by spr.job_id
)
select
  j.id,
  j.workspace_id,
  j.branch_id,
  j.customer_id,
  j.wo_number,
  coalesce(l.labor_wip_cents, 0) as labor_wip_cents,
  coalesce(p.parts_wip_cents, 0) as parts_wip_cents,
  (coalesce(l.labor_wip_cents, 0) + coalesce(p.parts_wip_cents, 0)) as wip_value_cents,
  least(
    j.created_at,
    coalesce(l.first_labor_at, j.created_at),
    coalesce(p.first_parts_at, j.created_at)
  ) as earliest_activity_at,
  greatest(
    j.updated_at,
    coalesce(l.last_labor_at, j.updated_at),
    coalesce(p.last_parts_at, j.updated_at)
  ) as last_activity_at
from public.service_jobs j
left join labor l on l.service_job_id = j.id
left join parts p on p.service_job_id = j.id
where j.deleted_at is null;

comment on materialized view public.mv_service_jobs_wip is
  'Wave 4 IntelliDealer WIP value per open/closed service job. Labor uses timecards with technician/profile or matrix rates; parts use service_parts_requirements quantity × unit_cost because service_parts_actions has no quantity/cost columns.';

create unique index mv_service_jobs_wip_pk
  on public.mv_service_jobs_wip (id);
comment on index public.mv_service_jobs_wip_pk is
  'Purpose: unique key required for concurrent Wave 4 WIP refreshes.';

create index mv_service_jobs_wip_workspace_value_idx
  on public.mv_service_jobs_wip (workspace_id, wip_value_cents desc);
comment on index public.mv_service_jobs_wip_workspace_value_idx is
  'Purpose: open Work Order WIP listing sorted by WIP exposure.';

create materialized view public.mv_service_wip_aging as
select
  j.workspace_id,
  j.branch_id,
  case
    when current_date - coalesce(wip.earliest_activity_at, j.created_at)::date <= 30 then 'current'
    when current_date - coalesce(wip.earliest_activity_at, j.created_at)::date <= 60 then 'd31_60'
    when current_date - coalesce(wip.earliest_activity_at, j.created_at)::date <= 90 then 'd61_90'
    when current_date - coalesce(wip.earliest_activity_at, j.created_at)::date <= 120 then 'd91_120'
    else 'over_120'
  end as bucket,
  count(*)::integer as wo_count,
  coalesce(sum(wip.wip_value_cents), 0)::bigint as total_wip_cents
from public.service_jobs j
join public.mv_service_jobs_wip wip on wip.id = j.id
where j.deleted_at is null
  and j.closed_at is null
group by j.workspace_id, j.branch_id, bucket;

comment on materialized view public.mv_service_wip_aging is
  'Wave 4 IntelliDealer WIP aging buckets: current, d31_60, d61_90, d91_120, over_120. Branch id follows existing service_jobs.branch_id text contract.';

create unique index mv_service_wip_aging_pk
  on public.mv_service_wip_aging (workspace_id, branch_id, bucket);
comment on index public.mv_service_wip_aging_pk is
  'Purpose: unique key required for concurrent Wave 4 WIP aging refreshes and branch-bucket lookups.';

create or replace view public.v_tech_recovery_30d
  with (security_invoker = true) as
select
  tp.workspace_id,
  tp.user_id as technician_id,
  coalesce(sum(sjs.estimated_hours), 0)::numeric as hours_charged,
  coalesce(sum(tc.hours), 0)::numeric as hours_worked,
  case
    when coalesce(sum(tc.hours), 0) = 0 then null::numeric
    else round((coalesce(sum(sjs.estimated_hours), 0)::numeric / nullif(sum(tc.hours), 0)::numeric) * 100, 2)
  end as recovery_pct
from public.technician_profiles tp
left join public.service_timecards tc
  on tc.technician_id = tp.user_id
 and tc.workspace_id = tp.workspace_id
 and tc.clocked_in_at >= now() - interval '30 days'
left join public.service_job_segments sjs
  on sjs.id = tc.segment_id
 and sjs.deleted_at is null
group by tp.workspace_id, tp.user_id;

comment on view public.v_tech_recovery_30d is
  'Wave 4 IntelliDealer technician recovery percent over the trailing 30 days from segment estimated hours and timecard actual hours.';

create or replace view public.v_tech_daily_capacity
  with (security_invoker = true) as
select
  tp.workspace_id,
  tp.user_id as technician_id,
  d.day::date as day,
  coalesce((tp.weekly_schedule ->> lower(to_char(d.day, 'Dy')))::numeric, 0)::numeric as available_hours,
  coalesce(sum(sjs.estimated_hours), 0)::numeric as scheduled_hours,
  coalesce(
    jsonb_agg(
      distinct jsonb_build_object(
        'service_job_id', j.id,
        'wo_number', j.wo_number,
        'customer_id', j.customer_id,
        'customer', c.name,
        'segment_id', sjs.id,
        'segment_number', sjs.segment_number,
        'type', sjs.type,
        'estimated_hours', sjs.estimated_hours,
        'scheduled_start_at', coalesce(sjs.scheduled_start_at, j.scheduled_start_at)
      )
    ) filter (where j.id is not null),
    '[]'::jsonb
  ) as scheduled_jobs
from public.technician_profiles tp
cross join lateral generate_series(
  current_date - 7,
  current_date + 7,
  interval '1 day'
) as d(day)
left join public.service_jobs j
  on j.workspace_id = tp.workspace_id
 and j.deleted_at is null
 and j.closed_at is null
 and j.technician_id = tp.user_id
 and j.scheduled_start_at::date = d.day::date
left join public.service_job_segments sjs
  on sjs.service_job_id = j.id
 and sjs.deleted_at is null
left join public.qrm_companies c on c.id = j.customer_id
group by tp.workspace_id, tp.user_id, d.day, tp.weekly_schedule;

comment on view public.v_tech_daily_capacity is
  'Wave 4 IntelliTech capacity grid for +/- 7 days. Uses technician_profiles.weekly_schedule and scheduled service jobs/segments.';
