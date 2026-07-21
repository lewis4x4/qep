-- ============================================================================
-- Migration 829: H9.1 / SV1-SV3 service-plan automation
--
-- Owner-approved scope:
--   * BlackRock may draft a provisional PM catalog, but QEP must review it
--     before activation.
--   * PM is due when either the hour threshold or calendar threshold arrives
--     first.
--   * Reviewed, active plans may enroll equipment and create one deduplicated
--     PM service job plus an auditable scheduling prompt.
--   * The PM scanner drains deterministic, resumable batches so scheduled work
--     never holds an unbounded set of schedule locks in one transaction.
--   * Agreement entitlements are an append-only grant/reserve/release/consume ledger;
--     available and reserved balances may never become negative.
--   * Generated PM work may end without completion only through a controlled,
--     reasoned cancellation that releases any reservation atomically.
--
-- This migration intentionally does not invent OEM kits, prices, labor times,
-- or customer-live program terms. The BlackRock rows are inactive operational
-- hypotheses until a QEP reviewer records approval and activates a program.
--
-- Rollback notes (run only after exporting/reconciling any live ledger rows):
--   1. Unschedule cron job service-plan-pm-daily.
--   2. Drop the service-plan triggers on service_jobs, then drop the controlled
--      RPCs, guards, balance view, and new service-plan tables in reverse FK
--      order (prompts, due events, scan runs, schedules, enrollments,
--      intervals, entitlement ledger).
--   3. Drop service_jobs.service_agreement_id,
--      service_plan_enrollment_id, service_plan_due_event_id, and
--      auto_generation_source only after confirming no downstream consumer
--      depends on them.
--   4. Delete only the three reserved BR-DRAFT-* rows created here, then drop
--      the review/activation columns from service_agreement_programs if no
--      later migration uses them.
--   5. Restore H9.1 roadmap evidence/state from the pre-migration snapshot.
--      Entitlement history is financial/audit evidence: never discard it as a
--      routine rollback shortcut.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Review/activation state on the existing program catalog
-- --------------------------------------------------------------------------

alter table public.service_agreement_programs
  add column if not exists is_provisional boolean not null default true,
  add column if not exists review_status text not null default 'draft',
  add column if not exists is_active boolean not null default false,
  add column if not exists catalog_owner text,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text,
  add column if not exists activated_by uuid references public.profiles(id) on delete set null,
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists source_evidence jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.service_agreement_programs'::regclass
      and conname = 'service_agreement_programs_review_status_check'
  ) then
    alter table public.service_agreement_programs
      add constraint service_agreement_programs_review_status_check
      check (review_status in ('draft', 'reviewed', 'changes_requested', 'retired'));
  end if;
end;
$$;

comment on column public.service_agreement_programs.is_provisional is
  'True until a QEP reviewer accepts the proposed program terms. Provisional programs cannot be activated.';
comment on column public.service_agreement_programs.review_status is
  'QEP review state. Activation requires a previously recorded reviewed state.';
comment on column public.service_agreement_programs.is_active is
  'Operational scanner switch. The activation guard rejects provisional, unreviewed, or interval-less programs.';

create index if not exists idx_service_agreement_programs_scanner_active
  on public.service_agreement_programs (workspace_id, id)
  where is_active and review_status = 'reviewed' and not is_provisional and deleted_at is null;

-- --------------------------------------------------------------------------
-- 2. Hour-or-calendar interval definitions and equipment enrollments
-- --------------------------------------------------------------------------

create table public.service_agreement_program_intervals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  program_id uuid not null references public.service_agreement_programs(id) on delete cascade,
  interval_code text not null,
  name text not null,
  interval_hours numeric(12, 1),
  interval_months integer,
  interval_days integer,
  entitlement_unit text not null default 'pm_service',
  entitlement_quantity numeric(12, 2) not null default 1,
  is_active boolean not null default true,
  source_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, program_id, interval_code),
  check (nullif(btrim(interval_code), '') is not null),
  check (interval_hours is null or interval_hours > 0),
  check (interval_months is null or interval_months > 0),
  check (interval_days is null or interval_days > 0),
  check (interval_hours is not null or interval_months is not null or interval_days is not null),
  check (entitlement_quantity > 0)
);

comment on table public.service_agreement_program_intervals is
  'Reviewed PM cadence definitions. When both thresholds exist, the scanner treats the interval as due when either threshold arrives first.';

create index idx_service_agreement_program_intervals_active
  on public.service_agreement_program_intervals (workspace_id, program_id, id)
  where is_active;

create table public.service_plan_equipment_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  service_agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  program_id uuid not null references public.service_agreement_programs(id) on delete restrict,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  status text not null default 'active',
  enrolled_on date not null,
  requested_baseline_hours numeric(12, 1),
  baseline_hours numeric(12, 1),
  baseline_source text not null,
  baseline_meter_reading_id uuid references public.equipment_meter_readings(id) on delete restrict,
  enrolled_by uuid references public.profiles(id) on delete restrict,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, service_agreement_id),
  check (status in ('active', 'paused', 'ended')),
  check (requested_baseline_hours is null or requested_baseline_hours >= 0),
  check (baseline_hours is null or baseline_hours >= 0),
  check (baseline_source in ('explicit', 'primary_actual_meter', 'not_required')),
  check (
    (
      baseline_source = 'explicit'
      and requested_baseline_hours is not null
      and baseline_hours = requested_baseline_hours
      and baseline_meter_reading_id is null
    )
    or (
      baseline_source = 'primary_actual_meter'
      and requested_baseline_hours is null
      and baseline_hours is not null
      and baseline_meter_reading_id is not null
    )
    or (
      baseline_source = 'not_required'
      and requested_baseline_hours is null
      and baseline_hours is null
      and baseline_meter_reading_id is null
    )
  ),
  check ((status = 'ended') = (ended_at is not null))
);

comment on table public.service_plan_equipment_enrollments is
  'One equipment enrollment per service agreement. Enrollment is allowed only after the linked program is reviewed and active.';
comment on column public.service_plan_equipment_enrollments.requested_baseline_hours is
  'Immutable caller-supplied enrollment baseline. Null means the caller requested primary-actual-meter derivation.';
comment on column public.service_plan_equipment_enrollments.baseline_meter_reading_id is
  'Primary actual meter-reading evidence used when the enrollment baseline was derived rather than supplied explicitly.';

create index idx_service_plan_equipment_enrollments_active
  on public.service_plan_equipment_enrollments (workspace_id, equipment_id, program_id)
  where status = 'active';

create index idx_service_plan_equipment_enrollments_baseline_meter
  on public.service_plan_equipment_enrollments (baseline_meter_reading_id)
  where baseline_meter_reading_id is not null;

create table public.service_plan_enrollment_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  enrollment_id uuid not null references public.service_plan_equipment_enrollments(id) on delete restrict,
  program_interval_id uuid not null references public.service_agreement_program_intervals(id) on delete restrict,
  cycle_number integer not null default 1,
  baseline_on date not null,
  baseline_hours numeric(12, 1),
  next_due_on date,
  next_due_hours numeric(12, 1),
  last_completed_job_id uuid references public.service_jobs(id) on delete set null,
  last_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, enrollment_id, program_interval_id),
  check (cycle_number > 0),
  check (baseline_hours is null or baseline_hours >= 0),
  check (next_due_hours is null or next_due_hours >= 0),
  check (next_due_on is not null or next_due_hours is not null)
);

comment on table public.service_plan_enrollment_schedules is
  'Current cadence anchor per enrolled program interval. Open due events prevent duplicate PM jobs until the prior job closes or follows controlled cancellation.';

create index idx_service_plan_enrollment_schedules_due_on
  on public.service_plan_enrollment_schedules (workspace_id, next_due_on)
  where next_due_on is not null;

create index idx_service_plan_enrollment_schedules_due_hours
  on public.service_plan_enrollment_schedules (workspace_id, next_due_hours)
  where next_due_hours is not null;

create index if not exists idx_equipment_meter_readings_pm_latest_actual
  on public.equipment_meter_readings
    (workspace_id, equipment_id, recorded_at desc, created_at desc, id desc)
  include (hours)
  where deleted_at is null
    and meter_index = 1
    and code = 'actual';

comment on index public.idx_equipment_meter_readings_pm_latest_actual is
  'Supports one latest primary-actual meter lookup per candidate equipment during bounded PM scans.';

create table public.service_plan_pm_scan_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  scan_date date not null,
  status text not null default 'running',
  due_count integer not null default 0,
  job_count integer not null default 0,
  batch_count integer not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  unique (workspace_id, scan_date),
  check (status in ('running', 'completed')),
  check (due_count >= 0 and job_count >= 0 and batch_count >= 0)
);

comment on table public.service_plan_pm_scan_runs is
  'Daily, workspace-scoped idempotency and resumable-batch progress record for the PM due scanner.';

create table public.service_plan_pm_due_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  scan_run_id uuid not null references public.service_plan_pm_scan_runs(id) on delete restrict,
  enrollment_id uuid not null references public.service_plan_equipment_enrollments(id) on delete restrict,
  schedule_id uuid not null references public.service_plan_enrollment_schedules(id) on delete restrict,
  program_interval_id uuid not null references public.service_agreement_program_intervals(id) on delete restrict,
  service_agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  service_job_id uuid references public.service_jobs(id) on delete restrict,
  due_basis text not null,
  due_on date,
  due_hours numeric(12, 1),
  observed_on date not null,
  observed_hours numeric(12, 1),
  cycle_number integer not null,
  status text not null default 'detected',
  entitlement_reservation_entry_id uuid,
  completed_at timestamptz,
  cancellation_kind text,
  cancellation_reason text,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (due_basis in ('hours', 'calendar', 'hours_and_calendar')),
  check (status in ('detected', 'job_created', 'completed', 'cancelled')),
  check (cancellation_kind is null or cancellation_kind in ('cancelled', 'deleted', 'abandoned')),
  check (
    (
      status = 'cancelled'
      and cancelled_at is not null
      and cancellation_kind is not null
      and nullif(btrim(cancellation_reason), '') is not null
      and cancelled_by is not null
    )
    or (
      status <> 'cancelled'
      and cancelled_at is null
      and cancellation_kind is null
      and cancellation_reason is null
      and cancelled_by is null
    )
  ),
  check (cycle_number > 0)
);

comment on table public.service_plan_pm_due_events is
  'Auditable due decision and generated-job link. A partial unique index permits only one open PM event per enrollment schedule.';
comment on column public.service_plan_pm_due_events.cancellation_kind is
  'Terminal reason class for a generated PM job ended without completion: cancelled, deleted, or abandoned.';

