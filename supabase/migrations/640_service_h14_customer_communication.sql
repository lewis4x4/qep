-- ============================================================================
-- Migration 640: H14 customer communication dedupe
--
-- Adds an idempotency key to the existing service_customer_notifications queue
-- so customer status notifications and promised-date-change messages can be
-- recorded once per event while reusing the existing email/SMS dispatcher.
-- ============================================================================

alter table public.service_customer_notifications
  add column if not exists dedupe_key text;

comment on column public.service_customer_notifications.dedupe_key is
  'H14 idempotency key for customer-facing service notifications; prevents repeated saves/transitions from spamming customers.';

comment on column public.service_customer_notifications.notification_type is
  'Customer-facing service notification type. H14 adds awaiting_approval, on_hold_parts, ready_for_pickup, and promised_date_changed while preserving existing free-text compatibility.';

create unique index if not exists idx_scn_h14_dedupe_key
  on public.service_customer_notifications(workspace_id, dedupe_key)
  where dedupe_key is not null;

comment on index public.idx_scn_h14_dedupe_key is
  'H14 partial unique idempotency guard for service customer notification queue rows.';

create index if not exists idx_scn_h14_pending_dispatch
  on public.service_customer_notifications(workspace_id, channel, created_at)
  where channel in ('email', 'sms')
    and recipient is not null
    and (metadata->>'delivered') is null;

comment on index public.idx_scn_h14_pending_dispatch is
  'Supports service-customer-notify-dispatch polling of queued H14 email/SMS notifications without scanning the full history.';
