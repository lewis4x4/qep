-- ============================================================================
-- Migration 637: H5 technician execution documentation gates
--
-- Adds per-segment diagnostic/repair sign-off, labor-story quality fields,
-- quoted-time overrun alerting, before/during/after segment photo metadata,
-- lock-out/tag-out and warranty-parts turn-in capture, plus a Service Advisor
-- documentation-review close gate. Existing jobs/segments are backfilled as
-- not_required; new work defaults into the H5 gate.
-- ============================================================================

-- ── Job-level documentation review and safety gate state ---------------------

alter table public.service_jobs
  add column if not exists h5_documentation_required boolean,
  add column if not exists documentation_review_status text,
  add column if not exists documentation_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists documentation_reviewed_at timestamptz,
  add column if not exists documentation_returned_by uuid references public.profiles(id) on delete set null,
  add column if not exists documentation_returned_at timestamptz,
  add column if not exists documentation_review_notes text,
  add column if not exists documentation_return_reason text,
  add column if not exists lockout_tagout_required boolean,
  add column if not exists lockout_tagout_completed boolean,
  add column if not exists lockout_tagout_completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists lockout_tagout_completed_at timestamptz,
  add column if not exists lockout_tagout_notes text;

update public.service_jobs
set
  h5_documentation_required = coalesce(h5_documentation_required, false),
  documentation_review_status = coalesce(documentation_review_status, 'not_required'),
  lockout_tagout_required = coalesce(lockout_tagout_required, false),
  lockout_tagout_completed = coalesce(lockout_tagout_completed, false)
where h5_documentation_required is null
   or documentation_review_status is null
   or lockout_tagout_required is null
   or lockout_tagout_completed is null;

alter table public.service_jobs
  alter column h5_documentation_required set default true,
  alter column h5_documentation_required set not null,
  alter column documentation_review_status set default 'pending',
  alter column documentation_review_status set not null,
  alter column lockout_tagout_required set default false,
  alter column lockout_tagout_required set not null,
  alter column lockout_tagout_completed set default false,
  alter column lockout_tagout_completed set not null;

comment on column public.service_jobs.h5_documentation_required is
  'H5 close-gate flag. Existing jobs are backfilled false/not_required; new H2-shaped jobs default true.';
comment on column public.service_jobs.documentation_review_status is
  'H5 Service Advisor documentation-review state: not_required, pending, returned, or approved.';
comment on column public.service_jobs.documentation_reviewed_by is
  'H5 Service Advisor who approved job documentation for close/invoice readiness.';
comment on column public.service_jobs.documentation_return_reason is
  'H5 reason the Service Advisor returned the job to the technician for documentation repair.';
comment on column public.service_jobs.lockout_tagout_required is
  'H5 job-level lock-out/tag-out safety flag. Segment-level flags can also require completion before close.';
comment on column public.service_jobs.lockout_tagout_completed is
  'H5 job-level lock-out/tag-out completion confirmation.';

-- ── Segment execution/sign-off/labor-story state -----------------------------

alter table public.service_job_segments
  add column if not exists h5_documentation_required boolean,
  add column if not exists diagnostic_signoff_status text,
  add column if not exists diagnostic_submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists diagnostic_submitted_at timestamptz,
  add column if not exists diagnostic_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists diagnostic_approved_at timestamptz,
  add column if not exists diagnostic_returned_by uuid references public.profiles(id) on delete set null,
  add column if not exists diagnostic_returned_at timestamptz,
  add column if not exists diagnostic_review_notes text,
  add column if not exists repair_signoff_status text,
  add column if not exists repair_signed_off_by uuid references public.profiles(id) on delete set null,
  add column if not exists repair_signed_off_at timestamptz,
  add column if not exists labor_story text,
  add column if not exists labor_story_complaint_verification text,
  add column if not exists labor_story_diagnostic_steps text,
  add column if not exists labor_story_root_cause text,
  add column if not exists labor_story_parts_used text,
  add column if not exists labor_story_work_performed text,
  add column if not exists quoted_labor_hours numeric(8, 2),
  add column if not exists overrun_threshold_pct numeric(5, 2),
  add column if not exists overrun_status text,
  add column if not exists overrun_flagged_at timestamptz,
  add column if not exists overrun_acknowledged_by uuid references public.profiles(id) on delete set null,
  add column if not exists overrun_acknowledged_at timestamptz,
  add column if not exists overrun_reason text,
  add column if not exists lockout_tagout_required boolean,
  add column if not exists lockout_tagout_completed boolean,
  add column if not exists lockout_tagout_completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists lockout_tagout_completed_at timestamptz,
  add column if not exists lockout_tagout_notes text,
  add column if not exists warranty_parts_turn_in_required boolean,
  add column if not exists warranty_parts_turn_in_completed boolean,
  add column if not exists warranty_parts_turn_in_completed_by uuid references public.profiles(id) on delete set null,
  add column if not exists warranty_parts_turn_in_completed_at timestamptz,
  add column if not exists warranty_parts_label text,
  add column if not exists warranty_parts_turn_in_notes text;

