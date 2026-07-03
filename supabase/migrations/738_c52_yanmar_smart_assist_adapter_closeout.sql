-- ============================================================================
-- Migration 738: C5.2 Yanmar Smart Assist adapter closeout
--
-- C5.2 is satisfied by the adapter-ready Smart Assist integration row, the
-- Yanmar/ASV normalizer, registry dispatch, and fixture-backed adapter tests.
-- This does not close live Smart Assist connectivity or Tethr provider action.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%738_c52_yanmar_smart_assist_adapter_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-107 packet') ||
      ' | supabase/migrations/614_yanmar_smart_assist_telematics_adapter.sql' ||
      ' | supabase/functions/_shared/adapters/yanmar-smart-assist.ts' ||
      ' | supabase/functions/_shared/adapters/yanmar-smart-assist.test.ts' ||
      ' | supabase/functions/_shared/telematics-adapter-registry.ts' ||
      ' | supabase/functions/_shared/telematics-adapter.ts' ||
      ' | supabase/migrations/613_telematics_adapter_contract.sql' ||
      ' | supabase/migrations/737_c51_telematics_adapter_contract_closeout.sql' ||
      ' | docs/IntelliDealer/_Manifests/QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md' ||
      ' | test-results/agent-gates/20260521T053955Z-C5.2-yanmar-smart-assist.json' ||
      ' | supabase/migrations/738_c52_yanmar_smart_assist_adapter_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C5.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C5.2 shipped: Yanmar / ASV Smart Assist is registered as an adapter-ready telematics provider after the C5.1 provider-neutral telematics foundation shipped. Migration 614 seeds integration_status for yanmar_smart_assist with pending_credentials, api_key auth, manual sync, supported brand surfaces for Yanmar and ASV, and a contract note that live polling or webhook cutover requires approved credentials, endpoint, payload, and device-mapping policy. The YanmarSmartAssistAdapter normalizes Smart Assist readings and fault/idle signals across Yanmar, ASV, YCENA, smart_assist, yanmar_smart_assist, and ycena_smart_assist provider keys; extracts nested device, serial, hours, GPS, timestamps, fault codes, provider event IDs, and severity aliases; returns a blocked live testConnection until credentials and endpoint contract exist; and is covered by Deno adapter tests. The D1.2 fixture register remains explicit that Smart Assist/Yanmar evidence is not Tethr provider evidence.'
  END,
  updated_at = now()
WHERE task_id = 'C5.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C5.2',
  'update',
  jsonb_build_object(
    'reason', 'c52_yanmar_smart_assist_adapter_closeout',
    'migration', '738_c52_yanmar_smart_assist_adapter_closeout.sql',
    'mission_alignment', 'pass: QEP now has a source-controlled Smart Assist adapter path for Yanmar and ASV machine hours, GPS, and fault/idle events, making future superintelligent service, rental, parts, and fleet recommendations portable once provider credentials and mapping are approved',
    'dependency_evidence', jsonb_build_array(
      'C5.1 shipped in supabase/migrations/737_c51_telematics_adapter_contract_closeout.sql',
      'supabase/migrations/613_telematics_adapter_contract.sql supplies the provider-neutral telematics adapter contract and deterministic active feed lookup indexes'
    ),
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/614_yanmar_smart_assist_telematics_adapter.sql registers yanmar_smart_assist with pending_credentials, api_key auth, manual sync, Yanmar and ASV brand surfaces, adapter_key yanmar_smart_assist, and live-cutover contract notes',
      'supabase/functions/_shared/adapters/yanmar-smart-assist.ts defines the YanmarSmartAssistAdapter provider yanmar_smart_assist normalizer for readings and signals without live polling/webhook behavior',
      'supabase/functions/_shared/adapters/yanmar-smart-assist.ts extracts nested device ids, serials, hour meters, GPS coordinates, timestamps, fault codes, provider event ids, and Smart Assist severity aliases',
      'supabase/functions/_shared/telematics-adapter-registry.ts dispatches yanmar, asv, ycena, smart_assist, yanmar_smart_assist, and ycena_smart_assist provider keys to yanmarSmartAssistAdapter',
      'supabase/functions/_shared/adapters/yanmar-smart-assist.test.ts covers Yanmar machine readings, ASV Smart Assist aliases, fault alert dedupe, and idle alerts',
      'test-results/agent-gates/20260521T053955Z-C5.2-yanmar-smart-assist.json records the historical C5.2 segment gate as PASS'
    ),
    'safety_bounds', jsonb_build_array(
      'this migration marks only C5.2 shipped and does not alter telematics runtime behavior',
      'Smart Assist adapter readiness is not live Tethr provider-action evidence',
      'unknown devices remain rejected by the provider-neutral ingest path instead of creating unmapped telemetry',
      'live testConnection intentionally fails until credentials and endpoint contract are configured'
    ),
    'manual_boundaries', jsonb_build_array(
      'no Yanmar or ASV Smart Assist credentials, API key, endpoint, webhook, or payload contract was supplied',
      'no device-to-equipment mapping source of truth or feed provisioning policy was approved',
      'no live Smart Assist poller, webhook, provider test connection, or customer data flow was tested',
      'docs/IntelliDealer/_Manifests/QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md states Smart Assist/Yanmar work is not Tethr provider evidence',
      'D1.2 and any Tethr-specific action row remain blocked until source-controlled provider contract and payload fixtures are supplied',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
