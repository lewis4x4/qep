-- Tighten parts order RLS checks and harden strict inventory adjustment permissions.

drop policy if exists "parts_orders_internal" on public.parts_orders;
create policy "parts_orders_internal" on public.parts_orders for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

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
  v_updated int := 0;
begin
  if not (
    auth.role() = 'service_role'
    or public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  ) then
    raise exception 'INSUFFICIENT_PRIVILEGES' using errcode = '42501';
  end if;

  if p_branch_id is null or length(v_pn) = 0 then
    raise exception 'missing_branch_or_part' using errcode = 'P0001';
  end if;

  if p_delta = 0 then
    return;
  end if;

  if p_delta > 0 then
    perform (
      select public.adjust_parts_inventory_delta(
        p_workspace_id,
        p_branch_id,
        v_pn,
        p_delta
      )
    );
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

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'INVENTORY_UPDATE_FAILED' using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) is
  'Strict parts_inventory change: negative delta aborts if stock would go negative.';

grant execute on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) to authenticated;
grant execute on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) to service_role;