update public.service_job_segments
set
  h5_documentation_required = coalesce(h5_documentation_required, false),
  diagnostic_signoff_status = coalesce(diagnostic_signoff_status, 'not_required'),
  repair_signoff_status = coalesce(repair_signoff_status, 'not_required'),
  overrun_threshold_pct = coalesce(overrun_threshold_pct, 10.00),
  overrun_status = coalesce(overrun_status, 'not_evaluated'),
  lockout_tagout_required = coalesce(lockout_tagout_required, false),
  lockout_tagout_completed = coalesce(lockout_tagout_completed, false),
  warranty_parts_turn_in_required = coalesce(warranty_parts_turn_in_required, false),
  warranty_parts_turn_in_completed = coalesce(warranty_parts_turn_in_completed, false)
where h5_documentation_required is null
   or diagnostic_signoff_status is null
   or repair_signoff_status is null
   or overrun_threshold_pct is null
   or overrun_status is null
   or lockout_tagout_required is null
   or lockout_tagout_completed is null
   or warranty_parts_turn_in_required is null
   or warranty_parts_turn_in_completed is null;

alter table public.service_job_segments
  alter column h5_documentation_required set default true,
  alter column h5_documentation_required set not null,
  alter column diagnostic_signoff_status set default 'not_submitted',
  alter column diagnostic_signoff_status set not null,
  alter column repair_signoff_status set default 'not_started',
  alter column repair_signoff_status set not null,
  alter column overrun_threshold_pct set default 10.00,
  alter column overrun_threshold_pct set not null,
  alter column overrun_status set default 'not_evaluated',
  alter column overrun_status set not null,
  alter column lockout_tagout_required set default false,
  alter column lockout_tagout_required set not null,
  alter column lockout_tagout_completed set default false,
  alter column lockout_tagout_completed set not null,
  alter column warranty_parts_turn_in_required set default false,
  alter column warranty_parts_turn_in_required set not null,
  alter column warranty_parts_turn_in_completed set default false,
  alter column warranty_parts_turn_in_completed set not null;

comment on column public.service_job_segments.h5_documentation_required is
  'H5 segment documentation gate flag. Existing segments are backfilled false/not_required; new segments default true.';
comment on column public.service_job_segments.diagnostic_signoff_status is
  'H5 diagnostic sign-off state: not_required, not_submitted, submitted, returned, approved.';
comment on column public.service_job_segments.repair_signoff_status is
  'H5 repair sign-off state: not_required, not_started, completed.';
comment on column public.service_job_segments.labor_story is
  'H5 technician labor story visible enough for another technician and customer value review.';
comment on column public.service_job_segments.labor_story_parts_used is
  'H5 labor-story parts and quantities narrative. Use explicit none if no parts were used.';
comment on column public.service_job_segments.quoted_labor_hours is
  'H5 quoted/approved labor budget for overrun alerting. Falls back to estimated_hours when null.';
comment on column public.service_job_segments.overrun_status is
  'H5 quoted-time status: not_evaluated, within_budget, overrun_unacknowledged, overrun_acknowledged.';
comment on column public.service_job_segments.lockout_tagout_required is
  'H5 segment-level lock-out/tag-out safety flag.';
comment on column public.service_job_segments.warranty_parts_turn_in_required is
  'H5 warranty-parts turn-in capture flag only. Full warranty claim lifecycle is H8.';
