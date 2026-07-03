-- ============================================================================
-- Migration 697: I8.1 no grapple build modeled as a service WO closeout
--
-- Migration 643 already created the standalone grapple_builds module, migrated
-- high-confidence legacy service_jobs into grapple_builds, flagged ambiguous
-- service jobs for review, and installed forward guards that keep grapple
-- production out of the service work-order lifecycle.
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
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I8.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I8.1 shipped: migration 643 created public.grapple_builds as the standalone production module, public.grapple_build_service_job_confidence(...) as the conservative legacy classifier, public.grapple_build_service_job_migrations as the audit trail, high-confidence service_jobs migration into grapple_builds, needs-review routing for ambiguous rows, public.service_jobs_prevent_grapple_production_route(), and public.service_jobs_freeze_migrated_grapple_production_lifecycle(). The dashboard creates new builds through create_grapple_build and explicitly avoids service work-order gates.'
  END,
  updated_at = now()
WHERE task_id = 'I8.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I8.1',
  'update',
  jsonb_build_object(
    'reason', 'i81_no_grapple_service_wo_closeout',
    'migration', '704_i81_no_grapple_service_wo_closeout.sql',
    'mission_alignment', 'pass: grapple truck production now has a dedicated equipment build lifecycle, while service work orders remain reserved for repair/service operations and legacy production rows are migrated or flagged',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_builds',
      'public.grapple_build_service_job_confidence(text, text, text, text, text, text, text, text, text, jsonb)',
      'public.grapple_build_service_job_migrations',
      'public.v_service_jobs_grapple_production_candidates',
      'public.service_jobs_prevent_grapple_production_route()',
      'trg_service_jobs_prevent_grapple_production_route',
      'public.service_jobs_freeze_migrated_grapple_production_lifecycle()',
      'trg_service_jobs_freeze_migrated_grapple_production_lifecycle',
      'service_jobs.grapple_production_routing_status',
      'service_jobs.grapple_build_id',
      'public.create_grapple_build(text, text, date, date, uuid, uuid, uuid, uuid, uuid, jsonb)',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx CreateBuildPanel'
    )
  ),
  'codex'
);

COMMIT;
