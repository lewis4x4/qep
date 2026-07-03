-- ============================================================================
-- Migration 682: H7.1 hauling and transport dispatch
--
-- H7.1 makes service hauling schedulable, trackable, and costable with
-- truck-class / mileage-band rate sheets and round-trip mileage calculation.
-- ============================================================================

BEGIN;

create table if not exists public.service_haul_rate_sheets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rate_type text not null default 'customer',
  truck_class text not null,
  mileage_band_min numeric(10, 2) not null default 0,
  mileage_band_max numeric(10, 2),
  base_rate_cents bigint not null default 0,
  per_mile_rate_cents bigint not null default 0,
  round_trip_minimum_miles numeric(10, 2) not null default 0,
  per_haul_minimum_cents bigint not null default 0,
  effective_date date not null default current_date,
  expiration_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rate_type in ('customer', 'internal')),
  check (truck_class <> ''),
  check (mileage_band_min >= 0),
  check (mileage_band_max is null or mileage_band_max >= mileage_band_min),
  check (base_rate_cents >= 0),
  check (per_mile_rate_cents >= 0),
  check (round_trip_minimum_miles >= 0),
  check (per_haul_minimum_cents >= 0),
  check (expiration_date is null or expiration_date >= effective_date)
);

comment on table public.service_haul_rate_sheets is
  'H7.1 configurable service haul rates by customer/internal rate type, truck class, and round-trip mileage band.';

create unique index if not exists uq_service_haul_rate_sheets_active_band
  on public.service_haul_rate_sheets(
    workspace_id,
    rate_type,
    lower(truck_class),
    mileage_band_min,
    coalesce(mileage_band_max, -1),
    effective_date
  )
  where active;

create index if not exists idx_service_haul_rate_sheets_lookup
  on public.service_haul_rate_sheets(workspace_id, rate_type, lower(truck_class), mileage_band_min, mileage_band_max)
  where active;

comment on index public.idx_service_haul_rate_sheets_lookup is
  'H7.1 fast lookup for active service haul rates by workspace, rate type, truck class, and mileage band.';

alter table public.service_haul_rate_sheets enable row level security;

drop policy if exists "service_haul_rate_sheets_service_all" on public.service_haul_rate_sheets;
create policy "service_haul_rate_sheets_service_all"
  on public.service_haul_rate_sheets for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "service_haul_rate_sheets_select_workspace" on public.service_haul_rate_sheets;
create policy "service_haul_rate_sheets_select_workspace"
  on public.service_haul_rate_sheets for select
  using (workspace_id = (select public.get_my_workspace()));

drop policy if exists "service_haul_rate_sheets_write_manager" on public.service_haul_rate_sheets;
create policy "service_haul_rate_sheets_write_manager"
  on public.service_haul_rate_sheets for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

alter table public.traffic_tickets
  add column if not exists truck_class text,
  add column if not exists mileage_one_way numeric(10, 2),
  add column if not exists round_trip_miles numeric(10, 2),
  add column if not exists rate_type text not null default 'customer',
  add column if not exists haul_rate_sheet_id uuid references public.service_haul_rate_sheets(id) on delete set null,
  add column if not exists haul_total_cents bigint,
  add column if not exists haul_cost_cents bigint,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists service_advisor_id uuid references public.profiles(id) on delete set null,
  add column if not exists rate_calc jsonb not null default '{}'::jsonb;

comment on column public.traffic_tickets.truck_class is
  'H7.1 service haul truck class used for rate-sheet selection.';
comment on column public.traffic_tickets.mileage_one_way is
  'H7.1 one-way service haul mileage captured by service advisor or GPS/manual fallback.';
comment on column public.traffic_tickets.round_trip_miles is
  'H7.1 computed round-trip service haul mileage used for customer/internal costing.';
comment on column public.traffic_tickets.haul_total_cents is
  'H7.1 calculated customer/internal haul total in cents after mileage band and minimum.';
