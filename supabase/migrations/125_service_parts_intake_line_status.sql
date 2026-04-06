-- ============================================================================
-- Migration 125: P1-C Intake line lifecycle — suggested → accepted → planned
-- - intake_line_status on service_parts_requirements (default accepted for legacy).
-- - job_code_template / ai_suggested lines start as suggested; planner skips them
--   until accepted; planner marks planned after actions are created.
-- - service_parts_accept_intake_line: suggested → accepted (operator gate).
-- - Fulfillment RPC rejects actions while line is still suggested.
-- ============================================================================

alter table public.service_parts_requirements
  add column if not exists intake_line_status text not null default 'accepted';

alter table public.service_parts_requirements
  drop constraint if exists service_parts_requirements_intake_line_status_check;

alter table public.service_parts_requirements
  add constraint service_parts_requirements_intake_line_status_check
  check (intake_line_status in ('suggested', 'accepted', 'planned'));

comment on column public.service_parts_requirements.intake_line_status is
  'Intake gate: suggested (not yet approved), accepted (ready to plan), planned (planner created actions).';

-- ── Accept suggested line (JWT actor must match) ─────────────────────────────
create or replace function public.service_parts_accept_intake_line(
  p_requirement_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.service_parts_requirements%rowtype;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into strict v_req
  from public.service_parts_requirements
  where id = p_requirement_id
  for update;

  if v_req.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_req.intake_line_status is distinct from 'suggested' then
    return jsonb_build_object(
      'ok', true,
      'requirement', to_jsonb(v_req),
      'already_accepted', true
    );
  end if;

  update public.service_parts_requirements
  set
    intake_line_status = 'accepted',
    updated_at = now()
  where id = p_requirement_id
  returning * into v_req;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    v_req.workspace_id,
    v_req.job_id,
    'parts_intake_accepted',
    p_actor_id,
    jsonb_build_object('requirement_id', p_requirement_id)
  );

  return jsonb_build_object('ok', true, 'requirement', to_jsonb(v_req));
end;
$$;

comment on function public.service_parts_accept_intake_line(uuid, uuid) is
  'Moves a parts requirement from suggested → accepted so the planner can include it.';

grant execute on function public.service_parts_accept_intake_line(uuid, uuid) to authenticated;
grant execute on function public.service_parts_accept_intake_line(uuid, uuid) to service_role;

