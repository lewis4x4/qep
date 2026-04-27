-- 421_service_job_segments.sql
--
-- Wave 1B: IntelliDealer multi-segment work order foundation from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#work_order_segment.segment_number.
--
-- Rollback notes:
--   drop trigger if exists set_service_job_segments_updated_at on public.service_job_segments;
--   drop policy if exists "service_job_segments_rep_scope" on public.service_job_segments;
--   drop policy if exists "service_job_segments_all_elevated" on public.service_job_segments;
--   drop policy if exists "service_job_segments_service_all" on public.service_job_segments;
--   drop table if exists public.service_job_segments;

create table public.service_job_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  segment_number text not null,
  description text,
  complaint text,
  cause text,
  correction text,
  job_code_id uuid references public.job_codes(id) on delete set null,
  job_code_number text,
  rate_code text,
  type char(1),
  reason char(1),
  priority text,
  status text not null default 'open',
  technician_id uuid references public.profiles(id) on delete set null,
  shop_bay_id uuid references public.service_shop_bays(id) on delete set null,
  scheduled_start_at timestamptz,
  date_started timestamptz,
  last_activity_at timestamptz,
  estimated_completion_at timestamptz,
  estimated_hours numeric(8,2),
  quantity numeric(8,2),
  hours_actual numeric(8,2),
  assist_hours numeric(8,2),
  add_on_hours numeric(8,2),
  gl_labor_account text,
  gl_warranty_account text,
  gl_internal_account text,
  gl_customer_account text,
  machine_make text,
  machine_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, service_job_id, segment_number)
);

comment on table public.service_job_segments is
  'Multi-segment service work-order rows with Three-Cs, job code, technician, hours, and GL routing.';

create index idx_service_job_segments_job
  on public.service_job_segments (workspace_id, service_job_id, segment_number)
  where deleted_at is null;
comment on index public.idx_service_job_segments_job is
  'Purpose: render Work Order Detail segment grid in segment-number order.';

create index idx_service_job_segments_technician_schedule
  on public.service_job_segments (workspace_id, technician_id, scheduled_start_at)
  where technician_id is not null and deleted_at is null;
comment on index public.idx_service_job_segments_technician_schedule is
  'Purpose: IntelliTech technician schedule lookups by assigned segment.';

alter table public.service_job_segments enable row level security;

create policy "service_job_segments_service_all"
  on public.service_job_segments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_job_segments_all_elevated"
  on public.service_job_segments for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "service_job_segments_rep_scope"
  on public.service_job_segments for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.service_jobs j
      where j.id = service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and (
          j.advisor_id = (select auth.uid())
          or j.technician_id = (select auth.uid())
          or j.service_manager_id = (select auth.uid())
          or public.crm_rep_can_access_company(j.customer_id)
        )
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.service_jobs j
      where j.id = service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and (
          j.advisor_id = (select auth.uid())
          or j.technician_id = (select auth.uid())
          or j.service_manager_id = (select auth.uid())
          or public.crm_rep_can_access_company(j.customer_id)
        )
    )
  );

create trigger set_service_job_segments_updated_at
  before update on public.service_job_segments
  for each row execute function public.set_updated_at();