create unique index idx_service_plan_pm_due_events_one_open
  on public.service_plan_pm_due_events (workspace_id, schedule_id)
  where status in ('detected', 'job_created');

create index idx_service_plan_pm_due_events_job
  on public.service_plan_pm_due_events (workspace_id, service_job_id)
  where service_job_id is not null;

alter table public.service_jobs
  add column if not exists service_agreement_id uuid references public.service_agreements(id) on delete set null,
  add column if not exists service_plan_enrollment_id uuid references public.service_plan_equipment_enrollments(id) on delete set null,
  add column if not exists service_plan_due_event_id uuid references public.service_plan_pm_due_events(id) on delete set null,
  add column if not exists auto_generation_source text;

create unique index if not exists idx_service_jobs_service_plan_due_event
  on public.service_jobs (workspace_id, service_plan_due_event_id)
  where service_plan_due_event_id is not null and deleted_at is null;

create table public.service_plan_schedule_prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  due_event_id uuid not null references public.service_plan_pm_due_events(id) on delete restrict,
  service_job_id uuid not null references public.service_jobs(id) on delete restrict,
  prompt_type text not null default 'advisor_schedule_pm',
  prompt_key text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, prompt_key)
);

comment on table public.service_plan_schedule_prompts is
  'Append-only evidence that the scanner surfaced a generated PM job for scheduling; delivery UI may project from this ledger.';

create index idx_service_plan_schedule_prompts_job
  on public.service_plan_schedule_prompts (workspace_id, service_job_id, created_at desc);

-- --------------------------------------------------------------------------
-- 3. Append-only service-agreement entitlement ledger
-- --------------------------------------------------------------------------

create table public.service_agreement_entitlement_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  service_agreement_id uuid not null references public.service_agreements(id) on delete restrict,
  enrollment_id uuid references public.service_plan_equipment_enrollments(id) on delete restrict,
  service_job_id uuid references public.service_jobs(id) on delete restrict,
  entry_type text not null,
  unit_code text not null default 'pm_service',
  quantity numeric(12, 2) not null,
  idempotency_key text not null,
  related_entry_id uuid references public.service_agreement_entitlement_ledger(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, service_agreement_id, unit_code, idempotency_key),
  check (entry_type in ('grant', 'reserve', 'release', 'consume')),
  check (quantity > 0),
  check (nullif(btrim(unit_code), '') is not null),
  check (nullif(btrim(idempotency_key), '') is not null),
  check (nullif(btrim(reason), '') is not null)
);

comment on table public.service_agreement_entitlement_ledger is
  'Immutable grant/reserve/release/consume ledger. A serialized insert guard prevents negative available or reserved balances.';

create index idx_service_agreement_entitlement_ledger_balance
  on public.service_agreement_entitlement_ledger
    (workspace_id, service_agreement_id, unit_code, created_at, id);

alter table public.service_plan_pm_due_events
  add constraint service_plan_pm_due_events_entitlement_reservation_fk
  foreign key (entitlement_reservation_entry_id)
  references public.service_agreement_entitlement_ledger(id)
  on delete restrict;

create or replace view public.service_agreement_entitlement_balances
with (security_invoker = true)
as
select
  workspace_id,
  service_agreement_id,
  unit_code,
  sum(case entry_type
    when 'grant' then quantity
    when 'reserve' then -quantity
    when 'release' then quantity
    else 0
  end)::numeric(12, 2) as available_quantity,
  sum(case entry_type
    when 'reserve' then quantity
    when 'release' then -quantity
    when 'consume' then -quantity
    else 0
  end)::numeric(12, 2) as reserved_quantity,
  sum(case when entry_type = 'consume' then quantity else 0 end)::numeric(12, 2)
    as consumed_quantity,
  sum(case when entry_type = 'grant' then quantity else 0 end)::numeric(12, 2)
    as granted_quantity
from public.service_agreement_entitlement_ledger
group by workspace_id, service_agreement_id, unit_code;

comment on view public.service_agreement_entitlement_balances is
  'Current entitlement projection derived only from the append-only ledger.';

-- --------------------------------------------------------------------------
-- 4. Lifecycle, immutability, and balance guards
-- --------------------------------------------------------------------------

create or replace function public.service_plan_assert_elevated_operator(
  p_workspace_id text,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_role text := coalesce(auth.role(), '');
begin
  if nullif(btrim(p_workspace_id), '') is null then
    raise exception 'workspace_id is required' using errcode = '22023';
  end if;

  -- Trusted service/cron contexts remain workspace-explicit in every caller.
  if v_auth_role = 'service_role' or session_user = 'postgres' then
    return;
  end if;

  if v_auth_role <> 'authenticated'
     or auth.uid() is null
     or p_actor_id is null
     or p_actor_id <> auth.uid()
     or p_workspace_id <> public.get_my_workspace()
     or public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'service-plan operation requires an elevated actor in the active workspace'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.service_plan_assert_elevated_operator(text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.guard_service_agreement_program_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.is_active then
      raise exception 'a new service agreement program requires a separate review transition before activation'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.program_code is distinct from old.program_code then
    raise exception 'service agreement program workspace and code are immutable'
      using errcode = '23514';
  end if;

  v_term_changed :=
    new.name is distinct from old.name
    or new.sponsor is distinct from old.sponsor
    or new.description is distinct from old.description
    or new.catalog_owner is distinct from old.catalog_owner
    or new.source_evidence is distinct from old.source_evidence;

  if old.is_active and v_term_changed then
    raise exception 'deactivate the service agreement program before changing reviewed terms'
      using errcode = '23514';
  end if;

  if v_term_changed and exists (
    select 1
    from public.service_plan_equipment_enrollments e
    where e.workspace_id = old.workspace_id
      and e.program_id = old.id
      and e.status = 'active'
  ) then
    raise exception 'version the service agreement program instead of changing terms for active enrollments'
      using errcode = '23514';
  end if;

  -- Any inactive reviewed program whose operating terms change must be
  -- explicitly reviewed again before it can return to service.
  if v_term_changed and old.review_status = 'reviewed' then
    new.review_status := 'draft';
    new.is_provisional := true;
    new.is_active := false;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_notes := null;
    new.activated_by := null;
    new.activated_at := null;
  end if;

  if new.review_status = 'reviewed' and old.review_status <> 'reviewed' then
    perform public.service_plan_assert_elevated_operator(new.workspace_id, new.reviewed_by);

    if new.is_provisional
       or new.reviewed_by is null
       or new.reviewed_at is null
       or nullif(btrim(new.review_notes), '') is null then
      raise exception 'QEP review requires non-provisional terms, reviewer, timestamp, and notes'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.service_agreement_program_intervals i
      where i.workspace_id = new.workspace_id
        and i.program_id = new.id
        and i.is_active
    ) then
      raise exception 'QEP review requires at least one active hour-or-calendar interval'
        using errcode = '23514';
    end if;
  end if;

  if new.review_status = 'reviewed'
     and old.review_status = 'reviewed'
     and (
       new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.review_notes is distinct from old.review_notes
     ) then
    raise exception 'recorded service agreement review evidence is immutable; return the program to draft for a new review transition'
      using errcode = '23514';
  end if;

  if new.is_active and not old.is_active then
    perform public.service_plan_assert_elevated_operator(new.workspace_id, new.activated_by);

    -- OLD must already be reviewed. This blocks review+activation in one write
    -- and makes the QEP review a recorded gate, not a boolean bypass.
    if old.review_status <> 'reviewed'
       or old.is_provisional
       or new.review_status <> 'reviewed'
       or new.is_provisional
       or new.activated_by is null
       or new.activated_at is null then
      raise exception 'activation requires a previously recorded QEP-reviewed, non-provisional program'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.service_agreement_program_intervals i
      where i.workspace_id = new.workspace_id
        and i.program_id = new.id
        and i.is_active
    ) then
      raise exception 'activation requires at least one active interval'
        using errcode = '23514';
    end if;

    new.deactivated_at := null;
  elsif not new.is_active and old.is_active then
    perform public.service_plan_assert_elevated_operator(new.workspace_id, coalesce(auth.uid(), old.activated_by));
    new.deactivated_at := coalesce(new.deactivated_at, now());
  end if;

  if new.review_status = 'retired' then
    new.is_active := false;
    new.deactivated_at := coalesce(new.deactivated_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.guard_service_agreement_program_activation()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_service_agreement_program_activation
  on public.service_agreement_programs;
create trigger guard_service_agreement_program_activation
  before insert or update on public.service_agreement_programs
  for each row execute function public.guard_service_agreement_program_activation();

create or replace function public.guard_service_agreement_program_interval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program public.service_agreement_programs%rowtype;
begin
  select *
  into v_program
  from public.service_agreement_programs
  where id = coalesce(new.program_id, old.program_id)
  for update;

  if not found then
    raise exception 'service agreement program not found' using errcode = '23503';
  end if;

  if v_program.workspace_id <> coalesce(new.workspace_id, old.workspace_id) then
    raise exception 'program interval workspace mismatch' using errcode = '23514';
  end if;

  if v_program.is_active then
    raise exception 'deactivate the service agreement program before changing intervals'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.service_plan_equipment_enrollments e
    where e.workspace_id = v_program.workspace_id
      and e.program_id = v_program.id
      and e.status = 'active'
  ) then
    raise exception 'version the service agreement program instead of changing intervals for active enrollments'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    new.workspace_id is distinct from old.workspace_id
    or new.program_id is distinct from old.program_id
  ) then
    raise exception 'program interval workspace and program are immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.reset_program_review_after_interval_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.service_agreement_programs
  set review_status = 'draft',
      is_provisional = true,
      is_active = false,
      reviewed_by = null,
      reviewed_at = null,
      review_notes = null,
      activated_by = null,
      activated_at = null,
      updated_at = now()
  where id = coalesce(new.program_id, old.program_id)
    and (
      review_status <> 'draft'
      or not is_provisional
      or is_active
      or reviewed_by is not null
      or reviewed_at is not null
      or review_notes is not null
      or activated_by is not null
      or activated_at is not null
    );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_service_agreement_program_interval()
  from public, anon, authenticated, service_role;
revoke all on function public.reset_program_review_after_interval_change()
  from public, anon, authenticated, service_role;

create trigger guard_service_agreement_program_interval
  before insert or update or delete on public.service_agreement_program_intervals
  for each row execute function public.guard_service_agreement_program_interval();

create trigger reset_program_review_after_interval_change
  after insert or update or delete on public.service_agreement_program_intervals
  for each row execute function public.reset_program_review_after_interval_change();

create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;

revoke all on function public.reject_append_only_mutation()
  from public, anon, authenticated, service_role;

