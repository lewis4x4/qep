-- ============================================================================
-- Migration 679: H4.1 hold states and efficiency integrity closeout
--
-- H4.1 is implemented by migration 636 plus shared hold-state helpers and
-- service metrics surfaces. This migration records roadmap status and evidence
-- only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/686_h41_hold_states_efficiency_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H4') ||
      ' | supabase/migrations/636_service_h4_hold_states_efficiency_integrity.sql' ||
      ' | supabase/functions/_shared/service-hold-integrity.ts' ||
      ' | supabase/functions/_shared/service-hold-integrity.test.ts' ||
      ' | apps/web/src/features/service/lib/service-metrics-api.ts' ||
      ' | apps/web/src/features/service/pages/ServiceMetricsDashboardPage.tsx' ||
      ' | supabase/migrations/686_h41_hold_states_efficiency_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H4.1 shipped: migration 636 normalizes service blockers into the five owner-named hold states (parts/sublet, approval, customer, warranty authorization, payment), preserves legacy blocker wording, exposes resolved and open hold durations, and subtracts allocated hold hours from service efficiency and recovery calculations. The shared hold-integrity helper and service metrics dashboard mirror the same vocabulary and hold-excluded efficiency evidence.'
  END,
  updated_at = now()
WHERE task_id = 'H4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H4.1',
  'update',
  jsonb_build_object(
    'reason', 'h41_hold_states_efficiency_closeout',
    'migration', '686_h41_hold_states_efficiency_closeout.sql',
    'mission_alignment', 'pass: service management can separate true technician productivity from customer, approval, warranty, payment, and parts/sublet delays while preserving an auditable equipment repair hold trail',
    'implementation_evidence', jsonb_build_array(
      '636_service_h4_hold_states_efficiency_integrity.sql',
      'supabase/functions/_shared/service-hold-integrity.ts',
      'supabase/functions/_shared/service-hold-integrity.test.ts',
      'apps/web/src/features/service/lib/service-metrics-api.ts',
      'apps/web/src/features/service/pages/ServiceMetricsDashboardPage.tsx'
    )
  ),
  'codex'
);

COMMIT;
