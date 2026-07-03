-- ============================================================================
-- Migration 737: C5.1 telematics schema and adapter contract closeout
--
-- C5.1 is satisfied by the provider-neutral telematics feed schema, adapter
-- boundary, deterministic provider/device lookup contract, and normalized ingest
-- paths. This does not close live Tethr provider action readiness.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%744_c51_telematics_adapter_contract_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-107 packet') ||
      ' | supabase/migrations/090_social_telematics.sql' ||
      ' | supabase/migrations/093_schema_hardening.sql' ||
      ' | supabase/migrations/613_telematics_adapter_contract.sql' ||
      ' | supabase/functions/_shared/telematics-adapter.ts' ||
      ' | supabase/functions/_shared/adapters/generic-telematics.ts' ||
      ' | supabase/functions/_shared/telematics-adapter-registry.ts' ||
      ' | supabase/functions/_shared/telematics-adapter.test.ts' ||
      ' | supabase/functions/telematics-ingest/index.ts' ||
      ' | supabase/functions/telematics-signal-ingest/index.ts' ||
      ' | apps/web/src/features/equipment/pages/AssetDetailPage.tsx' ||
      ' | apps/web/src/features/fleet/pages/FleetMapPage.tsx' ||
      ' | docs/IntelliDealer/_Manifests/QEP_TETHR_JAR_107_REPO_CLOSEOUT_REQUIREMENTS_2026-05-04.md' ||
      ' | test-results/agent-gates/20260521T052911Z-C5.1-telematics-adapter.json' ||
      ' | supabase/migrations/744_c51_telematics_adapter_contract_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C5.1 shipped: Provider-neutral telematics foundation is in place. Migration 090 creates telematics_feeds with workspace, equipment/subscription target, provider, device, active status, hours, GPS, and freshness fields; migration 093 requires every feed to target equipment or a subscription; migration 613 adds active workspace/provider/device uniqueness plus provider/device lookup indexes for deterministic adapter-backed ingestion. The shared telematics-adapter contract defines normalized reading and fault/idle signal shapes, provider key normalization, device validation, timestamp normalization, and signal dedupe keys. GenericTelematicsAdapter accepts provider-neutral/AEMP-style payloads, normalizes hours, odometer, GPS, timestamps, workspace, and signal metadata, and is covered by Deno tests. telematics-ingest and telematics-signal-ingest route payloads through the adapter registry, resolve active telematics_feeds by device plus optional provider/workspace, reject unknown devices, reject ambiguous devices, update feed readings/usage, and emit equipment-scoped operator signals. Asset 360 and Fleet Map read provider-neutral telematics feeds as fallback surfaces.'
  END,
  updated_at = now()
WHERE task_id = 'C5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C5.1',
  'update',
  jsonb_build_object(
    'reason', 'c51_telematics_adapter_contract_closeout',
    'migration', '744_c51_telematics_adapter_contract_closeout.sql',
    'mission_alignment', 'pass: QEP now has a provider-neutral telematics contract that can turn equipment hours, GPS, and fault/idle events into auditable operating intelligence without hard-wiring a single external vendor, supporting fleet, rental, service, and parts decisions',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/090_social_telematics.sql creates telematics_feeds with workspace, equipment/subscription target, provider, device, activity, last-hours, last-GPS, and freshness fields',
      'supabase/migrations/093_schema_hardening.sql enforces telematics_feeds_has_target so every feed maps to equipment or an EaaS subscription',
      'supabase/migrations/613_telematics_adapter_contract.sql adds active workspace/provider/device uniqueness and provider/device lookup indexes',
      'supabase/functions/_shared/telematics-adapter.ts defines normalized reading/signal contracts, provider key normalization, device validation, timestamps, severity, and dedupe keys',
      'supabase/functions/_shared/adapters/generic-telematics.ts provides a reference adapter for provider-neutral/AEMP-style readings and signals',
      'supabase/functions/_shared/telematics-adapter-registry.ts dispatches payloads by provider key and falls back to the generic adapter',
      'supabase/functions/_shared/telematics-adapter.test.ts covers provider key normalization, reading normalization, validation failures, signal normalization, and dedupe key construction',
      'supabase/functions/telematics-ingest/index.ts resolves active feeds by device plus optional provider/workspace, rejects unknown or ambiguous devices, and updates feed/usage readings',
      'supabase/functions/telematics-signal-ingest/index.ts resolves active feeds by device plus optional provider/workspace, rejects unknown or ambiguous devices, and emits equipment-scoped telematics_fault/telematics_idle signals',
      'apps/web/src/features/equipment/pages/AssetDetailPage.tsx and apps/web/src/features/fleet/pages/FleetMapPage.tsx surface provider-neutral telematics feed data',
      'test-results/agent-gates/20260521T052911Z-C5.1-telematics-adapter.json records the historical C5.1 segment gate as PASS'
    ),
    'safety_bounds', jsonb_build_array(
      'this migration marks only C5.1 shipped and does not alter telematics runtime behavior',
      'generic telematics foundation is not live Tethr provider-action evidence',
      'feed lookup remains active-only and may require provider/workspace to avoid cross-provider ambiguity',
      'unknown devices are rejected instead of creating unmapped telemetry',
      'signal dedupe keys prevent provider-event retry storms from duplicating operator signals'
    ),
    'manual_boundaries', jsonb_build_array(
      'no Tethr credentials, auth contract, webhook/API payload samples, or device metadata contract was supplied',
      'no device-to-equipment mapping source of truth was approved for live provider onboarding',
      'no stale-data, failed-provider, unknown-device, or UI owner policy was approved for live Tethr actions',
      'no live provider webhook, poller, or Tethr It Now action was tested',
      'C5.2 Yanmar Smart Assist adapter remains a separate dependent roadmap row',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