comment on column public.service_job_segments.warranty_parts_label is
  'H5 warranty-parts label/identifier captured at turn-in.';

-- ── Constraints --------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h5_doc_review_status_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h5_doc_review_status_chk
      check (documentation_review_status in ('not_required', 'pending', 'returned', 'approved')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segments_h5_diagnostic_status_chk') then
    alter table public.service_job_segments
      add constraint service_job_segments_h5_diagnostic_status_chk
      check (diagnostic_signoff_status in ('not_required', 'not_submitted', 'submitted', 'returned', 'approved')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segments_h5_repair_status_chk') then
    alter table public.service_job_segments
      add constraint service_job_segments_h5_repair_status_chk
      check (repair_signoff_status in ('not_required', 'not_started', 'completed')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segments_h5_overrun_status_chk') then
    alter table public.service_job_segments
      add constraint service_job_segments_h5_overrun_status_chk
      check (overrun_status in ('not_evaluated', 'within_budget', 'overrun_unacknowledged', 'overrun_acknowledged')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segments_h5_hours_nonnegative_chk') then
    alter table public.service_job_segments
      add constraint service_job_segments_h5_hours_nonnegative_chk
      check (
        (quoted_labor_hours is null or quoted_labor_hours >= 0)
        and (overrun_threshold_pct >= 0 and overrun_threshold_pct <= 100)
      ) not valid;
  end if;
end $$;

-- ── Before/during/after segment photo metadata -------------------------------

create table if not exists public.service_job_segment_photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  service_job_segment_id uuid not null references public.service_job_segments(id) on delete cascade,
  phase text not null,
  category text not null default 'other',
  storage_bucket text not null default 'portal-service-photos',
  storage_path text not null,
  caption text,
  content_type text,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  unique (storage_bucket, storage_path)
);

comment on table public.service_job_segment_photos is
  'H5 metadata for technician before/during/after service-work photos stored in the existing portal-service-photos bucket.';
comment on column public.service_job_segment_photos.phase is
  'H5 required photo phase: before, during, after.';
comment on column public.service_job_segment_photos.category is
  'H5 photo category: overall_condition, hour_meter, problem_area, fluids, failed_components, fault_codes, or other.';
comment on column public.service_job_segment_photos.storage_path is
  'Path within portal-service-photos. Staff uploads must use {workspace}/service-jobs/{job}/segments/{segment}/... paths.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_job_segment_photos_phase_chk') then
    alter table public.service_job_segment_photos
      add constraint service_job_segment_photos_phase_chk
      check (phase in ('before', 'during', 'after')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segment_photos_category_chk') then
    alter table public.service_job_segment_photos
      add constraint service_job_segment_photos_category_chk
      check (category in ('overall_condition', 'hour_meter', 'problem_area', 'fluids', 'failed_components', 'fault_codes', 'other')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_job_segment_photos_bucket_chk') then
    alter table public.service_job_segment_photos
      add constraint service_job_segment_photos_bucket_chk
      check (storage_bucket = 'portal-service-photos') not valid;
  end if;
end $$;

create index if not exists idx_service_job_segment_photos_segment_phase
  on public.service_job_segment_photos(workspace_id, service_job_segment_id, phase)
  where deleted_at is null;
comment on index public.idx_service_job_segment_photos_segment_phase is
  'Supports H5 close gate lookup of before/during/after photos by segment.';

create index if not exists idx_service_job_segments_h5_doc_required
  on public.service_job_segments(workspace_id, service_job_id, h5_documentation_required)
  where deleted_at is null and h5_documentation_required = true;
comment on index public.idx_service_job_segments_h5_doc_required is
  'Supports H5 Service Advisor documentation-review close gate.';

create index if not exists idx_service_job_segments_overrun_alerts
  on public.service_job_segments(workspace_id, overrun_status, service_job_id)
  where deleted_at is null and overrun_status = 'overrun_unacknowledged';
comment on index public.idx_service_job_segments_overrun_alerts is
  'Supports H5 quoted-time overrun alert queue.';

create or replace function public.enforce_service_job_segment_photo_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.service_job_segments s
    where s.id = new.service_job_segment_id
      and s.service_job_id = new.service_job_id
      and s.workspace_id = new.workspace_id
      and s.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Service segment photo must reference a segment on the same service job and workspace.',
      detail = 'service_segment_photo_parent_guard';
  end if;

  return new;
end;
$$;

comment on function public.enforce_service_job_segment_photo_parent() is
  'H5 DB backstop: ensures photo metadata cannot link a service job to an unrelated segment.';

drop trigger if exists service_job_segment_photos_parent_guard_trg on public.service_job_segment_photos;
create trigger service_job_segment_photos_parent_guard_trg
  before insert or update of workspace_id, service_job_id, service_job_segment_id on public.service_job_segment_photos
  for each row execute function public.enforce_service_job_segment_photo_parent();

-- ── RLS for technician updates and photo metadata ----------------------------

alter table public.service_job_segment_photos enable row level security;

drop policy if exists "service_job_segment_photos_service_all" on public.service_job_segment_photos;
create policy "service_job_segment_photos_service_all"
  on public.service_job_segment_photos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "service_job_segment_photos_staff_select" on public.service_job_segment_photos;
create policy "service_job_segment_photos_staff_select"
  on public.service_job_segment_photos for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter', 'finance_admin'
    )
  );

drop policy if exists "service_job_segment_photos_staff_insert" on public.service_job_segment_photos;
create policy "service_job_segment_photos_staff_insert"
  on public.service_job_segment_photos for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

drop policy if exists "service_job_segment_photos_staff_update" on public.service_job_segment_photos;
create policy "service_job_segment_photos_staff_update"
  on public.service_job_segment_photos for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

drop policy if exists "service_job_segment_photos_technician_select" on public.service_job_segment_photos;
create policy "service_job_segment_photos_technician_select"
  on public.service_job_segment_photos for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and exists (
      select 1
      from public.service_jobs j
      where j.id = service_job_segment_photos.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

drop policy if exists "service_job_segment_photos_technician_insert" on public.service_job_segment_photos;
create policy "service_job_segment_photos_technician_insert"
  on public.service_job_segment_photos for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and uploaded_by = (select auth.uid())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and exists (
      select 1
      from public.service_jobs j
      where j.id = service_job_segment_photos.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and j.technician_id = (select auth.uid())
    )
  );

drop policy if exists "service_job_segments_technician_h5_update" on public.service_job_segments;
create policy "service_job_segments_technician_h5_update"
  on public.service_job_segments for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and (
      technician_id = (select auth.uid())
      or exists (
        select 1
        from public.service_jobs j
        where j.id = service_job_segments.service_job_id
          and j.workspace_id = (select public.get_my_workspace())
          and j.technician_id = (select auth.uid())
      )
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and (
      technician_id = (select auth.uid())
      or exists (
        select 1
        from public.service_jobs j
        where j.id = service_job_segments.service_job_id
          and j.workspace_id = (select public.get_my_workspace())
          and j.technician_id = (select auth.uid())
      )
    )
  );

-- Technician table updates need a DB backstop because RLS is row-level, not
-- column-level. Keep review/approval and required-gate fields staff-owned even
-- if a technician uses PostgREST directly instead of the edge router.

create or replace function public.enforce_service_job_segment_technician_h5_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[] := array[
    'updated_at',
    'complaint',
    'cause',
    'correction',
    'diagnostic_signoff_status',
    'diagnostic_submitted_by',
    'diagnostic_submitted_at',
    'repair_signoff_status',
    'repair_signed_off_by',
    'repair_signed_off_at',
    'labor_story',
    'labor_story_complaint_verification',
    'labor_story_diagnostic_steps',
    'labor_story_root_cause',
    'labor_story_parts_used',
    'labor_story_work_performed',
    'quoted_labor_hours',
    'estimated_hours',
    'hours_actual',
    'overrun_threshold_pct',
    'overrun_status',
    'overrun_flagged_at',
    'overrun_acknowledged_by',
    'overrun_acknowledged_at',
    'overrun_reason',
    'lockout_tagout_required',
    'lockout_tagout_completed',
    'lockout_tagout_completed_by',
    'lockout_tagout_completed_at',
    'lockout_tagout_notes',
    'warranty_parts_turn_in_required',
    'warranty_parts_turn_in_completed',
    'warranty_parts_turn_in_completed_by',
    'warranty_parts_turn_in_completed_at',
    'warranty_parts_label',
    'warranty_parts_turn_in_notes'
  ];
begin
  if (select auth.role()) = 'service_role'
     or coalesce((select public.get_my_role())::text, '') <> 'technician' then
    return new;
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception using
      errcode = 'P0001',
      message = 'Technicians may update only H5 execution documentation fields on assigned service segments.',
      detail = 'service_segment_technician_column_guard';
  end if;

  if new.diagnostic_signoff_status is distinct from old.diagnostic_signoff_status
     and new.diagnostic_signoff_status <> 'submitted' then
    raise exception using
      errcode = 'P0001',
      message = 'Technicians may submit, but not approve or return, diagnostic sign-off.',
      detail = 'service_segment_diagnostic_review_guard';
  end if;

  if new.repair_signoff_status is distinct from old.repair_signoff_status
     and new.repair_signoff_status <> 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'Technicians may only mark repair sign-off completed.',
      detail = 'service_segment_repair_signoff_guard';
  end if;

  if new.diagnostic_submitted_by is distinct from old.diagnostic_submitted_by
     and new.diagnostic_submitted_by is distinct from (select auth.uid()) then
    raise exception using
      errcode = 'P0001',
      message = 'Technician diagnostic submitter must be the caller.',
      detail = 'service_segment_diagnostic_actor_guard';
  end if;

  if new.repair_signed_off_by is distinct from old.repair_signed_off_by
     and new.repair_signed_off_by is distinct from (select auth.uid()) then
    raise exception using
      errcode = 'P0001',
      message = 'Technician repair sign-off actor must be the caller.',
      detail = 'service_segment_repair_actor_guard';
  end if;

  return new;
end;
$$;

comment on function public.enforce_service_job_segment_technician_h5_update() is
  'H5 DB backstop: prevents technician direct table updates from bypassing SA diagnostic approval or disabling documentation gates.';

drop trigger if exists service_job_segments_h5_technician_update_guard_trg on public.service_job_segments;
create trigger service_job_segments_h5_technician_update_guard_trg
  before update on public.service_job_segments
  for each row execute function public.enforce_service_job_segment_technician_h5_update();

-- Staff access to the existing portal-service-photos bucket. Existing portal
-- customer policies remain intact; this adds workspace/job/segment-prefixed
-- staff paths and assigned-job technician checks.

drop policy if exists "service_photos_staff_insert" on storage.objects;
create policy "service_photos_staff_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = (select public.get_my_workspace())
    and (storage.foldername(name))[2] = 'service-jobs'
    and (storage.foldername(name))[4] = 'segments'
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_jobs j
          join public.service_job_segments s on s.service_job_id = j.id
          where j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
            and j.id::text = (storage.foldername(name))[3]
            and s.id::text = (storage.foldername(name))[5]
            and s.deleted_at is null
        )
      )
    )
  );

