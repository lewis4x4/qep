-- ============================================================================
-- Migration 095: Service-to-Parts Intelligence Engine — Parts & Vendor Tables
--
-- Parts orchestration (requirements, actions, staging) and vendor management
-- (profiles, contacts, escalation policies, active escalations).
-- ============================================================================

-- ── Parts action type enum ──────────────────────────────────────────────────

create type public.service_parts_action_type as enum (
  'pick', 'transfer', 'order', 'substitute', 'receive', 'stage', 'consume', 'return'
);

-- ── service_parts_requirements ──────────────────────────────────────────────

create table public.service_parts_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  part_number text not null,
  description text,
  quantity integer not null default 1 check (quantity > 0),
  unit_cost numeric(10, 2),
  source text not null default 'manual' check (source in ('ai_suggested', 'job_code_template', 'manual')),
  status text not null default 'pending' check (status in (
    'pending', 'picking', 'transferring', 'ordering', 'received', 'staged', 'consumed', 'returned', 'cancelled'
  )),
  need_by_date timestamptz,
  confidence text not null default 'manual' check (confidence in ('high', 'medium', 'low', 'manual')),
  vendor_id uuid, -- FK added after vendor_profiles table
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_parts_requirements is
  'Expected parts per service job. Each line represents one part needed for the job.';

-- ── service_parts_actions ───────────────────────────────────────────────────

