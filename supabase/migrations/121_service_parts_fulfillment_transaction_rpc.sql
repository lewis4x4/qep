-- ============================================================================
-- Migration 121: Transactional parts fulfillment (P0-B)
-- Atomic: inventory adjustment (strict for picks) + actions + requirement status.
-- Edge: service-parts-manager calls service_parts_apply_fulfillment_action only.
-- ============================================================================

-- Strict inventory: negative deltas fail the whole transaction if stock is insufficient.
-- Positive deltas delegate to existing adjust_parts_inventory_delta (migration 111).
create or replace function public.adjust_parts_inventory_delta_strict(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_delta integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pn text := trim(both from coalesce(p_part_number, ''));
  v_id uuid;
  v_qty int;
begin
  if p_branch_id is null or length(v_pn) = 0 then
    raise exception 'missing_branch_or_part' using errcode = 'P0001';
  end if;

  if p_delta = 0 then
    return;
  end if;

  if p_delta > 0 then
    perform (select public.adjust_parts_inventory_delta(
      p_workspace_id, p_branch_id, v_pn, p_delta
    ));
    return;
  end if;

  select id, qty_on_hand into v_id, v_qty
  from public.parts_inventory
  where workspace_id = p_workspace_id
    and branch_id = p_branch_id
    and part_number = v_pn
    and deleted_at is null
  for update;

  if not found then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  if v_qty + p_delta < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update public.parts_inventory
  set
    qty_on_hand = v_qty + p_delta,
    updated_at = now()
  where id = v_id;
end;
$$;

comment on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) is
  'Strict parts_inventory change: negative delta aborts if stock would go negative.';

grant execute on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) to authenticated;
grant execute on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) to service_role;

-- Single transaction for pick / receive / consume / return on a requirement line.
create or replace function public.service_parts_apply_fulfillment_action(
  p_requirement_id uuid,
  p_action text,
  p_actor_id uuid
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

  if v_norm in ('consume', 'return') and not (v_req.status in ('staged', 'received', 'consumed', 'returned')) then
    raise exception 'INVALID_TRANSITION: line must be staged or received before consume/return' using errcode = 'P0001';
  end if;

  v_qty := greatest(1, coalesce(v_req.quantity, 1));
  v_pn := trim(both from v_req.part_number);

  if v_norm = 'pick' then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for pick' using errcode = 'P0001';
    end if;
    perform (select public.adjust_parts_inventory_delta_strict(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      -v_qty
    ));
  elsif v_norm in ('receive', 'return') then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for inventory movement' using errcode = 'P0001';
    end if;
    perform (select public.adjust_parts_inventory_delta_strict(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      v_qty
    ));
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
    jsonb_build_object('via', 'service_parts_apply_fulfillment_action')
  );

  update public.service_parts_requirements
  set
    status = v_next,
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
    'parts_action',
    p_actor_id,
    jsonb_build_object(
      'action', v_norm,
      'requirement_id', p_requirement_id,
      'new_status', v_next,
      'via', 'service_parts_apply_fulfillment_action'
    )
  );

  return jsonb_build_object(
    'requirement', to_jsonb(v_req)
  );
end;
$$;

comment on function public.service_parts_apply_fulfillment_action(uuid, text, uuid) is
  'Transactional fulfillment: inventory (strict) + action row + requirement status + job event.';

grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid) to authenticated;
grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid) to service_role;
