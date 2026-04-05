-- ============================================================================
-- Migration 094: Service-to-Parts Intelligence Engine — Core Tables
--
-- Canonical service lifecycle object model per Moonshot Spec v4 sections 10.1–10.5.
-- Establishes service_jobs, event log, blockers, job codes, and job code
-- observations.  All tables workspace-scoped with RLS.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

create type public.service_source_type as enum (
  'call', 'walk_in', 'field_tech', 'sales_handoff', 'portal'
);

create type public.service_request_type as enum (
  'repair', 'pm_service', 'inspection', 'machine_down', 'recall', 'warranty'
);

create type public.service_priority as enum (
  'normal', 'urgent', 'critical'
);

create type public.service_stage as enum (
  'request_received',
  'triaging',
  'diagnosis_selected',
  'quote_drafted',
  'quote_sent',
  'approved',
  'parts_pending',
  'parts_staged',
  'haul_scheduled',
  'scheduled',
  'in_progress',
  'blocked_waiting',
  'quality_check',
  'ready_for_pickup',
  'invoice_ready',
  'invoiced',
  'paid_closed'
);

create type public.service_status_flag as enum (
  'machine_down',
  'shop_job',
  'field_job',
  'internal',
  'warranty_recall',
  'customer_pay',
  'good_faith',
  'waiting_customer',
  'waiting_vendor',
  'waiting_transfer',
  'waiting_haul'
);

-- ── service_jobs ────────────────────────────────────────────────────────────