comment on column public.traffic_tickets.rate_calc is
  'H7.1 immutable rate-calculation details for service haul auditability.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_h71_rate_type_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_h71_rate_type_chk
      check (rate_type in ('customer', 'internal')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_h71_mileage_nonnegative_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_h71_mileage_nonnegative_chk
      check (
        (mileage_one_way is null or mileage_one_way >= 0)
        and (round_trip_miles is null or round_trip_miles >= 0)
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_h71_haul_cents_nonnegative_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_h71_haul_cents_nonnegative_chk
      check (
        (haul_total_cents is null or haul_total_cents >= 0)
        and (haul_cost_cents is null or haul_cost_cents >= 0)
      ) not valid;
  end if;
end $$;

create index if not exists idx_traffic_tickets_h71_service_haul_board
  on public.traffic_tickets(workspace_id, shipping_date, status, driver_id)
  where ticket_type = 'service';
comment on index public.idx_traffic_tickets_h71_service_haul_board is
  'H7.1 service haul dispatch board by date, status, and driver.';

insert into public.service_haul_rate_sheets (
  workspace_id,
  rate_type,
  truck_class,
  mileage_band_min,
  mileage_band_max,
  base_rate_cents,
  per_mile_rate_cents,
  round_trip_minimum_miles,
  per_haul_minimum_cents,
  notes
) values
  (
    'default',
    'customer',
    'standard',
    0,
    null,
    0,
    0,
    0,
    50000,
    'H7.1 default preserves the prior flat $500 service haul line until branch-specific truck-class mileage rates are configured.'
  ),
  (
    'default',
    'internal',
    'standard',
    0,
    null,
    0,
    0,
    0,
    50000,
    'H7.1 default internal cost preserves the prior flat $500 service haul assumption until branch-specific costing is configured.'
  )
on conflict do nothing;

create or replace function public.service_calculate_haul_charge(
  p_workspace_id text,
  p_truck_class text,
  p_mileage_one_way numeric,
  p_rate_type text default 'customer'
)
returns table (
  rate_sheet_id uuid,
  truck_class text,
  rate_type text,
  one_way_miles numeric,
  round_trip_miles numeric,
  billable_miles numeric,
  base_rate_cents bigint,
  per_mile_rate_cents bigint,
  per_haul_minimum_cents bigint,
  total_cents bigint,
  rate_source text,
  calculation jsonb
)
language sql
stable
set search_path = ''
as $$
  with normalized as (
    select
      coalesce(nullif(p_workspace_id, ''), 'default') as workspace_id,
      lower(coalesce(nullif(p_truck_class, ''), 'standard')) as truck_class_lc,
      greatest(coalesce(p_mileage_one_way, 0), 0)::numeric as one_way_miles,
      greatest(coalesce(p_mileage_one_way, 0), 0)::numeric * 2 as round_trip_miles,
      case when p_rate_type in ('customer', 'internal') then p_rate_type else 'customer' end as rate_type
  ),
  selected_rate as (
    select r.*, 'configured_rate_sheet'::text as rate_source
    from normalized n
    join public.service_haul_rate_sheets r
      on r.workspace_id = n.workspace_id
     and r.rate_type = n.rate_type
     and lower(r.truck_class) = n.truck_class_lc
     and r.active
     and r.effective_date <= current_date
     and (r.expiration_date is null or r.expiration_date >= current_date)
     and r.mileage_band_min <= n.round_trip_miles
     and (r.mileage_band_max is null or r.mileage_band_max >= n.round_trip_miles)
    order by
      r.mileage_band_min desc,
      r.effective_date desc,
      r.created_at desc
    limit 1
  ),
  fallback_rate as (
    select
      null::uuid as id,
      n.workspace_id,
      n.rate_type,
      n.truck_class_lc as truck_class,
      0::numeric as mileage_band_min,
      null::numeric as mileage_band_max,
      0::bigint as base_rate_cents,
      0::bigint as per_mile_rate_cents,
      0::numeric as round_trip_minimum_miles,
      50000::bigint as per_haul_minimum_cents,
      current_date as effective_date,
      null::date as expiration_date,
      true as active,
      'H7.1 fallback preserves prior flat service haul charge when no rate sheet matches.'::text as notes,
      now() as created_at,
      now() as updated_at,
      'fallback_legacy_minimum'::text as rate_source
    from normalized n
    where not exists (select 1 from selected_rate)
  ),
  rate as (
    select * from selected_rate
    union all
    select * from fallback_rate
  ),
  priced as (
    select
      r.id as rate_sheet_id,
      r.truck_class,
      r.rate_type,
      n.one_way_miles,
      n.round_trip_miles,
      greatest(n.round_trip_miles, r.round_trip_minimum_miles)::numeric as billable_miles,
      r.base_rate_cents,
      r.per_mile_rate_cents,
      r.per_haul_minimum_cents,
      r.rate_source
    from normalized n
    cross join rate r
  )
  select
    p.rate_sheet_id,
    p.truck_class,
    p.rate_type,
    p.one_way_miles,
    p.round_trip_miles,
    p.billable_miles,
    p.base_rate_cents,
    p.per_mile_rate_cents,
    p.per_haul_minimum_cents,
    greatest(
      p.base_rate_cents + round(p.billable_miles * p.per_mile_rate_cents)::bigint,
      p.per_haul_minimum_cents
    ) as total_cents,
    p.rate_source,
    jsonb_build_object(
      'one_way_miles', p.one_way_miles,
      'round_trip_miles', p.round_trip_miles,
      'billable_miles', p.billable_miles,
      'base_rate_cents', p.base_rate_cents,
      'per_mile_rate_cents', p.per_mile_rate_cents,
      'per_haul_minimum_cents', p.per_haul_minimum_cents,
      'rate_source', p.rate_source
    ) as calculation
  from priced p;
$$;

comment on function public.service_calculate_haul_charge(text, text, numeric, text) is
  'H7.1 computes service haul charge from truck class, round-trip mileage band, and per-haul minimum. Falls back to the legacy $500 minimum if no configured rate matches.';

create or replace view public.v_service_haul_dispatch_board
  with (security_invoker = true) as
select
  j.id as service_job_id,
  j.workspace_id,
  j.branch_id,
  j.wo_number,
  j.tracking_token,
  j.current_stage,
  j.haul_required,
  j.customer_id,
  coalesce(c.name, j.requested_by_name, 'Unassigned customer') as customer_name,
  tt.id as traffic_ticket_id,
  tt.status as traffic_status,
  tt.shipping_date,
  tt.scheduled_start_at,
  tt.scheduled_end_at,
  tt.driver_id,
  coalesce(driver.full_name, driver.email) as driver_name,
  tt.service_advisor_id,
  coalesce(advisor.full_name, advisor.email) as service_advisor_name,
  tt.from_location,
  tt.to_location,
  tt.truck_class,
  tt.rate_type,
  tt.mileage_one_way,
  tt.round_trip_miles,
  tt.haul_total_cents,
  tt.haul_cost_cents,
  tt.rate_calc,
  case
    when tt.id is null then 'needs_ticket'
    when tt.driver_id is null then 'needs_driver'
    when tt.scheduled_start_at is null then 'needs_schedule'
    when tt.status = 'completed' then 'completed'
    else 'scheduled'
  end as dispatch_readiness
from public.service_jobs j
left join public.traffic_tickets tt on tt.id = j.traffic_ticket_id
left join public.crm_companies c on c.id = j.customer_id
left join public.profiles driver on driver.id = tt.driver_id
left join public.profiles advisor on advisor.id = tt.service_advisor_id
where j.deleted_at is null
  and j.closed_at is null
  and (j.haul_required or tt.id is not null);

comment on view public.v_service_haul_dispatch_board is
  'H7.1 service haul dispatch board joining open service jobs, traffic tickets, schedule, driver, truck class, mileage, and calculated haul cost.';

grant select on public.service_haul_rate_sheets to authenticated, service_role;
grant insert, update, delete on public.service_haul_rate_sheets to authenticated, service_role;
grant select on public.v_service_haul_dispatch_board to authenticated, service_role;
revoke all on function public.service_calculate_haul_charge(text, text, numeric, text) from public;
grant execute on function public.service_calculate_haul_charge(text, text, numeric, text) to authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/689_h71_hauling_transport_dispatch.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H7') ||
      ' | supabase/migrations/689_h71_hauling_transport_dispatch.sql' ||
      ' | supabase/functions/service-haul-router/index.ts' ||
      ' | supabase/functions/service-quote-engine/index.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H7.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H7.1 shipped: service_haul_rate_sheets configure customer/internal truck-class and mileage-band rates; service_calculate_haul_charge computes round-trip mileage, minimums, and audit metadata; traffic tickets now store truck class, driver/schedule, mileage, and calculated haul cents; service quote haul lines use the linked traffic-ticket calculation instead of a hardcoded flat line.'
  END,
  updated_at = now()
WHERE task_id = 'H7.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H7.1',
  'update',
  jsonb_build_object(
    'reason', 'h71_hauling_transport_dispatch',
    'migration', '689_h71_hauling_transport_dispatch.sql',
    'mission_alignment', 'pass: service hauling becomes a costed equipment-movement workflow with driver schedule, truck class, round-trip mileage, rate-sheet evidence, and quote-line cost visibility for equipment operations',
    'implementation_evidence', jsonb_build_array(
      'public.service_haul_rate_sheets',
      'public.service_calculate_haul_charge(text,text,numeric,text)',
      'public.v_service_haul_dispatch_board',
      'supabase/functions/service-haul-router/index.ts',
      'supabase/functions/service-quote-engine/index.ts'
    )
  ),
  'codex'
);

COMMIT;
