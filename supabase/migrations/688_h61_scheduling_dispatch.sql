-- ============================================================================
-- Migration 681: H6.1 scheduling and dispatch foundation
--
-- H6.1 needs one live schedule for every open work order plus technician
-- assignment guidance by skill, certification, branch, and availability.
-- This keeps the manager as the final decision maker by surfacing ranked
-- candidates; it does not auto-assign technicians.
-- ============================================================================

BEGIN;

create index if not exists idx_service_jobs_h61_live_schedule_open
  on public.service_jobs(workspace_id, branch_id, scheduled_start_at, priority)
  where closed_at is null and deleted_at is null;
comment on index public.idx_service_jobs_h61_live_schedule_open is
  'H6.1 live shop schedule lookup for all open work orders by workspace, branch, date, and priority.';

create index if not exists idx_technician_profiles_h61_dispatch_fit
  on public.technician_profiles(workspace_id, branch_id, active_workload);
comment on index public.idx_technician_profiles_h61_dispatch_fit is
  'H6.1 technician assignment candidate lookup by workspace, branch, and workload.';

create or replace view public.v_service_live_schedule
  with (security_invoker = true) as
select
  j.id as service_job_id,
  j.workspace_id,
  j.branch_id,
  coalesce(j.wo_number, j.tracking_token) as schedule_reference,
  j.wo_number,
  j.tracking_token,
  j.customer_id,
  coalesce(c.name, j.requested_by_name, 'Unassigned customer') as customer_name,
  j.machine_id,
  coalesce(j.machine_make, m.make) as machine_make,
  coalesce(j.machine_model, m.model) as machine_model,
  coalesce(j.machine_serial_number, m.serial_number) as machine_serial_number,
  j.request_type,
  j.priority,
  j.current_stage,
  j.status_flags,
  j.shop_or_field,
  j.haul_required,
  j.machine_down,
  j.scheduled_start_at,
  j.scheduled_end_at,
  j.promised_at,
  case
    when j.scheduled_start_at is null then 'unscheduled'
    when j.scheduled_start_at::date < current_date then 'past_due'
    when j.scheduled_start_at::date = current_date then 'today'
    else 'upcoming'
  end as schedule_bucket,
  j.technician_id,
  coalesce(tech.full_name, tech.email) as technician_name,
  j.advisor_id,
  coalesce(advisor.full_name, advisor.email) as advisor_name,
  j.field_site_location,
  j.field_site_contact_name,
  j.field_site_contact_phone,
  blockers.active_blocker_count,
  blockers.active_blockers,
  case
    when j.current_stage = 'blocked_waiting' or blockers.active_blocker_count > 0 then 'blocked'
    when j.technician_id is null and j.scheduled_start_at is null then 'needs_schedule_and_assignment'
    when j.technician_id is null then 'needs_assignment'
    when j.scheduled_start_at is null then 'assigned_unscheduled'
    when j.shop_or_field = 'field' then 'field_dispatch_ready'
    else 'shop_dispatch_ready'
  end as dispatch_status,
  jsonb_build_object(
    'mobile_ready', j.technician_id is not null and j.scheduled_start_at is not null,
    'field_dispatch', j.shop_or_field = 'field',
    'technician_id', j.technician_id,
    'technician_name', coalesce(tech.full_name, tech.email),
    'site_location', j.field_site_location,
    'site_contact_name', j.field_site_contact_name,
    'site_contact_phone', j.field_site_contact_phone
  ) as mobile_dispatch_payload,
  j.created_at,
  j.updated_at
