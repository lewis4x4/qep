-- ============================================================================
-- Migration 096: Service-to-Parts Intelligence Engine — Quotes, TAT, Feedback
--
-- Service quote engine (quotes, line items, approvals), TAT metrics,
-- customer notification log, machine knowledge notes, completion feedback.
-- ============================================================================

-- ── service_quotes ──────────────────────────────────────────────────────────

create table public.service_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  version integer not null default 1,
  labor_total numeric(12, 2) not null default 0,
  parts_total numeric(12, 2) not null default 0,
  haul_total numeric(12, 2) not null default 0,
  shop_supplies numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'approved', 'rejected', 'expired', 'superseded'
  )),
  sent_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_quotes is
  'Structured service quote header. Supports versioning via superseded status.';

-- ── service_quote_lines ─────────────────────────────────────────────────────

create table public.service_quote_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  quote_id uuid not null references public.service_quotes(id) on delete cascade,
  line_type text not null check (line_type in (
    'labor', 'part', 'haul', 'shop_supply', 'optional', 'discount'
  )),
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(10, 2) not null default 0,
  extended_price numeric(12, 2) not null default 0,
  part_requirement_id uuid references public.service_parts_requirements(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_quote_lines is
  'Line items for a service quote: labor, parts, haul, shop supplies, optional, discount.';

-- ── service_quote_approvals ─────────────────────────────────────────────────

create table public.service_quote_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  quote_id uuid not null references public.service_quotes(id) on delete cascade,
  approved_by text,
  approval_type text not null check (approval_type in ('customer', 'internal')),
  method text not null check (method in ('portal', 'email', 'phone', 'in_person')),
  signature_url text,
  notes text,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.service_quote_approvals is
  'Approval records for customer signoff and internal exceptions.';

-- ── service_tat_metrics ─────────────────────────────────────────────────────

create table public.service_tat_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  segment_name text not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  target_duration_hours numeric(8, 2),
  actual_duration_hours numeric(8, 2),
  is_machine_down boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_tat_metrics is
  'Derived per-segment timing for TAT/SLA tracking per service job.';

-- ── service_customer_notifications ──────────────────────────────────────────

create table public.service_customer_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  notification_type text not null,
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'sms', 'portal')),
  recipient text,
  sent_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.service_customer_notifications is
  'External notification log for customer-facing service communications.';

-- ── machine_knowledge_notes ─────────────────────────────────────────────────

create table public.machine_knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  equipment_id uuid references public.crm_equipment(id) on delete set null,
  job_id uuid references public.service_jobs(id) on delete set null,
  note_type text not null check (note_type in (
    'sop', 'voice', 'completion', 'bulletin', 'field_hack', 'serial_specific', 'general'
  )),
  content text not null,
  source_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.machine_knowledge_notes is
  'Equipment-specific learning and institutional knowledge. Queryable by knowledge base retrieval.';

-- ── service_completion_feedback ─────────────────────────────────────────────

create table public.service_completion_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  actual_problem_fixed boolean,
  additional_issues jsonb not null default '[]'::jsonb,
  missing_parts jsonb not null default '[]'::jsonb,
  time_saver_notes text,
  serial_specific_note text,
  return_visit_risk text check (return_visit_risk in ('none', 'low', 'medium', 'high')),
  upsell_suggestions jsonb not null default '[]'::jsonb,
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.service_completion_feedback is
  'Structured post-job learning input captured at quality check stage.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.service_quotes enable row level security;
alter table public.service_quote_lines enable row level security;
alter table public.service_quote_approvals enable row level security;
alter table public.service_tat_metrics enable row level security;
alter table public.service_customer_notifications enable row level security;
alter table public.machine_knowledge_notes enable row level security;
alter table public.service_completion_feedback enable row level security;

-- service_quotes
create policy "sq_select" on public.service_quotes for select
  using (workspace_id = public.get_my_workspace());
create policy "sq_insert" on public.service_quotes for insert
  with check (workspace_id = public.get_my_workspace());
create policy "sq_update" on public.service_quotes for update
  using (workspace_id = public.get_my_workspace());
create policy "sq_service_all" on public.service_quotes for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_quote_lines
create policy "sql_select" on public.service_quote_lines for select
  using (workspace_id = public.get_my_workspace());
create policy "sql_insert" on public.service_quote_lines for insert
  with check (workspace_id = public.get_my_workspace());
create policy "sql_update" on public.service_quote_lines for update
  using (workspace_id = public.get_my_workspace());
create policy "sql_service_all" on public.service_quote_lines for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_quote_approvals
create policy "sqa_select" on public.service_quote_approvals for select
  using (workspace_id = public.get_my_workspace());
create policy "sqa_insert" on public.service_quote_approvals for insert
  with check (workspace_id = public.get_my_workspace());
create policy "sqa_service_all" on public.service_quote_approvals for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_tat_metrics
create policy "tat_select" on public.service_tat_metrics for select
  using (workspace_id = public.get_my_workspace());
create policy "tat_insert" on public.service_tat_metrics for insert
  with check (workspace_id = public.get_my_workspace());
create policy "tat_update" on public.service_tat_metrics for update
  using (workspace_id = public.get_my_workspace());
create policy "tat_service_all" on public.service_tat_metrics for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_customer_notifications
create policy "scn_select" on public.service_customer_notifications for select
  using (workspace_id = public.get_my_workspace());
create policy "scn_insert" on public.service_customer_notifications for insert
  with check (workspace_id = public.get_my_workspace());
create policy "scn_service_all" on public.service_customer_notifications for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- machine_knowledge_notes
create policy "mkn_select" on public.machine_knowledge_notes for select
  using (workspace_id = public.get_my_workspace());
create policy "mkn_insert" on public.machine_knowledge_notes for insert
  with check (workspace_id = public.get_my_workspace());
create policy "mkn_service_all" on public.machine_knowledge_notes for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- service_completion_feedback
create policy "scf_select" on public.service_completion_feedback for select
  using (workspace_id = public.get_my_workspace());
create policy "scf_insert" on public.service_completion_feedback for insert
  with check (workspace_id = public.get_my_workspace());
create policy "scf_service_all" on public.service_completion_feedback for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Quotes by job
create index idx_sq_job on public.service_quotes(job_id);
create index idx_sq_status on public.service_quotes(status) where status in ('draft', 'sent');

-- Quote lines by quote
create index idx_sql_quote on public.service_quote_lines(quote_id);

-- Approvals by quote
create index idx_sqa_quote on public.service_quote_approvals(quote_id);

-- TAT by job
create index idx_tat_job on public.service_tat_metrics(job_id);
create index idx_tat_active on public.service_tat_metrics(segment_name)
  where completed_at is null;

-- Customer notifications by job
create index idx_scn_job on public.service_customer_notifications(job_id);

-- Machine knowledge by equipment
create index idx_mkn_equipment on public.machine_knowledge_notes(equipment_id)
  where equipment_id is not null;
create index idx_mkn_job on public.machine_knowledge_notes(job_id)
  where job_id is not null;

-- Completion feedback by job (unique per job)
create unique index idx_scf_job_uniq on public.service_completion_feedback(job_id);

-- ── Updated-at triggers ─────────────────────────────────────────────────────

create trigger set_sq_updated_at
  before update on public.service_quotes for each row
  execute function public.set_updated_at();

create trigger set_sql_updated_at
  before update on public.service_quote_lines for each row
  execute function public.set_updated_at();

create trigger set_tat_updated_at
  before update on public.service_tat_metrics for each row
  execute function public.set_updated_at();