create table public.service_parts_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  requirement_id uuid not null references public.service_parts_requirements(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  action_type public.service_parts_action_type not null,
  actor_id uuid references public.profiles(id) on delete set null,
  from_branch text,
  to_branch text,
  vendor_id uuid, -- FK added after vendor_profiles table
  po_reference text,
  expected_date timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_parts_actions is
  'Action log per part line. Tracks pick, transfer, order, receive, stage, consume, return.';

-- ── service_parts_staging ───────────────────────────────────────────────────

create table public.service_parts_staging (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  requirement_id uuid not null references public.service_parts_requirements(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  bin_location text,
  staged_by uuid references public.profiles(id) on delete set null,
  staged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.service_parts_staging is
  'Staged parts tracking. Records physical staging location and actor.';

-- ── vendor_profiles ─────────────────────────────────────────────────────────

create table public.vendor_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  supplier_type text not null default 'general' check (supplier_type in (
    'oem', 'aftermarket', 'general', 'specialty', 'internal'
  )),
  category_support jsonb not null default '[]'::jsonb,
  avg_lead_time_hours numeric(8, 2),
  responsiveness_score numeric(4, 2) default 0.5
    check (responsiveness_score >= 0 and responsiveness_score <= 1),
  after_hours_contact text,
  machine_down_escalation_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_profiles is
  'Supplier master. Responsiveness score updated by Phase B vendor intelligence.';

-- Now add vendor FKs to parts tables
alter table public.service_parts_requirements
  add constraint spr_vendor_fk foreign key (vendor_id) references public.vendor_profiles(id) on delete set null;
alter table public.service_parts_actions
  add constraint spa_vendor_fk foreign key (vendor_id) references public.vendor_profiles(id) on delete set null;

-- ── vendor_contacts ─────────────────────────────────────────────────────────

create table public.vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  contact_name text not null,
  role text,
  phone text,
  email text,
  is_primary boolean not null default false,
  escalation_tier integer not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_contacts is
  'Contact ladder per vendor for escalation workflows.';

-- ── vendor_escalation_policies ──────────────────────────────────────────────

create table public.vendor_escalation_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  is_machine_down boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_escalation_policies is
  'Configurable timed escalation templates. Steps define trigger hours and actions.';

-- ── vendor_escalations ──────────────────────────────────────────────────────

create table public.vendor_escalations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  job_id uuid references public.service_jobs(id) on delete set null,
  policy_id uuid references public.vendor_escalation_policies(id) on delete set null,
  po_reference text,
  current_step integer not null default 1,
  next_action_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_escalations is
  'Active escalation tracking per vendor PO. Timed steps advance automatically.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.service_parts_requirements enable row level security;
alter table public.service_parts_actions enable row level security;
alter table public.service_parts_staging enable row level security;
alter table public.vendor_profiles enable row level security;
alter table public.vendor_contacts enable row level security;
alter table public.vendor_escalation_policies enable row level security;
alter table public.vendor_escalations enable row level security;

-- service_parts_requirements
create policy "spr_select" on public.service_parts_requirements for select
  using (workspace_id = public.get_my_workspace());
create policy "spr_insert" on public.service_parts_requirements for insert
  with check (workspace_id = public.get_my_workspace());
create policy "spr_update" on public.service_parts_requirements for update
  using (workspace_id = public.get_my_workspace());
create policy "spr_service_all" on public.service_parts_requirements for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_parts_actions
create policy "spa_select" on public.service_parts_actions for select
  using (workspace_id = public.get_my_workspace());
create policy "spa_insert" on public.service_parts_actions for insert
  with check (workspace_id = public.get_my_workspace());
create policy "spa_update" on public.service_parts_actions for update
  using (workspace_id = public.get_my_workspace());
create policy "spa_service_all" on public.service_parts_actions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_parts_staging
create policy "sps_select" on public.service_parts_staging for select
  using (workspace_id = public.get_my_workspace());
create policy "sps_insert" on public.service_parts_staging for insert
  with check (workspace_id = public.get_my_workspace());
create policy "sps_service_all" on public.service_parts_staging for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- vendor_profiles
create policy "vp_select" on public.vendor_profiles for select
  using (workspace_id = public.get_my_workspace());
create policy "vp_insert" on public.vendor_profiles for insert
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vp_update" on public.vendor_profiles for update
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vp_service_all" on public.vendor_profiles for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- vendor_contacts
create policy "vc_select" on public.vendor_contacts for select
  using (workspace_id = public.get_my_workspace());
create policy "vc_insert" on public.vendor_contacts for insert
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vc_update" on public.vendor_contacts for update
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vc_service_all" on public.vendor_contacts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- vendor_escalation_policies
create policy "vep_select" on public.vendor_escalation_policies for select
  using (workspace_id = public.get_my_workspace());
create policy "vep_insert" on public.vendor_escalation_policies for insert
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vep_update" on public.vendor_escalation_policies for update
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "vep_service_all" on public.vendor_escalation_policies for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- vendor_escalations
create policy "ve_select" on public.vendor_escalations for select
  using (workspace_id = public.get_my_workspace());
create policy "ve_insert" on public.vendor_escalations for insert
  with check (workspace_id = public.get_my_workspace());
create policy "ve_update" on public.vendor_escalations for update
  using (workspace_id = public.get_my_workspace());
create policy "ve_service_all" on public.vendor_escalations for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Parts requirements by job
create index idx_spr_job on public.service_parts_requirements(job_id);
create index idx_spr_status on public.service_parts_requirements(status)
  where status not in ('consumed', 'returned', 'cancelled');
create index idx_spr_need_by on public.service_parts_requirements(need_by_date)
  where need_by_date is not null and status not in ('consumed', 'returned', 'cancelled');

-- Parts actions by requirement and job
create index idx_spa_requirement on public.service_parts_actions(requirement_id);
create index idx_spa_job on public.service_parts_actions(job_id);
create index idx_spa_pending on public.service_parts_actions(action_type)
  where completed_at is null;

-- Staging by job
create index idx_sps_job on public.service_parts_staging(job_id);

-- Vendor lookups
create index idx_vp_name on public.vendor_profiles(name);
create index idx_vc_vendor on public.vendor_contacts(vendor_id);

-- Active escalations
create index idx_ve_active on public.vendor_escalations(next_action_at)
  where resolved_at is null;
create index idx_ve_job on public.vendor_escalations(job_id)
  where job_id is not null and resolved_at is null;

-- ── Updated-at triggers ─────────────────────────────────────────────────────

create trigger set_spr_updated_at
  before update on public.service_parts_requirements for each row
  execute function public.set_updated_at();

create trigger set_spa_updated_at
  before update on public.service_parts_actions for each row
  execute function public.set_updated_at();

create trigger set_vp_updated_at
  before update on public.vendor_profiles for each row
  execute function public.set_updated_at();

create trigger set_vc_updated_at
  before update on public.vendor_contacts for each row
  execute function public.set_updated_at();

create trigger set_vep_updated_at
  before update on public.vendor_escalation_policies for each row
  execute function public.set_updated_at();

create trigger set_ve_updated_at
  before update on public.vendor_escalations for each row
  execute function public.set_updated_at();
