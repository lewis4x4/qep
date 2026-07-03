-- ============================================================================
-- Migration 696: I7.1 build-timeline tracking closeout
--
-- Migration 645 made grapple_build_stage_events the durable timeline log and
-- added reportable timeline views that compute stage durations without
-- duplicating transition history.
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
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I7.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I7.1 shipped: migration 645 records build stage transitions in grapple_build_stage_events from stage/sign-off RPCs and exposes public.v_grapple_build_timeline plus public.v_grapple_build_dashboard_timeline/progress sheets for timeline reporting. The dashboard consumes those views for timeline health, recent events, and computed stage durations, so each standalone grapple build has reportable pipeline timing without a duplicate log.'
  END,
  updated_at = now()
WHERE task_id = 'I7.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I7.1',
  'update',
  jsonb_build_object(
    'reason', 'i71_build_timeline_tracking_closeout',
    'migration', '696_i71_build_timeline_tracking_closeout.sql',
    'mission_alignment', 'pass: build leaders, sales, and service can inspect duration and transition history for grapple production, improving equipment delivery predictability and operational accountability',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_stage_events',
      'public.transition_grapple_build_stage(uuid, text, text, jsonb)',
      'public.sign_grapple_build_final_qc(uuid, text, text, text)',
      'public.v_grapple_build_timeline',
      'public.v_grapple_build_dashboard_timeline',
      'public.v_grapple_build_progress_sheets',
      'stage_durations duration_seconds/duration_hours rollups',
      'apps/web/src/features/service/lib/grapple-production-api.ts normalizeGrappleTimelineRows',
      'apps/web/src/features/service/lib/grapple-production-api.ts normalizeGrappleProgressSheetRows',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx TimelineDurationsPanel',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx TimelineListPanel'
    )
  ),
  'codex'
);

COMMIT;
