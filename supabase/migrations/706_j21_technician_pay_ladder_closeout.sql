-- ============================================================================
-- Migration 699: J2.1 technician certification + pay-ladder closeout
--
-- Migration 642 created the Road/Shop/Grapple technician pay-ladder backend,
-- structured certification tracking, non-secret vendor-login readiness records,
-- and progression views. The Workforce app now exposes the RLS-scoped ladder.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/642_workforce_technician_cert_pay_ladder.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 5 ADD (Workforce), Section 1.6') ||
      ' | supabase/migrations/642_workforce_technician_cert_pay_ladder.sql' ||
      ' | apps/web/src/features/workforce/lib/workforce-api.ts' ||
      ' | apps/web/src/features/workforce/pages/WorkforceTechnicianPayLadderPage.tsx' ||
      ' | apps/web/src/features/workforce/pages/__tests__/WorkforceTechnicianPayLadderPage.integration.test.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] J2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] J2.1 shipped: migration 642 created Road, Shop, and Grapple technician pay-ladder tiers; structured OEM and in-house certification records; HR-scoped wage/tier assignments; non-secret vendor-login readiness records; tool-count and tooling verification signals; RLS helpers; and progression views that gate advancement on efficiency, QEP-fault comebacks, tenure, OEM/in-house certifications, vendor-login readiness, and tooling. The Shop Master 95% efficiency gate and Road Master 90% gate are preserved. Live OEM portal credentials, passwords, API keys, and external provider confirmations remain intentionally out of scope.'
  END,
  updated_at = now()
WHERE task_id = 'J2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'J2.1',
  'update',
  jsonb_build_object(
    'reason', 'j21_technician_pay_ladder_closeout',
    'migration', '706_j21_technician_pay_ladder_closeout.sql',
    'mission_alignment', 'pass: QEP OS now models technician growth, certification readiness, and compensation progression inside the workforce operating layer without depending on external portal credentials',
    'implementation_evidence', jsonb_build_array(
      'public.technician_profiles.pay_ladder_role',
      'public.technician_profiles.tenure_start_date',
      'public.technician_profiles.tool_count',
      'public.technician_pay_ladder_tiers',
      'public.technician_pay_ladder_assignment',
      'public.technician_oem_certifications',
      'public.technician_in_house_certifications',
      'public.technician_vendor_logins',
      'public.technician_pay_ladder_missing_requirements(uuid, numeric, integer, integer, integer, timestamptz, numeric, integer, integer, jsonb, text[], boolean, text[], text, integer)',
      'public.v_technician_pay_ladder_metric_snapshot',
      'public.v_technician_pay_ladder_progression',
      'apps/web/src/features/workforce/pages/WorkforceTechnicianPayLadderPage.tsx',
      'apps/web/src/features/workforce/pages/__tests__/WorkforceTechnicianPayLadderPage.integration.test.tsx'
    ),
    'manual_boundaries', jsonb_build_array(
      'live OEM portal credentials',
      'external provider confirmations',
      'passwords or API secrets'
    )
  ),
  'codex'
);

COMMIT;
