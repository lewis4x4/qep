-- ============================================================================
-- Migration 743: F1.4 auto-triage pipeline closeout
--
-- The auto-triage pipeline composes the Decision Inbox V2 preparation chain:
-- plain-English question rewrite, deterministic lane classification, owner
-- routing, citation assembly, recommendation drafting, precedent matching, and
-- optional qep_decisions upsert for Brian review. This migration records
-- roadmap status only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%750_f14_auto_triage_pipeline_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.4') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.4' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Section 4 auto-triage pipeline' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Immediate next actions item 4' ||
      ' | supabase/functions/auto-triage-pipeline/logic.ts' ||
      ' | supabase/functions/auto-triage-pipeline/index.ts' ||
      ' | supabase/functions/auto-triage-pipeline/logic.test.ts' ||
      ' | supabase/functions/lane-classifier/logic.ts' ||
      ' | supabase/config.toml functions.auto-triage-pipeline' ||
      ' | supabase/migrations/750_f14_auto_triage_pipeline_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F1.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F1.4 shipped: auto-triage-pipeline now turns a pending-decision payload into a Brian-reviewable qep_decisions draft. It normalizes the plain-English question, reuses the F1.3 lane classifier, routes owner roles for Brian/Rylee/Ryan/Angela/Norman/Tina, builds deterministic evidence citations from source links/tasks/payload/provided citations, drafts lane-appropriate recommendation defaults with reversal cost and silence thresholds, searches qep_decision_precedents for a best match above the 0.85 similarity threshold, records precedent evidence in ai_prep_packet when matched, and can upsert an open qep_decisions row when apply_update or upsert is requested.'
  END,
  updated_at = now()
WHERE task_id = 'F1.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F1.4',
  'update',
  jsonb_build_object(
    'reason', 'f14_auto_triage_pipeline_closeout',
    'migration', '750_f14_auto_triage_pipeline_closeout.sql',
    'mission_alignment', 'pass: QEP agents need pending equipment, parts, sales, rental, service, and management decisions translated into owner-routed, cited, reversible recommendations so the build can keep moving instead of waiting on hand-written decision packets',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F1.4 as the auto-triage pipeline edge function row',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Section 4 defines the rewriter, lane classifier, owner router, citation finder, recommendation drafter, and Brian-review queue sequence',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md immediate next action 4 states F1.4 ships before the inbox UI',
      'supabase/functions/auto-triage-pipeline/logic.ts implements rewriteQuestionPlain, routeOwnerRole, buildDeterministicCitations, draftRecommendation, findBestPrecedentMatch, applyPrecedentRecommendation, and buildAutoTriageDraft',
      'supabase/functions/auto-triage-pipeline/logic.ts imports and reuses classifyDecisionLane from the F1.3 lane classifier',
      'supabase/functions/auto-triage-pipeline/index.ts reads qep_decision_precedents, applies the best precedent match above PRECEDENT_SIMILARITY_THRESHOLD, and optionally upserts qep_decisions',
      'supabase/functions/auto-triage-pipeline/logic.test.ts covers question rewrite, owner routing, deterministic citations, recommendation defaults, precedent matching, draft composition, and precedent injection',
      'supabase/config.toml registers the auto-triage-pipeline edge function'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime decision behavior',
      'this closeout marks only F1.4 shipped and does not mark F1.5 or downstream decision-channel rows shipped',
      'pipeline writes only when apply_update=true or upsert=true is requested',
      'AUTHORIZE-class decisions still require the separate signature/authorization path',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Supabase edge invocation was performed in this source-controlled closeout',
      'Brian triage UI approval is F1.5 and remains outside this slice',
      'M365, SMS, Linear, and voice owner-channel delivery remain separate downstream rows',
      'production deployment of auto-triage-pipeline remains an edge-function deployment task',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
