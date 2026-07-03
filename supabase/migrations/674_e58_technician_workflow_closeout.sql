-- ============================================================================
-- Migration 674: E5.8 technician workflow capture closeout
--
-- E5.8 / QEP-139 was originally a technician workflow-capture gate. The owner
-- Service Discovery v1.1 inputs unblocked it, and the H5 migration now carries
-- the technician execution/documentation contract. This migration records the
-- roadmap closeout without changing operational schema.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/674_e58_technician_workflow_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H5') ||
      ' | supabase/migrations/637_service_h5_technician_execution_documentation.sql' ||
      ' | supabase/migrations/674_e58_technician_workflow_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] E5.8 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] E5.8 shipped: Technician workflow capture is closed by the H5 execution/documentation gates. Service job segments now carry diagnostic and repair sign-off state, labor-story fields, quoted-time overrun tracking, before/during/after photo metadata, lock-out/tag-out capture, warranty-parts label/turn-in fields, and the Service Advisor documentation-review close gate.'
  END,
  updated_at = now()
WHERE task_id = 'E5.8';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'E5.8',
  'update',
  jsonb_build_object(
    'reason', 'e58_technician_workflow_closeout',
    'migration', '674_e58_technician_workflow_closeout.sql',
    'mission_alignment', 'pass: technicians get enforceable service execution controls for equipment repair quality, warranty parts handling, safety documentation, and customer-visible labor stories',
    'implementation_evidence', jsonb_build_array(
      '637_service_h5_technician_execution_documentation.sql'
    )
  ),
  'codex'
);

COMMIT;
