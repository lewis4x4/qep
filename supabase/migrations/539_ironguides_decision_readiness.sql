-- Migration 539: IronGuides JAR-109 decision readiness metadata
--
-- This does not onboard a live IronGuides feed and does not retire IronGuides.
-- It records the honest runtime state for the parity blocker: QEP can keep using
-- fallback/blended valuation surfaces, but the IronGuides live-feed row remains
-- decision-gated until either live vendor evidence or an approved replacement
-- decision exists.

with workspaces as (
  select distinct workspace_id
  from public.integration_status
  where workspace_id is not null
  union
  select 'default'::text
), seeded as (
  insert into public.integration_status (
    workspace_id,
    integration_key,
    display_name,
    status,
    auth_type,
    sync_frequency,
    endpoint_url,
    config
  )
  select
    w.workspace_id,
    'ironguides',
    'Iron Solutions / IronGuides',
    'demo_mode'::public.integration_status_enum,
    'api_key',
    'manual'::public.sync_frequency,
    null,
    jsonb_build_object(
      'parity_blocker', 'JAR-109',
      'provider_scope', 'parity_external_decision',
      'implementation_status', 'decision_required',
      'decision_required', true,
      'external_dependency_required', true,
      'credentials_required', true,
      'live_feed_contract_required', true,
      'live_adapter_implemented', false,
      'live_feed_required_for_built', true,
      'replacement_decision_required_for_na', true,
      'decision_packet', 'docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md',
      'repo_closeout_requirements_doc', 'docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_JAR_109_REPO_CLOSEOUT_2026-05-04.md',
      'fallback_policy', 'QEP fallback/blended valuation remains operational but is not IronGuides BUILT evidence.',
      'blocked_status_reason', 'IronGuides live feed contract/API/auth/sample payload evidence or owner-approved replacement decision is still required.',
      'required_live_feed_evidence', jsonb_build_array(
        'signed IronGuides contract or written vendor authorization',
        'API/feed documentation and authentication method',
        'sandbox or sample payloads',
        'feed cadence and freshness expectations',
        'allowed valuation fields and comparables policy',
        'data retention, privacy, credential storage, and rotation owner',
        'source-controlled live adapter/feed ingestion and verification with IronGuides-sourced valuation data'
      ),
      'required_replacement_evidence', jsonb_build_array(
        'source-controlled business decision that live IronGuides is not required',
        'owner approval and effective date',
        'replacement policy standardizing on QEP fallback/blended valuation',
        'impact statement for sales, rental, trade-in, and executive reporting',
        'runtime config lifecycle = replaced and external_dependency_required = false'
      )
    )
  from workspaces w
  on conflict (workspace_id, integration_key) do nothing
  returning workspace_id, integration_key
)
update public.integration_status
set
  last_sync_error = null,
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'parity_blocker', 'JAR-109',
    'provider_scope', 'parity_external_decision',
    'implementation_status', 'decision_required',
    'decision_required', true,
    'external_dependency_required', true,
    'credentials_required', true,
    'live_feed_contract_required', true,
    'live_adapter_implemented', false,
    'live_feed_required_for_built', true,
    'replacement_decision_required_for_na', true,
    'decision_packet', 'docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md',
    'repo_closeout_requirements_doc', 'docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_JAR_109_REPO_CLOSEOUT_2026-05-04.md',
    'fallback_policy', 'QEP fallback/blended valuation remains operational but is not IronGuides BUILT evidence.',
    'blocked_status_reason', 'IronGuides live feed contract/API/auth/sample payload evidence or owner-approved replacement decision is still required.',
    'required_live_feed_evidence', jsonb_build_array(
      'signed IronGuides contract or written vendor authorization',
      'API/feed documentation and authentication method',
      'sandbox or sample payloads',
      'feed cadence and freshness expectations',
      'allowed valuation fields and comparables policy',
      'data retention, privacy, credential storage, and rotation owner',
      'source-controlled live adapter/feed ingestion and verification with IronGuides-sourced valuation data'
    ),
    'required_replacement_evidence', jsonb_build_array(
      'source-controlled business decision that live IronGuides is not required',
      'owner approval and effective date',
      'replacement policy standardizing on QEP fallback/blended valuation',
      'impact statement for sales, rental, trade-in, and executive reporting',
      'runtime config lifecycle = replaced and external_dependency_required = false'
    )
  ),
  updated_at = now()
where integration_key = 'ironguides'
  and coalesce(config ->> 'lifecycle', '') <> 'replaced';

-- Rollback reference only:
-- update public.integration_status
-- set config = config
--   - 'parity_blocker'
--   - 'provider_scope'
--   - 'implementation_status'
--   - 'decision_required'
--   - 'external_dependency_required'
--   - 'credentials_required'
--   - 'live_feed_contract_required'
--   - 'live_adapter_implemented'
--   - 'live_feed_required_for_built'
--   - 'replacement_decision_required_for_na'
--   - 'decision_packet'
--   - 'repo_closeout_requirements_doc'
--   - 'fallback_policy'
--   - 'blocked_status_reason'
--   - 'required_live_feed_evidence'
--   - 'required_replacement_evidence'
-- where integration_key = 'ironguides'
--   and config ->> 'parity_blocker' = 'JAR-109';
