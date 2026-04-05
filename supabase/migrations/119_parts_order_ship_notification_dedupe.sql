-- ============================================================================
-- Migration 119: Idempotent staff-triggered parts shipment emails (dedupe key)
-- ============================================================================

create table public.parts_order_notification_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  parts_order_id uuid not null references public.parts_orders(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parts_order_id, event_type)
);

comment on table public.parts_order_notification_sends is
  'Records staff-triggered portal notifications (e.g. parts_shipped) to prevent duplicate sends.';

create index idx_parts_order_notification_sends_workspace
  on public.parts_order_notification_sends(workspace_id);

create trigger set_parts_order_notification_sends_updated_at
  before update on public.parts_order_notification_sends
  for each row execute function public.set_updated_at();

alter table public.parts_order_notification_sends enable row level security;

create policy "parts_order_notification_sends_select"
  on public.parts_order_notification_sends for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_order_notification_sends_insert"
  on public.parts_order_notification_sends for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_order_notification_sends_delete"
  on public.parts_order_notification_sends for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_order_notification_sends_service_all"
  on public.parts_order_notification_sends for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