create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Customer / machine context
  customer_id uuid references public.crm_companies(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  machine_id uuid references public.crm_equipment(id) on delete set null,

  -- Request metadata
  source_type public.service_source_type not null default 'call',
  request_type public.service_request_type not null default 'repair',
  priority public.service_priority not null default 'normal',
  current_stage public.service_stage not null default 'request_received',
  status_flags public.service_status_flag[] not null default '{}',

  -- Assignment
  branch_id text,
  advisor_id uuid references public.profiles(id) on delete set null,
  service_manager_id uuid references public.profiles(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,

  -- Request details
  requested_by_name text,
  customer_problem_summary text,
  ai_diagnosis_summary text,
  selected_job_code_id uuid, -- FK added after job_codes table
  haul_required boolean not null default false,
  shop_or_field text not null default 'shop' check (shop_or_field in ('shop', 'field')),

  -- Scheduling
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,

  -- Financials
  quote_total numeric(12, 2),
  invoice_total numeric(12, 2),

  -- Lifecycle
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz
);

comment on table public.service_jobs is
  'Canonical service lifecycle object. One row per service event from intake through paid/closed.';

-- ── service_job_events ──────────────────────────────────────────────────────

create table public.service_job_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  old_stage public.service_stage,
  new_stage public.service_stage,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.service_job_events is
  'Immutable event log for service job lifecycle transitions and key actions.';

-- ── service_job_blockers ────────────────────────────────────────────────────

create table public.service_job_blockers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  blocker_type text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_job_blockers is
  'Active and resolved blockers per service job.';

-- ── job_codes ───────────────────────────────────────────────────────────────

create table public.job_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  make text not null,
  model_family text,
  job_name text not null,
  manufacturer_estimated_hours numeric(6, 2),
  shop_average_hours numeric(6, 2),
  senior_tech_average_hours numeric(6, 2),
  parts_template jsonb not null default '[]'::jsonb,
  common_add_ons jsonb not null default '[]'::jsonb,
  confidence_score numeric(4, 2) default 0.5
    check (confidence_score >= 0 and confidence_score <= 1),
  is_system_generated boolean not null default false,
  source_of_truth_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_codes is
  'Static and learned job-code records. Confidence score updated by Phase B living-job-code engine.';

-- Now add the FK from service_jobs -> job_codes
alter table public.service_jobs
  add constraint service_jobs_selected_job_code_fk
  foreign key (selected_job_code_id) references public.job_codes(id) on delete set null;

-- ── job_code_observations ───────────────────────────────────────────────────

create table public.job_code_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_code_id uuid not null references public.job_codes(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  actual_hours numeric(6, 2),
  estimated_hours numeric(6, 2),
  parts_consumed jsonb not null default '[]'::jsonb,
  parts_quoted jsonb not null default '[]'::jsonb,
  discovered_add_ons jsonb not null default '[]'::jsonb,
  technician_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.job_code_observations is
  'Per-completion learning rows. Feeds Phase B living-job-code intelligence.';

-- ── technician_profiles ─────────────────────────────────────────────────────

create table public.technician_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  user_id uuid not null references public.profiles(id) on delete cascade,
  certifications jsonb not null default '[]'::jsonb,
  brands_supported jsonb not null default '[]'::jsonb,
  job_type_history jsonb not null default '[]'::jsonb,
  average_efficiency numeric(5, 2),
  active_workload integer not null default 0,
  branch_id text,
  field_eligible boolean not null default true,
  shop_eligible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index technician_profiles_user_workspace_uniq
  on public.technician_profiles(user_id, workspace_id);

comment on table public.technician_profiles is
  'Technician skill and capacity profiles. Phase B builds history-driven metrics.';

-- ── technician_job_performance ──────────────────────────────────────────────

create table public.technician_job_performance (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  technician_id uuid not null references public.technician_profiles(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  job_code_id uuid references public.job_codes(id) on delete set null,
  estimated_hours numeric(6, 2),
  actual_hours numeric(6, 2),
  variance numeric(6, 2),
  comeback boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.technician_job_performance is
  'Per-tech per-job metrics. Feeds technician efficiency profiles.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.service_jobs enable row level security;
alter table public.service_job_events enable row level security;
alter table public.service_job_blockers enable row level security;
alter table public.job_codes enable row level security;
alter table public.job_code_observations enable row level security;
alter table public.technician_profiles enable row level security;
alter table public.technician_job_performance enable row level security;

-- service_jobs
create policy "svc_jobs_select" on public.service_jobs for select
  using (workspace_id = public.get_my_workspace());
create policy "svc_jobs_insert" on public.service_jobs for insert
  with check (workspace_id = public.get_my_workspace());
create policy "svc_jobs_update" on public.service_jobs for update
  using (workspace_id = public.get_my_workspace());
create policy "svc_jobs_delete" on public.service_jobs for delete
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "svc_jobs_service_all" on public.service_jobs for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_job_events
create policy "svc_events_select" on public.service_job_events for select
  using (workspace_id = public.get_my_workspace());
create policy "svc_events_insert" on public.service_job_events for insert
  with check (workspace_id = public.get_my_workspace());
create policy "svc_events_service_all" on public.service_job_events for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_job_blockers
create policy "svc_blockers_select" on public.service_job_blockers for select
  using (workspace_id = public.get_my_workspace());
create policy "svc_blockers_insert" on public.service_job_blockers for insert
  with check (workspace_id = public.get_my_workspace());
create policy "svc_blockers_update" on public.service_job_blockers for update
  using (workspace_id = public.get_my_workspace());
create policy "svc_blockers_service_all" on public.service_job_blockers for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- job_codes
create policy "job_codes_select" on public.job_codes for select
  using (workspace_id = public.get_my_workspace());
create policy "job_codes_insert" on public.job_codes for insert
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "job_codes_update" on public.job_codes for update
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "job_codes_service_all" on public.job_codes for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- job_code_observations
create policy "jco_select" on public.job_code_observations for select
  using (workspace_id = public.get_my_workspace());
create policy "jco_insert" on public.job_code_observations for insert
  with check (workspace_id = public.get_my_workspace());
create policy "jco_service_all" on public.job_code_observations for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- technician_profiles
create policy "tech_profiles_select" on public.technician_profiles for select
  using (workspace_id = public.get_my_workspace());
create policy "tech_profiles_insert" on public.technician_profiles for insert
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "tech_profiles_update" on public.technician_profiles for update
  using (workspace_id = public.get_my_workspace());
create policy "tech_profiles_service_all" on public.technician_profiles for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- technician_job_performance
create policy "tech_perf_select" on public.technician_job_performance for select
  using (workspace_id = public.get_my_workspace());
create policy "tech_perf_insert" on public.technician_job_performance for insert
  with check (workspace_id = public.get_my_workspace());
create policy "tech_perf_service_all" on public.technician_job_performance for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Command center queries: filter by stage, priority, branch for open jobs
create index idx_svc_jobs_stage on public.service_jobs(current_stage)
  where closed_at is null and deleted_at is null;
create index idx_svc_jobs_priority on public.service_jobs(priority)
  where closed_at is null and deleted_at is null;
create index idx_svc_jobs_branch on public.service_jobs(branch_id)
  where closed_at is null and deleted_at is null;
create index idx_svc_jobs_advisor on public.service_jobs(advisor_id)
  where closed_at is null and deleted_at is null;
create index idx_svc_jobs_technician on public.service_jobs(technician_id)
  where closed_at is null and deleted_at is null;
create index idx_svc_jobs_customer on public.service_jobs(customer_id)
  where customer_id is not null;
create index idx_svc_jobs_machine on public.service_jobs(machine_id)
  where machine_id is not null;
create index idx_svc_jobs_scheduled_start on public.service_jobs(scheduled_start_at)
  where closed_at is null and deleted_at is null and scheduled_start_at is not null;

-- Event log queries
create index idx_svc_events_job on public.service_job_events(job_id, created_at desc);

-- Blocker queries: unresolved blockers
create index idx_svc_blockers_job_active on public.service_job_blockers(job_id)
  where resolved_at is null;

-- Job code lookups
create index idx_job_codes_make_model on public.job_codes(make, model_family);

-- Observation aggregation
create index idx_jco_job_code on public.job_code_observations(job_code_id);
create index idx_jco_job on public.job_code_observations(job_id);

-- Tech performance
create index idx_tech_perf_technician on public.technician_job_performance(technician_id);

-- ── Updated-at triggers ─────────────────────────────────────────────────────

create trigger set_service_jobs_updated_at
  before update on public.service_jobs for each row
  execute function public.set_updated_at();

create trigger set_service_job_blockers_updated_at
  before update on public.service_job_blockers for each row
  execute function public.set_updated_at();

create trigger set_job_codes_updated_at
  before update on public.job_codes for each row
  execute function public.set_updated_at();

create trigger set_technician_profiles_updated_at
  before update on public.technician_profiles for each row
  execute function public.set_updated_at();
