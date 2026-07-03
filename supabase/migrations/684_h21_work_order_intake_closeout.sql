-- ============================================================================
-- Migration 677: H2.1 work-order type and intake hardening closeout
--
-- H2.1 is implemented by migrations 633/634 plus service intake/router
-- validation. This migration records roadmap status and evidence only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/684_h21_work_order_intake_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H2') ||
      ' | supabase/migrations/633_service_h2_intake_enum_values.sql' ||
      ' | supabase/migrations/634_service_h2_intake_header_fields.sql' ||
      ' | supabase/functions/_shared/service-intake-hardening.ts' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | supabase/migrations/684_h21_work_order_intake_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H2.1 shipped: migrations 633/634 add the seven owner-required work-order types, intake channels, priority vocabulary, mandatory hour-meter/header fields, grapple-truck miles, machine year snapshot, Three-Cs, promised-date indexing, and road-job site details. The service intake hardening helper and service-job router enforce complete H2 intake before new work orders can be created or H2-shaped records can be edited.'
  END,
  updated_at = now()
WHERE task_id = 'H2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H2.1',
  'update',
  jsonb_build_object(
    'reason', 'h21_work_order_intake_closeout',
    'migration', '684_h21_work_order_intake_closeout.sql',
    'mission_alignment', 'pass: service writers get enforceable intake gates for equipment repair, field service, internal, comeback, warranty, and hauling workflows before operations accept work into the system',
    'implementation_evidence', jsonb_build_array(
      '633_service_h2_intake_enum_values.sql',
      '634_service_h2_intake_header_fields.sql',
      'supabase/functions/_shared/service-intake-hardening.ts',
      'supabase/functions/service-job-router/index.ts',
      'apps/web/src/features/service/pages/ServiceIntakePage.tsx'
    )
  ),
  'codex'
);

COMMIT;
