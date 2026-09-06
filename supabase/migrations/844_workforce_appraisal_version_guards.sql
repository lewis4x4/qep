-- BUS-002: every operator mutation must compare the version read by the editor
-- while holding the appraisal lock. Existing role, signature and score gates stay authoritative.
create or replace function public.employee_appraisal_mutate_versioned(
  p_appraisal_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_payload jsonb default '{}'::jsonb
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appraisal public.employee_performance_appraisals%rowtype;
  v_updated_at timestamptz;
begin
  select * into v_appraisal
  from public.employee_performance_appraisals
  where id = p_appraisal_id and deleted_at is null
  for update;
  if not found or not public.employee_appraisal_can_read(
    v_appraisal.workspace_id, v_appraisal.subject_employee_id,
    v_appraisal.subject_profile_id, v_appraisal.reviewer_profile_id
  ) then
    raise exception using errcode = '42501', message = 'Appraisal not accessible.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'Read the current appraisal before saving.';
  end if;
  if v_appraisal.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'Appraisal changed. Review the latest version before saving your retained draft.';
  end if;
  case p_action
    when 'score' then
      perform public.employee_appraisal_score(
        p_appraisal_id, p_payload->'scores', p_payload->>'manager_summary',
        nullif(p_payload->>'cost_of_living_raise_pct', '')::numeric,
        p_payload->'key_strengths', p_payload->'improvement_areas', p_payload->'goals_next_period'
      );
    when 'finalize' then
      perform public.employee_appraisal_finalize(p_appraisal_id, p_payload->>'manager_summary', p_payload->>'manager_signature_name');
    when 'acknowledge' then
      perform public.employee_appraisal_acknowledge(p_appraisal_id, p_payload->>'employee_signature_name', p_payload->>'employee_comments');
    else
      raise exception using errcode = '22023', message = 'Unknown appraisal action.';
  end case;
  -- The existing update trigger uses now(); read its exact persisted value.
  select updated_at into v_updated_at from public.employee_performance_appraisals where id = p_appraisal_id;
  return v_updated_at;
end;
$$;
revoke all on function public.employee_appraisal_mutate_versioned(uuid,text,timestamptz,jsonb) from public, anon;
grant execute on function public.employee_appraisal_mutate_versioned(uuid,text,timestamptz,jsonb) to authenticated, service_role;
-- Disallow callers from skipping the version guard. SECURITY DEFINER wrappers
-- retain access to the original domain operations and their established checks.
revoke execute on function public.employee_appraisal_score(uuid,jsonb,text,numeric,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.employee_appraisal_finalize(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.employee_appraisal_acknowledge(uuid,text,text) from public, anon, authenticated;
revoke update on public.employee_performance_appraisals from authenticated;
revoke insert, update, delete on public.employee_performance_appraisal_scores from authenticated;
comment on function public.employee_appraisal_mutate_versioned(uuid,text,timestamptz,jsonb) is
  'BUS-002 versioned scoring/finalization/acknowledgement. Locks before comparison; preserves existing HR and signature checks.';