create trigger service_plan_schedule_prompts_append_only
  before update or delete on public.service_plan_schedule_prompts
  for each row execute function public.reject_append_only_mutation();

create trigger service_agreement_entitlement_ledger_append_only
  before update or delete on public.service_agreement_entitlement_ledger
  for each row execute function public.reject_append_only_mutation();

create or replace function public.guard_service_agreement_entitlement_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available numeric(12, 2) := 0;
  v_reserved numeric(12, 2) := 0;
  v_related_quantity numeric(12, 2);
  v_related_enrollment_id uuid;
  v_related_service_job_id uuid;
  v_related_used numeric(12, 2) := 0;
begin
  if not exists (
    select 1
    from public.service_agreements a
    where a.id = new.service_agreement_id
      and a.workspace_id = new.workspace_id
      and a.deleted_at is null
  ) then
    raise exception 'entitlement agreement workspace mismatch or deleted agreement'
      using errcode = '23514';
  end if;

  if new.enrollment_id is not null and not exists (
    select 1
    from public.service_plan_equipment_enrollments e
    where e.id = new.enrollment_id
      and e.workspace_id = new.workspace_id
      and e.service_agreement_id = new.service_agreement_id
  ) then
    raise exception 'entitlement enrollment does not belong to the agreement workspace'
      using errcode = '23514';
  end if;

  if new.service_job_id is not null and not exists (
    select 1
    from public.service_jobs j
    where j.id = new.service_job_id
      and j.workspace_id = new.workspace_id
      and j.service_agreement_id = new.service_agreement_id
      and (
        new.enrollment_id is null
        or j.service_plan_enrollment_id = new.enrollment_id
      )
      and j.deleted_at is null
  ) then
    raise exception 'entitlement service job does not belong to the agreement/enrollment workspace'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'service-plan-entitlement:' || new.workspace_id || ':' ||
      new.service_agreement_id::text || ':' || new.unit_code,
      0
    )
  );

  select
    coalesce(sum(case entry_type
      when 'grant' then quantity
      when 'reserve' then -quantity
      when 'release' then quantity
      else 0
    end), 0),
    coalesce(sum(case entry_type
      when 'reserve' then quantity
      when 'release' then -quantity
      when 'consume' then -quantity
      else 0
    end), 0)
  into v_available, v_reserved
  from public.service_agreement_entitlement_ledger
  where workspace_id = new.workspace_id
    and service_agreement_id = new.service_agreement_id
    and unit_code = new.unit_code;

  if new.entry_type in ('grant', 'reserve') and new.related_entry_id is not null then
    raise exception '% entries cannot reference a prior ledger entry', new.entry_type
      using errcode = '23514';
  end if;

  if new.entry_type = 'reserve' and v_available < new.quantity then
    raise exception 'insufficient available entitlement: available %, requested %', v_available, new.quantity
      using errcode = '23514';
  end if;

  if new.entry_type in ('release', 'consume') then
    if new.related_entry_id is null then
      raise exception '% requires the related reserve entry', new.entry_type
        using errcode = '23514';
    end if;

    select r.quantity, r.enrollment_id, r.service_job_id
    into v_related_quantity, v_related_enrollment_id, v_related_service_job_id
    from public.service_agreement_entitlement_ledger r
    where r.id = new.related_entry_id
      and r.workspace_id = new.workspace_id
      and r.service_agreement_id = new.service_agreement_id
      and r.unit_code = new.unit_code
      and r.entry_type = 'reserve'
    for share;

    if not found then
      raise exception 'related entitlement reserve not found in this agreement/unit ledger'
        using errcode = '23514';
    end if;

    if new.enrollment_id is distinct from v_related_enrollment_id
       or new.service_job_id is distinct from v_related_service_job_id then
      raise exception 'release/consume links must match the related reserve enrollment and service job'
        using errcode = '23514';
    end if;

    select coalesce(sum(quantity), 0)
    into v_related_used
    from public.service_agreement_entitlement_ledger
    where related_entry_id = new.related_entry_id
      and workspace_id = new.workspace_id
      and service_agreement_id = new.service_agreement_id
      and unit_code = new.unit_code
      and entry_type in ('release', 'consume');

    if v_related_quantity - v_related_used < new.quantity
       or v_reserved < new.quantity then
      raise exception 'entitlement reserve would become negative'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_service_agreement_entitlement_insert()
  from public, anon, authenticated, service_role;

create trigger guard_service_agreement_entitlement_insert
  before insert on public.service_agreement_entitlement_ledger
  for each row execute function public.guard_service_agreement_entitlement_insert();

-- --------------------------------------------------------------------------
-- 5. Workspace RLS and least-privilege table access
-- --------------------------------------------------------------------------

do $rls$
declare
  v_table text;
  v_tables text[] := array[
    'service_agreement_program_intervals',
    'service_plan_equipment_enrollments',
    'service_plan_enrollment_schedules',
    'service_plan_pm_scan_runs',
    'service_plan_pm_due_events',
    'service_plan_schedule_prompts',
    'service_agreement_entitlement_ledger'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (workspace_id = (select public.get_my_workspace()))',
      v_table || '_workspace_select',
      v_table
    );
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      v_table || '_service_all',
      v_table
    );
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format('grant select on table public.%I to service_role', v_table);
  end loop;
end;
$rls$;

alter table public.service_agreement_programs force row level security;

revoke all on table public.service_agreement_entitlement_balances
  from public, anon, authenticated, service_role;
grant select on table public.service_agreement_entitlement_balances to authenticated;
grant select on table public.service_agreement_entitlement_balances to service_role;

-- --------------------------------------------------------------------------
-- 6. Controlled catalog, review, activation, enrollment, and ledger RPCs
-- --------------------------------------------------------------------------

