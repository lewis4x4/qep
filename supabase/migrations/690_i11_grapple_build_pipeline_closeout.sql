-- ============================================================================
-- Migration 690: I1.1 grapple build pipeline closeout
--
-- Migration 643 and the web grapple production dashboard already shipped the
-- standalone build pipeline. Record the roadmap state with concrete evidence
-- without closing the later Stream I child-entity rows.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/643_grapple_truck_production_pipeline.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)') ||
      ' | supabase/migrations/643_grapple_truck_production_pipeline.sql' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.ts' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.test.ts' ||
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx' ||
      ' | apps/web/src/features/service/components/ServiceSubNav.tsx' ||
      ' | apps/web/src/App.tsx route /service/grapple'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I1.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I1.1 shipped: migration 643 created the standalone grapple_builds module, create_grapple_build and transition_grapple_build_stage RPCs, stage/status event logging, production-dashboard backing views, and RLS helpers; the /service/grapple dashboard consumes those views and RPCs without creating or depending on service_jobs.'
  END,
  updated_at = now()
WHERE task_id = 'I1.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I1.1',
  'update',
  jsonb_build_object(
    'reason', 'i11_grapple_build_pipeline_closeout',
    'migration', '690_i11_grapple_build_pipeline_closeout.sql',
    'mission_alignment', 'pass: employees get a dedicated grapple-truck production command surface for build stage, status, assignment, customer, equipment, and timeline pressure without contaminating the service work-order lifecycle',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_builds',
      'public.grapple_build_stage_events',
      'public.create_grapple_build',
      'public.transition_grapple_build_stage',
      'public.v_grapple_build_pipeline',
      'public.v_grapple_build_stage_summary',
      'public.v_grapple_build_dashboard_timeline',
      'apps/web/src/features/service/lib/grapple-production-api.ts',
      'apps/web/src/features/service/lib/grapple-production-api.test.ts',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx',
      'apps/web/src/App.tsx route /service/grapple'
    )
  ),
  'codex'
);

COMMIT;
