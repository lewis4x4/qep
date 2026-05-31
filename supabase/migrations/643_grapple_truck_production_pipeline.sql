-- ============================================================================
-- Migration 643: Stream I grapple-truck production pipeline
--
-- I1.1 + I8.1 only. Creates a standalone production build module for grapple
-- trucks, dashboard-backing security_invoker views, RLS, and a conservative
-- cleanup path for legacy service_jobs that were being used as production
-- build records. This intentionally does NOT add GTB inspection, accessory
-- install, parts-sheet, sales/service build-progress, final-QC, or timeline
-- tracking forms from later Stream I slices.
-- ============================================================================

-- ── Grapple-production classification helpers --------------------------------

create or replace function public.grapple_build_machine_is_grapple_truck(
  p_name text,
  p_make text,
  p_model text,
  p_category text,
  p_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    lower(concat_ws(
      ' ',
      coalesce(p_metadata->>'equipment_class', ''),
      coalesce(p_metadata->>'service_equipment_class', ''),
      coalesce(p_metadata->>'rate_class', ''),
      coalesce(p_metadata->>'work_class', '')
    )) ~ '\mgrapple(_truck)?\M'
    or (
      lower(concat_ws(
        ' ',
        p_name,
        p_make,
        p_model,
        p_category,
        coalesce(p_metadata->>'description', ''),
        coalesce(p_metadata->>'body_type', ''),
        coalesce(p_metadata->>'equipment_type', '')
      )) ~ '\mgrapple\M'
      and lower(concat_ws(
        ' ',
        p_name,
        p_make,
        p_model,
        p_category,
        coalesce(p_metadata->>'description', ''),
        coalesce(p_metadata->>'body_type', ''),
        coalesce(p_metadata->>'equipment_type', '')
      )) ~ '\mtruck\M'
    );
$$;

comment on function public.grapple_build_machine_is_grapple_truck(text, text, text, text, jsonb) is
  'Stream I classifier equivalent to the service intake grapple-truck detector. It is used only to separate production builds from the service work-order lifecycle.';

create or replace function public.grapple_build_service_job_confidence(
  p_request_type text,
  p_summary text,
  p_complaint text,
  p_cause text,
  p_correction text,
  p_machine_name text,
  p_machine_make text,
  p_machine_model text,
  p_machine_category text,
  p_machine_metadata jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  with signals as (
    select
      public.grapple_build_machine_is_grapple_truck(
        p_machine_name,
        p_machine_make,
        p_machine_model,
        p_machine_category,
        p_machine_metadata
      ) as is_grapple_truck,
      lower(concat_ws(
        ' ',
        p_summary,
        p_complaint,
        p_cause,
        p_correction
      )) as job_text
  ), intent as (
    select
      is_grapple_truck,
      (
        job_text ~ '\m(grapple[- ]?truck|gtb)\M.{0,80}\m(build|built|production|assemble|assembly|upfit|upfitting)\M'
        or job_text ~ '\m(build|built|production|assemble|assembly|upfit|upfitting)\M.{0,80}\m(grapple[- ]?truck|gtb)\M'
        or job_text ~ '\m(production build|build package|upfit package|new unit|sold unit|mount grapple body)\M'
      ) as has_explicit_build_intent
    from signals
  )
  select case
    when is_grapple_truck
      and has_explicit_build_intent
      then 'high'
    when has_explicit_build_intent
      then 'possible'
    when is_grapple_truck
      and coalesce(p_request_type, '') = 'internal'
      then 'possible'
    else 'none'
  end
  from intent;
$$;

comment on function public.grapple_build_service_job_confidence(text, text, text, text, text, text, text, text, text, jsonb) is
  'I8.1 conservative classifier for legacy service_jobs. high = likely grapple production build to migrate; possible = review/flag only; none = normal service job.';

-- ── Core production build tables ---------------------------------------------

create table if not exists public.grapple_builds (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_number text not null,
  source_service_job_id uuid unique references public.service_jobs(id) on delete set null,

  -- Customer / order context. FK targets are the qrm_* base tables; crm_* names
  -- are compatibility views and must not be FK targets.
  customer_company_id uuid references public.qrm_companies(id) on delete set null,
  customer_contact_id uuid references public.qrm_contacts(id) on delete set null,
  sales_deal_id uuid references public.qrm_deals(id) on delete set null,

  -- Truck/chassis + finished machine identity, both against the base equipment table.
  chassis_equipment_id uuid references public.qrm_equipment(id) on delete set null,
  finished_equipment_id uuid references public.qrm_equipment(id) on delete set null,

  production_stage text not null default 'intake',
  status text not null default 'active',
  priority text not null default 'normal',

  assigned_lead_id uuid references public.profiles(id) on delete set null,
  assigned_builder_id uuid references public.profiles(id) on delete set null,

  target_start_date date,
  target_completion_date date,
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  current_stage_entered_at timestamptz not null default now(),
  hold_reason text,
  production_notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  check (production_stage in (
    'intake',
    'chassis_arrival',
    'pre_build_review',
    'production_scheduled',
    'in_production',
    'production_hold',
    'production_complete',
    'ready_for_final_qc'
  )),
  check (status in ('active', 'on_hold', 'completed', 'cancelled')),
  check (priority in ('low', 'normal', 'high', 'expedite')),
  check (target_completion_date is null or target_start_date is null or target_completion_date >= target_start_date),
  check (actual_completed_at is null or actual_started_at is null or actual_completed_at >= actual_started_at)
);

comment on table public.grapple_builds is
  'Stream I standalone grapple-truck production entity. This is not a service work order and does not use service_jobs.current_stage/request_type lifecycle.';
comment on column public.grapple_builds.build_number is
  'Production build identifier for the grapple-truck pipeline.';
comment on column public.grapple_builds.source_service_job_id is
  'I8.1 one-time legacy bridge when an existing service work order is migrated/flagged into the production module. New builds should not originate in service_jobs.';
comment on column public.grapple_builds.chassis_equipment_id is
  'Truck/chassis equipment record in qrm_equipment. crm_equipment is a view and is intentionally not used for FK targets.';
comment on column public.grapple_builds.finished_equipment_id is
  'Finished grapple-truck machine/equipment record in qrm_equipment when known.';
comment on column public.grapple_builds.production_stage is
  'Constrained-text Stream I production stage. Later slices add GTB/accessory/parts/progress/QC detail tables without changing this service-separate lifecycle.';

create unique index if not exists idx_grapple_builds_workspace_build_number
  on public.grapple_builds(workspace_id, lower(build_number))
  where deleted_at is null;
create index if not exists idx_grapple_builds_workspace_stage
  on public.grapple_builds(workspace_id, production_stage, status)
  where deleted_at is null;
create index if not exists idx_grapple_builds_lead
  on public.grapple_builds(workspace_id, assigned_lead_id)
  where deleted_at is null and assigned_lead_id is not null;
create index if not exists idx_grapple_builds_builder
  on public.grapple_builds(workspace_id, assigned_builder_id)
  where deleted_at is null and assigned_builder_id is not null;
create index if not exists idx_grapple_builds_target_completion
  on public.grapple_builds(workspace_id, target_completion_date)
  where deleted_at is null and target_completion_date is not null;

create table if not exists public.grapple_build_stage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_id uuid not null references public.grapple_builds(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  from_status text,
  to_status text,
  event_type text not null default 'stage_transition',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (event_type in ('created', 'stage_transition', 'status_update', 'legacy_service_job_migration', 'note')),
  check (from_stage is null or from_stage in (
    'intake', 'chassis_arrival', 'pre_build_review', 'production_scheduled',
    'in_production', 'production_hold', 'production_complete', 'ready_for_final_qc'
  )),
  check (to_stage in (
    'intake', 'chassis_arrival', 'pre_build_review', 'production_scheduled',
    'in_production', 'production_hold', 'production_complete', 'ready_for_final_qc'
  )),
  check (from_status is null or from_status in ('active', 'on_hold', 'completed', 'cancelled')),
  check (to_status is null or to_status in ('active', 'on_hold', 'completed', 'cancelled'))
);

comment on table public.grapple_build_stage_events is
  'Append-only Stream I stage/status event log backing the production dashboard timeline. Detailed I7 build-timeline tracking is intentionally left for a later slice.';

create index if not exists idx_grapple_build_stage_events_build_created
  on public.grapple_build_stage_events(build_id, created_at desc);
create index if not exists idx_grapple_build_stage_events_workspace_created
  on public.grapple_build_stage_events(workspace_id, created_at desc);

create table if not exists public.grapple_build_service_job_migrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null unique references public.service_jobs(id) on delete cascade,
  grapple_build_id uuid references public.grapple_builds(id) on delete set null,
  confidence text not null,
  disposition text not null,
  detection_reason text not null,
  migrated_by uuid references public.profiles(id) on delete set null,
  migrated_at timestamptz,
  review_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (confidence in ('high', 'possible')),
  check (disposition in ('migrated_to_grapple_builds', 'needs_review', 'not_a_grapple_build', 'waived_legacy_service_repair'))
);

comment on table public.grapple_build_service_job_migrations is
  'I8.1 audit table for service_jobs that look like legacy grapple-truck production builds. High-confidence rows are migrated; possible rows are flagged for review without breaking service_jobs.';

create index if not exists idx_grapple_build_service_job_migrations_workspace_disposition
  on public.grapple_build_service_job_migrations(workspace_id, disposition, created_at desc);

create or replace function public.grapple_build_validate_workspace_refs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.customer_company_id is not null and not exists (
    select 1 from public.qrm_companies c where c.id = new.customer_company_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'grapple_builds.customer_company_id must belong to workspace %', new.workspace_id using errcode = '23514';
  end if;

  if new.customer_contact_id is not null and not exists (
    select 1 from public.qrm_contacts c where c.id = new.customer_contact_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'grapple_builds.customer_contact_id must belong to workspace %', new.workspace_id using errcode = '23514';
  end if;

  if new.sales_deal_id is not null and not exists (
    select 1 from public.qrm_deals d where d.id = new.sales_deal_id and d.workspace_id = new.workspace_id
  ) then
    raise exception 'grapple_builds.sales_deal_id must belong to workspace %', new.workspace_id using errcode = '23514';
  end if;

  if new.chassis_equipment_id is not null and not exists (
    select 1 from public.qrm_equipment e where e.id = new.chassis_equipment_id and e.workspace_id = new.workspace_id
  ) then
    raise exception 'grapple_builds.chassis_equipment_id must belong to workspace %', new.workspace_id using errcode = '23514';
  end if;

  if new.finished_equipment_id is not null and not exists (
    select 1 from public.qrm_equipment e where e.id = new.finished_equipment_id and e.workspace_id = new.workspace_id
  ) then
    raise exception 'grapple_builds.finished_equipment_id must belong to workspace %', new.workspace_id using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.grapple_build_validate_workspace_refs() is
  'Stream I workspace-integrity guard for grapple_builds references to qrm_* base tables.';

drop trigger if exists trg_grapple_build_validate_workspace_refs on public.grapple_builds;
create trigger trg_grapple_build_validate_workspace_refs
  before insert or update of workspace_id, customer_company_id, customer_contact_id, sales_deal_id, chassis_equipment_id, finished_equipment_id
  on public.grapple_builds
  for each row execute function public.grapple_build_validate_workspace_refs();

alter table public.service_jobs
  add column if not exists grapple_production_routing_status text not null default 'not_grapple_production',
  add column if not exists grapple_build_id uuid references public.grapple_builds(id) on delete set null;

comment on column public.service_jobs.grapple_production_routing_status is
  'I8.1 cleanup marker. New grapple-truck production builds are blocked from service_jobs and should be created in grapple_builds. Legacy rows may be migrated or flagged for review.';
comment on column public.service_jobs.grapple_build_id is
  'I8.1 legacy bridge to grapple_builds for service_jobs that were safely migrated out of the service work-order lifecycle.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_grapple_production_routing_status_chk') then
    alter table public.service_jobs
      add constraint service_jobs_grapple_production_routing_status_chk
      check (grapple_production_routing_status in (
        'not_grapple_production',
        'needs_review',
        'migrated_to_grapple_builds',
        'legacy_service_repair'
      )) not valid;
  end if;
end $$;

create index if not exists idx_service_jobs_grapple_routing_status
  on public.service_jobs(workspace_id, grapple_production_routing_status)
  where grapple_production_routing_status <> 'not_grapple_production';
create index if not exists idx_service_jobs_grapple_build_id
  on public.service_jobs(grapple_build_id)
  where grapple_build_id is not null;

-- ── Access helpers and RLS ----------------------------------------------------

create or replace function public.grapple_build_can_manage(
  p_workspace_id text,
  p_assigned_lead_id uuid,
  p_assigned_builder_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or (
      p_workspace_id = (select public.get_my_workspace())
      and (
        coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
        or p_assigned_lead_id = (select auth.uid())
        or p_assigned_builder_id = (select auth.uid())
      )
    );
$$;

comment on function public.grapple_build_can_manage(text, uuid, uuid) is
  'Stream I RLS helper: elevated roles plus assigned build lead/builder can manage a build; service_role bypasses for automation.';

create or replace function public.grapple_build_can_read(
  p_workspace_id text,
  p_assigned_lead_id uuid,
  p_assigned_builder_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or (
      p_workspace_id = (select public.get_my_workspace())
      and (
        coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
        or p_assigned_lead_id = (select auth.uid())
        or p_assigned_builder_id = (select auth.uid())
      )
    );
$$;

comment on function public.grapple_build_can_read(text, uuid, uuid) is
  'Stream I RLS helper: elevated roles see production, assigned lead/builder/technician sees assigned builds, and service_role can automate.';

revoke execute on function public.grapple_build_can_manage(text, uuid, uuid) from public;
revoke execute on function public.grapple_build_can_read(text, uuid, uuid) from public;
grant execute on function public.grapple_build_can_manage(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.grapple_build_can_read(text, uuid, uuid) to authenticated, service_role;

alter table public.grapple_builds enable row level security;
alter table public.grapple_build_stage_events enable row level security;
alter table public.grapple_build_service_job_migrations enable row level security;

drop policy if exists "grapple_builds_service_all" on public.grapple_builds;
create policy "grapple_builds_service_all" on public.grapple_builds for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_builds_select_scoped" on public.grapple_builds;
create policy "grapple_builds_select_scoped" on public.grapple_builds for select
  using (public.grapple_build_can_read(workspace_id, assigned_lead_id, assigned_builder_id));

drop policy if exists "grapple_builds_insert_manager" on public.grapple_builds;
create policy "grapple_builds_insert_manager" on public.grapple_builds for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

drop policy if exists "grapple_builds_update_assigned_or_manager" on public.grapple_builds;
create policy "grapple_builds_update_assigned_or_manager" on public.grapple_builds for update
  using (public.grapple_build_can_manage(workspace_id, assigned_lead_id, assigned_builder_id))
  with check (public.grapple_build_can_manage(workspace_id, assigned_lead_id, assigned_builder_id));

drop policy if exists "grapple_build_stage_events_service_all" on public.grapple_build_stage_events;
create policy "grapple_build_stage_events_service_all" on public.grapple_build_stage_events for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_stage_events_select_scoped" on public.grapple_build_stage_events;
create policy "grapple_build_stage_events_select_scoped" on public.grapple_build_stage_events for select
  using (
    exists (
      select 1
      from public.grapple_builds gb
      where gb.id = grapple_build_stage_events.build_id
        and gb.workspace_id = grapple_build_stage_events.workspace_id
        and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
    )
  );

drop policy if exists "grapple_build_stage_events_insert_assigned_or_manager" on public.grapple_build_stage_events;
create policy "grapple_build_stage_events_insert_assigned_or_manager" on public.grapple_build_stage_events for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.grapple_builds gb
      where gb.id = grapple_build_stage_events.build_id
        and gb.workspace_id = grapple_build_stage_events.workspace_id
        and public.grapple_build_can_manage(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
    )
  );

drop policy if exists "grapple_build_service_job_migrations_service_all" on public.grapple_build_service_job_migrations;
create policy "grapple_build_service_job_migrations_service_all" on public.grapple_build_service_job_migrations for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "grapple_build_service_job_migrations_select_manager" on public.grapple_build_service_job_migrations;
create policy "grapple_build_service_job_migrations_select_manager" on public.grapple_build_service_job_migrations for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

drop policy if exists "grapple_build_service_job_migrations_write_manager" on public.grapple_build_service_job_migrations;
create policy "grapple_build_service_job_migrations_write_manager" on public.grapple_build_service_job_migrations for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

-- ── RPCs for backend callers --------------------------------------------------

create or replace function public.create_grapple_build(
  p_build_number text,
  p_chassis_equipment_id uuid default null,
  p_finished_equipment_id uuid default null,
  p_customer_company_id uuid default null,
  p_customer_contact_id uuid default null,
  p_sales_deal_id uuid default null,
  p_target_start_date date default null,
  p_target_completion_date date default null,
  p_assigned_lead_id uuid default null,
  p_assigned_builder_id uuid default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_build_id uuid;
begin
  insert into public.grapple_builds (
    build_number,
    chassis_equipment_id,
    finished_equipment_id,
    customer_company_id,
    customer_contact_id,
    sales_deal_id,
    target_start_date,
    target_completion_date,
    assigned_lead_id,
    assigned_builder_id,
    priority,
    metadata
  ) values (
    nullif(trim(p_build_number), ''),
    p_chassis_equipment_id,
    p_finished_equipment_id,
    p_customer_company_id,
    p_customer_contact_id,
    p_sales_deal_id,
    p_target_start_date,
    p_target_completion_date,
    p_assigned_lead_id,
    p_assigned_builder_id,
    coalesce(p_priority, 'normal'),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_build_id;

  insert into public.grapple_build_stage_events (
    workspace_id,
    build_id,
    to_stage,
    to_status,
    event_type,
    note,
    metadata
  )
  select workspace_id, id, production_stage, status, 'created', 'Grapple production build created.', '{}'::jsonb
  from public.grapple_builds
  where id = v_build_id;

  return v_build_id;
end;
$$;

comment on function public.create_grapple_build(text, uuid, uuid, uuid, uuid, uuid, date, date, uuid, uuid, text, jsonb) is
  'I1.1 backend RPC for creating a standalone grapple-truck production build. This does not create a service_jobs row.';

create or replace function public.transition_grapple_build_stage(
  p_build_id uuid,
  p_next_stage text,
  p_next_status text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.grapple_builds
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.grapple_builds%rowtype;
  v_after public.grapple_builds%rowtype;
  v_status text;
begin
  select * into v_before
  from public.grapple_builds
  where id = p_build_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'grapple build % not found', p_build_id;
  end if;

  v_status := coalesce(
    p_next_status,
    case
      when p_next_stage = 'production_hold' then 'on_hold'
      when p_next_stage in ('production_complete', 'ready_for_final_qc') then 'completed'
      else 'active'
    end
  );

  update public.grapple_builds
  set production_stage = p_next_stage,
      status = v_status,
      current_stage_entered_at = now(),
      actual_started_at = case when actual_started_at is null and p_next_stage in ('in_production', 'production_hold', 'production_complete', 'ready_for_final_qc') then now() else actual_started_at end,
      actual_completed_at = case when v_status = 'completed' and actual_completed_at is null then now() else actual_completed_at end,
      updated_at = now()
  where id = p_build_id
  returning * into v_after;

  insert into public.grapple_build_stage_events (
    workspace_id,
    build_id,
    from_stage,
    to_stage,
    from_status,
    to_status,
    event_type,
    note,
    metadata
  ) values (
    v_after.workspace_id,
    v_after.id,
    v_before.production_stage,
    v_after.production_stage,
    v_before.status,
    v_after.status,
    case when v_before.production_stage is distinct from v_after.production_stage then 'stage_transition' else 'status_update' end,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_after;
end;
$$;

comment on function public.transition_grapple_build_stage(uuid, text, text, text, jsonb) is
  'I1.1 backend RPC for stage/status transitions in the standalone grapple-truck production pipeline.';

revoke execute on function public.create_grapple_build(text, uuid, uuid, uuid, uuid, uuid, date, date, uuid, uuid, text, jsonb) from public;
revoke execute on function public.transition_grapple_build_stage(uuid, text, text, text, jsonb) from public;
grant execute on function public.create_grapple_build(text, uuid, uuid, uuid, uuid, uuid, date, date, uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.transition_grapple_build_stage(uuid, text, text, text, jsonb) to authenticated, service_role;

-- ── Production dashboard backing views ---------------------------------------

create or replace view public.v_grapple_build_pipeline
  with (security_invoker = true) as
select
  gb.id,
  gb.workspace_id,
  gb.build_number,
  gb.source_service_job_id,
  gb.production_stage,
  gb.status,
  gb.priority,
  gb.customer_company_id,
  co.name as customer_company_name,
  gb.customer_contact_id,
  nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), '') as customer_contact_name,
  gb.sales_deal_id,
  d.name as sales_deal_name,
  gb.chassis_equipment_id,
  chassis.name as chassis_equipment_name,
  chassis.asset_tag as chassis_asset_tag,
  chassis.serial_number as chassis_serial_number,
  gb.finished_equipment_id,
  finished.name as finished_equipment_name,
  finished.asset_tag as finished_asset_tag,
  gb.assigned_lead_id,
  coalesce(nullif(lead_profile.full_name, ''), lead_profile.email) as assigned_lead_name,
  gb.assigned_builder_id,
  coalesce(nullif(builder_profile.full_name, ''), builder_profile.email) as assigned_builder_name,
  gb.target_start_date,
  gb.target_completion_date,
  gb.actual_started_at,
  gb.actual_completed_at,
  gb.current_stage_entered_at,
  greatest(0, floor(extract(epoch from (now() - gb.current_stage_entered_at)) / 86400))::integer as days_in_stage,
  case
    when gb.deleted_at is not null then 'deleted'
    when gb.status = 'completed' then 'complete'
    when gb.target_completion_date is null then 'no_target'
    when gb.target_completion_date < current_date then 'overdue'
    when gb.target_completion_date <= current_date + 3 then 'due_soon'
    else 'on_track'
  end as timeline_health,
  gb.hold_reason,
  gb.production_notes,
  gb.metadata,
  gb.created_at,
  gb.updated_at
from public.grapple_builds gb
left join public.qrm_companies co on co.id = gb.customer_company_id
left join public.qrm_contacts ct on ct.id = gb.customer_contact_id
left join public.qrm_deals d on d.id = gb.sales_deal_id
left join public.qrm_equipment chassis on chassis.id = gb.chassis_equipment_id
left join public.qrm_equipment finished on finished.id = gb.finished_equipment_id
left join public.profiles lead_profile on lead_profile.id = gb.assigned_lead_id
left join public.profiles builder_profile on builder_profile.id = gb.assigned_builder_id
where gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or gb.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_pipeline is
  'I1.1 production-dashboard backing view: one row per active grapple build with stage, status, assignments, customer/order/equipment context, and timeline health.';

grant select on public.v_grapple_build_pipeline to authenticated, service_role;

create or replace view public.v_grapple_build_stage_summary
  with (security_invoker = true) as
select
  workspace_id,
  production_stage,
  status,
  count(*)::integer as build_count,
  count(*) filter (where timeline_health = 'overdue')::integer as overdue_count,
  count(*) filter (where timeline_health = 'due_soon')::integer as due_soon_count,
  count(*) filter (where assigned_lead_id is null)::integer as unassigned_lead_count,
  count(*) filter (where assigned_builder_id is null)::integer as unassigned_builder_count,
  min(target_completion_date) as next_target_completion_date,
  max(updated_at) as latest_updated_at
from public.v_grapple_build_pipeline
group by workspace_id, production_stage, status;

comment on view public.v_grapple_build_stage_summary is
  'I1.1 production-dashboard backing view: rollup of grapple builds by production stage/status and timeline health.';

grant select on public.v_grapple_build_stage_summary to authenticated, service_role;

create or replace view public.v_grapple_build_dashboard_timeline
  with (security_invoker = true) as
select
  ev.id as event_id,
  ev.workspace_id,
  ev.build_id,
  gb.build_number,
  ev.event_type,
  ev.from_stage,
  ev.to_stage,
  ev.from_status,
  ev.to_status,
  ev.note,
  ev.metadata,
  ev.actor_id,
  coalesce(nullif(actor.full_name, ''), actor.email) as actor_name,
  ev.created_at
from public.grapple_build_stage_events ev
join public.grapple_builds gb
  on gb.id = ev.build_id
 and gb.workspace_id = ev.workspace_id
left join public.profiles actor on actor.id = ev.actor_id
where gb.deleted_at is null
  and public.grapple_build_can_read(gb.workspace_id, gb.assigned_lead_id, gb.assigned_builder_id)
  and ((select auth.role()) = 'service_role' or ev.workspace_id = (select public.get_my_workspace()));

comment on view public.v_grapple_build_dashboard_timeline is
  'I1.1 production-dashboard backing view: append-only stage/status events for the grapple production board. Detailed I7 tracking remains a later slice.';

grant select on public.v_grapple_build_dashboard_timeline to authenticated, service_role;

create or replace view public.v_service_jobs_grapple_production_candidates
  with (security_invoker = true) as
select
  j.id as service_job_id,
  j.workspace_id,
  j.request_type::text as request_type,
  j.current_stage::text as current_stage,
  j.customer_id,
  j.contact_id,
  j.machine_id,
  e.name as machine_name,
  e.make as machine_make,
  e.model as machine_model,
  e.category::text as machine_category,
  j.customer_problem_summary,
  j.complaint,
  j.cause,
  j.correction,
  public.grapple_build_service_job_confidence(
    j.request_type::text,
    j.customer_problem_summary,
    j.complaint,
    j.cause,
    j.correction,
    coalesce(e.name, j.machine_make),
    coalesce(e.make, j.machine_make),
    coalesce(e.model, j.machine_model),
    e.category::text,
    e.metadata
  ) as confidence,
  j.grapple_production_routing_status,
  j.grapple_build_id,
  j.created_at,
  j.updated_at,
  j.deleted_at
from public.service_jobs j
left join public.qrm_equipment e on e.id = j.machine_id
where j.deleted_at is null
  and j.workspace_id = (select public.get_my_workspace())
  and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  and public.grapple_build_service_job_confidence(
    j.request_type::text,
    j.customer_problem_summary,
    j.complaint,
    j.cause,
    j.correction,
    coalesce(e.name, j.machine_make),
    coalesce(e.make, j.machine_make),
    coalesce(e.model, j.machine_model),
    e.category::text,
    e.metadata
  ) in ('high', 'possible');

comment on view public.v_service_jobs_grapple_production_candidates is
  'I8.1 review queue for service_jobs that appear to be legacy grapple-truck production builds. High confidence rows are auto-migrated by migration 643; possible rows are flagged for manager review.';

grant select on public.v_service_jobs_grapple_production_candidates to authenticated, service_role;

-- ── Legacy service_jobs migration/flagging -----------------------------------

with candidates as (
  select
    j.*,
    e.name as equipment_name,
    e.make as equipment_make,
    e.model as equipment_model,
    e.category::text as equipment_category,
    e.metadata as equipment_metadata,
    public.grapple_build_service_job_confidence(
      j.request_type::text,
      j.customer_problem_summary,
      j.complaint,
      j.cause,
      j.correction,
      coalesce(e.name, j.machine_make),
      coalesce(e.make, j.machine_make),
      coalesce(e.model, j.machine_model),
      e.category::text,
      e.metadata
    ) as confidence
  from public.service_jobs j
  left join public.qrm_equipment e on e.id = j.machine_id
  where j.deleted_at is null
), migrated as (
  insert into public.grapple_builds (
    workspace_id,
    build_number,
    source_service_job_id,
    customer_company_id,
    customer_contact_id,
    chassis_equipment_id,
    production_stage,
    status,
    priority,
    assigned_lead_id,
    assigned_builder_id,
    target_start_date,
    target_completion_date,
    actual_started_at,
    actual_completed_at,
    current_stage_entered_at,
    production_notes,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  select
    c.workspace_id,
    'GTB-MIG-' || left(c.id::text, 8),
    c.id,
    case when exists (select 1 from public.qrm_companies qc where qc.id = c.customer_id and qc.workspace_id = c.workspace_id) then c.customer_id else null end,
    case when exists (select 1 from public.qrm_contacts qct where qct.id = c.contact_id and qct.workspace_id = c.workspace_id) then c.contact_id else null end,
    case when exists (select 1 from public.qrm_equipment qe where qe.id = c.machine_id and qe.workspace_id = c.workspace_id) then c.machine_id else null end,
    case
      when c.closed_at is not null then 'production_complete'
      when c.current_stage::text in ('scheduled', 'in_progress', 'quality_check', 'ready_for_pickup', 'invoice_ready', 'invoiced') then 'in_production'
      else 'intake'
    end,
    case when c.closed_at is not null then 'completed' else 'active' end,
    case when c.priority::text in ('urgent', 'critical', 'emergency') then 'high' else 'normal' end,
    coalesce(c.service_manager_id, c.advisor_id),
    c.technician_id,
    c.scheduled_start_at::date,
    c.scheduled_end_at::date,
    case when c.current_stage::text in ('in_progress', 'quality_check', 'ready_for_pickup', 'invoice_ready', 'invoiced', 'paid_closed') then c.current_stage_entered_at else null end,
    c.closed_at,
    coalesce(c.current_stage_entered_at, c.updated_at, c.created_at),
    'Migrated from legacy service_jobs by Stream I I8.1 cleanup. Original service stage: ' || c.current_stage::text || '.',
    jsonb_build_object(
      'source', 'service_jobs_i8_1_cleanup',
      'service_job_id', c.id,
      'service_request_type', c.request_type::text,
      'service_current_stage', c.current_stage::text,
      'service_status_flags', c.status_flags::text[],
      'classification_confidence', c.confidence
    ),
    coalesce(c.advisor_id, c.service_manager_id, c.technician_id),
    c.created_at,
    now()
  from candidates c
  where c.confidence = 'high'
  on conflict (source_service_job_id) do update
  set customer_company_id = excluded.customer_company_id,
      customer_contact_id = excluded.customer_contact_id,
      chassis_equipment_id = excluded.chassis_equipment_id,
      assigned_lead_id = excluded.assigned_lead_id,
      assigned_builder_id = excluded.assigned_builder_id,
      updated_at = now()
  returning source_service_job_id, id as grapple_build_id
), recorded as (
  insert into public.grapple_build_service_job_migrations (
    workspace_id,
    service_job_id,
    grapple_build_id,
    confidence,
    disposition,
    detection_reason,
    migrated_at,
    metadata
  )
  select
    c.workspace_id,
    c.id,
    m.grapple_build_id,
    c.confidence,
    case when c.confidence = 'high' then 'migrated_to_grapple_builds' else 'needs_review' end,
    case
      when c.confidence = 'high' then 'Internal/service text and grapple-truck signals indicate this legacy service job was being used as a production build.'
      else 'Grapple-truck/internal signal found, but not enough production language to move automatically.'
    end,
    case when c.confidence = 'high' then now() else null end,
    jsonb_build_object(
      'service_request_type', c.request_type::text,
      'service_current_stage', c.current_stage::text,
      'machine_name', c.equipment_name,
      'machine_make', c.equipment_make,
      'machine_model', c.equipment_model,
      'machine_category', c.equipment_category
    )
  from candidates c
  left join migrated m on m.source_service_job_id = c.id
  where c.confidence in ('high', 'possible')
  on conflict (service_job_id) do update
  set grapple_build_id = excluded.grapple_build_id,
      confidence = excluded.confidence,
      disposition = excluded.disposition,
      detection_reason = excluded.detection_reason,
      migrated_at = coalesce(public.grapple_build_service_job_migrations.migrated_at, excluded.migrated_at),
      metadata = excluded.metadata,
      updated_at = now()
  returning service_job_id, grapple_build_id, disposition
)
update public.service_jobs sj
set grapple_build_id = r.grapple_build_id,
    grapple_production_routing_status = case
      when r.disposition = 'migrated_to_grapple_builds' then 'migrated_to_grapple_builds'
      else 'needs_review'
    end,
    updated_at = now()
from recorded r
where r.service_job_id = sj.id;

insert into public.grapple_build_stage_events (
  workspace_id,
  build_id,
  to_stage,
  to_status,
  event_type,
  note,
  metadata,
  actor_id,
  created_at
)
select
  gb.workspace_id,
  gb.id,
  gb.production_stage,
  gb.status,
  'legacy_service_job_migration',
  'Created from a legacy service work order by Stream I I8.1 cleanup.',
  jsonb_build_object('source_service_job_id', gb.source_service_job_id),
  gb.created_by,
  now()
from public.grapple_builds gb
where gb.source_service_job_id is not null
  and not exists (
    select 1
    from public.grapple_build_stage_events ev
    where ev.build_id = gb.id
      and ev.event_type = 'legacy_service_job_migration'
  );

-- ── Forward guard: production builds cannot be created as service WOs ----------

create or replace function public.service_jobs_prevent_grapple_production_route()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_equipment_name text;
  v_equipment_make text;
  v_equipment_model text;
  v_equipment_category text;
  v_equipment_metadata jsonb;
  v_confidence text;
begin
  select e.name, e.make, e.model, e.category::text, e.metadata
    into v_equipment_name, v_equipment_make, v_equipment_model, v_equipment_category, v_equipment_metadata
  from public.qrm_equipment e
  where e.id = new.machine_id;

  v_confidence := public.grapple_build_service_job_confidence(
    new.request_type::text,
    new.customer_problem_summary,
    new.complaint,
    new.cause,
    new.correction,
    coalesce(v_equipment_name, new.machine_make),
    coalesce(v_equipment_make, new.machine_make),
    coalesce(v_equipment_model, new.machine_model),
    v_equipment_category,
    v_equipment_metadata
  );

  if v_confidence = 'high'
     and coalesce(new.grapple_production_routing_status, 'not_grapple_production') not in ('migrated_to_grapple_builds', 'legacy_service_repair') then
    raise exception 'Grapple-truck production must be created in grapple_builds, not service_jobs'
      using errcode = '23514',
            hint = 'Use public.create_grapple_build or insert into public.grapple_builds for production builds. service_jobs remains for repairs/service only.';
  end if;

  if v_confidence = 'possible'
     and coalesce(new.grapple_production_routing_status, 'not_grapple_production') = 'not_grapple_production' then
    new.grapple_production_routing_status := 'needs_review';
  end if;

  return new;
end;
$$;

comment on function public.service_jobs_prevent_grapple_production_route() is
  'I8.1 guard: blocks new high-confidence grapple-truck production work from entering the service work-order lifecycle and flags ambiguous rows for manager review.';

drop trigger if exists trg_service_jobs_prevent_grapple_production_route on public.service_jobs;
create trigger trg_service_jobs_prevent_grapple_production_route
  before insert or update of request_type, customer_problem_summary, complaint, cause, correction, machine_id, machine_make, machine_model, grapple_production_routing_status
  on public.service_jobs
  for each row execute function public.service_jobs_prevent_grapple_production_route();

create or replace function public.service_jobs_freeze_migrated_grapple_production_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.grapple_production_routing_status = 'migrated_to_grapple_builds'
     and (
       new.current_stage is distinct from old.current_stage
       or new.current_stage_entered_at is distinct from old.current_stage_entered_at
       or new.closed_at is distinct from old.closed_at
     ) then
    raise exception 'Migrated grapple production rows are read-only in the service lifecycle'
      using errcode = '23514',
            hint = 'Use grapple_builds / transition_grapple_build_stage for production stage movement.';
  end if;

  return new;
end;
$$;

comment on function public.service_jobs_freeze_migrated_grapple_production_lifecycle() is
  'I8.1 guard: once a legacy service job is migrated into grapple_builds, service lifecycle stage/close mutations are blocked to keep production separate from service work orders.';

drop trigger if exists trg_service_jobs_freeze_migrated_grapple_production_lifecycle on public.service_jobs;
create trigger trg_service_jobs_freeze_migrated_grapple_production_lifecycle
  before update of current_stage, current_stage_entered_at, closed_at
  on public.service_jobs
  for each row execute function public.service_jobs_freeze_migrated_grapple_production_lifecycle();

-- ── Updated-at triggers -------------------------------------------------------

drop trigger if exists set_grapple_builds_updated_at on public.grapple_builds;
create trigger set_grapple_builds_updated_at
  before update on public.grapple_builds for each row
  execute function public.set_updated_at();

drop trigger if exists set_grapple_build_service_job_migrations_updated_at on public.grapple_build_service_job_migrations;
create trigger set_grapple_build_service_job_migrations_updated_at
  before update on public.grapple_build_service_job_migrations for each row
  execute function public.set_updated_at();