create or replace function public.service_plan_save_program_interval(
  p_workspace_id text,
  p_program_id uuid,
  p_interval_code text,
  p_name text,
  p_interval_hours numeric,
  p_interval_months integer,
  p_interval_days integer,
  p_entitlement_unit text default 'pm_service',
  p_entitlement_quantity numeric default 1,
  p_source_evidence jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns public.service_agreement_program_intervals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_agreement_program_intervals%rowtype;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  if nullif(btrim(p_interval_code), '') is null
     or nullif(btrim(p_name), '') is null
     or (p_interval_hours is null and p_interval_months is null and p_interval_days is null)
     or coalesce(p_interval_hours, 1) <= 0
     or coalesce(p_interval_months, 1) <= 0
     or coalesce(p_interval_days, 1) <= 0
     or coalesce(p_entitlement_quantity, 0) <= 0 then
    raise exception 'valid interval code/name, a positive hour or calendar threshold, and positive entitlement quantity are required'
      using errcode = '22023';
  end if;

  insert into public.service_agreement_program_intervals (
    workspace_id,
    program_id,
    interval_code,
    name,
    interval_hours,
    interval_months,
    interval_days,
    entitlement_unit,
    entitlement_quantity,
    source_evidence
  ) values (
    p_workspace_id,
    p_program_id,
    upper(btrim(p_interval_code)),
    btrim(p_name),
    p_interval_hours,
    p_interval_months,
    p_interval_days,
    coalesce(nullif(btrim(p_entitlement_unit), ''), 'pm_service'),
    p_entitlement_quantity,
    coalesce(p_source_evidence, '{}'::jsonb)
  )
  on conflict (workspace_id, program_id, interval_code) do update
  set name = excluded.name,
      interval_hours = excluded.interval_hours,
      interval_months = excluded.interval_months,
      interval_days = excluded.interval_days,
      entitlement_unit = excluded.entitlement_unit,
      entitlement_quantity = excluded.entitlement_quantity,
      source_evidence = excluded.source_evidence,
      is_active = true,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.service_plan_review_program(
  p_workspace_id text,
  p_program_id uuid,
  p_reviewer_id uuid,
  p_review_notes text
)
returns public.service_agreement_programs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_agreement_programs%rowtype;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_reviewer_id);

  if nullif(btrim(p_review_notes), '') is null then
    raise exception 'review notes are required' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.service_agreement_programs
  where id = p_program_id
    and workspace_id = p_workspace_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'service agreement program not found' using errcode = 'P0002';
  end if;

  if v_row.is_active then
    raise exception 'deactivate the program before recording a new review'
      using errcode = '23514';
  end if;

  update public.service_agreement_programs
  set is_provisional = false,
      review_status = 'reviewed',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      review_notes = btrim(p_review_notes),
      updated_at = now()
  where id = p_program_id
    and workspace_id = p_workspace_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.service_plan_set_program_activation(
  p_workspace_id text,
  p_program_id uuid,
  p_is_active boolean,
  p_actor_id uuid
)
returns public.service_agreement_programs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_agreement_programs%rowtype;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  select *
  into v_row
  from public.service_agreement_programs
  where id = p_program_id
    and workspace_id = p_workspace_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'service agreement program not found' using errcode = 'P0002';
  end if;

  if v_row.is_active = p_is_active then
    return v_row;
  end if;

  update public.service_agreement_programs
  set is_active = p_is_active,
      activated_by = case when p_is_active then p_actor_id else activated_by end,
      activated_at = case when p_is_active then now() else activated_at end,
      deactivated_at = case when p_is_active then null else now() end,
      updated_at = now()
  where id = p_program_id
    and workspace_id = p_workspace_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.service_plan_post_entitlement(
  p_workspace_id text,
  p_service_agreement_id uuid,
  p_entry_type text,
  p_unit_code text,
  p_quantity numeric,
  p_idempotency_key text,
  p_reason text,
  p_actor_id uuid,
  p_enrollment_id uuid default null,
  p_service_job_id uuid default null,
  p_related_entry_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.service_agreement_entitlement_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_agreement_entitlement_ledger%rowtype;
  v_unit_code text;
  v_idempotency_key text;
  v_reason text;
  v_metadata jsonb;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  if p_entry_type is null
     or p_entry_type not in ('grant', 'reserve', 'release', 'consume')
     or p_service_agreement_id is null
     or coalesce(p_quantity, 0) <= 0
     or p_quantity <> round(p_quantity, 2)
     or nullif(btrim(p_unit_code), '') is null
     or nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_reason), '') is null then
    raise exception 'valid entry type, agreement, unit, positive two-decimal quantity, idempotency key, and reason are required'
      using errcode = '22023';
  end if;

  v_unit_code := btrim(p_unit_code);
  v_idempotency_key := btrim(p_idempotency_key);
  v_reason := btrim(p_reason);
  v_metadata := coalesce(p_metadata, '{}'::jsonb);

  if v_idempotency_key like 'pm-reserve:%'
     or v_idempotency_key like 'pm-consume:%'
     or v_idempotency_key like 'pm-cancel-release:%' then
    raise exception 'pm-reserve, pm-consume, and pm-cancel-release idempotency namespaces are system-managed'
      using errcode = '23514';
  end if;

  if p_entry_type in ('release', 'consume')
     and p_related_entry_id is not null
     and exists (
       select 1
       from public.service_agreement_entitlement_ledger r
       where r.id = p_related_entry_id
         and r.workspace_id = p_workspace_id
         and r.service_agreement_id = p_service_agreement_id
         and r.unit_code = v_unit_code
         and r.entry_type = 'reserve'
         and r.idempotency_key like 'pm-reserve:%'
     ) then
    raise exception 'auto-generated PM reservations must be released by cancellation or consumed by paid closeout'
      using errcode = '23514';
  end if;

  -- Serialize source-key inspection before the BEFORE INSERT balance guard.
  -- PostgreSQL fires that guard before ON CONFLICT, so relying on a conflict
  -- clause alone makes an exact reserve/release/consume retry fail after the
  -- first write changes the balance.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'service-plan-entitlement:' || p_workspace_id || ':' ||
      p_service_agreement_id::text || ':' || v_unit_code,
      0
    )
  );

  select *
  into v_row
  from public.service_agreement_entitlement_ledger
  where workspace_id = p_workspace_id
    and service_agreement_id = p_service_agreement_id
    and unit_code = v_unit_code
    and idempotency_key = v_idempotency_key;

  if found then
    if v_row.entry_type is distinct from p_entry_type
       or v_row.quantity is distinct from p_quantity
       or v_row.enrollment_id is distinct from p_enrollment_id
       or v_row.service_job_id is distinct from p_service_job_id
       or v_row.related_entry_id is distinct from p_related_entry_id
       or v_row.actor_id is distinct from p_actor_id
       or v_row.reason is distinct from v_reason
       or v_row.metadata is distinct from v_metadata then
      raise exception 'entitlement idempotency key conflicts with an existing source payload'
        using errcode = '23514';
    end if;

    return v_row;
  end if;

  insert into public.service_agreement_entitlement_ledger (
    workspace_id,
    service_agreement_id,
    enrollment_id,
    service_job_id,
    entry_type,
    unit_code,
    quantity,
    idempotency_key,
    related_entry_id,
    actor_id,
    reason,
    metadata
  ) values (
    p_workspace_id,
    p_service_agreement_id,
    p_enrollment_id,
    p_service_job_id,
    p_entry_type,
    v_unit_code,
    p_quantity,
    v_idempotency_key,
    p_related_entry_id,
    p_actor_id,
    v_reason,
    v_metadata
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.service_plan_cancel_pm_due_event(
  p_workspace_id text,
  p_due_event_id uuid,
  p_cancellation_kind text,
  p_reason text,
  p_actor_id uuid
)
returns public.service_plan_pm_due_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due public.service_plan_pm_due_events%rowtype;
  v_reservation public.service_agreement_entitlement_ledger%rowtype;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  if p_due_event_id is null
     or p_actor_id is null
     or p_cancellation_kind is null
     or p_cancellation_kind not in ('cancelled', 'deleted', 'abandoned')
     or nullif(btrim(p_reason), '') is null then
    raise exception 'due event, attributable actor, cancellation kind, and reason are required'
      using errcode = '22023';
  end if;

  select *
  into v_due
  from public.service_plan_pm_due_events
  where id = p_due_event_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'service-plan PM due event not found' using errcode = 'P0002';
  end if;

  if v_due.status = 'cancelled' then
    if v_due.cancellation_kind is distinct from p_cancellation_kind
       or v_due.cancellation_reason is distinct from btrim(p_reason)
       or v_due.cancelled_by is distinct from p_actor_id then
      raise exception 'PM cancellation retry conflicts with the recorded disposition'
        using errcode = '23514';
    end if;
    return v_due;
  end if;

  if v_due.status = 'completed' then
    raise exception 'a completed PM cycle cannot be cancelled'
      using errcode = '23514';
  end if;

  if v_due.entitlement_reservation_entry_id is not null then
    select *
    into v_reservation
    from public.service_agreement_entitlement_ledger
    where id = v_due.entitlement_reservation_entry_id
      and workspace_id = p_workspace_id
      and service_agreement_id = v_due.service_agreement_id
      and enrollment_id = v_due.enrollment_id
      and service_job_id is not distinct from v_due.service_job_id
      and entry_type = 'reserve'
    for share;

    if not found then
      raise exception 'PM due event reservation evidence is missing or inconsistent'
        using errcode = '23514';
    end if;

    insert into public.service_agreement_entitlement_ledger (
      workspace_id,
      service_agreement_id,
      enrollment_id,
      service_job_id,
      entry_type,
      unit_code,
      quantity,
      idempotency_key,
      related_entry_id,
      actor_id,
      reason,
      metadata
    ) values (
      p_workspace_id,
      v_due.service_agreement_id,
      v_due.enrollment_id,
      v_due.service_job_id,
      'release',
      v_reservation.unit_code,
      v_reservation.quantity,
      'pm-cancel-release:' || v_due.id::text,
      v_reservation.id,
      p_actor_id,
      'Released because generated PM work was ' || p_cancellation_kind || ': ' || btrim(p_reason),
      jsonb_build_object(
        'due_event_id', v_due.id,
        'cancellation_kind', p_cancellation_kind,
        'reservation_entry_id', v_reservation.id
      )
    );
  end if;

  update public.service_plan_pm_due_events
  set status = 'cancelled',
      cancellation_kind = p_cancellation_kind,
      cancellation_reason = btrim(p_reason),
      cancelled_by = p_actor_id,
      cancelled_at = now()
  where id = v_due.id
    and workspace_id = p_workspace_id
  returning * into v_due;

  if v_due.service_job_id is not null then
    insert into public.service_job_events (
      workspace_id,
      job_id,
      event_type,
      actor_id,
      metadata
    ) values (
      p_workspace_id,
      v_due.service_job_id,
      'pm_service_plan_cycle_cancelled',
      p_actor_id,
      jsonb_build_object(
        'due_event_id', v_due.id,
        'cancellation_kind', p_cancellation_kind,
        'reason', btrim(p_reason),
        'entitlement_released', v_due.entitlement_reservation_entry_id is not null
      )
    );

    update public.service_jobs
    set deleted_at = coalesce(deleted_at, now()),
        updated_at = now()
    where id = v_due.service_job_id
      and workspace_id = p_workspace_id
      and service_plan_due_event_id = v_due.id;

    if not found then
      raise exception 'generated PM service job is missing or no longer linked to its due event'
        using errcode = '23514';
    end if;
  end if;

  return v_due;
end;
$$;

create or replace function public.guard_service_plan_pm_job_abandonment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due_event_id uuid;
begin
  if tg_op = 'DELETE' then
    v_due_event_id := old.service_plan_due_event_id;
  else
    if old.deleted_at is not null or new.deleted_at is null then
      return new;
    end if;
    v_due_event_id := old.service_plan_due_event_id;
  end if;

  if v_due_event_id is not null and exists (
    select 1
    from public.service_plan_pm_due_events d
    where d.id = v_due_event_id
      and d.workspace_id = old.workspace_id
      and d.service_job_id = old.id
      and d.status = 'job_created'
  ) then
    raise exception 'use service_plan_cancel_pm_due_event to cancel, delete, or abandon generated PM work'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_service_plan_pm_job_abandonment()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_service_plan_pm_job_soft_delete on public.service_jobs;
create trigger guard_service_plan_pm_job_soft_delete
  before update of deleted_at on public.service_jobs
  for each row execute function public.guard_service_plan_pm_job_abandonment();

drop trigger if exists guard_service_plan_pm_job_delete on public.service_jobs;
create trigger guard_service_plan_pm_job_delete
  before delete on public.service_jobs
  for each row execute function public.guard_service_plan_pm_job_abandonment();

create or replace function public.service_plan_enroll_equipment(
  p_workspace_id text,
  p_service_agreement_id uuid,
  p_enrolled_on date,
  p_baseline_hours numeric,
  p_actor_id uuid
)
returns public.service_plan_equipment_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement public.service_agreements%rowtype;
  v_program public.service_agreement_programs%rowtype;
  v_enrollment public.service_plan_equipment_enrollments%rowtype;
  v_baseline_hours numeric(12, 1);
  v_baseline_source text;
  v_baseline_meter_reading_id uuid;
  v_requires_hour_baseline boolean;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  if p_service_agreement_id is null
     or p_enrolled_on is null
     or (
       p_baseline_hours is not null
       and (
         p_baseline_hours < 0
         or p_baseline_hours <> round(p_baseline_hours, 1)
       )
     ) then
    raise exception 'agreement, enrollment date, and non-negative one-decimal baseline hours are required'
      using errcode = '22023';
  end if;

  select *
  into v_agreement
  from public.service_agreements
  where id = p_service_agreement_id
    and workspace_id = p_workspace_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'service agreement not found in the workspace'
      using errcode = 'P0002';
  end if;

  -- The agreement row lock serializes every enrollment attempt for this
  -- source agreement. Exact retries return the original immutable enrollment
  -- evidence even if the live plan is later paused/deactivated or its cadence
  -- schedules have advanced. Different source inputs are never accepted as a
  -- successful retry.
  select *
  into v_enrollment
  from public.service_plan_equipment_enrollments
  where workspace_id = p_workspace_id
    and service_agreement_id = p_service_agreement_id
  for update;

  if found then
    if v_enrollment.program_id is distinct from v_agreement.program_id
       or v_enrollment.equipment_id is distinct from v_agreement.equipment_id
       or v_enrollment.enrolled_on is distinct from p_enrolled_on
       or v_enrollment.requested_baseline_hours is distinct from p_baseline_hours
       or v_enrollment.enrolled_by is distinct from p_actor_id then
      raise exception 'service-plan enrollment retry conflicts with recorded date, baseline, actor, program, or equipment evidence'
        using errcode = '23514';
    end if;

    return v_enrollment;
  end if;

  if v_agreement.status <> 'active'
     or v_agreement.program_id is null
     or v_agreement.equipment_id is null
     or (v_agreement.starts_on is not null and v_agreement.starts_on > p_enrolled_on)
     or (v_agreement.expires_on is not null and v_agreement.expires_on < p_enrolled_on) then
    raise exception 'an active, in-term agreement with a program and equipment is required'
      using errcode = '23514';
  end if;

  select *
  into v_program
  from public.service_agreement_programs
  where id = v_agreement.program_id
    and workspace_id = p_workspace_id
    and is_active
    and review_status = 'reviewed'
    and not is_provisional
    and deleted_at is null;

  if not found then
    raise exception 'equipment enrollment requires a reviewed, active, non-provisional program'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.qrm_equipment e
    where e.id = v_agreement.equipment_id
      and e.workspace_id = p_workspace_id
      and e.deleted_at is null
  ) then
    raise exception 'agreement equipment is missing from the workspace'
      using errcode = '23514';
  end if;

  v_baseline_hours := p_baseline_hours;
  if v_baseline_hours is null then
    select r.id, r.hours
    into v_baseline_meter_reading_id, v_baseline_hours
    from public.equipment_meter_readings r
    where r.workspace_id = p_workspace_id
      and r.equipment_id = v_agreement.equipment_id
      and r.meter_index = 1
      and r.code = 'actual'
      and r.recorded_at <= p_enrolled_on
      and r.deleted_at is null
    order by r.recorded_at desc, r.created_at desc, r.id desc
    limit 1;
  end if;

  select exists (
    select 1
      from public.service_agreement_program_intervals i
     where i.workspace_id = p_workspace_id
       and i.program_id = v_program.id
       and i.is_active
       and i.interval_hours is not null
  ) into v_requires_hour_baseline;

  if v_baseline_hours is null and v_requires_hour_baseline then
    raise exception 'hour-based service-plan enrollment requires a non-negative baseline or a primary actual meter reading'
      using errcode = '23514';
  end if;

  v_baseline_source := case
    when p_baseline_hours is not null then 'explicit'
    when v_baseline_meter_reading_id is not null then 'primary_actual_meter'
    else 'not_required'
  end;

  insert into public.service_plan_equipment_enrollments (
    workspace_id,
    service_agreement_id,
    program_id,
    equipment_id,
    enrolled_on,
    requested_baseline_hours,
    baseline_hours,
    baseline_source,
    baseline_meter_reading_id,
    enrolled_by
  ) values (
    p_workspace_id,
    v_agreement.id,
    v_program.id,
    v_agreement.equipment_id,
    p_enrolled_on,
    p_baseline_hours,
    v_baseline_hours,
    v_baseline_source,
    v_baseline_meter_reading_id,
    p_actor_id
  )
  returning * into v_enrollment;

  insert into public.service_plan_enrollment_schedules (
    workspace_id,
    enrollment_id,
    program_interval_id,
    baseline_on,
    baseline_hours,
    next_due_on,
    next_due_hours
  )
  select
    p_workspace_id,
    v_enrollment.id,
    i.id,
    p_enrolled_on,
    v_baseline_hours,
    case
      when i.interval_months is null and i.interval_days is null then null
      else (
        p_enrolled_on + make_interval(
          months => coalesce(i.interval_months, 0),
          days => coalesce(i.interval_days, 0)
        )
      )::date
    end,
    case when i.interval_hours is null or v_baseline_hours is null
      then null
      else v_baseline_hours + i.interval_hours
    end
  from public.service_agreement_program_intervals i
  where i.workspace_id = p_workspace_id
    and i.program_id = v_program.id
    and i.is_active;

  if coalesce(v_agreement.included_pm_services, 0) > 0 then
    insert into public.service_agreement_entitlement_ledger (
      workspace_id,
      service_agreement_id,
      enrollment_id,
      entry_type,
      unit_code,
      quantity,
      idempotency_key,
      actor_id,
      reason,
      metadata
    ) values (
      p_workspace_id,
      v_agreement.id,
      v_enrollment.id,
      'grant',
      'pm_service',
      v_agreement.included_pm_services,
      'enrollment-grant:' || v_enrollment.id::text,
      p_actor_id,
      'Included PM services granted at reviewed program enrollment',
      jsonb_build_object('program_id', v_program.id, 'source', 'service_agreements.included_pm_services')
    )
    on conflict (workspace_id, service_agreement_id, unit_code, idempotency_key)
    do nothing;
  end if;

  return v_enrollment;
