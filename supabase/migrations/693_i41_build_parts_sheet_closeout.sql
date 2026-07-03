-- ============================================================================
-- Migration 693: I4.1 build parts sheet closeout
--
-- Migration 644 created grapple build parts sheet headers, consumed line rows,
-- rollup triggers, RLS, and read views. The web dashboard now exposes controls
-- to create a build sheet, add consumed parts, and lock the sheet to the build.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/644_grapple_build_child_entities.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)') ||
      ' | supabase/migrations/644_grapple_build_child_entities.sql' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.ts' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.test.ts' ||
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I4.1 shipped: migration 644 created grapple_build_parts_sheets, grapple_build_parts_sheet_lines, rollup triggers, RLS, and v_grapple_build_parts_sheet* read models; the dashboard now lets eligible build operators create the sheet, record consumed part lines with quantity/cost/source branch evidence, and lock the sheet directly to the standalone grapple build.'
  END,
  updated_at = now()
WHERE task_id = 'I4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I4.1',
  'update',
  jsonb_build_object(
    'reason', 'i41_build_parts_sheet_closeout',
    'migration', '693_i41_build_parts_sheet_closeout.sql',
    'mission_alignment', 'pass: production and parts operators can capture consumed build parts against the grapple build itself, preserving production costing evidence for sales/service without creating a service work order or counter sale',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_parts_sheets',
      'public.grapple_build_parts_sheet_lines',
      'public.grapple_build_parts_sheet_recalculate(uuid)',
      'public.v_grapple_build_parts_sheets',
      'public.v_grapple_build_parts_sheet_lines',
      'apps/web/src/features/service/lib/grapple-production-api.ts createGrapplePartsSheet',
      'apps/web/src/features/service/lib/grapple-production-api.ts addGrapplePartsSheetLine',
      'apps/web/src/features/service/lib/grapple-production-api.ts lockGrapplePartsSheet',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx build parts sheet card'
    )
  ),
  'codex'
);

COMMIT;
