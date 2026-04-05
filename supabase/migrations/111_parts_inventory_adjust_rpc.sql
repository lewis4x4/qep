-- ============================================================================
-- Migration 111: Atomic parts_inventory adjustments (pick/receive/return)
-- Called from service-parts-manager; SERIALIZABLE row lock via SELECT FOR UPDATE
-- ============================================================================

create or replace function public.adjust_parts_inventory_delta(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_delta integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pn text := trim(both from coalesce(p_part_number, ''));
  v_id uuid;
  v_qty int;
  v_insufficient boolean := false;
begin
  if p_branch_id is null or length(v_pn) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch_or_part');
  end if;

  if p_delta = 0 then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  select id, qty_on_hand into v_id, v_qty
  from public.parts_inventory
  where workspace_id = p_workspace_id
    and branch_id = p_branch_id
    and part_number = v_pn
    and deleted_at is null
  for update;

  if found then
    if p_delta < 0 and v_qty + p_delta < 0 then
      v_insufficient := true;
    end if;
    update public.parts_inventory
    set
      qty_on_hand = greatest(0, v_qty + p_delta),
      updated_at = now()
    where id = v_id
    returning qty_on_hand into v_qty;
  else
    if p_delta >= 0 then
      insert into public.parts_inventory (workspace_id, branch_id, part_number, qty_on_hand)
      values (p_workspace_id, p_branch_id, v_pn, p_delta)
      returning qty_on_hand into v_qty;
    else
      insert into public.parts_inventory (workspace_id, branch_id, part_number, qty_on_hand)
      values (p_workspace_id, p_branch_id, v_pn, greatest(0, p_delta))
      returning qty_on_hand into v_qty;
      if p_delta < 0 then
        v_insufficient := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'qty_on_hand', v_qty,
    'insufficient', v_insufficient
  );
end;
$$;

comment on function public.adjust_parts_inventory_delta(text, text, text, integer) is
  'Apply delta to parts_inventory for a branch+part; negative = issue from stock.';

grant execute on function public.adjust_parts_inventory_delta(text, text, text, integer) to authenticated;
grant execute on function public.adjust_parts_inventory_delta(text, text, text, integer) to service_role;