from public.service_jobs j
left join public.crm_companies c on c.id = j.customer_id
left join public.crm_equipment m on m.id = j.machine_id
left join public.profiles tech on tech.id = j.technician_id
left join public.profiles advisor on advisor.id = j.advisor_id
left join lateral (
  select
    count(*)::integer as active_blocker_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'blocker_type', b.blocker_type,
          'description', b.description,
          'created_at', b.created_at
        )
        order by b.created_at
      ) filter (where b.id is not null),
      '[]'::jsonb
    ) as active_blockers
  from public.service_job_blockers b
  where b.workspace_id = j.workspace_id
    and b.job_id = j.id
    and b.resolved_at is null
) blockers on true
where j.closed_at is null
  and j.deleted_at is null;

comment on view public.v_service_live_schedule is
  'H6.1 single live service schedule: every open work order, including unscheduled/unassigned work, with dispatch readiness for shop and field/mobile execution.';

create or replace function public.service_schedule_assignment_candidates(
  p_service_job_id uuid
)
returns table (
  service_job_id uuid,
  technician_profile_id uuid,
  technician_user_id uuid,
  technician_name text,
  branch_id text,
  branch_match boolean,
  shop_field_eligible boolean,
  brand_match boolean,
  legacy_cert_match boolean,
  oem_cert_match boolean,
  in_house_completed_count integer,
  active_workload integer,
  availability_date date,
  available_hours numeric,
  scheduled_hours numeric,
  capacity_remaining_hours numeric,
  suitability_score integer,
  reasons jsonb
)
language sql
stable
set search_path = ''
as $$
  with job as (
    select
      j.id as service_job_id,
      j.workspace_id,
      j.branch_id as job_branch_id,
      j.shop_or_field,
      coalesce(j.scheduled_start_at::date, current_date) as assignment_date,
      lower(coalesce(j.machine_make, m.make, '')) as machine_make_lc,
      lower(coalesce(jc.job_name, '')) as job_name_lc
    from public.service_jobs j
    left join public.crm_equipment m on m.id = j.machine_id
    left join public.job_codes jc on jc.id = j.selected_job_code_id
    where j.id = p_service_job_id
      and j.closed_at is null
      and j.deleted_at is null
  ),
  candidate_base as (
    select
      j.service_job_id,
      j.assignment_date,
      j.job_branch_id,
      j.shop_or_field,
      j.machine_make_lc,
      j.job_name_lc,
      tp.id as technician_profile_id,
      tp.user_id as technician_user_id,
      coalesce(nullif(p.full_name, ''), p.email, tp.user_id::text) as technician_name,
      tp.branch_id,
      tp.active_workload,
      case
        when j.job_branch_id is null or tp.branch_id is null then true
        else tp.branch_id = j.job_branch_id
      end as branch_match,
      case
        when j.shop_or_field = 'field' then tp.field_eligible
        else tp.shop_eligible
      end as shop_field_eligible,
      vendor.required_oem_vendor,
      brand.has_brand_profile,
      brand.brand_match,
      legacy.has_legacy_certs,
      legacy.legacy_cert_match,
      oem.oem_cert_match,
      inhouse.in_house_completed_count,
      capacity.available_hours,
      capacity.scheduled_hours,
      capacity.available_hours - capacity.scheduled_hours as capacity_remaining_hours
    from job j
    join public.technician_profiles tp on tp.workspace_id = j.workspace_id
    left join public.profiles p on p.id = tp.user_id
    cross join lateral (
      select case
        when j.machine_make_lc like '%cummins%' then 'cummins'
        when j.machine_make_lc like '%asv%' then 'asv'
        when j.machine_make_lc like '%yanmar%' then 'yanmar'
        when j.machine_make_lc like '%sennebogen%' then 'sennebogen'
        when j.machine_make_lc like '%develon%' or j.machine_make_lc like '%doosan%' then 'develon'
        when j.machine_make_lc like '%asc%' then 'asc'
        else null
      end as required_oem_vendor
    ) vendor
    cross join lateral (
      select
        exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(tp.brands_supported) = 'array' then tp.brands_supported else '[]'::jsonb end
          ) as supported(brand)
        ) as has_brand_profile,
        exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(tp.brands_supported) = 'array' then tp.brands_supported else '[]'::jsonb end
          ) as supported(brand)
          where j.machine_make_lc <> ''
            and j.machine_make_lc like '%' || lower(supported.brand) || '%'
        ) as brand_match
    ) brand
    cross join lateral (
      select
        exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(tp.certifications) = 'array' then tp.certifications else '[]'::jsonb end
          ) as cert(name)
        ) as has_legacy_certs,
        exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(tp.certifications) = 'array' then tp.certifications else '[]'::jsonb end
          ) as cert(name)
          where j.job_name_lc <> ''
            and j.job_name_lc like '%' || lower(cert.name) || '%'
        ) as legacy_cert_match
    ) legacy
    cross join lateral (
      select coalesce(
        exists (
          select 1
          from public.technician_oem_certifications cert
          where cert.workspace_id = tp.workspace_id
            and cert.technician_profile_id = tp.id
            and cert.vendor = vendor.required_oem_vendor
            and cert.status = 'completed'
            and (cert.expires_at is null or cert.expires_at >= current_date)
        ),
        false
      ) as oem_cert_match
    ) oem
    cross join lateral (
      select count(*)::integer as in_house_completed_count
      from public.technician_in_house_certifications cert
      where cert.workspace_id = tp.workspace_id
        and cert.technician_profile_id = tp.id
        and cert.status = 'completed'
        and (cert.expires_at is null or cert.expires_at >= current_date)
    ) inhouse
    cross join lateral (
      select
        coalesce((tp.weekly_schedule ->> trim(lower(to_char(j.assignment_date, 'Dy'))))::numeric, 0)::numeric as available_hours,
        coalesce((
          select sum(
            case
              when other.scheduled_start_at is null then 0
              else greatest(
                extract(epoch from (
                  coalesce(other.scheduled_end_at, other.scheduled_start_at + interval '1 hour')
                  - other.scheduled_start_at
                )) / 3600,
                0
              )
            end
          )
          from public.service_jobs other
          where other.workspace_id = tp.workspace_id
            and other.technician_id = tp.user_id
            and other.id <> j.service_job_id
            and other.closed_at is null
            and other.deleted_at is null
            and other.scheduled_start_at::date = j.assignment_date
        ), 0)::numeric as scheduled_hours
    ) capacity
  ),
  scored as (
    select
      cb.*,
      (
        100
        + case when cb.branch_match then 20 else -25 end
        + case when cb.shop_field_eligible then 25 else -50 end
        + case
            when cb.brand_match then 20
            when cb.machine_make_lc <> '' and cb.has_brand_profile then -5
            else 0
          end
        + case when cb.legacy_cert_match then 12 else 0 end
        + case
            when cb.oem_cert_match then 12
            when cb.required_oem_vendor is not null then -8
            else 0
          end
        + least(cb.in_house_completed_count * 2, 10)
        + case when cb.capacity_remaining_hours > 0 then 20 else -30 end
        - greatest(cb.active_workload, 0) * 3
      )::integer as suitability_score
    from candidate_base cb
  )
  select
    s.service_job_id,
    s.technician_profile_id,
    s.technician_user_id,
    s.technician_name,
    s.branch_id,
    s.branch_match,
    s.shop_field_eligible,
    s.brand_match,
    s.legacy_cert_match,
    s.oem_cert_match,
    s.in_house_completed_count,
    s.active_workload,
    s.assignment_date as availability_date,
    s.available_hours,
    s.scheduled_hours,
    s.capacity_remaining_hours,
    s.suitability_score,
    reason_list.reasons
  from scored s
  cross join lateral (
    select coalesce(jsonb_agg(reason), '[]'::jsonb) as reasons
    from (
      values
        (case when s.branch_match
          then jsonb_build_object('key', 'branch_match', 'label', 'Branch match', 'detail', coalesce(s.branch_id, 'No technician branch set'))
          else jsonb_build_object('key', 'branch_gap', 'label', 'Branch mismatch', 'detail', 'Technician is outside the work-order branch') end),
        (case when s.shop_field_eligible
          then jsonb_build_object('key', 'route_eligible', 'label', 'Route eligible', 'detail', s.shop_or_field)
          else jsonb_build_object('key', 'route_gap', 'label', 'Route mismatch', 'detail', s.shop_or_field) end),
        (case when s.brand_match
          then jsonb_build_object('key', 'brand_match', 'label', 'Brand match', 'detail', 'Technician brand profile matches machine make')
          when s.machine_make_lc <> '' and s.has_brand_profile
          then jsonb_build_object('key', 'brand_gap', 'label', 'Brand gap', 'detail', 'No supported brand matched machine make')
          else null end),
        (case when s.legacy_cert_match
          then jsonb_build_object('key', 'legacy_cert_match', 'label', 'Skill/cert match', 'detail', 'Legacy certification matched job code')
          else null end),
        (case when s.oem_cert_match
          then jsonb_build_object('key', 'oem_cert_match', 'label', 'OEM cert match', 'detail', s.required_oem_vendor)
          when s.required_oem_vendor is not null
          then jsonb_build_object('key', 'oem_cert_gap', 'label', 'OEM cert gap', 'detail', s.required_oem_vendor)
          else null end),
        (case when s.capacity_remaining_hours > 0
          then jsonb_build_object('key', 'capacity_available', 'label', 'Capacity available', 'detail', s.capacity_remaining_hours::text || 'h remaining')
          else jsonb_build_object('key', 'capacity_full', 'label', 'Capacity full', 'detail', s.capacity_remaining_hours::text || 'h remaining') end),
        (jsonb_build_object('key', 'active_workload', 'label', 'Active workload', 'detail', s.active_workload::text || ' open jobs'))
    ) as r(reason)
    where reason is not null
  ) reason_list
  order by
    s.suitability_score desc,
    s.active_workload asc,
    s.technician_name asc;
