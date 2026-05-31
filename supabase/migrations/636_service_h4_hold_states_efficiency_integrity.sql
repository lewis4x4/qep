-- ============================================================================
-- Migration 636: H4 hold states & efficiency integrity
--
-- Replaces free-text service blocker reasons with five owner-named hold states
-- and excludes hold duration from technician efficiency/recovery denominators.
--
-- H4 states:
--   waiting_on_parts_sublet
--   waiting_on_approval
--   waiting_on_customer
--   waiting_on_warranty_authorization
--   waiting_on_payment
-- ============================================================================

create or replace function public.service_normalize_hold_state(p_blocker_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select lower(regexp_replace(trim(coalesce(p_blocker_type, '')), '[^a-z0-9]+', '_', 'g')) as value
  )
  select case
    when value in (
      'waiting_on_parts_sublet',
      'waiting_on_approval',
      'waiting_on_customer',
      'waiting_on_warranty_authorization',
      'waiting_on_payment'
    ) then value
    when value in (
      'waiting_on_parts',
      'waiting_parts',
      'parts_shortage',
      'parts_pending',
      'waiting_on_sublet',
      'waiting_sublet',
      'sublet',
      'waiting_vendor',
      'vendor_wait',
      'vendor',
      'po_wait',
      'waiting_po'
    ) or value like '%part%'
      or value like '%sublet%'
      or value like '%vendor%'
      or value like '%purchase_order%'
      or value like 'po\_%' escape '\'
      then 'waiting_on_parts_sublet'
    when value in (
      'waiting_on_warranty_authorization',
      'waiting_warranty_authorization',
      'warranty_authorization',
      'warranty_auth',
      'waiting_warranty',
      'warranty',
      'oem_authorization',
      'manufacturer_authorization'
    ) or value like '%warranty%'
      or value like '%oem%'
      or value like '%manufacturer%'
      then 'waiting_on_warranty_authorization'
    when value in (
      'waiting_on_approval',
      'waiting_approval',
      'approval',
      'authorization',
      'waiting_authorization',
      'estimate_approval',
      'customer_approval',
      'waiting_customer_approval'
    ) or value like '%approval%'
      or value like '%authorization%'
      or value like '%authorisation%'
      or value like '%estimate%'
      then 'waiting_on_approval'
    when value in (
      'waiting_on_customer',
      'waiting_customer',
      'customer',
      'client',
      'waiting_client',
      'waiting_on_client',
      'other'
    ) or value like '%customer%'
      or value like '%client%'
      then 'waiting_on_customer'
    when value in (
      'waiting_on_payment',
      'waiting_payment',
      'payment',
      'deposit',
      'invoice_payment',
      'ar_hold',
      'accounts_receivable'
    ) or value like '%payment%'
      or value like '%deposit%'
      or value like '%invoice%'
      or value like '%receivable%'
      or value like '%billing%'
      then 'waiting_on_payment'
    else null
  end
  from normalized;
$$;

comment on function public.service_normalize_hold_state(text) is
  'H4 helper. Normalizes legacy/free-text service blocker labels into one of the five named hold states; returns null for invalid new free text.';

create or replace function public.service_job_blockers_apply_hold_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original text := new.blocker_type;
  v_normalized text;
begin
  v_normalized := public.service_normalize_hold_state(new.blocker_type);

  if v_normalized is null then
    return new;
  end if;

  if new.blocker_type is distinct from v_normalized then
    new.blocker_type := v_normalized;
    new.description := nullif(trim(concat(
      '[Legacy blocker type: ',
      coalesce(v_original, ''),
      '] ',
      coalesce(new.description, '')
    )), '');
  end if;

  return new;
end $$;

comment on function public.service_job_blockers_apply_hold_state() is
  'H4 trigger helper. Preserves legacy blocker wording in description while storing only named hold states.';

alter table public.service_job_blockers
  add column if not exists hold_duration_seconds bigint generated always as (
    case
      when resolved_at is null then null::bigint
      else greatest(0::bigint, floor(extract(epoch from (resolved_at - created_at)))::bigint)
    end
  ) stored;

comment on column public.service_job_blockers.blocker_type is
  'H4 named hold state only: waiting_on_parts_sublet, waiting_on_approval, waiting_on_customer, waiting_on_warranty_authorization, waiting_on_payment.';
comment on column public.service_job_blockers.hold_duration_seconds is
  'H4 resolved-hold duration in seconds from created_at to resolved_at. Open-hold elapsed duration is exposed by v_service_job_hold_durations.';

