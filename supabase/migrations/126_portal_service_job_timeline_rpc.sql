-- ============================================================================
-- Migration 126: P1-D Portal ↔ internal timeline parity (customer-safe subset)
-- RPC returns service_job_events for the job linked from service_requests,
-- filtered to non-sensitive event types (no metadata, no internal-only actions).
-- ============================================================================

create or replace function public.portal_get_service_job_timeline(p_service_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pc uuid;
  v_job_id uuid;
  v_events jsonb;
begin
  v_pc := public.get_portal_customer_id();
  if v_pc is null then
    return jsonb_build_object('ok', false, 'error', 'not_portal_user');
  end if;

  select sr.service_job_id into v_job_id
  from public.service_requests sr
  where sr.id = p_service_request_id
    and sr.portal_customer_id = v_pc;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_job_id is null then
    return jsonb_build_object(
      'ok', true,
      'service_job_id', null,
      'events', '[]'::jsonb
    );
  end if;

  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'event_type', s.event_type,
          'created_at', s.created_at,
          'old_stage', s.old_stage::text,
          'new_stage', s.new_stage::text,
          'customer_label',
            case
              when s.event_type = 'stage_transition' and s.new_stage is not null then 'Shop status updated'
              when s.event_type = 'technician_assigned' then 'Technician assigned to your job'
              when s.event_type = 'haul_created' then 'Transport or haul scheduled'
              when s.event_type = 'completion_feedback_submitted' then 'We received your feedback — thank you'
              when s.event_type = 'portal_request_linked' then 'Your request is connected to the shop'
              when s.event_type = 'created' then 'Service job opened'
              else initcap(replace(s.event_type, '_', ' '))
            end
        )
        order by s.created_at desc
      )
      from (
        select *
        from public.service_job_events e
        where e.job_id = v_job_id
          and e.event_type in (
            'stage_transition',
            'technician_assigned',
            'haul_created',
            'completion_feedback_submitted',
            'portal_request_linked',
            'created'
          )
        order by e.created_at desc
        limit 100
      ) s
    ),
    '[]'::jsonb
  )
  into v_events;

  return jsonb_build_object(
    'ok', true,
    'service_job_id', v_job_id,
    'events', coalesce(v_events, '[]'::jsonb)
  );
end;
$$;

comment on function public.portal_get_service_job_timeline(uuid) is
  'Portal customer: timeline rows for linked service_jobs (sanitized labels, no metadata).';

grant execute on function public.portal_get_service_job_timeline(uuid) to authenticated;
grant execute on function public.portal_get_service_job_timeline(uuid) to service_role;