drop policy if exists "service_photos_staff_select" on storage.objects;
create policy "service_photos_staff_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = (select public.get_my_workspace())
    and (
      coalesce((select public.get_my_role())::text, '') in (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter', 'finance_admin'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and exists (
          select 1
          from public.service_job_segment_photos p
          join public.service_jobs j on j.id = p.service_job_id
          where p.storage_bucket = storage.objects.bucket_id
            and p.storage_path = storage.objects.name
            and p.workspace_id = (select public.get_my_workspace())
            and p.deleted_at is null
            and j.workspace_id = (select public.get_my_workspace())
            and j.technician_id = (select auth.uid())
        )
      )
    )
  );

drop policy if exists "service_photos_staff_delete" on storage.objects;
create policy "service_photos_staff_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = (select public.get_my_workspace())
    and (storage.foldername(name))[2] = 'service-jobs'
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch'
    )
  );

-- ── H5 documentation close gate ---------------------------------------------

create or replace function public.service_job_h5_documentation_gate(
  p_job_id uuid,
  p_require_sa_review boolean default true
)
returns table (
  ok boolean,
  code text,
  reason text,
  missing jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j record;
  s record;
  v_missing jsonb := '[]'::jsonb;
  v_has_required_segment boolean := false;
  v_phase text;
  v_photo_exists boolean;
  v_budget numeric;
  v_threshold_hours numeric;
begin
  select
    id,
    workspace_id,
    customer_id,
    advisor_id,
    technician_id,
    service_manager_id,
    h5_documentation_required,
    documentation_review_status,
    lockout_tagout_required,
    lockout_tagout_completed
  into j
  from public.service_jobs
  where id = p_job_id
    and deleted_at is null;

  if not found then
    return query select
      false,
      'service_job_not_found'::text,
      'Service job not found for H5 documentation gate.'::text,
      jsonb_build_array(jsonb_build_object('scope', 'job', 'field', 'id'));
    return;
  end if;

  if (select auth.role()) <> 'service_role' and (
    j.workspace_id is distinct from (select public.get_my_workspace())
    or not (
      coalesce((select public.get_my_role())::text, '') in (
        'admin', 'manager', 'owner', 'service_writer', 'dispatch', 'parts_counter', 'finance_admin'
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'rep'
        and (
          j.advisor_id = (select auth.uid())
          or j.technician_id = (select auth.uid())
          or j.service_manager_id = (select auth.uid())
          or public.crm_rep_can_access_company(j.customer_id)
        )
      )
      or (
        coalesce((select public.get_my_role())::text, '') = 'technician'
        and j.technician_id = (select auth.uid())
      )
    )
  ) then
    return query select
      false,
      'service_job_not_found'::text,
      'Service job not found for H5 documentation gate.'::text,
      jsonb_build_array(jsonb_build_object('scope', 'job', 'field', 'id'));
    return;
  end if;

  select exists(
    select 1
    from public.service_job_segments seg
    where seg.service_job_id = p_job_id
      and seg.deleted_at is null
      and seg.h5_documentation_required = true
  ) into v_has_required_segment;

  if coalesce(j.h5_documentation_required, false) = false
     and v_has_required_segment = false then
    return query select
      true,
      'h5_documentation_not_required'::text,
      'H5 documentation gate is not required for this legacy service job.'::text,
      '[]'::jsonb;
    return;
  end if;

  if p_require_sa_review = true
     and coalesce(j.documentation_review_status, 'pending') <> 'approved' then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'job',
      'field', 'documentation_review_status',
      'expected', 'approved',
      'actual', coalesce(j.documentation_review_status, 'pending')
    ));
  end if;

  if coalesce(j.lockout_tagout_required, false) = true
     and coalesce(j.lockout_tagout_completed, false) = false then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'job',
      'field', 'lockout_tagout_completed'
    ));
  end if;

  if coalesce(j.h5_documentation_required, false) = true
     and v_has_required_segment = false then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'scope', 'job',
      'field', 'service_job_segments',
      'reason', 'At least one H5-required segment is needed before documentation review.'
    ));
  end if;

  for s in
    select *
    from public.service_job_segments seg
    where seg.service_job_id = p_job_id
      and seg.deleted_at is null
      and seg.h5_documentation_required = true
    order by seg.segment_number
  loop
    if coalesce(s.diagnostic_signoff_status, '') <> 'approved' then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'scope', 'segment',
        'segment_id', s.id,
        'segment_number', s.segment_number,
        'field', 'diagnostic_signoff_status',
        'expected', 'approved',
        'actual', s.diagnostic_signoff_status
      ));
    end if;

    if coalesce(s.repair_signoff_status, '') <> 'completed' then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'scope', 'segment',
        'segment_id', s.id,
        'segment_number', s.segment_number,
        'field', 'repair_signoff_status',
        'expected', 'completed',
        'actual', s.repair_signoff_status
      ));
    end if;

    if length(trim(coalesce(s.labor_story, ''))) < 40 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story'));
    end if;
    if length(trim(coalesce(s.labor_story_complaint_verification, ''))) < 10 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story_complaint_verification'));
    end if;
    if length(trim(coalesce(s.labor_story_diagnostic_steps, ''))) < 10 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story_diagnostic_steps'));
    end if;
    if length(trim(coalesce(s.labor_story_root_cause, ''))) < 10 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story_root_cause'));
    end if;
    if length(trim(coalesce(s.labor_story_parts_used, ''))) < 10 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story_parts_used'));
    end if;
    if length(trim(coalesce(s.labor_story_work_performed, ''))) < 10 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('scope', 'segment', 'segment_id', s.id, 'segment_number', s.segment_number, 'field', 'labor_story_work_performed'));
    end if;

    v_budget := coalesce(s.quoted_labor_hours, s.estimated_hours);
    if v_budget is not null and v_budget > 0 and s.hours_actual is not null then
      v_threshold_hours := round((v_budget * (1 + coalesce(s.overrun_threshold_pct, 10.00) / 100.0))::numeric, 2);
      if s.hours_actual > v_threshold_hours and s.overrun_acknowledged_at is null then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'scope', 'segment',
          'segment_id', s.id,
          'segment_number', s.segment_number,
          'field', 'overrun_acknowledged_at',
          'budget_hours', v_budget,
          'actual_hours', s.hours_actual,
          'threshold_hours', v_threshold_hours
        ));
      end if;
    end if;

    if coalesce(s.lockout_tagout_required, false) = true
       and coalesce(s.lockout_tagout_completed, false) = false then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'scope', 'segment',
        'segment_id', s.id,
        'segment_number', s.segment_number,
        'field', 'lockout_tagout_completed'
      ));
    end if;

    if coalesce(s.warranty_parts_turn_in_required, false) = true then
      if coalesce(s.warranty_parts_turn_in_completed, false) = false then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'scope', 'segment',
          'segment_id', s.id,
          'segment_number', s.segment_number,
          'field', 'warranty_parts_turn_in_completed'
        ));
      end if;
      if length(trim(coalesce(s.warranty_parts_label, ''))) < 3 then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'scope', 'segment',
          'segment_id', s.id,
          'segment_number', s.segment_number,
          'field', 'warranty_parts_label'
        ));
      end if;
    end if;

    foreach v_phase in array array['before', 'during', 'after'] loop
      select exists(
        select 1
        from public.service_job_segment_photos p
        where p.service_job_segment_id = s.id
          and p.service_job_id = p_job_id
          and p.workspace_id = j.workspace_id
          and p.phase = v_phase
          and p.deleted_at is null
      ) into v_photo_exists;

      if v_photo_exists = false then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'scope', 'segment',
          'segment_id', s.id,
          'segment_number', s.segment_number,
          'field', 'service_job_segment_photos',
          'phase', v_phase
        ));
      end if;
    end loop;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    return query select
      false,
      'h5_documentation_incomplete'::text,
      'Service Advisor documentation review cannot pass until segment sign-off, labor story, overrun, safety, warranty turn-in, and before/during/after photo requirements are complete.'::text,
      v_missing;
    return;
  end if;

  return query select
    true,
    'h5_documentation_complete'::text,
    'H5 technician execution documentation is complete for close.'::text,
    '[]'::jsonb;
