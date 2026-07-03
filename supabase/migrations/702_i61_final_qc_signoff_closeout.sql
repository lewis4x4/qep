-- ============================================================================
-- Migration 695: I6.1 final QC checklist + Lead sign-off closeout
--
-- Migration 645 already created the final-QC checklist records, assigned Lead
-- sign-off RPC, release gate, and direct-update DB backstop. The web grapple
-- production dashboard exposes the checklist, pass/completion controls, Lead
-- sign-off action, and release-gate status.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/645_grapple_build_progress_qc_timeline.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)') ||
      ' | supabase/migrations/645_grapple_build_progress_qc_timeline.sql' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.ts' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.test.ts' ||
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I6.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I6.1 shipped: migration 645 created grapple_build_final_qc_checklists, grapple_build_final_qc_items, final-QC rollup guards, public.grapple_build_final_qc_release_gate(uuid), public.sign_grapple_build_final_qc(uuid,text,text,text), and the direct grapple_builds production_complete/release trigger. The dashboard exposes create/pass/complete/sign controls and shows release readiness, so a build cannot be released until final QC is complete and the assigned Lead has signed.'
  END,
  updated_at = now()
WHERE task_id = 'I6.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I6.1',
  'update',
  jsonb_build_object(
    'reason', 'i61_final_qc_signoff_closeout',
    'migration', '702_i61_final_qc_signoff_closeout.sql',
    'mission_alignment', 'pass: grapple builds now have a release-critical final QC checklist and assigned Lead sign-off gate, strengthening equipment quality control before customer or fleet release',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_final_qc_checklists',
      'public.grapple_build_final_qc_items',
      'public.grapple_build_final_qc_release_gate(uuid)',
      'public.sign_grapple_build_final_qc(uuid, text, text, text)',
      'public.enforce_grapple_build_final_qc_release()',
      'grapple_builds_final_qc_release_trg',
      'public.v_grapple_build_final_qc_checklists',
      'public.v_grapple_build_final_qc_items',
      'apps/web/src/features/service/lib/grapple-production-api.ts signGrappleBuildFinalQc',
      'apps/web/src/features/service/lib/grapple-production-api.ts completeGrappleFinalQcChecklist',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx ReleaseGatePanel',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx FinalQcPanel'
    )
  ),
  'codex'
);

COMMIT;
