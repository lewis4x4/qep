-- ============================================================================
-- Migration 638: H11 service metrics dashboard
--
-- Adds owner-facing service metrics views with margin-by-work-order-type first.
-- Reuses H1 quote-line margin fields, H2 request_type, H4 hold-excluded
-- efficiency views, and existing TAT metrics/targets instead of recalculating
-- turnaround math in application code.
-- ============================================================================

create or replace function public.service_can_view_metrics()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or coalesce((select public.get_my_role())::text, '') in (
      'admin', 'manager', 'owner', 'service_writer', 'finance_admin'
    );
$$;

comment on function public.service_can_view_metrics() is
  'H11 metrics access helper. Owners/managers/admin/service writers/finance admins can view service metrics; technicians are intentionally excluded.';

revoke execute on function public.service_can_view_metrics() from public;
grant execute on function public.service_can_view_metrics() to authenticated, service_role;

create index if not exists idx_service_quotes_h11_workspace_job_status
  on public.service_quotes(workspace_id, job_id, status, updated_at desc);
comment on index public.idx_service_quotes_h11_workspace_job_status is
  'Supports H11 latest service quote selection for margin-by-work-order-type metrics.';

create index if not exists idx_service_jobs_h11_workspace_created_request_type
  on public.service_jobs(workspace_id, created_at, request_type)
  where deleted_at is null;
comment on index public.idx_service_jobs_h11_workspace_created_request_type is
  'Supports H11 service metrics windows by work-order type.';

create index if not exists idx_service_tat_metrics_h11_workspace_completed
  on public.service_tat_metrics(workspace_id, completed_at, segment_name)
  where completed_at is not null;
comment on index public.idx_service_tat_metrics_h11_workspace_completed is
  'Supports H11 cycle-time metrics using existing TAT rows.';

create index if not exists idx_service_labor_ledger_h11_warranty
  on public.service_labor_ledger(workspace_id, revenue_type, labor_date)
  where deleted_at is null;
comment on index public.idx_service_labor_ledger_h11_warranty is
  'Supports H11 warranty and labor recovery rollups from the service labor ledger.';

create index if not exists idx_service_billing_rows_h11_warranty
  on public.service_billing_rows(workspace_id, revenue_type, created_at)
  where deleted_at is null;
comment on index public.idx_service_billing_rows_h11_warranty is
  'Supports H11 warranty recovery rollups from service billing rows.';

-- ── #1 owner metric: margin by work-order type ------------------------------

create or replace view public.v_service_metrics_margin_by_request_type
  with (security_invoker = true) as
