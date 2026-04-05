-- ============================================================================
-- Migration 102: Indexes for vendor escalation worker queries
-- ============================================================================

create index if not exists idx_vendor_escalations_due
  on public.vendor_escalations(next_action_at)
  where resolved_at is null and next_action_at is not null;

create index if not exists idx_vendor_escalations_vendor_active
  on public.vendor_escalations(vendor_id)
  where resolved_at is null;
