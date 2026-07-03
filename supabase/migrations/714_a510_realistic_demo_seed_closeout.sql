-- ============================================================================
-- Migration 714: A5.10 realistic demo seed closeout
--
-- QB-14 is implemented by migration 603 plus the demo verification harness. The
-- seed is deterministic, idempotent, provenance-tagged, and bounded to local
-- demo data with no live provider dependency.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%714_a510_realistic_demo_seed_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-14') ||
      ' | supabase/migrations/603_seed_realistic_data.sql' ||
      ' | scripts/demo/seed-ids.mjs' ||
      ' | scripts/demo/verify-seed.mjs' ||
      ' | supabase/migrations/472_qrm_company_wave2_columns.sql' ||
      ' | supabase/migrations/026_crm_sprint2_contact_company_management.sql' ||
      ' | supabase/migrations/047_crm_equipment_moonshot.sql' ||
      ' | supabase/migrations/714_a510_realistic_demo_seed_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.10 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.10 shipped: migration 603 seeds the QB-14 demo world using deterministic UUID bands for 60 companies, 200 contacts, 100 equipment assets, 20 active deals, and 80 activities. Every seeded row carries seedBatchId=qb14-realistic-demo-2026-05-20, seedSource=qb14_demo_seed, liveImport=false, provenance=deterministic_demo_seed, externalDependency=null, and a seedOrdinal so demos are traceable and clearly synthetic. Idempotency is enforced by deterministic IDs, metadata-bounded ON CONFLICT updates, contact-company and deal-stage natural conflict targets, and existing unique guards for customer legacy numbers, equipment asset tags, and VIN/PIN values. scripts/demo/verify-seed.mjs checks expected counts, CRM compatibility views, FK integrity, search_customer_picker_ranked results, anchor quote signals, catalog/fleet visibility, and optional authenticated app/RLS access.'
  END,
  updated_at = now()
WHERE task_id = 'A5.10';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.10',
  'update',
  jsonb_build_object(
    'reason', 'a510_realistic_demo_seed_closeout',
    'migration', '714_a510_realistic_demo_seed_closeout.sql',
    'mission_alignment', 'pass: the deterministic demo world gives sales and quote teams a credible equipment, customer, fleet, and deal dataset for pressure-testing quote workflows without relying on live vendor/customer systems',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/603_seed_realistic_data.sql deterministic UUID bands for company/contact/equipment/deal/activity rows',
      'supabase/migrations/603_seed_realistic_data.sql seedBatchId/provenance/liveImport/externalDependency metadata on each seeded domain row',
      'supabase/migrations/603_seed_realistic_data.sql metadata-bounded ON CONFLICT updates for idempotent reruns',
      'supabase/migrations/603_seed_realistic_data.sql natural contact-company and deal-stage conflict targets',
      'scripts/demo/seed-ids.mjs QB14_REALISTIC_EXPECTED_COUNTS constants',
      'scripts/demo/verify-seed.mjs expected row counts and CRM compatibility view checks',
      'scripts/demo/verify-seed.mjs FK integrity, customer picker, quote signal, catalog/fleet, and optional authenticated RLS verification',
      'supabase/migrations/472_qrm_company_wave2_columns.sql unique customer legacy number guard',
      'supabase/migrations/026_crm_sprint2_contact_company_management.sql unique equipment asset tag guard',
      'supabase/migrations/047_crm_equipment_moonshot.sql unique equipment VIN/PIN guard'
    ),
    'safety_bounds', jsonb_build_array(
      'seed rows use the default demo workspace only',
      'seed metadata explicitly says liveImport=false and externalDependency=null',
      'idempotent updates are limited to rows already carrying the QB-14 seedBatchId',
      'the verification script separates static seed integrity from optional authenticated app/RLS proof'
    ),
    'manual_boundaries', jsonb_build_array(
      'running the seed against a live Supabase project still requires operator-selected environment variables',
      'authenticated app/RLS seed verification requires configured demo auth credentials',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
