-- ============================================================================
-- Migration 683: H8.1 comeback and warranty closeout
--
-- The H8 implementation landed before the roadmap row was closed. Record the
-- shipped state with evidence spanning schema, edge actions, invoice blocking,
-- and the service work-order gate UI.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/639_service_h8_comeback_warranty.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H8') ||
      ' | supabase/migrations/639_service_h8_comeback_warranty.sql' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | supabase/functions/_shared/service-h8-comeback-warranty.ts' ||
      ' | supabase/functions/_shared/service-invoice.ts' ||
      ' | apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H8.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H8.1 shipped: comeback_rework jobs link to the original WO with fault attribution, QEP-fault no-rebill, and responsible-technician efficiency impact; service_warranty_claims / lines / events assemble Three-C, warranty-payer, labor, billing, and warranty-parts turn-in evidence through OEM submission, evaluation, approval, payment, denial, or cancellation; per-line payer routing separates customer invoice lines from warranty/internal absorption; machine warranty coverage is surfaced at service intake.'
  END,
  updated_at = now()
WHERE task_id = 'H8.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H8.1',
  'update',
  jsonb_build_object(
    'reason', 'h81_comeback_warranty_closeout',
    'migration', '690_h81_comeback_warranty_closeout.sql',
    'mission_alignment', 'pass: service leaders can separate QEP-fault comeback absorption from customer billing, assemble warranty claims from service evidence, and measure technician/service quality without manual spreadsheet reconciliation',
    'implementation_evidence', jsonb_build_array(
      'public.service_jobs.original_service_job_id and comeback_* columns',
      'public.service_warranty_claims',
      'public.service_warranty_claim_lines',
      'public.service_warranty_claim_events',
      'public.v_service_comeback_technician_rates',
      'public.v_service_warranty_claim_lifecycle',
      'supabase/functions/service-job-router/index.ts h8 actions',
      'supabase/functions/_shared/service-invoice.ts no-rebill guard',
      'apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx'
    )
  ),
  'codex'
);

COMMIT;
