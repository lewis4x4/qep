-- ============================================================================
-- Migration 117: Audit fulfillment on every parts_orders status change (when a
-- fulfillment run exists). Keeps parts_fulfillment_runs in sync for terminal
-- states. Skips draft→submitted (portal-api already inserts portal_submitted).
-- ============================================================================

create or replace function public.parts_orders_fulfillment_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfillment_run_id is null then
    return new;
  end if;
  if old.status is not distinct from new.status then
    return new;
  end if;
  -- Submit path: portal-api inserts portal_submitted + explicit run create
  if old.status = 'draft' and new.status = 'submitted' then
    return new;
  end if;

  insert into public.parts_fulfillment_events (
    workspace_id,
    fulfillment_run_id,
    event_type,
    payload
  ) values (
    new.workspace_id,
    new.fulfillment_run_id,
    'order_status_' || new.status,
    jsonb_build_object(
      'parts_order_id', new.id,
      'previous_status', old.status,
      'new_status', new.status
    )
  );

  if new.status = 'shipped' then
    update public.parts_fulfillment_runs
    set status = 'shipped', updated_at = now()
    where id = new.fulfillment_run_id and workspace_id = new.workspace_id;
  elsif new.status = 'delivered' then
    update public.parts_fulfillment_runs
    set status = 'closed', updated_at = now()
    where id = new.fulfillment_run_id and workspace_id = new.workspace_id;
  elsif new.status = 'cancelled' then
    update public.parts_fulfillment_runs
    set status = 'cancelled', updated_at = now()
    where id = new.fulfillment_run_id and workspace_id = new.workspace_id;
  end if;

  return new;
end;
$$;

comment on function public.parts_orders_fulfillment_on_status() is
  'After parts_orders.status changes: append fulfillment event and align parts_fulfillment_runs for shipped/delivered/cancelled.';

create trigger parts_orders_fulfillment_on_status_trg
  after update of status on public.parts_orders
  for each row
  execute function public.parts_orders_fulfillment_on_status();