$$;

comment on function public.service_schedule_assignment_candidates(uuid) is
  'H6.1 ranks technician candidates for a service job by branch, shop/field eligibility, brands, legacy/OEM/in-house certifications, active workload, and schedule capacity. Manager remains final approver.';

grant select on public.v_service_live_schedule to authenticated, service_role;
revoke all on function public.service_schedule_assignment_candidates(uuid) from public;
grant execute on function public.service_schedule_assignment_candidates(uuid) to authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/688_h61_scheduling_dispatch.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H6') ||
      ' | supabase/migrations/688_h61_scheduling_dispatch.sql' ||
      ' | supabase/functions/service-scheduler/index.ts' ||
      ' | apps/web/src/features/service/components/ServiceJobDetailDrawer.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H6.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H6.1 shipped: v_service_live_schedule exposes every open work order on one live schedule, including unscheduled/unassigned backlog and field/mobile dispatch readiness; service_schedule_assignment_candidates ranks technicians by branch, shop/field eligibility, supported brands, legacy/OEM/in-house certifications, active workload, and schedule capacity while leaving final assignment to the manager.'
  END,
  updated_at = now()
WHERE task_id = 'H6.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H6.1',
  'update',
  jsonb_build_object(
    'reason', 'h61_scheduling_dispatch',
    'migration', '688_h61_scheduling_dispatch.sql',
    'mission_alignment', 'pass: service managers get one live schedule for all open equipment repair work and evidence-ranked technician candidates for dispatch, reducing whiteboard dependence while preserving human final assignment control',
    'implementation_evidence', jsonb_build_array(
      'public.v_service_live_schedule',
      'public.service_schedule_assignment_candidates(uuid)',
      'supabase/functions/service-scheduler/index.ts',
      'apps/web/src/features/service/components/ServiceJobDetailDrawer.tsx'
    )
  ),
  'codex'
);

COMMIT;
