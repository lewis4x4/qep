-- ============================================================================
-- Migration 348: Service InspectionPlus
--
-- Rollback notes:
--   1. Drop triggers set_service_inspection_findings_updated_at and
--      set_service_inspections_updated_at.
--   2. Drop indexes idx_service_inspection_findings_inspection,
--      idx_service_inspections_workspace_status, and
--      idx_service_inspections_service_job.
--   3. Drop policies on service_inspection_findings and service_inspections.
--   4. Drop tables service_inspection_findings and service_inspections.
-- ============================================================================

create table public.service_inspections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  inspection_number text not null,
  title text not null,
  template_key text,
  template_name text,
  inspection_type text not null default 'equipment_condition',
  status text not null default 'draft' check (
    status in ('draft', 'in_progress', 'completed', 'cancelled')
  ),
  stock_number text,
  reference_number text,
  customer_name text,
  machine_summary text,
  service_job_id uuid references public.service_jobs(id) on delete set null,
  customer_id uuid references public.qrm_companies(id) on delete set null,
  machine_id uuid references public.qrm_equipment(id) on delete set null,
  assignee_name text,
  approver_name text,
  created_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  approval_status text not null default 'not_requested' check (
    approval_status in ('not_requested', 'pending', 'approved', 'returned')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, inspection_number)
);

comment on table public.service_inspections is
  'InspectionPlus-style service inspection forms with optional service-job linking, assignee routing, and approval metadata.';

create index idx_service_inspections_workspace_status
  on public.service_inspections(workspace_id, status, created_at desc);

create index idx_service_inspections_service_job
  on public.service_inspections(service_job_id)
  where service_job_id is not null;

alter table public.service_inspections enable row level security;

create policy "svc_inspections_select"
  on public.service_inspections for select
  using (workspace_id = public.get_my_workspace());

create policy "svc_inspections_insert"
  on public.service_inspections for insert
  with check (workspace_id = public.get_my_workspace());

create policy "svc_inspections_update"
  on public.service_inspections for update
  using (workspace_id = public.get_my_workspace());

create policy "svc_inspections_delete"
  on public.service_inspections for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_inspections_service_all"
  on public.service_inspections for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_service_inspections_updated_at
  before update on public.service_inspections
  for each row execute function public.set_updated_at();

create table public.service_inspection_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  inspection_id uuid not null references public.service_inspections(id) on delete cascade,
  template_item_key text,
  section_label text not null,
  finding_label text not null,
  response text not null default 'pending' check (
    response in ('pending', 'pass', 'fail', 'na')
  ),
  sort_order integer not null default 0,
  expected_value text,
  observed_value text,
  notes text,
  photo_urls text[] not null default '{}'::text[],
  requires_follow_up boolean not null default false,
  linked_service_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_inspection_findings is
  'Line-level findings captured against a service inspection form.';

create index idx_service_inspection_findings_inspection
  on public.service_inspection_findings(inspection_id, sort_order);

alter table public.service_inspection_findings enable row level security;

create policy "svc_inspection_findings_select"
  on public.service_inspection_findings for select
  using (workspace_id = public.get_my_workspace());

create policy "svc_inspection_findings_insert"
  on public.service_inspection_findings for insert
  with check (workspace_id = public.get_my_workspace());

create policy "svc_inspection_findings_update"
  on public.service_inspection_findings for update
  using (workspace_id = public.get_my_workspace());

create policy "svc_inspection_findings_delete"
  on public.service_inspection_findings for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_inspection_findings_service_all"
  on public.service_inspection_findings for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_service_inspection_findings_updated_at
  before update on public.service_inspection_findings
  for each row execute function public.set_updated_at();
