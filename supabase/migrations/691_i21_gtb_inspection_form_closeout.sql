-- ============================================================================
-- Migration 691: I2.1 GTB inspection form closeout
--
-- Migration 644 created the first-class GTB inspection entity. The web
-- dashboard now exposes a create/sign path so the form can be completed and
-- attached to a standalone grapple build.
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
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I2.1 shipped: migration 644 created grapple_build_gtb_inspections and grapple_build_gtb_inspection_items as child entities of standalone grapple_builds with workspace/build sync, rollups, RLS, and v_grapple_build_gtb_inspections; the dashboard now lets eligible build operators open the standard GTB inspection, seed its inspection checks, pass/sign it, and keep it attached to the build record outside service inspection checklists.'
  END,
  updated_at = now()
WHERE task_id = 'I2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I2.1',
  'update',
  jsonb_build_object(
    'reason', 'i21_gtb_inspection_form_closeout',
    'migration', '691_i21_gtb_inspection_form_closeout.sql',
    'mission_alignment', 'pass: grapple production teams can complete GTB build inspections against the production build record, preserving service inspection separation while giving management concrete quality evidence before downstream QC',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_gtb_inspections',
      'public.grapple_build_gtb_inspection_items',
      'public.grapple_build_gtb_inspection_recalculate',
      'public.v_grapple_build_gtb_inspections',
      'apps/web/src/features/service/lib/grapple-production-api.ts createGrappleGtbInspection',
      'apps/web/src/features/service/lib/grapple-production-api.ts completeGrappleGtbInspection',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx GTB inspection card'
    )
  ),
  'codex'
);

COMMIT;