-- ── Fulfillment RPC: block pick/receive/consume/return until line accepted ───
create or replace function public.service_parts_apply_fulfillment_action(
  p_requirement_id uuid,
  p_action text,
  p_actor_id uuid,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.service_parts_requirements%rowtype;
  v_job record;
  v_next text;
  v_action public.service_parts_action_type;
  v_qty int;
  v_pn text;
  v_norm text;
  v_override boolean := false;
  v_inv_result jsonb;
  v_insufficient boolean;
  v_qty_after int;
  v_meta jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_norm := lower(trim(both from coalesce(p_action, '')));

  select * into strict v_req
  from public.service_parts_requirements
  where id = p_requirement_id
  for update;

  if v_req.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if coalesce(v_req.intake_line_status, 'accepted') = 'suggested' then
    raise exception 'INTAKE_SUGGESTED_NOT_ACCEPTED' using errcode = 'P0001';
  end if;

  select id, branch_id, workspace_id into strict v_job
  from public.service_jobs
  where id = v_req.job_id
  for update;

  case v_norm
    when 'pick' then
      v_next := 'picking';
      v_action := 'pick';
    when 'receive' then
      v_next := 'received';
      v_action := 'receive';
    when 'consume' then
      v_next := 'consumed';
      v_action := 'consume';
    when 'return' then
      v_next := 'returned';
      v_action := 'return';
    else
      raise exception 'invalid_action' using errcode = 'P0001';
  end case;

  if v_norm = 'pick' and v_req.status = 'pending' then
    raise exception 'INVALID_TRANSITION: pick requires a plan — run parts planner first' using errcode = 'P0001';
  end if;

  if v_norm = 'receive' and not (v_req.status in ('ordering', 'transferring', 'received')) then
    raise exception 'INVALID_TRANSITION: receive requires ordering or transferring (planned order in flight)' using errcode = 'P0001';
  end if;

  if v_norm = 'consume' and v_req.status = 'consumed' then
    raise exception 'INVALID_TRANSITION: line already consumed' using errcode = 'P0001';
  end if;

  if v_norm in ('consume', 'return') and not (v_req.status in ('staged', 'received', 'consumed', 'returned')) then
    raise exception 'INVALID_TRANSITION: line must be staged or received before consume/return' using errcode = 'P0001';
  end if;

  v_qty := greatest(1, coalesce(v_req.quantity, 1));
  v_pn := trim(both from v_req.part_number);

  v_override := coalesce(nullif(trim(both from p_override_reason), ''), '') <> '';

  if v_norm = 'pick' then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for pick' using errcode = 'P0001';
    end if;
    if v_override then
      if public.get_my_role() not in ('admin', 'manager', 'owner') then
        raise exception 'override_requires_manager' using errcode = '42501';
      end if;
      select public.adjust_parts_inventory_delta(
        v_req.workspace_id,
        v_job.branch_id,
        v_pn,
        -v_qty
      ) into v_inv_result;
      v_insufficient := coalesce((v_inv_result->>'insufficient')::boolean, false);
      v_qty_after := coalesce((v_inv_result->>'qty_on_hand')::int, 0);
      insert into public.service_parts_inventory_overrides (
        workspace_id,
        requirement_id,
        job_id,
        part_number,
        quantity_requested,
        qty_on_hand_after,
        insufficient,
        reason,
        actor_id
      ) values (
        v_req.workspace_id,
        p_requirement_id,
        v_req.job_id,
        v_pn,
        v_qty,
        v_qty_after,
        v_insufficient,
        trim(both from p_override_reason),
        p_actor_id
      );
    else
      perform (select public.adjust_parts_inventory_delta_strict(
        v_req.workspace_id,
        v_job.branch_id,
        v_pn,
        -v_qty
      ));
    end if;
  elsif v_norm in ('receive', 'return') then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for inventory movement' using errcode = 'P0001';
    end if;
    if v_override then
      raise exception 'override_only_for_pick' using errcode = 'P0001';
    end if;
    perform (select public.adjust_parts_inventory_delta_strict(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      v_qty
    ));
  end if;

  v_meta := jsonb_build_object('via', 'service_parts_apply_fulfillment_action');
  if v_override then
    v_meta := v_meta || jsonb_build_object('override_reason', trim(both from p_override_reason));
  end if;

  update public.service_parts_actions
  set completed_at = now()
  where requirement_id = p_requirement_id
    and job_id = v_req.job_id
    and completed_at is null
    and superseded_at is null;

  insert into public.service_parts_actions (
    workspace_id,
    requirement_id,
    job_id,
    action_type,
    actor_id,
    completed_at,
    metadata
  ) values (
    v_req.workspace_id,
    p_requirement_id,
    v_req.job_id,
    v_action,
    p_actor_id,
    now(),
    v_meta
  );

  update public.service_parts_requirements
  set
    status = v_next,
    updated_at = now()
  where id = p_requirement_id
  returning * into v_req;

  if v_norm = 'consume' then
    insert into public.service_internal_billing_line_staging (
      workspace_id,
      service_job_id,
      requirement_id,
      line_type,
      part_number,
      description,
      quantity,
      unit_cost,
      status,
      consumed_at
    ) values (
      v_req.workspace_id,
      v_req.job_id,
      p_requirement_id,
      'parts_consume',
      v_pn,
      coalesce(v_req.description, v_pn),
      v_qty::numeric,
      coalesce(v_req.unit_cost, 0),
      'draft',
      now()
    );
  end if;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    v_req.workspace_id,
    v_req.job_id,
    'parts_action',
    p_actor_id,
    jsonb_build_object(
      'action', v_norm,
      'requirement_id', p_requirement_id,
      'new_status', v_next,
      'via', 'service_parts_apply_fulfillment_action',
      'inventory_override', v_override
    )
  );

  return jsonb_build_object(
    'requirement', to_jsonb(v_req),
    'inventory_override', v_override
  );
end;
$$;

comment on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) is
  'Transactional fulfillment; blocks while intake_line_status is suggested.';

grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) to authenticated;
grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) to service_role;
