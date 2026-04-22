-- ============================================================================
-- Migration 356: Decommission HubSpot and IntelliDealer as live dependencies
--
-- Rollback notes:
--   1. Remove lifecycle metadata from integration_status.config for
--      hubspot and intellidealer if the business reverses the decision.
--   2. Reintroduce live-integration flows in app/admin surfaces only after
--      a new product decision.
-- ============================================================================

update public.integration_status
set
  status = 'demo_mode',
  last_sync_error = null,
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'lifecycle', 'replaced',
    'replacement_surface', 'QRM',
    'replacement_label', 'QRM Native',
    'replacement_summary', 'HubSpot is deprecated. QRM is the live CRM system of record.',
    'external_dependency_required', false,
    'decommissioned_at', now()
  ),
  updated_at = now()
where workspace_id = 'default'
  and integration_key = 'hubspot';

update public.integration_status
set
  status = 'demo_mode',
  last_sync_error = null,
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'lifecycle', 'replaced',
    'replacement_surface', 'QEP Catalog + QRM',
    'replacement_label', 'QEP Native',
    'replacement_summary', 'IntelliDealer is deprecated. Catalog, quote, parts, and customer workflows run natively in QEP.',
    'external_dependency_required', false,
    'decommissioned_at', now()
  ),
  updated_at = now()
where workspace_id = 'default'
  and integration_key = 'intellidealer';
