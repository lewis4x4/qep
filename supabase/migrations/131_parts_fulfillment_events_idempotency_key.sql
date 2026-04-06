-- ============================================================================
-- Migration 131: Optional idempotency_key on parts_fulfillment_events so vendor
-- webhooks and similar callers can dedupe retries (same logical event → one row).
-- ============================================================================

alter table public.parts_fulfillment_events
  add column if not exists idempotency_key text;

comment on column public.parts_fulfillment_events.idempotency_key is
  'When set, unique per workspace; insert with same key is ignored (dedupe).';

create unique index if not exists idx_parts_fulfillment_events_workspace_idempotency
  on public.parts_fulfillment_events (workspace_id, idempotency_key)
  where idempotency_key is not null;

comment on table public.parts_fulfillment_events is
  'Append-only events for fulfillment state. payload.audit_channel: portal | shop | vendor (migration 130). idempotency_key dedupes vendor retries (migration 131).';
