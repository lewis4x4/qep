-- ============================================================================
-- Migration 694: I5.1 build-progress sheets to sales + service closeout
--
-- Migration 645 created the cross-department read helper and progress-sheet
-- view. The web dashboard already consumes that view for current build progress,
-- timeline health, latest event, stage durations, and final-QC release readiness.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/645_grapple_build_progress_qc_timeline.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)') ||
      ' | supabase/migrations/645_grapple_build_progress_qc_timeline.sql' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.ts' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.test.ts' ||
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I5.1 shipped: migration 645 created grapple_build_can_read_progress(text), sales/service SELECT-only progress policies, and v_grapple_build_progress_sheets; the grapple production dashboard loads that view so sales/service readers can see current stage, progress percent, timeline health, latest event, stage durations, and final-QC release readiness without write access.'
  END,
  updated_at = now()
WHERE task_id = 'I5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I5.1',
  'update',
  jsonb_build_object(
    'reason', 'i51_build_progress_sheets_closeout',
    'migration', '694_i51_build_progress_sheets_closeout.sql',
    'mission_alignment', 'pass: sales and service can read live grapple build progress from the same production source of truth, giving downstream teams pipeline visibility without granting build management rights',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_can_read_progress(text)',
      'public.v_grapple_build_progress_sheets',
      'grapple_builds_select_progress_sales_service',
      'grapple_build_stage_events_select_progress_sales_service',
      'apps/web/src/features/service/lib/grapple-production-api.ts fetchGrappleProductionDashboard',
      'apps/web/src/features/service/lib/grapple-production-api.ts normalizeGrappleProgressSheetRows',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx BuildListPanel progress bars',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx ReleaseGatePanel',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx TimelineDurationsPanel'
    )
  ),
  'codex'
);

COMMIT;
