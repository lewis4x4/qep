-- ============================================================================
-- Migration 752: F4.1 precedent similarity matching closeout
--
-- Migration 595 created the precedent ledger and answered-decision promotion
-- trigger. The auto-triage-pipeline edge function already reads that ledger,
-- selects the best lexical match above 0.85, and injects precedent evidence.
-- This migration records roadmap status only and does not claim live edge
-- deployment, semantic/vector search, or autonomous decision answering.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%759_f41_precedent_similarity_matching_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.1') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.1' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F4.1 precedent requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-152 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F4.1 foundation built' ||
      ' | supabase/migrations/595_qep_decisions.sql qep_decision_precedents' ||
      ' | supabase/functions/auto-triage-pipeline/logic.ts precedent matcher' ||
      ' | supabase/functions/auto-triage-pipeline/index.ts precedent read/apply path' ||
      ' | supabase/functions/auto-triage-pipeline/logic.test.ts precedent tests' ||
      ' | supabase/migrations/759_f41_precedent_similarity_matching_closeout.test.ts' ||
      ' | supabase/migrations/759_f41_precedent_similarity_matching_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F4.1 shipped: migration 595 provides qep_decision_precedents with source_decision_id, pattern_summary, applied_answer, applied_rationale, owner_role, service-role write access, authenticated read access, and a decision-resolution trigger that writes precedent rows only when a decision transitions to answered with answered_option present. The auto-triage-pipeline reads the latest 200 precedent rows, applies findBestPrecedentMatch at PRECEDENT_SIMILARITY_THRESHOLD 0.85 using deterministic lexical overlap plus a bounded same-owner bonus, and uses applyPrecedentRecommendation to replace the draft recommendation while preserving precedent_match evidence in ai_prep_packet. Focused Deno tests cover match, no-match, and evidence injection behavior. This is not semantic embedding search and does not auto-answer decisions; it suggests precedent-backed defaults for owner review.'
  END,
  updated_at = now()
WHERE task_id = 'F4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F4.1',
  'update',
  jsonb_build_object(
    'reason', 'f41_precedent_similarity_matching_closeout',
    'migration', '759_f41_precedent_similarity_matching_closeout.sql',
    'mission_alignment', 'pass: precedent matching lets QEP equipment, parts, rental, sales, service, and management decisions reuse prior governed answers as evidence-backed recommendations, reducing repeated bottlenecks while keeping owner review and audit context intact',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F4.1 as Precedent similarity matching with dependencies F1.1 and F1.4',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md requires each answered decision to become qep_decision_precedents evidence and new pending decisions to receive suggestions when similarity exceeds 0.85',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-152 / F4.1 Precedent similarity matching as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records F4.1 / QEP-152 as foundation built with migration reconciliation pending',
      'supabase/migrations/595_qep_decisions.sql creates qep_decision_precedents with source_decision_id, pattern_summary, applied_answer, applied_rationale, owner_role, created_at, owner index, RLS, service-role writes, and authenticated reads',
      'supabase/migrations/595_qep_decisions.sql writes a precedent row from fn_qep_decision_resolved_promote_tasks only when a qep_decisions row transitions into answered and answered_option is present',
      'supabase/functions/auto-triage-pipeline/index.ts reads qep_decision_precedents ordered by newest first and capped at 200 rows',
      'supabase/functions/auto-triage-pipeline/logic.ts exposes PRECEDENT_SIMILARITY_THRESHOLD = 0.85, findBestPrecedentMatch, and applyPrecedentRecommendation',
      'findBestPrecedentMatch uses deterministic lexical similarity with a 0.03 same-owner bonus capped at 1.0 and rejects candidates below threshold',
      'applyPrecedentRecommendation replaces recommended_option and recommended_rationale while adding ai_prep_packet.precedent_match with precedent id, source decision id, pattern, answer, rationale, score, and threshold',
      'supabase/functions/auto-triage-pipeline/logic.test.ts covers match above threshold, low-similarity null behavior, and precedent evidence injection'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime precedent matching behavior',
      'this closeout marks only F4.1 shipped and does not mark F4.2, F4.3, F4.4, F5.1, or F5.2',
      'precedent matching suggests draft recommendations but does not answer qep_decisions by itself',
      'auto-triage only writes qep_decisions when apply_update or upsert is explicitly requested',
      'the implementation is deterministic lexical matching, not semantic embeddings or pgvector search',
      'no live provider, credential, webhook, or manual owner signoff is required for this source-controlled slice',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Supabase edge function invocation against production precedent data was run in this source-controlled closeout',
      'no production deployment or supabase db push/local apply was run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice',
      'semantic/vector similarity, if desired later, remains separate roadmap work and is not claimed here'
    )
  ),
  'codex'
);

COMMIT;
