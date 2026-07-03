-- ============================================================================
-- Migration 680: H5.1 technician execution documentation closeout
--
-- H5.1 is implemented by migration 637 plus shared H5 helpers, service router
-- actions, and web close-gate panels. This migration records roadmap status
-- and evidence only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/680_h51_technician_execution_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H5') ||
      ' | supabase/migrations/637_service_h5_technician_execution_documentation.sql' ||
      ' | supabase/functions/_shared/service-h5-execution.ts' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | apps/web/src/features/service/lib/service-wo-gates.ts' ||
      ' | apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx' ||
      ' | supabase/migrations/680_h51_technician_execution_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H5.1 shipped: migration 637 adds per-segment diagnostic and repair sign-off, labor-story quality fields, quoted-time overrun alerting, before/during/after service photo metadata, lock-out/tag-out capture, warranty-parts label and turn-in capture, technician update backstops, and service_job_h5_documentation_gate() so Service Advisor documentation review blocks close or invoice-ready moves until segment evidence is complete.'
  END,
  updated_at = now()
WHERE task_id = 'H5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H5.1',
  'update',
  jsonb_build_object(
    'reason', 'h51_technician_execution_closeout',
    'migration', '680_h51_technician_execution_closeout.sql',
    'mission_alignment', 'pass: service technicians and advisors now have auditable equipment repair execution controls for segment sign-off, safety, warranty parts, customer-visible labor stories, photos, and closeout quality',
    'implementation_evidence', jsonb_build_array(
      '637_service_h5_technician_execution_documentation.sql',
      'supabase/functions/_shared/service-h5-execution.ts',
      'supabase/functions/_shared/service-h5-execution.test.ts',
      'supabase/functions/service-job-router/index.ts',
      'apps/web/src/features/service/lib/service-wo-gates.ts',
      'apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx'
    )
  ),
  'codex'
);

COMMIT;
