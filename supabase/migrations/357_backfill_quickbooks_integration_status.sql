-- ============================================================================
-- Migration 357: Backfill QuickBooks integration_status row
--
-- Rollback notes:
--   1. Delete the inserted quickbooks row only if it was created by this
--      migration and no credentials/test history were added afterward.
-- ============================================================================

insert into public.integration_status (
  workspace_id,
  integration_key,
  display_name,
  status,
  auth_type,
  sync_frequency,
  config
)
select
  'default',
  'quickbooks',
  'QuickBooks Online GL',
  'pending_credentials',
  'oauth_app',
  'manual',
  '{}'::jsonb
where not exists (
  select 1
  from public.integration_status
  where workspace_id = 'default'
    and integration_key = 'quickbooks'
);
