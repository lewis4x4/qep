-- 529_intellidealer_service_deal_genome_non_must.sql
--
-- Non-must IntelliDealer service / Deal Genome cleanup.
-- Additive/idempotent only: no raw IntelliDealer files, no COL artifacts.
-- Sources:
--   docs/intellidealer-gap-audit/phase-4-service.yaml#wo_listing.outstanding_pos_filter
--   docs/intellidealer-gap-audit/phase-4-service.yaml#wo_listing.segment_status_filter
--   docs/intellidealer-gap-audit/phase-4-service.yaml#wo_listing.include_all_segments
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_quote_gain.select_technician
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_quote_gain.select_inside_outside_shift
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_quote_gain.col_rework_hours
--   docs/intellidealer-gap-audit/phase-5-deal-genome.yaml#analysis_payroll.summary_by
--
-- Rollback notes:
--   drop view if exists public.v_deal_genome_service_payroll_hours_analysis;
--   drop view if exists public.v_deal_genome_service_quote_gain_loss_by_technician;
--   drop view if exists public.v_service_open_work_order_listing;
--   drop index if exists public.idx_service_parts_actions_open_order;
--   drop index if exists public.idx_service_labor_ledger_rework;
--   alter table public.service_labor_ledger drop constraint if exists service_labor_ledger_rework_of_labor_id_fkey;
--   alter table public.service_labor_ledger drop column if exists rework_of_labor_id;
--   alter table public.service_labor_ledger drop column if exists is_rework;

alter table public.service_labor_ledger
  add column if not exists is_rework boolean not null default false,
  add column if not exists rework_of_labor_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'service_labor_ledger_rework_of_labor_id_fkey'
      and conrelid = 'public.service_labor_ledger'::regclass
  ) then
    alter table public.service_labor_ledger
      add constraint service_labor_ledger_rework_of_labor_id_fkey
      foreign key (rework_of_labor_id)
      references public.service_labor_ledger(id)
      on delete set null;
  end if;
end $$;

comment on column public.service_labor_ledger.is_rework is
  'IntelliDealer non-must cleanup: marks labor rows that represent rework / redo hours for efficiency and quote gain-loss reporting.';
comment on column public.service_labor_ledger.rework_of_labor_id is
  'Optional link to the original labor ledger row being corrected or reworked.';

create index if not exists idx_service_labor_ledger_rework
  on public.service_labor_ledger (workspace_id, service_job_id, labor_date)
  where is_rework = true and deleted_at is null;
comment on index public.idx_service_labor_ledger_rework is
  'Purpose: IntelliDealer Efficiency / Quote Gain-Loss rework-hours rollups.';

create index if not exists idx_service_parts_actions_open_order
  on public.service_parts_actions (workspace_id, job_id, requirement_id)
  where action_type = 'order'
    and completed_at is null
    and superseded_at is null;
comment on index public.idx_service_parts_actions_open_order is
  'Purpose: Open Work Orders listing filter for service jobs blocked on outstanding vendor POs.';

create or replace view public.v_deal_genome_service_efficiency_analysis
  with (security_invoker = true) as
with ledger as (
  select
    service_job_id,
    service_job_segment_id,
    technician_id,
    employee_id,
    sum(actual_hours)::numeric as actual_hours,
    sum(billable_hours)::numeric as billable_hours,
    sum(standard_hours)::numeric as ledger_standard_hours,
    sum(actual_hours) filter (where is_rework = true)::numeric as rework_hours,
    sum(labor_sale_cents)::bigint as labor_sale_cents,
    sum(labor_cost_cents)::bigint as labor_cost_cents
  from public.service_labor_ledger
  where deleted_at is null
  group by service_job_id, service_job_segment_id, technician_id, employee_id
), timecards as (
  select
    service_job_id,
    segment_id as service_job_segment_id,
    technician_id,
    sum(hours)::numeric as timecard_hours
  from public.service_timecards
  group by service_job_id, segment_id, technician_id
)
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  s.id as service_job_segment_id,
  s.segment_number,
  coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id) as technician_id,
  l.employee_id,
  coalesce(s.revenue_type, j.revenue_type) as revenue_type,
  coalesce(s.billing_basis, j.billing_basis) as billing_basis,
  coalesce(s.estimated_hours, j.standard_hours, 0)::numeric as estimated_hours,
  coalesce(s.standard_hours, l.ledger_standard_hours, j.standard_hours, s.estimated_hours, 0)::numeric as standard_hours,
  coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0)::numeric as actual_hours,
  coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric as billable_hours,
  case
    when coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0) = 0 then null::numeric
    else round((coalesce(s.standard_hours, l.ledger_standard_hours, j.standard_hours, s.estimated_hours, 0)::numeric / nullif(coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0), 0)::numeric) * 100, 2)
  end as efficiency_pct,
  case
    when coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0) = 0 then null::numeric
    else round((coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric / nullif(coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0), 0)::numeric) * 100, 2)
  end as recovery_pct,
  coalesce(l.labor_sale_cents, 0)::bigint as labor_sale_cents,
  coalesce(l.labor_cost_cents, 0)::bigint as labor_cost_cents,
  coalesce(l.rework_hours, 0)::numeric as rework_hours,
  tp.inside_outside_shift,
  tp.shop_class,
  emp.shift_code