end;
$$;

create or replace function public.service_plan_set_enrollment_status(
  p_workspace_id text,
  p_enrollment_id uuid,
  p_status text,
  p_actor_id uuid,
  p_reason text default null
)
returns public.service_plan_equipment_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.service_plan_equipment_enrollments%rowtype;
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);

  if p_status not in ('active', 'paused', 'ended') then
    raise exception 'enrollment status must be active, paused, or ended'
      using errcode = '22023';
  end if;

  select *
  into v_row
  from public.service_plan_equipment_enrollments
  where id = p_enrollment_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'service-plan enrollment not found' using errcode = 'P0002';
  end if;

  if v_row.status = 'ended' and p_status <> 'ended' then
    raise exception 'ended service-plan enrollments are final; create a new agreement enrollment'
      using errcode = '23514';
  end if;

  if p_status = 'ended' then
    if nullif(btrim(p_reason), '') is null then
      raise exception 'ending a service-plan enrollment requires a reason'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.service_plan_pm_due_events d
      where d.workspace_id = p_workspace_id
        and d.enrollment_id = p_enrollment_id
        and d.status in ('detected', 'job_created')
    ) then
      raise exception 'resolve the open PM due job before ending the enrollment'
        using errcode = '23514';
    end if;
  end if;

  update public.service_plan_equipment_enrollments
  set status = p_status,
      ended_at = case when p_status = 'ended' then now() else null end,
      end_reason = case when p_status = 'ended' then btrim(p_reason) else null end,
      updated_at = now()
  where id = p_enrollment_id
    and workspace_id = p_workspace_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.service_plan_save_program_interval(
  text, uuid, text, text, numeric, integer, integer, text, numeric, jsonb, uuid
) from public, anon;
revoke all on function public.service_plan_review_program(text, uuid, uuid, text)
  from public, anon;
revoke all on function public.service_plan_set_program_activation(text, uuid, boolean, uuid)
  from public, anon;
revoke all on function public.service_plan_post_entitlement(
  text, uuid, text, text, numeric, text, text, uuid, uuid, uuid, uuid, jsonb
) from public, anon;
revoke all on function public.service_plan_cancel_pm_due_event(text, uuid, text, text, uuid)
  from public, anon;
revoke all on function public.service_plan_enroll_equipment(text, uuid, date, numeric, uuid)
  from public, anon;
revoke all on function public.service_plan_set_enrollment_status(text, uuid, text, uuid, text)
  from public, anon;

grant execute on function public.service_plan_save_program_interval(
  text, uuid, text, text, numeric, integer, integer, text, numeric, jsonb, uuid
) to authenticated, service_role;
grant execute on function public.service_plan_review_program(text, uuid, uuid, text)
  to authenticated, service_role;
grant execute on function public.service_plan_set_program_activation(text, uuid, boolean, uuid)
  to authenticated, service_role;
grant execute on function public.service_plan_post_entitlement(
  text, uuid, text, text, numeric, text, text, uuid, uuid, uuid, uuid, jsonb
) to authenticated, service_role;
grant execute on function public.service_plan_cancel_pm_due_event(text, uuid, text, text, uuid)
  to authenticated, service_role;
grant execute on function public.service_plan_enroll_equipment(text, uuid, date, numeric, uuid)
  to authenticated, service_role;
grant execute on function public.service_plan_set_enrollment_status(text, uuid, text, uuid, text)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 7. Inactive BlackRock first-pass catalog (QEP workspace only)
-- --------------------------------------------------------------------------

insert into public.service_agreement_programs (
  workspace_id,
  program_code,
  name,
  sponsor,
  description,
  is_provisional,
  review_status,
  is_active,
  catalog_owner,
  source_evidence
)
values
  (
    'default',
    'BR-DRAFT-PM-250',
    'BlackRock Draft 250-Hour / 6-Month PM',
    'BlackRock provisional draft',
    'Inactive first-pass cadence hypothesis only. QEP must verify the OEM/model fit, scope, kit, labor, and customer terms before review and activation.',
    true,
    'draft',
    false,
    'BlackRock',
    jsonb_build_object(
      'owner_answers', jsonb_build_array('SV1', 'SV2', 'SV3'),
      'status', 'provisional_not_customer_live',
      'requires', jsonb_build_array('qep_review', 'oem_model_validation', 'kit_and_labor_validation')
    )
  ),
  (
    'default',
    'BR-DRAFT-PM-500',
    'BlackRock Draft 500-Hour / 12-Month PM',
    'BlackRock provisional draft',
    'Inactive first-pass cadence hypothesis only. QEP must verify the OEM/model fit, scope, kit, labor, and customer terms before review and activation.',
    true,
    'draft',
    false,
    'BlackRock',
    jsonb_build_object(
      'owner_answers', jsonb_build_array('SV1', 'SV2', 'SV3'),
      'status', 'provisional_not_customer_live',
      'requires', jsonb_build_array('qep_review', 'oem_model_validation', 'kit_and_labor_validation')
    )
  ),
  (
    'default',
    'BR-DRAFT-PM-1000',
    'BlackRock Draft 1,000-Hour / 24-Month PM',
    'BlackRock provisional draft',
    'Inactive first-pass cadence hypothesis only. QEP must verify the OEM/model fit, scope, kit, labor, and customer terms before review and activation.',
    true,
    'draft',
    false,
    'BlackRock',
    jsonb_build_object(
      'owner_answers', jsonb_build_array('SV1', 'SV2', 'SV3'),
      'status', 'provisional_not_customer_live',
      'requires', jsonb_build_array('qep_review', 'oem_model_validation', 'kit_and_labor_validation')
    )
  )
on conflict (workspace_id, program_code) do nothing;

insert into public.service_agreement_program_intervals (
  workspace_id,
  program_id,
  interval_code,
  name,
  interval_hours,
  interval_months,
  interval_days,
  entitlement_unit,
  entitlement_quantity,
  source_evidence
)
select
  'default',
  p.id,
  proposed.interval_code,
  proposed.name,
  proposed.interval_hours,
  proposed.interval_months,
  proposed.interval_days,
  'pm_service',
  1,
  jsonb_build_object(
    'status', 'provisional_not_customer_live',
    'semantics', 'hour_or_calendar_whichever_first',
    'requires_qep_review', true
  )
from (
  values
    ('BR-DRAFT-PM-250', 'PM-250-6M', '250 hours or 6 months, whichever comes first', 250::numeric, 6, null::integer),
    ('BR-DRAFT-PM-500', 'PM-500-12M', '500 hours or 12 months, whichever comes first', 500::numeric, 12, null::integer),
    ('BR-DRAFT-PM-1000', 'PM-1000-24M', '1,000 hours or 24 months, whichever comes first', 1000::numeric, 24, null::integer)
) as proposed(program_code, interval_code, name, interval_hours, interval_months, interval_days)
join public.service_agreement_programs p
  on p.workspace_id = 'default'
 and p.program_code = proposed.program_code
