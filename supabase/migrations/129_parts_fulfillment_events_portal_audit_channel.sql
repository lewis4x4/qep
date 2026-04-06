-- ============================================================================
-- Migration 129: Tag portal-originated parts_fulfillment_events with
-- payload.audit_channel = 'portal' (trigger path). Matches shop/vendor mirror.
-- Historical rows unchanged; UI still infers portal from event_type when absent.
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
      'new_status', new.status,
      'audit_channel', 'portal'
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
  'After parts_orders.status changes: append fulfillment event (audit_channel=portal) and align parts_fulfillment_runs for shipped/delivered/cancelled.';
