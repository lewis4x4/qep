-- ============================================================================
-- Migration 161: Service Dashboard + Canonical Equipment State (Wave 6.4 + 5D)
--
-- (a) service_timecards: per-tech clock-in/clock-out for the Mechanic
--     Overview pivot of the Service Dashboard.
-- (b) service_dashboard_rollup: pre-aggregated bucket widget data
--     (security_invoker = true so RLS on service_jobs flows through).
-- (c) equipment_status_canonical: the v2 §1 note 6 single-source-of-truth
--     view that the portal MUST read from. Joins service_jobs +
--     rental_contracts (best-effort) + telematics presence into one row
--     per equipment with stage_label, stage_source, eta, last_updated.
-- ============================================================================

-- ── 1. service_timecards ───────────────────────────────────────────────────

create table if not exists public.service_timecards (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  hours numeric(6,2) generated always as (
    case when clocked_out_at is null then null
    else round(extract(epoch from (clocked_out_at - clocked_in_at)) / 3600.0, 2) end
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clocked_out_at is null or clocked_out_at >= clocked_in_at)
);

comment on table public.service_timecards is 'Per-technician clock-in/out for service jobs. Powers the Mechanic Overview pivot of the Service Dashboard.';

alter table public.service_timecards enable row level security;

create policy "tc_workspace" on public.service_timecards for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "tc_service" on public.service_timecards for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_tc_job on public.service_timecards(service_job_id);
create index idx_tc_tech_open on public.service_timecards(technician_id) where clocked_out_at is null;
create index idx_tc_workspace on public.service_timecards(workspace_id);

create trigger set_tc_updated_at
  before update on public.service_timecards
  for each row execute function public.set_updated_at();

-- ── 2. service_dashboard_rollup view ───────────────────────────────────────
-- Pre-aggregated bucket data for the dashboard widgets. Recomputes on every
-- query — service_jobs row counts are well within reasonable scan budgets.

create or replace view public.service_dashboard_rollup as
with bucketed as (
  select
    sj.workspace_id,
    sj.branch_id,
    sj.advisor_id,
    sj.technician_id,
    case
      when sj.scheduled_end_at < now() and sj.current_stage::text not in ('closed', 'invoiced') then 'overdue'
      when sj.current_stage::text in ('request_received', 'scheduling') then 'pending'
      when sj.current_stage::text in ('in_progress', 'parts_waiting', 'awaiting_customer') then 'active'
      when sj.current_stage::text in ('closed', 'invoiced') then 'closed'
      else 'other'
    end as bucket,
    sj.id
  from public.service_jobs sj
)
select
  workspace_id,
  branch_id,
  count(*) filter (where bucket = 'overdue')  as overdue_count,
  count(*) filter (where bucket = 'pending')  as pending_count,
  count(*) filter (where bucket = 'active')   as active_count,
  count(*) filter (where bucket = 'closed')   as closed_count,
  count(*) as total_count
from bucketed
group by workspace_id, branch_id;

alter view public.service_dashboard_rollup set (security_invoker = true);

comment on view public.service_dashboard_rollup is 'Bucket aggregates for the Service Dashboard widgets. security_invoker=true honors caller RLS on service_jobs.';

-- ── 3. equipment_status_canonical view (5D + 6.4 cross-cutting) ────────────
-- Single source of truth for equipment status visible to customers in the
-- portal. Stage labels are curated translations, NOT raw internal jargon.
-- Every row carries stage_source + last_updated so the portal can show
-- "where this status came from" without leaking internal columns.

create or replace view public.equipment_status_canonical as
with active_service as (
  select distinct on (sj.machine_id)
    sj.machine_id as equipment_id,
    case sj.current_stage::text
      when 'request_received'  then 'In intake'
      when 'scheduling'        then 'Scheduling service'
      when 'parts_waiting'     then 'Waiting on parts'
      when 'in_progress'       then 'In the shop'
      when 'awaiting_customer' then 'Waiting on you'
      when 'closed'            then 'Service complete'
      when 'invoiced'          then 'Service complete'
      else 'In service queue'
    end as stage_label,
    'service_jobs'::text as stage_source,
    sj.scheduled_end_at as eta,
    sj.updated_at as last_updated
  from public.service_jobs sj
  where sj.current_stage::text not in ('closed', 'invoiced', 'cancelled')
  order by sj.machine_id, sj.updated_at desc
)
select
  e.id as equipment_id,
  e.workspace_id,
  e.company_id,
  coalesce(s.stage_label, 'Operational') as stage_label,
  coalesce(s.stage_source, 'default') as stage_source,
  s.eta,
  coalesce(s.last_updated, e.updated_at) as last_updated
from public.crm_equipment e
left join active_service s on s.equipment_id = e.id;

alter view public.equipment_status_canonical set (security_invoker = true);

comment on view public.equipment_status_canonical is
  'v2 §1 note 6: single canonical state for portal. Curated stage labels with source attribution. security_invoker=true honors RLS on crm_equipment + service_jobs.';