with mapped as (
  select
    id,
    blocker_type as original_blocker_type,
    coalesce(public.service_normalize_hold_state(blocker_type), 'waiting_on_customer') as normalized_blocker_type
  from public.service_job_blockers
  where blocker_type is distinct from coalesce(public.service_normalize_hold_state(blocker_type), 'waiting_on_customer')
)
update public.service_job_blockers b
set
  blocker_type = mapped.normalized_blocker_type,
  description = nullif(trim(concat(
    '[Legacy blocker type: ',
    mapped.original_blocker_type,
    '] ',
    coalesce(b.description, '')
  )), '')
from mapped
where b.id = mapped.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_job_blockers_hold_state_chk') then
    alter table public.service_job_blockers
      add constraint service_job_blockers_hold_state_chk
      check (blocker_type in (
        'waiting_on_parts_sublet',
        'waiting_on_approval',
        'waiting_on_customer',
        'waiting_on_warranty_authorization',
        'waiting_on_payment'
      )) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_blockers_resolved_after_created_chk') then
    alter table public.service_job_blockers
      add constraint service_job_blockers_resolved_after_created_chk
      check (resolved_at is null or resolved_at >= created_at) not valid;
  end if;
end $$;

drop trigger if exists service_job_blockers_apply_hold_state on public.service_job_blockers;
create trigger service_job_blockers_apply_hold_state
  before insert or update of blocker_type, description on public.service_job_blockers
  for each row execute function public.service_job_blockers_apply_hold_state();

create index if not exists idx_service_job_blockers_hold_state_open
  on public.service_job_blockers(workspace_id, blocker_type, job_id)
  where resolved_at is null;
comment on index public.idx_service_job_blockers_hold_state_open is
  'Supports H4 active-hold queues and diagnostics by named hold state.';

create or replace view public.v_service_job_hold_durations
  with (security_invoker = true) as
select
  b.workspace_id,
  b.id as blocker_id,
  b.job_id as service_job_id,
  b.blocker_type as hold_state,
  b.description,
  b.created_by,
  b.resolved_by,
  b.created_at as hold_started_at,
  b.resolved_at as hold_resolved_at,
  (b.resolved_at is null) as is_open,
  round(
    (
      extract(epoch from (greatest(coalesce(b.resolved_at, now()), b.created_at) - b.created_at)) / 3600.0
    )::numeric,
    4
  ) as hold_duration_hours,
  b.hold_duration_seconds
from public.service_job_blockers b
where b.blocker_type in (
  'waiting_on_parts_sublet',
  'waiting_on_approval',
  'waiting_on_customer',
  'waiting_on_warranty_authorization',
  'waiting_on_payment'
);

comment on view public.v_service_job_hold_durations is
  'H4 per-hold duration view. Uses created_at as hold open time and resolved_at/now() as close time for resolved/open holds.';

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
), job_holds as (
  select
    service_job_id,
    workspace_id,
    sum(hold_duration_hours)::numeric as total_hold_hours
  from public.v_service_job_hold_durations
  group by service_job_id, workspace_id
), row_base as (
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
    coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0)::numeric as actual_hours_before_hold,
    coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric as billable_hours,
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
  where j.deleted_at is null
), job_actuals as (
  select
    workspace_id,
    service_job_id,
    sum(actual_hours_before_hold)::numeric as job_actual_hours_before_hold
  from row_base
  group by workspace_id, service_job_id
), adjusted as (
  select
    rb.*,
    coalesce(jh.total_hold_hours, 0)::numeric as job_hold_hours,
    case
      when coalesce(ja.job_actual_hours_before_hold, 0) = 0 then 0::numeric
      else round(
        (
          least(coalesce(jh.total_hold_hours, 0), ja.job_actual_hours_before_hold)
          * (rb.actual_hours_before_hold / nullif(ja.job_actual_hours_before_hold, 0))
        )::numeric,
        2
      )
    end as hold_hours_excluded
  from row_base rb
  left join job_actuals ja
    on ja.workspace_id = rb.workspace_id
   and ja.service_job_id = rb.service_job_id
  left join job_holds jh
    on jh.workspace_id = rb.workspace_id
   and jh.service_job_id = rb.service_job_id
)
select
  workspace_id,
  service_job_id,
  wo_number,
  company_id,
  branch_id,
  service_job_segment_id,
  segment_number,
  technician_id,
  employee_id,
  revenue_type,
  billing_basis,
  estimated_hours,
  standard_hours,
  greatest(actual_hours_before_hold - hold_hours_excluded, 0)::numeric as actual_hours,
  billable_hours,
  case
    when greatest(actual_hours_before_hold - hold_hours_excluded, 0) = 0 then null::numeric
    else round((standard_hours / nullif(greatest(actual_hours_before_hold - hold_hours_excluded, 0), 0)) * 100, 2)
  end as efficiency_pct,
  case
    when greatest(actual_hours_before_hold - hold_hours_excluded, 0) = 0 then null::numeric
    else round((billable_hours / nullif(greatest(actual_hours_before_hold - hold_hours_excluded, 0), 0)) * 100, 2)
  end as recovery_pct,
  labor_sale_cents,
  labor_cost_cents,
  rework_hours,
  inside_outside_shift,
  shop_class,
  shift_code,
  actual_hours_before_hold,
  hold_hours_excluded,
  job_hold_hours