on conflict (workspace_id, program_id, interval_code) do nothing;

-- Reassert the safety state even if a prior hand-created row used one of the
-- reserved draft codes. We deliberately do not overwrite names or intervals.
update public.service_agreement_programs
set is_provisional = true,
    review_status = 'draft',
    is_active = false,
    reviewed_by = null,
    reviewed_at = null,
    review_notes = null,
    activated_by = null,
    activated_at = null,
    deactivated_at = coalesce(deactivated_at, now()),
    updated_at = now()
where workspace_id = 'default'
  and program_code in ('BR-DRAFT-PM-250', 'BR-DRAFT-PM-500', 'BR-DRAFT-PM-1000');

-- --------------------------------------------------------------------------
-- 8. Deterministic daily due scanner and schedule-prompt evidence
-- --------------------------------------------------------------------------

create or replace function public.service_plan_has_due_pm_internal(
  p_workspace_id text,
  p_as_of date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_calendar_due boolean := false;
  v_hour_due boolean := false;
begin
  -- This non-locking completion probe protects SKIP LOCKED semantics: a row
  -- held by another scan keeps this daily run resumable instead of allowing a
  -- false completed state. Calendar candidates use the direct due-date index.
  select exists (
    select 1
    from public.service_plan_enrollment_schedules s
    join public.service_plan_equipment_enrollments en
      on en.id = s.enrollment_id
     and en.workspace_id = s.workspace_id
     and en.status = 'active'
    join public.service_agreement_program_intervals i
      on i.id = s.program_interval_id
     and i.workspace_id = s.workspace_id
     and i.is_active
    join public.service_agreement_programs p
      on p.id = en.program_id
     and p.workspace_id = s.workspace_id
     and p.is_active
     and p.review_status = 'reviewed'
     and not p.is_provisional
     and p.deleted_at is null
    join public.service_agreements a
      on a.id = en.service_agreement_id
     and a.workspace_id = s.workspace_id
     and a.status = 'active'
     and a.deleted_at is null
     and (a.starts_on is null or a.starts_on <= p_as_of)
     and (a.expires_on is null or a.expires_on >= p_as_of)
    join public.qrm_equipment eq
      on eq.id = en.equipment_id
     and eq.workspace_id = s.workspace_id
     and eq.deleted_at is null
    where s.workspace_id = p_workspace_id
      and s.next_due_on is not null
      and s.next_due_on <= p_as_of
      and not exists (
        select 1
        from public.service_plan_pm_due_events d
        where d.workspace_id = s.workspace_id
          and d.schedule_id = s.id
          and d.status in ('detected', 'job_created')
      )
  ) into v_calendar_due;

  if v_calendar_due then
    return true;
  end if;

  -- Hour-only completion probing resolves the latest eligible reading once
  -- per equipment, not once per schedule/interval on that equipment.
  with hour_schedule_candidates as materialized (
    select s.id as schedule_id, en.equipment_id, s.next_due_hours
    from public.service_plan_enrollment_schedules s
    join public.service_plan_equipment_enrollments en
      on en.id = s.enrollment_id
     and en.workspace_id = s.workspace_id
     and en.status = 'active'
    join public.service_agreement_program_intervals i
      on i.id = s.program_interval_id
     and i.workspace_id = s.workspace_id
     and i.is_active
    join public.service_agreement_programs p
      on p.id = en.program_id
     and p.workspace_id = s.workspace_id
     and p.is_active
     and p.review_status = 'reviewed'
     and not p.is_provisional
     and p.deleted_at is null
    join public.service_agreements a
      on a.id = en.service_agreement_id
     and a.workspace_id = s.workspace_id
     and a.status = 'active'
     and a.deleted_at is null
     and (a.starts_on is null or a.starts_on <= p_as_of)
     and (a.expires_on is null or a.expires_on >= p_as_of)
    join public.qrm_equipment eq
      on eq.id = en.equipment_id
     and eq.workspace_id = s.workspace_id
     and eq.deleted_at is null
    where s.workspace_id = p_workspace_id
      and s.next_due_hours is not null
      and (s.next_due_on is null or s.next_due_on > p_as_of)
      and not exists (
        select 1
        from public.service_plan_pm_due_events d
        where d.workspace_id = s.workspace_id
          and d.schedule_id = s.id
          and d.status in ('detected', 'job_created')
      )
  ),
  hour_candidate_equipment as materialized (
    select distinct equipment_id
    from hour_schedule_candidates
  ),
  hour_meters as materialized (
    select candidate.equipment_id, meter.hours
    from hour_candidate_equipment candidate
    cross join lateral (
      select r.hours
      from public.equipment_meter_readings r
      where r.workspace_id = p_workspace_id
        and r.equipment_id = candidate.equipment_id
        and r.meter_index = 1
        and r.code = 'actual'
        and r.recorded_at <= p_as_of
        and r.deleted_at is null
      order by r.recorded_at desc, r.created_at desc, r.id desc
      limit 1
    ) meter
  )
  select exists (
    select 1
    from hour_schedule_candidates candidate
    join hour_meters meter
      on meter.equipment_id = candidate.equipment_id
     and meter.hours >= candidate.next_due_hours
  ) into v_hour_due;

  return v_hour_due;
end;
$$;

revoke all on function public.service_plan_has_due_pm_internal(text, date)
  from public, anon, authenticated, service_role;

create or replace function public.service_plan_scan_due_pm_internal(
  p_workspace_id text,
  p_as_of date,
  p_batch_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_existing_result jsonb;
  v_existing_status text;
  v_existing_due_count integer := 0;
  v_existing_job_count integer := 0;
  v_existing_batch_count integer := 0;
  v_due record;
  v_due_event_id uuid;
  v_job_id uuid;
  v_reservation_id uuid;
  v_due_basis text;
  v_reservation_error text;
  v_due_count integer := 0;
  v_job_count integer := 0;
  v_claimed_count integer := 0;
  v_scan_complete boolean := false;
  v_resumed boolean := false;
  v_result jsonb;
begin
  if nullif(btrim(p_workspace_id), '') is null or p_as_of is null then
    raise exception 'workspace_id and scan date are required' using errcode = '22023';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'PM scan batch size must be between 1 and 500'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('service-plan-pm-scan:' || p_workspace_id || ':' || p_as_of::text, 0)
  );

  insert into public.service_plan_pm_scan_runs (workspace_id, scan_date)
  values (p_workspace_id, p_as_of)
  on conflict (workspace_id, scan_date) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select
      id,
      status,
      due_count,
      job_count,
      batch_count,
      result
    into
      v_run_id,
      v_existing_status,
      v_existing_due_count,
      v_existing_job_count,
      v_existing_batch_count,
      v_existing_result
    from public.service_plan_pm_scan_runs
    where workspace_id = p_workspace_id
      and scan_date = p_as_of;

    if v_existing_status = 'completed' then
      return coalesce(
        v_existing_result,
        jsonb_build_object(
          'workspace_id', p_workspace_id,
          'scan_date', p_as_of,
          'status', 'completed',
          'due_count', v_existing_due_count,
          'job_count', v_existing_job_count
        )
      ) || jsonb_build_object(
        'deduplicated', true,
        'batch_claimed_count', 0,
        'batch_due_count', 0,
        'batch_job_count', 0,
        'needs_follow_up', false
      );
    end if;

    v_resumed := true;
  end if;

  for v_due in
    with calendar_claims as materialized (
      select s.id as schedule_id
      from public.service_plan_enrollment_schedules s
      join public.service_plan_equipment_enrollments en
        on en.id = s.enrollment_id
       and en.workspace_id = s.workspace_id
       and en.status = 'active'
      join public.service_agreement_program_intervals i
        on i.id = s.program_interval_id
       and i.workspace_id = s.workspace_id
       and i.is_active
      join public.service_agreement_programs p
        on p.id = en.program_id
       and p.workspace_id = s.workspace_id
       and p.is_active
       and p.review_status = 'reviewed'
       and not p.is_provisional
       and p.deleted_at is null
      join public.service_agreements a
        on a.id = en.service_agreement_id
       and a.workspace_id = s.workspace_id
       and a.status = 'active'
       and a.deleted_at is null
       and (a.starts_on is null or a.starts_on <= p_as_of)
       and (a.expires_on is null or a.expires_on >= p_as_of)
      join public.qrm_equipment eq
        on eq.id = en.equipment_id
       and eq.workspace_id = s.workspace_id
       and eq.deleted_at is null
      where s.workspace_id = p_workspace_id
        and s.next_due_on is not null
        and s.next_due_on <= p_as_of
        and not exists (
          select 1
          from public.service_plan_pm_due_events d
          where d.workspace_id = s.workspace_id
            and d.schedule_id = s.id
            and d.status in ('detected', 'job_created')
        )
      order by s.next_due_on, s.next_due_hours nulls last, s.id
      limit p_batch_size
      for update of s skip locked
    ),
    hour_candidate_equipment as materialized (
      select distinct en.equipment_id
      from public.service_plan_enrollment_schedules s
      join public.service_plan_equipment_enrollments en
        on en.id = s.enrollment_id
       and en.workspace_id = s.workspace_id
       and en.status = 'active'
      join public.service_agreement_program_intervals i
        on i.id = s.program_interval_id
       and i.workspace_id = s.workspace_id
       and i.is_active
      join public.service_agreement_programs p
        on p.id = en.program_id
       and p.workspace_id = s.workspace_id
       and p.is_active
       and p.review_status = 'reviewed'
       and not p.is_provisional
       and p.deleted_at is null
      join public.service_agreements a
        on a.id = en.service_agreement_id
       and a.workspace_id = s.workspace_id
       and a.status = 'active'
       and a.deleted_at is null
       and (a.starts_on is null or a.starts_on <= p_as_of)
       and (a.expires_on is null or a.expires_on >= p_as_of)
      join public.qrm_equipment eq
        on eq.id = en.equipment_id
       and eq.workspace_id = s.workspace_id
       and eq.deleted_at is null
      where s.workspace_id = p_workspace_id
        and s.next_due_hours is not null
        and (s.next_due_on is null or s.next_due_on > p_as_of)
        and (select count(*) from calendar_claims) < p_batch_size
        and not exists (
          select 1
          from public.service_plan_pm_due_events d
          where d.workspace_id = s.workspace_id
            and d.schedule_id = s.id
            and d.status in ('detected', 'job_created')
        )
    ),
    hour_meters as materialized (
      select candidate.equipment_id, meter.hours
      from hour_candidate_equipment candidate
      cross join lateral (
        select r.hours
        from public.equipment_meter_readings r
        where r.workspace_id = p_workspace_id
          and r.equipment_id = candidate.equipment_id
          and r.meter_index = 1
          and r.code = 'actual'
          and r.recorded_at <= p_as_of
          and r.deleted_at is null
        order by r.recorded_at desc, r.created_at desc, r.id desc
        limit 1
      ) meter
    ),
    hour_claims as materialized (
      select s.id as schedule_id, meter.hours as observed_hours
      from public.service_plan_enrollment_schedules s
      join public.service_plan_equipment_enrollments en
        on en.id = s.enrollment_id
       and en.workspace_id = s.workspace_id
       and en.status = 'active'
      join public.service_agreement_program_intervals i
        on i.id = s.program_interval_id
       and i.workspace_id = s.workspace_id
       and i.is_active
      join public.service_agreement_programs p
        on p.id = en.program_id
       and p.workspace_id = s.workspace_id
       and p.is_active
       and p.review_status = 'reviewed'
       and not p.is_provisional
       and p.deleted_at is null
      join public.service_agreements a
        on a.id = en.service_agreement_id
       and a.workspace_id = s.workspace_id
       and a.status = 'active'
       and a.deleted_at is null
       and (a.starts_on is null or a.starts_on <= p_as_of)
       and (a.expires_on is null or a.expires_on >= p_as_of)
      join public.qrm_equipment eq
        on eq.id = en.equipment_id
       and eq.workspace_id = s.workspace_id
       and eq.deleted_at is null
      join hour_meters meter
        on meter.equipment_id = en.equipment_id
       and meter.hours >= s.next_due_hours
      where s.workspace_id = p_workspace_id
        and s.next_due_hours is not null
        and (s.next_due_on is null or s.next_due_on > p_as_of)
        and not exists (
          select 1
          from public.service_plan_pm_due_events d
          where d.workspace_id = s.workspace_id
            and d.schedule_id = s.id
            and d.status in ('detected', 'job_created')
        )
      order by s.next_due_on nulls last, s.next_due_hours nulls last, s.id
      limit greatest(
        p_batch_size - (select count(*) from calendar_claims),
        0
      )
      for update of s skip locked
    ),
    claimed as materialized (
      select calendar_claims.schedule_id, null::numeric(12, 1) as observed_hours
      from calendar_claims
      union all
      select hour_claims.schedule_id, hour_claims.observed_hours
      from hour_claims
    ),
    calendar_equipment as materialized (
      select distinct en.equipment_id
      from calendar_claims claim
      join public.service_plan_enrollment_schedules s
        on s.id = claim.schedule_id
      join public.service_plan_equipment_enrollments en
        on en.id = s.enrollment_id
       and en.workspace_id = s.workspace_id
    ),
    calendar_meters as materialized (
      select candidate.equipment_id, meter.hours
      from calendar_equipment candidate
      cross join lateral (
        select r.hours
        from public.equipment_meter_readings r
        where r.workspace_id = p_workspace_id
          and r.equipment_id = candidate.equipment_id
          and r.meter_index = 1
          and r.code = 'actual'
          and r.recorded_at <= p_as_of
          and r.deleted_at is null
        order by r.recorded_at desc, r.created_at desc, r.id desc
        limit 1
      ) meter
    )
    select
      s.id as schedule_id,
      s.cycle_number,
      s.next_due_on,
      s.next_due_hours,
      en.id as enrollment_id,
      en.service_agreement_id,
      en.equipment_id,
      i.id as interval_id,
      i.interval_code,
      i.interval_hours,
      i.interval_months,
      i.interval_days,
      i.entitlement_unit,
      i.entitlement_quantity,
      p.id as program_id,
      p.program_code,
      a.contract_number,
      eq.company_id,
      eq.home_branch_id,
      eq.name as equipment_name,
      eq.make as equipment_make,
      eq.model as equipment_model,
      eq.serial_number as equipment_serial_number,
      coalesce(claim.observed_hours, calendar_meter.hours) as observed_hours
    from claimed claim
    join public.service_plan_enrollment_schedules s
      on s.id = claim.schedule_id
    join public.service_plan_equipment_enrollments en
      on en.id = s.enrollment_id
     and en.workspace_id = s.workspace_id
    join public.service_agreement_program_intervals i
      on i.id = s.program_interval_id
     and i.workspace_id = s.workspace_id
    join public.service_agreement_programs p
      on p.id = en.program_id
     and p.workspace_id = s.workspace_id
    join public.service_agreements a
      on a.id = en.service_agreement_id
     and a.workspace_id = s.workspace_id
    join public.qrm_equipment eq
      on eq.id = en.equipment_id
     and eq.workspace_id = s.workspace_id
    left join calendar_meters calendar_meter
      on calendar_meter.equipment_id = en.equipment_id
    order by s.next_due_on nulls last, s.next_due_hours nulls last, s.id
  loop
    v_claimed_count := v_claimed_count + 1;
    v_due_event_id := null;
    v_job_id := gen_random_uuid();
    v_reservation_id := null;

    v_due_basis := case
      when v_due.next_due_on is not null
       and v_due.next_due_on <= p_as_of
       and v_due.next_due_hours is not null
       and v_due.observed_hours is not null
       and v_due.observed_hours >= v_due.next_due_hours
        then 'hours_and_calendar'
      when v_due.next_due_hours is not null
       and v_due.observed_hours is not null
       and v_due.observed_hours >= v_due.next_due_hours
        then 'hours'
      else 'calendar'
    end;

    insert into public.service_plan_pm_due_events (
      workspace_id,
      scan_run_id,
      enrollment_id,
      schedule_id,
      program_interval_id,
      service_agreement_id,
      equipment_id,
      due_basis,
      due_on,
      due_hours,
      observed_on,
      observed_hours,
      cycle_number
    ) values (
      p_workspace_id,
      v_run_id,
      v_due.enrollment_id,
      v_due.schedule_id,
      v_due.interval_id,
      v_due.service_agreement_id,
      v_due.equipment_id,
      v_due_basis,
      v_due.next_due_on,
      v_due.next_due_hours,
      p_as_of,
      v_due.observed_hours,
      v_due.cycle_number
    )
    on conflict do nothing
    returning id into v_due_event_id;

    if v_due_event_id is null then
      continue;
    end if;

    v_due_count := v_due_count + 1;

    insert into public.service_jobs (
      id,
      workspace_id,
      customer_id,
      machine_id,
      source_type,
      request_type,
      priority,
      current_stage,
      branch_id,
      requested_by_name,
      customer_problem_summary,
      shop_or_field,
      service_agreement_id,
      service_plan_enrollment_id,
      service_plan_due_event_id,
      auto_generation_source
    ) values (
      v_job_id,
      p_workspace_id,
      v_due.company_id,
      v_due.equipment_id,
      'portal',
      'pm_service',
      'normal',
      'request_received',
      v_due.home_branch_id::text,
      'Service-plan PM scanner',
      format(
        'Schedule %s for %s (%s). Due by %s under agreement %s.',
        v_due.interval_code,
        coalesce(v_due.equipment_name, concat_ws(' ', v_due.equipment_make, v_due.equipment_model)),
        v_due_basis,
        case
          when v_due_basis = 'hours' then v_due.next_due_hours::text || ' hours'
          when v_due_basis = 'calendar' then v_due.next_due_on::text
          else v_due.next_due_hours::text || ' hours or ' || v_due.next_due_on::text
        end,
        v_due.contract_number
      ),
      'shop',
      v_due.service_agreement_id,
      v_due.enrollment_id,
      v_due_event_id,
      'service_plan_pm_daily_scan'
    );

    -- Reserve an included entitlement when one is available. Lack of an
    -- entitlement never suppresses a safety/maintenance due job; the prompt
    -- evidence explicitly records whether the job is reserved or customer-pay.
    begin
      insert into public.service_agreement_entitlement_ledger (
        workspace_id,
        service_agreement_id,
        enrollment_id,
        service_job_id,
        entry_type,
        unit_code,
        quantity,
        idempotency_key,
        reason,
        metadata
      ) values (
        p_workspace_id,
        v_due.service_agreement_id,
        v_due.enrollment_id,
        v_job_id,
        'reserve',
        v_due.entitlement_unit,
        v_due.entitlement_quantity,
        'pm-reserve:' || v_due_event_id::text,
        'Reserved for auto-generated reviewed service-plan PM job',
        jsonb_build_object('due_event_id', v_due_event_id, 'program_id', v_due.program_id)
      )
      returning id into v_reservation_id;
    exception
      when check_violation then
        get stacked diagnostics v_reservation_error = message_text;
        if v_reservation_error not like 'insufficient available entitlement:%' then
          raise;
        end if;
        v_reservation_id := null;
    end;

    update public.service_plan_pm_due_events
    set service_job_id = v_job_id,
        entitlement_reservation_entry_id = v_reservation_id,
        status = 'job_created'
    where id = v_due_event_id;

    insert into public.service_plan_schedule_prompts (
      workspace_id,
      due_event_id,
      service_job_id,
      prompt_key,
      evidence
    ) values (
      p_workspace_id,
      v_due_event_id,
      v_job_id,
      'pm-schedule:' || v_due_event_id::text,
      jsonb_build_object(
        'scan_date', p_as_of,
        'due_basis', v_due_basis,
        'due_on', v_due.next_due_on,
        'due_hours', v_due.next_due_hours,
        'observed_hours', v_due.observed_hours,
        'program_code', v_due.program_code,
        'interval_code', v_due.interval_code,
        'entitlement_reserved', v_reservation_id is not null,
        'action', 'schedule_generated_pm_job'
      )
    );

    insert into public.service_job_events (
      workspace_id,
      job_id,
      event_type,
      metadata
    ) values (
      p_workspace_id,
      v_job_id,
      'pm_schedule_prompt_created',
      jsonb_build_object(
        'due_event_id', v_due_event_id,
        'due_basis', v_due_basis,
        'program_id', v_due.program_id,
        'program_interval_id', v_due.interval_id,
        'entitlement_reservation_entry_id', v_reservation_id
      )
    );

    v_job_count := v_job_count + 1;
  end loop;

  -- A batch that claims work remains resumable even when it happened to claim
  -- fewer than the ceiling. On an empty pass, a non-locking probe distinguishes
  -- a drained queue from rows temporarily hidden by SKIP LOCKED.
  if v_claimed_count = 0 then
    v_scan_complete := not public.service_plan_has_due_pm_internal(
      p_workspace_id,
      p_as_of
    );
  else
    v_scan_complete := false;
  end if;

  v_result := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'scan_date', p_as_of,
    'status', case when v_scan_complete then 'completed' else 'running' end,
    'due_count', v_existing_due_count + v_due_count,
    'job_count', v_existing_job_count + v_job_count,
    'batch_count', v_existing_batch_count + 1,
    'batch_limit', p_batch_size,
    'batch_claimed_count', v_claimed_count,
    'batch_due_count', v_due_count,
    'batch_job_count', v_job_count,
    'needs_follow_up', not v_scan_complete,
    'resumed', v_resumed,
    'deduplicated', false
  );

  update public.service_plan_pm_scan_runs
  set status = case when v_scan_complete then 'completed' else 'running' end,
      due_count = v_existing_due_count + v_due_count,
      job_count = v_existing_job_count + v_job_count,
      batch_count = v_existing_batch_count + 1,
      updated_at = now(),
      completed_at = case when v_scan_complete then now() else null end,
      result = v_result
  where id = v_run_id;

  return v_result;
