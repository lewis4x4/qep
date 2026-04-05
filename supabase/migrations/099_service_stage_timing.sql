-- ============================================================================
-- Migration 099: Service job stage timing + portal link column
--
-- current_stage_entered_at: true dwell time per stage for TAT/SLA (not updated_at).
-- portal_request_id: optional link to customer portal service_requests.
-- ============================================================================

-- Stage entered at (dwell clock for TAT monitor)
alter table public.service_jobs
  add column if not exists current_stage_entered_at timestamptz;

update public.service_jobs
set current_stage_entered_at = coalesce(updated_at, created_at, now())
where current_stage_entered_at is null;

alter table public.service_jobs
  alter column current_stage_entered_at set not null;

alter table public.service_jobs
  alter column current_stage_entered_at set default now();

comment on column public.service_jobs.current_stage_entered_at is
  'When the job entered current_stage; used for SLA dwell time (not bumped by unrelated field updates).';

-- Portal intake → internal job (optional)
alter table public.service_jobs
  add column if not exists portal_request_id uuid references public.service_requests(id) on delete set null;

create index if not exists idx_svc_jobs_portal_request
  on public.service_jobs(portal_request_id)
  where portal_request_id is not null;

comment on column public.service_jobs.portal_request_id is
  'Customer portal service_requests row that spawned or links to this internal job.';
