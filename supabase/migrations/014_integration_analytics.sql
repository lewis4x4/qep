-- Migration 014: Integration analytics events
-- Extends activity_type enum with integration UI event types.
-- Adds INSERT RLS policy so owner-role users can log integration events from the frontend.

-- ── Extend activity_type enum ───────────────────────────────────────────────
-- ADD VALUE IF NOT EXISTS prevents errors on re-run and handles out-of-transaction DDL.
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'integration_config_updated';
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'integration_connection_tested';
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'integration_card_clicked';
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'integration_panel_opened';

-- ── INSERT RLS policy for integration events ────────────────────────────────
-- Allows authenticated users with owner role to insert integration analytics events.
-- Workflow fields (enrollment_id, deal_id, hub_id) are allowed to be null.
create policy "activity_log_insert_integration_owner" on public.activity_log
  for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Note: PostgreSQL does not support DROP VALUE on enums.
-- To rollback enum changes, recreate the type (requires data migration).
-- drop policy if exists "activity_log_insert_integration_owner" on public.activity_log;