with scoped_jobs as (
  select
    j.id as service_job_id,
    j.workspace_id,
    j.request_type::text as request_type
  from public.service_jobs j
  where j.deleted_at is null
    and public.service_can_view_metrics()
    and (
      (select auth.role()) = 'service_role'
      or j.workspace_id = (select public.get_my_workspace())
    )
), ranked_quotes as (
  select
    q.id as quote_id,
    q.workspace_id,
    q.job_id as service_job_id,
    sj.request_type,
    q.status,
    q.version,
    q.total,
    q.margin_guardrail_status,
    q.created_at,
    q.updated_at,
    row_number() over (
      partition by q.workspace_id, q.job_id
      order by
        q.version desc,
        coalesce(q.outcome_at, q.updated_at, q.created_at) desc,
        case q.status
          when 'approved' then 0
          when 'sent' then 1
          when 'draft' then 2
          when 'expired' then 3
          when 'rejected' then 4
          else 5
        end
    ) as quote_rank
  from public.service_quotes q
  join scoped_jobs sj
    on sj.service_job_id = q.job_id
   and sj.workspace_id = q.workspace_id
  where q.status <> 'superseded'
), latest_quote_lines as (
  select
    rq.workspace_id,
    rq.service_job_id,
    rq.quote_id,
    rq.request_type,
    rq.status,
    rq.margin_guardrail_status,
    rq.created_at,
    l.id as line_id,
    l.line_type,
    coalesce(l.extended_price, l.quantity * l.unit_price, 0)::numeric as line_revenue,
    l.margin_cost_basis,
    l.margin_amount,
    l.margin_pct,
    l.margin_status,
    l.margin_floor_blocked
  from ranked_quotes rq
  left join public.service_quote_lines l
    on l.quote_id = rq.quote_id
   and l.workspace_id = rq.workspace_id
  where rq.quote_rank = 1
), rollup as (
  select
    workspace_id,
    request_type,
    count(distinct service_job_id)::integer as job_count,
    count(distinct quote_id)::integer as quote_count,
    count(line_id) filter (where line_type = 'labor' and margin_amount is not null)::integer as marginable_line_count,
    count(line_id) filter (where line_type = 'labor' and coalesce(margin_floor_blocked, false) = true)::integer as below_floor_line_count,
    count(line_id) filter (where line_type = 'labor' and margin_status = 'target_met')::integer as target_met_line_count,
    coalesce(sum(line_revenue) filter (where line_type = 'labor'), 0)::numeric as labor_revenue,
    coalesce(sum(margin_cost_basis) filter (where line_type = 'labor' and margin_amount is not null), 0)::numeric as margin_cost_basis,
    coalesce(sum(margin_amount) filter (where line_type = 'labor' and margin_amount is not null), 0)::numeric as margin_amount,
    max(created_at) as latest_quote_created_at
  from latest_quote_lines
  group by workspace_id, request_type
)
select
  workspace_id,
  request_type,
  job_count,
  quote_count,
  marginable_line_count,
  below_floor_line_count,
  target_met_line_count,
  round(labor_revenue, 2) as total_labor_revenue,
  round(margin_cost_basis, 2) as total_margin_cost_basis,
  round(margin_amount, 2) as total_margin_amount,
  case
    when labor_revenue <= 0 then null::numeric
    else round((margin_amount / nullif(labor_revenue, 0)) * 100, 2)
  end as margin_pct,
  latest_quote_created_at
from rollup;

comment on view public.v_service_metrics_margin_by_request_type is
  'H11 owner #1 metric. Aggregates the latest non-superseded service quote per work order by service_jobs.request_type, using H1 persisted service_quote_lines margin_amount/margin_cost_basis/margin_status fields.';

grant select on public.v_service_metrics_margin_by_request_type to authenticated, service_role;

-- ── Cycle-time rollup: reuses existing TAT metrics ---------------------------

create or replace view public.v_service_metrics_cycle_time_by_segment
  with (security_invoker = true) as
with scoped_tat as (
  select
    tm.workspace_id,
    tm.job_id,
    tm.segment_name,
    tm.target_duration_hours,
    tm.actual_duration_hours,
    tm.started_at,
    tm.completed_at,
    tm.is_machine_down
  from public.service_tat_metrics tm
  join public.service_jobs j
    on j.id = tm.job_id
   and j.workspace_id = tm.workspace_id
  where j.deleted_at is null
    and public.service_can_view_metrics()
    and (
      (select auth.role()) = 'service_role'
      or tm.workspace_id = (select public.get_my_workspace())
    )
)
select
  workspace_id,
  segment_name,
  count(*) filter (where completed_at is null)::integer as open_segment_count,
  count(*) filter (where completed_at is not null)::integer as completed_segment_count,
  round(avg(actual_duration_hours) filter (where completed_at is not null), 2) as avg_actual_duration_hours,
  round(avg(target_duration_hours) filter (where completed_at is not null), 2) as avg_target_duration_hours,
  round(
    (
      count(*) filter (
        where completed_at is not null
          and target_duration_hours is not null
          and actual_duration_hours is not null
          and actual_duration_hours <= target_duration_hours
      )::numeric
      / nullif(count(*) filter (where completed_at is not null and target_duration_hours is not null), 0)
    ) * 100,
    2
  ) as on_time_pct,
  max(completed_at) as latest_completed_at
from scoped_tat
where completed_at is null
   or started_at >= now() - interval '90 days'
group by workspace_id, segment_name;

comment on view public.v_service_metrics_cycle_time_by_segment is
  'H11 cycle-time dashboard rollup. Reuses service_tat_metrics rows and their target_duration_hours instead of reinventing turnaround math.';

