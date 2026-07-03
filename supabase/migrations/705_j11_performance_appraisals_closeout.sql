-- ============================================================================
-- Migration 698: J1.1 performance appraisal system closeout
--
-- Migration 641 created the Service Advisor + Technician performance appraisal
-- backend and the workforce app now exposes the RLS-scoped create/score/finalize
-- and acknowledgement workflow.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/641_workforce_performance_appraisals.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 5 ADD (Workforce)') ||
      ' | supabase/migrations/641_workforce_performance_appraisals.sql' ||
      ' | supabase/functions/performance-appraisals/index.ts' ||
      ' | apps/web/src/features/workforce/lib/workforce-api.ts' ||
      ' | apps/web/src/features/workforce/pages/WorkforcePerformanceAppraisalsPage.tsx' ||
      ' | apps/web/src/features/workforce/pages/__tests__/WorkforcePerformanceAppraisalsPage.integration.test.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] J1.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] J1.1 shipped: migration 641 created Service Advisor and Technician scorecard definitions with exactly seven active equal-weight categories, employee performance appraisal headers/scores, deterministic Sub-Par/Normal/Excellent banding, Cost of Living + Performance raise math, manager summary/finalization signature guards, subject acknowledgement, RLS helpers, and RPCs for create/score/finalize/acknowledge. The workforce app exposes the HR-scoped appraisal queue and live scoring/signature workflow.'
  END,
  updated_at = now()
WHERE task_id = 'J1.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'J1.1',
  'update',
  jsonb_build_object(
    'reason', 'j11_performance_appraisals_closeout',
    'migration', '705_j11_performance_appraisals_closeout.sql',
    'mission_alignment', 'pass: service advisors and technicians now have structured appraisal scorecards, manager evidence, signature accountability, and raise recommendations that support workforce operations inside QEP OS',
    'implementation_evidence', jsonb_build_array(
      'public.employee_appraisal_scorecard_categories',
      'public.employee_performance_appraisals',
      'public.employee_performance_appraisal_scores',
      'public.employee_appraisal_score_band(numeric)',
      'public.employee_appraisal_recommended_raise_pct(numeric, numeric)',
      'public.enforce_employee_performance_appraisal_finalize()',
      'public.employee_appraisal_create(uuid, text, date, date, text, numeric, text)',
      'public.employee_appraisal_score(uuid, jsonb, text, numeric, jsonb, jsonb, jsonb)',
      'public.employee_appraisal_finalize(uuid, text, text)',
      'public.employee_appraisal_acknowledge(uuid, text, text)',
      'public.v_employee_performance_appraisals',
      'supabase/functions/performance-appraisals/index.ts',
      'apps/web/src/features/workforce/pages/WorkforcePerformanceAppraisalsPage.tsx',
      'apps/web/src/features/workforce/pages/__tests__/WorkforcePerformanceAppraisalsPage.integration.test.tsx'
    )
  ),
  'codex'
);

COMMIT;