end;
$$;

revoke all on function public.service_plan_scan_due_pm_internal(text, date, integer)
  from public, anon, authenticated, service_role;

create or replace function public.service_plan_scan_due_pm(
  p_workspace_id text,
  p_as_of date default current_date,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.service_plan_assert_elevated_operator(p_workspace_id, p_actor_id);
  return public.service_plan_scan_due_pm_internal(p_workspace_id, p_as_of);
end;
$$;

revoke all on function public.service_plan_scan_due_pm(text, date, uuid)
  from public, anon;
grant execute on function public.service_plan_scan_due_pm(text, date, uuid)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 9. PM closeout consumes the reservation and advances the cadence anchor
-- --------------------------------------------------------------------------

create or replace function public.complete_service_plan_pm_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due record;
  v_completed_on date;
  v_completed_hours numeric(12, 1);
begin
  if new.current_stage <> 'paid_closed'
     or old.current_stage = 'paid_closed'
     or new.service_plan_due_event_id is null then
    return new;
  end if;

  select
    d.*,
    s.baseline_hours,
    i.interval_hours,
    i.interval_months,
    i.interval_days,
    i.entitlement_unit,
    i.entitlement_quantity
  into v_due
  from public.service_plan_pm_due_events d
  join public.service_plan_enrollment_schedules s
    on s.id = d.schedule_id
   and s.workspace_id = d.workspace_id
  join public.service_agreement_program_intervals i
    on i.id = d.program_interval_id
   and i.workspace_id = d.workspace_id
  where d.id = new.service_plan_due_event_id
    and d.workspace_id = new.workspace_id
    and d.service_job_id = new.id
    and d.status = 'job_created'
  for update of d, s;

  if not found then
    return new;
  end if;

  v_completed_on := coalesce(new.closed_at::date, current_date);

  select r.hours
  into v_completed_hours
  from public.equipment_meter_readings r
  where r.workspace_id = new.workspace_id
    and r.equipment_id = v_due.equipment_id
    and r.meter_index = 1
    and r.code = 'actual'
    and r.recorded_at <= v_completed_on
    and r.deleted_at is null
  order by r.recorded_at desc, r.created_at desc, r.id desc
  limit 1;

  v_completed_hours := coalesce(v_completed_hours, v_due.observed_hours, v_due.baseline_hours);

  if v_due.entitlement_reservation_entry_id is not null then
    insert into public.service_agreement_entitlement_ledger (
      workspace_id,
      service_agreement_id,
      enrollment_id,
      service_job_id,
      entry_type,
      unit_code,
      quantity,
      idempotency_key,
      related_entry_id,
      actor_id,
      reason,
      metadata
    ) values (
      new.workspace_id,
      v_due.service_agreement_id,
      v_due.enrollment_id,
      new.id,
      'consume',
      v_due.entitlement_unit,
      v_due.entitlement_quantity,
      'pm-consume:' || v_due.id::text,
      v_due.entitlement_reservation_entry_id,
      coalesce(auth.uid(), new.technician_id, new.advisor_id),
      'Consumed when the auto-generated PM service job closed',
      jsonb_build_object('due_event_id', v_due.id, 'closed_at', coalesce(new.closed_at, now()))
    )
    on conflict (workspace_id, service_agreement_id, unit_code, idempotency_key)
    do nothing;
  end if;

  update public.service_plan_pm_due_events
  set status = 'completed',
      completed_at = coalesce(new.closed_at, now())
  where id = v_due.id;

  update public.service_plan_enrollment_schedules
  set cycle_number = cycle_number + 1,
      baseline_on = v_completed_on,
      baseline_hours = v_completed_hours,
      next_due_on = case
        when v_due.interval_months is null and v_due.interval_days is null then null
        else (
          v_completed_on + make_interval(
            months => coalesce(v_due.interval_months, 0),
            days => coalesce(v_due.interval_days, 0)
          )
        )::date
      end,
      next_due_hours = case
        when v_due.interval_hours is null or v_completed_hours is null then null
        else v_completed_hours + v_due.interval_hours
      end,
      last_completed_job_id = new.id,
      last_completed_at = coalesce(new.closed_at, now()),
      updated_at = now()
  where id = v_due.schedule_id;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    new.workspace_id,
    new.id,
    'pm_service_plan_cycle_completed',
    coalesce(auth.uid(), new.technician_id, new.advisor_id),
    jsonb_build_object(
      'due_event_id', v_due.id,
      'completed_on', v_completed_on,
      'completed_hours', v_completed_hours,
      'next_due_on', case
        when v_due.interval_months is null and v_due.interval_days is null then null
        else (
          v_completed_on + make_interval(
            months => coalesce(v_due.interval_months, 0),
            days => coalesce(v_due.interval_days, 0)
          )
        )::date
      end,
      'next_due_hours', case when v_due.interval_hours is null or v_completed_hours is null then null else v_completed_hours + v_due.interval_hours end
    )
  );

  return new;