grant select on public.v_service_metrics_cycle_time_by_segment to authenticated, service_role;

-- ── Owner watch summary ------------------------------------------------------

create or replace view public.v_service_metrics_owner_watch
  with (security_invoker = true) as
with scoped_jobs as (
  select j.*
  from public.service_jobs j
  where j.deleted_at is null
    and public.service_can_view_metrics()
    and (
      (select auth.role()) = 'service_role'
      or j.workspace_id = (select public.get_my_workspace())
    )
), recent_jobs as (
  select *
  from scoped_jobs
  where coalesce(opened_at, created_at) >= now() - interval '30 days'
), completed_tat as (
  select
    tm.workspace_id,
    count(*)::integer as completed_tat_count,
    round(avg(tm.actual_duration_hours), 2) as avg_cycle_time_hours,
    round(avg(tm.target_duration_hours), 2) as avg_cycle_target_hours,
    round(
      (
        count(*) filter (
          where tm.target_duration_hours is not null
            and tm.actual_duration_hours is not null
            and tm.actual_duration_hours <= tm.target_duration_hours
        )::numeric / nullif(count(*) filter (where tm.target_duration_hours is not null), 0)
      ) * 100,
      2
    ) as tat_on_time_pct
  from public.service_tat_metrics tm
  join scoped_jobs j
    on j.id = tm.job_id
   and j.workspace_id = tm.workspace_id
  where tm.completed_at >= now() - interval '30 days'
  group by tm.workspace_id
), efficiency as (
  select
    e.workspace_id,
    round(avg(e.efficiency_pct) filter (where e.efficiency_pct is not null), 2) as avg_technician_efficiency_pct,
    round(avg(e.recovery_pct) filter (where e.recovery_pct is not null), 2) as avg_labor_recovery_pct,
    round(sum(e.actual_hours), 2) as hold_excluded_actual_hours,
    round(sum(e.hold_hours_excluded), 2) as hold_hours_excluded
  from public.v_deal_genome_service_efficiency_analysis e
  join scoped_jobs j
    on j.id = e.service_job_id
   and j.workspace_id = e.workspace_id
  where coalesce(j.opened_at, j.created_at) >= now() - interval '30 days'
  group by e.workspace_id
), tech_recovery as (
  select
    tr.workspace_id,
    round(sum(tr.hours_charged), 2) as tech_hours_charged_30d,
    round(sum(tr.hours_worked), 2) as tech_hours_worked_30d,
    round((sum(tr.hours_charged) / nullif(sum(tr.hours_worked), 0)) * 100, 2) as tech_labor_recovery_pct_30d,
    round(sum(tr.hold_hours_excluded), 2) as tech_hold_hours_excluded_30d
  from public.v_tech_recovery_30d tr
  where public.service_can_view_metrics()
    and (
      (select auth.role()) = 'service_role'
      or tr.workspace_id = (select public.get_my_workspace())
    )
  group by tr.workspace_id
), warranty_rows as (
  select
    ll.workspace_id,
    sum(ll.labor_sale_cents)::bigint as revenue_cents,
    sum(ll.labor_cost_cents)::bigint as cost_cents
  from public.service_labor_ledger ll
  join scoped_jobs j
    on j.id = ll.service_job_id
   and j.workspace_id = ll.workspace_id
  where ll.deleted_at is null
    and coalesce(ll.revenue_type, j.revenue_type)::text = 'warranty'
    and coalesce(ll.labor_date::timestamptz, ll.created_at) >= now() - interval '30 days'
  group by ll.workspace_id
  union all
  select
    br.workspace_id,
    sum(br.extended_price_cents)::bigint as revenue_cents,
    sum(br.extended_cost_cents)::bigint as cost_cents
  from public.service_billing_rows br
  join scoped_jobs j
    on j.id = br.service_job_id
   and j.workspace_id = br.workspace_id
  where br.deleted_at is null
    and coalesce(br.revenue_type, j.revenue_type)::text = 'warranty'
    and br.created_at >= now() - interval '30 days'
  group by br.workspace_id
), warranty as (
  select
    workspace_id,
    coalesce(sum(revenue_cents), 0)::bigint as warranty_revenue_cents,
    coalesce(sum(cost_cents), 0)::bigint as warranty_cost_cents,
    round((sum(revenue_cents)::numeric / nullif(sum(cost_cents), 0)) * 100, 2) as warranty_recovery_pct
  from warranty_rows
  group by workspace_id
), first_touch_candidates as (
  select j.workspace_id, j.id as service_job_id, j.work_started_at as touched_at
  from scoped_jobs j
  where j.work_started_at is not null
  union all
  select tc.workspace_id, tc.service_job_id, tc.clocked_in_at as touched_at
  from public.service_timecards tc
  join scoped_jobs j
    on j.id = tc.service_job_id
   and j.workspace_id = tc.workspace_id
  union all
  select ll.workspace_id, ll.service_job_id, ll.started_at as touched_at
  from public.service_labor_ledger ll
  join scoped_jobs j
    on j.id = ll.service_job_id
   and j.workspace_id = ll.workspace_id
  where ll.deleted_at is null
    and ll.started_at is not null
), first_touch as (
  select
    workspace_id,
    service_job_id,
    min(touched_at) as first_touched_at
  from first_touch_candidates
  group by workspace_id, service_job_id
), first_touch_summary as (
  select
    rj.workspace_id,
    round(avg(extract(epoch from (ft.first_touched_at - coalesce(rj.opened_at, rj.created_at))) / 3600.0), 2) as avg_hours_to_first_touch,
    count(ft.service_job_id)::integer as first_touch_job_count
  from recent_jobs rj
  join first_touch ft
    on ft.service_job_id = rj.id
   and ft.workspace_id = rj.workspace_id
  where ft.first_touched_at >= coalesce(rj.opened_at, rj.created_at)
  group by rj.workspace_id
), open_hold_summary as (
  select
    h.workspace_id,
    count(*)::integer as open_hold_count,
    count(distinct h.service_job_id)::integer as open_jobs_on_hold_count
  from public.v_service_job_hold_durations h
  join scoped_jobs j
    on j.id = h.service_job_id
   and j.workspace_id = h.workspace_id
  where h.is_open = true
  group by h.workspace_id
), workspace_rollup as (
  select
    workspace_id,
    count(*)::integer as jobs_30d,
    count(*) filter (where request_type::text = 'comeback_rework')::integer as comeback_jobs_30d,
    round((count(*) filter (where request_type::text = 'comeback_rework')::numeric / nullif(count(*), 0)) * 100, 2) as comeback_rate_pct,
    count(*) filter (where shop_or_field = 'shop')::integer as shop_jobs_30d,
    count(*) filter (where shop_or_field = 'field')::integer as field_jobs_30d,
    round((count(*) filter (where shop_or_field = 'field')::numeric / nullif(count(*), 0)) * 100, 2) as field_mix_pct
  from recent_jobs
  group by workspace_id
), open_jobs as (
  select
    workspace_id,
    count(*)::integer as open_work_orders
  from scoped_jobs
  where closed_at is null
    and current_stage::text not in ('invoiced', 'paid_closed')
  group by workspace_id
), workspaces as (
  select workspace_id from scoped_jobs
  union select workspace_id from completed_tat
  union select workspace_id from tech_recovery
  union select workspace_id from warranty
)
select
  w.workspace_id,
  coalesce(wr.jobs_30d, 0) as jobs_30d,
  coalesce(wr.comeback_jobs_30d, 0) as comeback_jobs_30d,
  wr.comeback_rate_pct,
  ct.completed_tat_count,
  ct.avg_cycle_time_hours,
  ct.avg_cycle_target_hours,
  ct.tat_on_time_pct,
  ef.avg_technician_efficiency_pct,
  coalesce(tr.tech_labor_recovery_pct_30d, ef.avg_labor_recovery_pct) as labor_recovery_pct,
  tr.tech_hours_charged_30d,
  tr.tech_hours_worked_30d,
  coalesce(ef.hold_excluded_actual_hours, 0) as hold_excluded_actual_hours_30d,
  coalesce(tr.tech_hold_hours_excluded_30d, ef.hold_hours_excluded, 0) as hold_hours_excluded_30d,
  coalesce(wr.shop_jobs_30d, 0) as shop_jobs_30d,
  coalesce(wr.field_jobs_30d, 0) as field_jobs_30d,
  wr.field_mix_pct,
  coalesce(oj.open_work_orders, 0) as open_work_orders,
  coalesce(oh.open_hold_count, 0) as open_hold_count,
  coalesce(oh.open_jobs_on_hold_count, 0) as open_jobs_on_hold_count,
  coalesce(war.warranty_revenue_cents, 0) as warranty_revenue_cents,
  coalesce(war.warranty_cost_cents, 0) as warranty_cost_cents,
  war.warranty_recovery_pct,
  ft.avg_hours_to_first_touch,
  coalesce(ft.first_touch_job_count, 0) as first_touch_job_count,
  now() as computed_at
