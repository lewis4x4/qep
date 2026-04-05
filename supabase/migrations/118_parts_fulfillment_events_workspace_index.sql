-- ============================================================================
-- Migration 118: Index parts_fulfillment_events by workspace for list/audit
-- queries (avoids full scans when filtering recent events per tenant).
-- ============================================================================

create index idx_parts_fulfillment_events_workspace_created
  on public.parts_fulfillment_events(workspace_id, created_at desc);
