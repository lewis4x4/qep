-- ============================================================================
-- Migration 686: H12.1 offline field mode closeout
--
-- H12 adds an offline-ready technician field packet over the existing service
-- mobile work-order surface. Record the roadmap state with concrete web and
-- edge replay evidence.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%service-offline-field-mode.ts%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H12') ||
      ' | apps/web/src/features/service/lib/service-offline-field-mode.ts' ||
      ' | apps/web/src/features/service/lib/service-offline-field-mode.test.ts' ||
      ' | apps/web/src/features/service/pages/ServiceTechnicianMobilePage.tsx' ||
      ' | apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx' ||
      ' | apps/web/src/features/service/lib/api.ts' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | supabase/functions/service-job-router/service-job-router-h12-source.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H12.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H12.1 shipped: ServiceTechnicianMobilePage now caches opened work-order snapshots for offline reopening, falls back to saved agendas after a cold no-signal load, queues hour-meter, three-C, segment labor, and photo packets locally, and drains them on reconnect through service-job-router replay actions. service-job-router adds record_segment_labor so offline labor capture can sync without forcing H5 final repair sign-off.'
  END,
  updated_at = now()
WHERE task_id = 'H12.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H12.1',
  'update',
  jsonb_build_object(
    'reason', 'h12_offline_field_mode_closeout',
    'migration', '693_h12_offline_field_mode.sql',
    'mission_alignment', 'pass: field technicians can preserve machine/work-order context and capture meter, three-C, labor, and photo evidence in no-signal conditions, reducing lost service evidence before reconnect',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/service/lib/service-offline-field-mode.ts',
      'apps/web/src/features/service/lib/service-offline-field-mode.test.ts',
      'apps/web/src/features/service/pages/ServiceTechnicianMobilePage.tsx',
      'apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx',
      'apps/web/src/features/service/lib/api.ts recordSegmentLabor/uploadAndRecordSegmentPhoto',
      'supabase/functions/service-job-router/index.ts record_segment_labor',
      'supabase/functions/service-job-router/service-job-router-h12-source.test.ts'
    )
  ),
  'codex'
);

COMMIT;
