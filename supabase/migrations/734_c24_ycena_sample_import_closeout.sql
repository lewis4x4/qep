-- ============================================================================
-- Migration 734: C2.4 ASV/Yanmar YCENA sample import closeout
--
-- JAR-105 Slice 5.4 is satisfied by the source-controlled YCENA sample import
-- tool, import-plan tests, and tracked dry-run/apply artifacts for ASV and
-- Yanmar. Bobcat, Vermeer, and the broader JAR-105 decision row remain separate.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%734_c24_ycena_sample_import_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-105 packet') ||
      ' | scripts/oem/ycena-sample-import.mjs' ||
      ' | scripts/oem/__tests__/ycena-sample-import.test.ts' ||
      ' | scripts/oem/ycena-price-book-parser.mjs' ||
      ' | test-results/oem-imports/20260521T051500Z-C2.4-ycena-sample-import-dry-run.json' ||
      ' | test-results/oem-imports/20260521T051500Z-C2.4-ycena-sample-import-apply.json' ||
      ' | test-results/agent-gates/20260521T052005Z-C2.4-ycena-sample-import.json' ||
      ' | supabase/migrations/734_c24_ycena_sample_import_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C2.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C2.4 shipped: scripts/oem/ycena-sample-import.mjs turns C2.3 parser output into ASV/Yanmar import plans, brand-prefixes base and option numbers, maps base rows to equipment_base_codes, associates model-level options to each imported base in equipment_options, writes equipment_base_codes_import_runs on apply, and keeps apply gated behind SUPABASE_URL/VITE_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY. The tracked dry-run artifact records 829 parsed rows, 69 base upserts, 2,726 option associations, and 44 skipped duplicate/orphan transform rows across ASV and Yanmar. The tracked apply artifact records 69 base inserts and 2,726 option inserts with ASV run cd2d3e60-e097-43de-b1e0-a390a43ebf18 and Yanmar run 6b3d2688-fe1d-4c91-beda-eeee9b92ac6a. This closes only C2.4; C2.5 Bobcat, C2.6 Vermeer, and D2.3/JAR-105 remain blocked or decision-gated by their own rows and external proof requirements.'
  END,
  updated_at = now()
WHERE task_id = 'C2.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C2.4',
  'update',
  jsonb_build_object(
    'reason', 'c24_ycena_sample_import_closeout',
    'migration', '734_c24_ycena_sample_import_closeout.sql',
    'mission_alignment', 'pass: QEP can convert supplied YCENA ASV/Yanmar price books into canonical equipment base and option records with import-run provenance, giving equipment sales and rental quoting auditable OEM pricing inputs',
    'implementation_evidence', jsonb_build_array(
      'scripts/oem/ycena-sample-import.mjs builds dry-run/apply import plans for supported ASV and Yanmar YCENA sources',
      'scripts/oem/ycena-sample-import.mjs brand-prefixes base and option numbers to avoid ASV/Yanmar collisions in the legacy unique(workspace_id, base_number) shape',
      'scripts/oem/ycena-sample-import.mjs upserts equipment_base_codes on workspace_id/base_number and equipment_options on workspace_id/base_code_id/option_number',
      'scripts/oem/ycena-sample-import.mjs records equipment_base_codes_import_runs with rows_inserted, rows_updated, rows_skipped, source filename, source SHA-256, and parser/import metadata on apply',
      'scripts/oem/__tests__/ycena-sample-import.test.ts covers Yanmar plan mapping, base/option associations, duplicate-option dedupe, and skipped transform rows',
      'test-results/oem-imports/20260521T051500Z-C2.4-ycena-sample-import-dry-run.json records 829 parsed rows, 69 base upserts, 2,726 option associations, and 44 skipped transform rows across ASV/Yanmar',
      'test-results/oem-imports/20260521T051500Z-C2.4-ycena-sample-import-apply.json records 69 base inserts, 2,726 option inserts, ASV run cd2d3e60-e097-43de-b1e0-a390a43ebf18, and Yanmar run 6b3d2688-fe1d-4c91-beda-eeee9b92ac6a',
      'test-results/agent-gates/20260521T052005Z-C2.4-ycena-sample-import.json records a passing segment gate for the YCENA sample import slice'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter importer, application, or database runtime behavior',
      'this closeout does not mark C2.1, C2.2, C2.3, C2.5, C2.6, or D2.3 shipped',
      'this closeout does not perform a new live import or require credentials',
      'apply mode remains gated by service-role environment variables',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'Bobcat and Vermeer sample files/API contracts remain not supplied and are governed by C2.5/C2.6',
      'D2.3/JAR-105 remains decision-gated because the broader OEM expansion includes blocked Bobcat and Vermeer rows',
      'no new production import was run in this closeout; tracked 2026-05-21 artifacts are the source-controlled import evidence',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