end;
$$;

revoke all on function public.complete_service_plan_pm_cycle()
  from public, anon, authenticated, service_role;

drop trigger if exists complete_service_plan_pm_cycle on public.service_jobs;
create trigger complete_service_plan_pm_cycle
  after update of current_stage on public.service_jobs
  for each row execute function public.complete_service_plan_pm_cycle();

-- --------------------------------------------------------------------------
-- 10. Service-role/cron wrapper and fail-safe daily registration
-- --------------------------------------------------------------------------

create or replace function public.run_service_plan_pm_daily_scan(
  p_as_of date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace record;
  v_results jsonb := '[]'::jsonb;
  v_workspace_batch_size constant integer := 5;
  v_schedule_batch_size constant integer := 100;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user <> 'postgres' then
    raise exception 'daily service-plan scanner is restricted to service_role or postgres'
      using errcode = '42501';
  end if;

  if p_as_of is null then
    raise exception 'scan date is required' using errcode = '22023';
  end if;

  for v_workspace in
    with active_workspaces as materialized (
      select distinct workspace_id
      from public.service_agreement_programs
      where is_active
        and review_status = 'reviewed'
        and not is_provisional
        and deleted_at is null
    )
    select active.workspace_id
    from active_workspaces active
    left join public.service_plan_pm_scan_runs scan
      on scan.workspace_id = active.workspace_id
     and scan.scan_date = p_as_of
    where scan.status is distinct from 'completed'
    order by
      case when scan.id is null then 0 else 1 end,
      scan.updated_at nulls first,
      active.workspace_id
    limit v_workspace_batch_size
  loop
    v_results := v_results || jsonb_build_array(
      public.service_plan_scan_due_pm_internal(
        v_workspace.workspace_id,
        p_as_of,
        v_schedule_batch_size
      )
    );
  end loop;

  return jsonb_build_object(
    'scan_date', p_as_of,
    'workspace_count', jsonb_array_length(v_results),
    'workspace_batch_limit', v_workspace_batch_size,
    'schedule_batch_limit', v_schedule_batch_size,
    'results', v_results
  );
end;
$$;

revoke all on function public.run_service_plan_pm_daily_scan(date)
  from public, anon, authenticated;
grant execute on function public.run_service_plan_pm_daily_scan(date)
  to service_role;

do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping service-plan-pm-daily cron: pg_cron not available.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'service-plan-pm-daily') then
    perform cron.unschedule('service-plan-pm-daily');
  end if;

  perform cron.schedule(
    'service-plan-pm-daily',
    '*/5 * * * *',
    $job$select public.run_service_plan_pm_daily_scan(current_date);$job$
  );
exception
  when others then
    raise notice 'Skipping service-plan-pm-daily cron: %', sqlerrm;
end;
$cron$;

-- --------------------------------------------------------------------------
-- 11. Roadmap/Linear source-of-truth evidence
-- --------------------------------------------------------------------------

update public.qep_roadmap_tasks
set ship_state = 'in_progress',
    blocking_decision = null,
    evidence_link = concat_ws(
      ' | ',
      nullif(evidence_link, ''),
      'supabase/migrations/829_service_plan_pm_automation_and_entitlement_ledger.sql'
    ),
    notes = coalesce(notes, '') ||
      E'\n[2026-07-20] H9.1 / SV1-SV3 backend/schema ready, UI follow-on required: the default QEP workspace has an explicitly inactive BlackRock draft catalog; activation requires a prior recorded QEP review; equipment enrollment produces hour-or-calendar schedules from a valid baseline; a daily idempotent scanner creates one PM job and append-only schedule prompt; paid closeout consumes reservations; controlled cancellation releases them without losing audit evidence. Draft cadence values remain non-customer-live until QEP validates OEM/model, kit, labor, and commercial terms. H9.1 remains in_progress until staff-facing program review, activation, enrollment, and prompt handling are integrated and acceptance-tested. Mission alignment PASS for the backend foundation only: reviewed maintenance intent becomes auditable equipment action without fabricating source data or allowing silent entitlement overdrafts.',
    updated_at = now()
where task_id = 'H9.1';

insert into public.qep_roadmap_sync_events (
  direction,
  task_id,
  action,
  changed_fields,
  actor
) values (
  'reconcile',
  'H9.1',
  'update',
  jsonb_build_object(
    'ship_state', 'in_progress',
    'implementation_state', 'backend_schema_ready_ui_follow_on',
    'migration', '829_service_plan_pm_automation_and_entitlement_ledger.sql',
    'owner_answers', jsonb_build_array('SV1', 'SV2', 'SV3'),
    'safety_gate', 'blackrock_catalog_inactive_until_qep_review',
    'mission_alignment', 'pass for backend foundation: reviewed preventive-maintenance intent becomes deduplicated equipment work and auditable entitlement truth while provisional source assumptions remain blocked from customer-live activation; staff UI integration remains required before H9.1 ships'
  ),
  'codex'
);

commit;