from adjusted;

comment on view public.v_deal_genome_service_efficiency_analysis is
  'Phase 5 Deal Genome Efficiency Analysis view. H4 excludes named service hold duration from actual_hours before computing efficiency/recovery; actual_hours_before_hold, hold_hours_excluded, and job_hold_hours expose the adjustment.';

create or replace view public.v_tech_recovery_30d
  with (security_invoker = true) as
with timecard_base as (
  select
    tc.workspace_id,
    tc.technician_id,
    tc.service_job_id,
    coalesce(sjs.estimated_hours, 0)::numeric as charged_hours,
    coalesce(tc.hours, 0)::numeric as worked_hours
  from public.service_timecards tc
  left join public.service_job_segments sjs
    on sjs.id = tc.segment_id
   and sjs.deleted_at is null
  where tc.clocked_in_at >= now() - interval '30 days'
), tech_job_hours as (
  select
    workspace_id,
    technician_id,
    service_job_id,
    sum(charged_hours)::numeric as charged_hours,
    sum(worked_hours)::numeric as worked_hours
  from timecard_base
  group by workspace_id, technician_id, service_job_id
), job_totals as (
  select
    workspace_id,
    service_job_id,
    sum(worked_hours)::numeric as job_worked_hours
  from tech_job_hours
  group by workspace_id, service_job_id
), job_holds_30d as (
  select
    workspace_id,
    service_job_id,
    round(sum(
      extract(epoch from (
        least(coalesce(hold_resolved_at, now()), now())
        - greatest(hold_started_at, now() - interval '30 days')
      )) / 3600.0
    )::numeric, 4) as hold_hours
  from public.v_service_job_hold_durations
  where least(coalesce(hold_resolved_at, now()), now()) > greatest(hold_started_at, now() - interval '30 days')
  group by workspace_id, service_job_id
), adjusted as (
  select
    tjh.workspace_id,
    tjh.technician_id,
    tjh.service_job_id,
    tjh.charged_hours,
    tjh.worked_hours,
    case
      when coalesce(jt.job_worked_hours, 0) = 0 then 0::numeric
      else round(
        (
          least(coalesce(jh.hold_hours, 0), jt.job_worked_hours)
          * (tjh.worked_hours / nullif(jt.job_worked_hours, 0))
        )::numeric,
        2
      )
    end as hold_hours_excluded
  from tech_job_hours tjh
  left join job_totals jt
    on jt.workspace_id = tjh.workspace_id
   and jt.service_job_id = tjh.service_job_id
  left join job_holds_30d jh
    on jh.workspace_id = tjh.workspace_id
   and jh.service_job_id = tjh.service_job_id
)
select
  tp.workspace_id,
  tp.user_id as technician_id,
  coalesce(sum(a.charged_hours), 0)::numeric as hours_charged,
  greatest(coalesce(sum(a.worked_hours), 0) - coalesce(sum(a.hold_hours_excluded), 0), 0)::numeric as hours_worked,
  case
    when greatest(coalesce(sum(a.worked_hours), 0) - coalesce(sum(a.hold_hours_excluded), 0), 0) = 0 then null::numeric
    else round((coalesce(sum(a.charged_hours), 0)::numeric / nullif(greatest(coalesce(sum(a.worked_hours), 0) - coalesce(sum(a.hold_hours_excluded), 0), 0), 0)::numeric) * 100, 2)
  end as recovery_pct,
  coalesce(sum(a.worked_hours), 0)::numeric as hours_worked_before_hold,
  coalesce(sum(a.hold_hours_excluded), 0)::numeric as hold_hours_excluded
from public.technician_profiles tp
left join adjusted a
  on a.technician_id = tp.user_id
 and a.workspace_id = tp.workspace_id
group by tp.workspace_id, tp.user_id;

comment on view public.v_tech_recovery_30d is
  'Wave 4 IntelliDealer technician recovery percent over the trailing 30 days. H4 excludes named service hold duration from worked hours before computing recovery_pct.';
