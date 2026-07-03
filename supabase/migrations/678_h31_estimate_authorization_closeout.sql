-- ============================================================================
-- Migration 678: H3.1 estimate authorization gates closeout
--
-- H3.1 is implemented by migration 635 plus service authorization helpers,
-- router/quote engine enforcement, and the work-order gate panel. This
-- migration records roadmap status and evidence only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/678_h31_estimate_authorization_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H3') ||
      ' | supabase/migrations/635_service_h3_estimate_authorization_gates.sql' ||
      ' | supabase/functions/_shared/service-estimate-authorization.ts' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | supabase/functions/service-quote-engine/index.ts' ||
      ' | apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx' ||
      ' | supabase/migrations/678_h31_estimate_authorization_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H3.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H3.1 shipped: migration 635 models the owner-binding No approval = No repair rule with documented approved-estimate fields, a 10% re-authorization threshold, service_job_estimate_authorization_gate(), work-start and technician clock-on database backstops, and quote-engine reauthorization when current scope exceeds the approved baseline. The web gate panel mirrors the block for service writers and technicians before repair work starts.'
  END,
  updated_at = now()
WHERE task_id = 'H3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H3.1',
  'update',
  jsonb_build_object(
    'reason', 'h31_estimate_authorization_closeout',
    'migration', '678_h31_estimate_authorization_closeout.sql',
    'mission_alignment', 'pass: service operations now have enforceable customer approval and scope reauthorization gates before chargeable repair work can begin, protecting equipment customers, service writers, technicians, and management auditability',
    'implementation_evidence', jsonb_build_array(
      '635_service_h3_estimate_authorization_gates.sql',
      'supabase/functions/_shared/service-estimate-authorization.ts',
      'supabase/functions/service-job-router/index.ts',
      'supabase/functions/service-quote-engine/index.ts',
      'apps/web/src/features/service/lib/service-wo-gates.ts',
      'apps/web/src/features/service/components/ServiceWorkOrderGatePanels.tsx'
    )
  ),
  'codex'
);

COMMIT;