from public.service_jobs j
left join public.service_job_segments s
  on s.service_job_id = j.id
 and s.deleted_at is null
left join ledger l
  on l.service_job_id = j.id
 and (
   l.service_job_segment_id = s.id
   or (l.service_job_segment_id is null and s.id is null)
 )
left join timecards tc
  on tc.service_job_id = j.id
 and (
   tc.service_job_segment_id = s.id
   or (tc.service_job_segment_id is null and s.id is null)
 )
left join public.technician_profiles tp
  on tp.workspace_id = j.workspace_id
 and tp.user_id = coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
left join lateral (
  select e.shift_code
  from public.employees e
  where e.workspace_id = j.workspace_id
    and e.deleted_at is null
    and (
      e.id = l.employee_id
      or e.profile_id = coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
    )
  order by case when e.id = l.employee_id then 0 else 1 end
  limit 1
) emp on true
where j.deleted_at is null;

comment on view public.v_deal_genome_service_efficiency_analysis is
  'Phase 5 Deal Genome Efficiency Analysis view. Compares estimated/standard/billable hours to actual labor, and includes rework hours plus technician inside/outside/shift filters.';

create or replace view public.v_deal_genome_service_quote_gain_loss_by_technician
  with (security_invoker = true) as
select
  q.workspace_id,
  q.service_quote_id,
  q.quote_number,
  q.service_job_id,
  q.wo_number,
  q.company_id,
  q.branch_id,
  q.assigned_salesperson_id,
  q.status,
  q.quote_outcome,
  q.quote_result_reason,
  q.sent_at,
  q.expires_at,
  q.outcome_at,
  q.quoted_labor_cents,
  q.quoted_parts_cents,
  q.quoted_other_cents,
  q.quoted_total_cents,
  q.converted_invoice_total_cents,
  q.quote_to_invoice_pct,
  e.service_job_segment_id,
  e.segment_number,
  e.technician_id,
  e.employee_id,
  e.inside_outside_shift,
  e.shop_class,
  e.shift_code,
  e.standard_hours,
  e.actual_hours,
  (coalesce(e.standard_hours, 0) - coalesce(e.actual_hours, 0))::numeric as gain_loss_hours,
  coalesce(e.rework_hours, 0)::numeric as rework_hours
from public.v_deal_genome_service_quote_gain_loss q
left join public.v_deal_genome_service_efficiency_analysis e
  on e.service_job_id = q.service_job_id;

comment on view public.v_deal_genome_service_quote_gain_loss_by_technician is
  'IntelliDealer non-must cleanup view: quote gain/loss rows enriched with service technician, segment, inside/outside/shift, standard/actual/gain-loss, and rework hours.';

create or replace view public.v_deal_genome_service_payroll_hours_analysis
  with (security_invoker = true) as
select
  pe.workspace_id,
  pe.id as payroll_entry_id,
  pe.employee_id,
  e.profile_id as technician_id,
  e.display_name as employee_name,
  pe.branch_id,
  pe.labor_date,
  pe.billing_run_date,
  ppc.id as premium_code_id,
  ppc.code as premium_code,
  ppc.description as premium_description,
  ppc.multiplier,
  pe.hours,
  pe.source_module,
  pe.source_record_id
from public.qrm_payroll_entries pe
join public.qrm_payroll_premium_codes ppc
  on ppc.id = pe.premium_code_id
left join public.employees e
  on e.id = pe.employee_id
where pe.deleted_at is null
  and ppc.deleted_at is null;

comment on view public.v_deal_genome_service_payroll_hours_analysis is
  'IntelliDealer non-must cleanup view: payroll hours detail that can be summarized by premium code or labor date.';

create or replace view public.v_service_open_work_order_listing
  with (security_invoker = true) as
with outstanding_pos as (
  select
    spr.job_id as service_job_id,
    count(distinct spr.id)::integer as outstanding_po_count
  from public.service_parts_requirements spr
  where spr.status = 'ordering'
    or exists (
      select 1
      from public.service_parts_actions spa
      where spa.requirement_id = spr.id
        and spa.job_id = spr.job_id
        and spa.action_type = 'order'
        and spa.completed_at is null
        and spa.superseded_at is null
    )
  group by spr.job_id
)
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  j.current_stage,
  j.billed_status,
  j.priority,
  j.technician_id as header_technician_id,
  j.fulfillment_run_id,
  pfr.status as fulfillment_status,
  s.id as service_job_segment_id,
  s.segment_number,
  s.status as segment_status,
  coalesce(op.outstanding_po_count, 0)::integer as outstanding_po_count,
  (coalesce(op.outstanding_po_count, 0) > 0) as has_outstanding_pos,
  coalesce(vla.last_activity_at, j.updated_at) as last_activity_at,
  j.created_at,
  j.updated_at
from public.service_jobs j
left join public.parts_fulfillment_runs pfr
  on pfr.id = j.fulfillment_run_id
left join public.service_job_segments s
  on s.service_job_id = j.id
 and s.deleted_at is null
left join outstanding_pos op
  on op.service_job_id = j.id
left join public.v_service_jobs_last_activity vla
  on vla.service_job_id = j.id
where j.deleted_at is null
  and j.closed_at is null;

comment on view public.v_service_open_work_order_listing is
  'IntelliDealer non-must cleanup view for Open Work Orders listing filters: outstanding POs, segment status, and segment-expanded rows.';