from workspaces w
left join workspace_rollup wr on wr.workspace_id = w.workspace_id
left join completed_tat ct on ct.workspace_id = w.workspace_id
left join efficiency ef on ef.workspace_id = w.workspace_id
left join tech_recovery tr on tr.workspace_id = w.workspace_id
left join warranty war on war.workspace_id = w.workspace_id
left join first_touch_summary ft on ft.workspace_id = w.workspace_id
left join open_hold_summary oh on oh.workspace_id = w.workspace_id
left join open_jobs oj on oj.workspace_id = w.workspace_id;

comment on view public.v_service_metrics_owner_watch is
  'H11 owner watch metrics: cycle time from service_tat_metrics, comeback rate from H2 request_type, technician efficiency/labor recovery from H4 hold-excluded views, warranty recovery from service ledgers, shop/field mix, open WOs/holds, and hours-to-first-touch.';

grant select on public.v_service_metrics_owner_watch to authenticated, service_role;

-- ── Open work-order operational breakdowns ----------------------------------

create or replace view public.v_service_metrics_open_wo_by_status
  with (security_invoker = true) as
select
  j.workspace_id,
  j.current_stage::text as current_stage,
  count(*)::integer as open_work_order_count,
  count(*) filter (
    where exists (
      select 1
      from public.service_job_blockers b
      where b.job_id = j.id
        and b.workspace_id = j.workspace_id
        and b.resolved_at is null
    )
  )::integer as with_open_hold_count,
  min(coalesce(j.opened_at, j.created_at)) as oldest_opened_at
