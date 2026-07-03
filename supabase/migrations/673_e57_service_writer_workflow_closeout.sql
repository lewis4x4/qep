-- ============================================================================
-- Migration 673: E5.7 service-writer workflow capture closeout
--
-- E5.7 / QEP-138 was originally a workflow-capture gate. The owner Service
-- Discovery v1.1 inputs unblocked it, and the local H2/H3/H5 migrations now
-- implement the service-writer intake, authorization, and closeout gates.
-- This migration records that closeout in qep_roadmap_tasks without changing
-- operational schema.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/673_e57_service_writer_workflow_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H2/H3') ||
      ' | supabase/migrations/634_service_h2_intake_header_fields.sql' ||
      ' | supabase/migrations/635_service_h3_estimate_authorization_gates.sql' ||
      ' | supabase/migrations/637_service_h5_technician_execution_documentation.sql' ||
      ' | supabase/migrations/673_e57_service_writer_workflow_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] E5.7 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] E5.7 shipped: Service-writer workflow capture is closed by the H2/H3/H5 service gates. Intake now has machine year, mandatory hour-meter, three C fields, intake channel, priority, promised date, and road-job details; estimate authorization enforces No approval = No repair plus >10 percent re-authorization; documentation closeout is represented by the Service Advisor review gate.'
  END,
  updated_at = now()
WHERE task_id = 'E5.7';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'E5.7',
  'update',
  jsonb_build_object(
    'reason', 'e57_service_writer_workflow_closeout',
    'migration', '673_e57_service_writer_workflow_closeout.sql',
    'mission_alignment', 'pass: service advisors get enforced equipment-service intake and authorization controls for complete work orders, reducing operational leakage in the equipment service workflow',
    'implementation_evidence', jsonb_build_array(
      '634_service_h2_intake_header_fields.sql',
      '635_service_h3_estimate_authorization_gates.sql',
      '637_service_h5_technician_execution_documentation.sql'
    )
  ),
  'codex'
);

COMMIT;