end;
$$;

comment on function public.service_job_h5_documentation_gate(uuid, boolean) is
  'H5 close gate. With p_require_sa_review=false it validates segment documentation before SA approval; with true it also requires SA-approved review.';

revoke execute on function public.service_job_h5_documentation_gate(uuid, boolean) from public;
grant execute on function public.service_job_h5_documentation_gate(uuid, boolean) to authenticated, service_role;

create or replace function public.enforce_service_job_h5_documentation_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate record;
begin
  if (
    new.closed_at is not null
    and old.closed_at is distinct from new.closed_at
  ) or (
    new.current_stage::text in ('invoice_ready', 'invoiced', 'paid_closed')
    and coalesce(old.current_stage::text, '') is distinct from new.current_stage::text
  ) then
    select * into gate
    from public.service_job_h5_documentation_gate(new.id, true)
    limit 1;

    if gate.ok is not true then
      raise exception using
        errcode = 'P0001',
        message = gate.reason,
        detail = gate.code;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_service_job_h5_documentation_close() is
  'H5 DB backstop: direct service_jobs close/invoice-ready updates are blocked until Service Advisor documentation review passes.';

drop trigger if exists service_jobs_h5_documentation_close_trg on public.service_jobs;
create trigger service_jobs_h5_documentation_close_trg
  before update of current_stage, closed_at on public.service_jobs
  for each row execute function public.enforce_service_job_h5_documentation_close();