from public.service_jobs j
where j.deleted_at is null
  and j.closed_at is null
  and j.current_stage::text not in ('invoiced', 'paid_closed')
  and public.service_can_view_metrics()
  and (
    (select auth.role()) = 'service_role'
    or j.workspace_id = (select public.get_my_workspace())
  )
group by j.workspace_id, j.current_stage;

comment on view public.v_service_metrics_open_wo_by_status is
  'H11 open work orders grouped by service stage/status, including how many are currently held.';

grant select on public.v_service_metrics_open_wo_by_status to authenticated, service_role;

create or replace view public.v_service_metrics_open_wo_by_hold_reason
  with (security_invoker = true) as
select
  h.workspace_id,
  h.hold_state,
  count(*)::integer as open_hold_count,
  count(distinct h.service_job_id)::integer as affected_work_order_count,
  round(avg(h.hold_duration_hours), 2) as avg_open_hold_hours,
  max(h.hold_started_at) as latest_hold_started_at
from public.v_service_job_hold_durations h
join public.service_jobs j
  on j.id = h.service_job_id
 and j.workspace_id = h.workspace_id
where h.is_open = true
  and j.deleted_at is null
  and j.closed_at is null
  and public.service_can_view_metrics()
  and (
    (select auth.role()) = 'service_role'
    or h.workspace_id = (select public.get_my_workspace())
  )
group by h.workspace_id, h.hold_state;

comment on view public.v_service_metrics_open_wo_by_hold_reason is
  'H11 open work orders grouped by H4 normalized hold reason/state.';

grant select on public.v_service_metrics_open_wo_by_hold_reason to authenticated, service_role;
