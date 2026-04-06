-- ============================================================================
-- Migration 130: Backfill payload.audit_channel on parts_fulfillment_events
-- for rows created before portal trigger (129) and explicit mirror tagging.
-- Idempotent: only updates rows where audit_channel is missing/null.
-- ============================================================================

-- Portal: customer order lifecycle + submit
update public.parts_fulfillment_events
set payload = payload || jsonb_build_object('audit_channel', 'portal')
where payload->>'audit_channel' is null
  and (
    event_type like 'order_status_%'
    or event_type = 'portal_submitted'
  );

-- Vendor: inbound webhooks + escalations mirrored to the run
update public.parts_fulfillment_events
set payload = payload || jsonb_build_object('audit_channel', 'vendor')
where payload->>'audit_channel' is null
  and event_type in (
    'shop_vendor_inbound',
    'shop_vendor_escalation_seeded',
    'shop_vendor_escalation_step'
  );

-- Shop: counter/planner/manager, job↔run link events, and any other legacy row
update public.parts_fulfillment_events
set payload = payload || jsonb_build_object('audit_channel', 'shop')
where payload->>'audit_channel' is null;

comment on table public.parts_fulfillment_events is
  'Append-only events for fulfillment state. payload.audit_channel: portal | shop | vendor (backfilled migration 130).';
