-- ============================================================================
-- Migration 753: F4.2 decision dependency graph + auto-recompute closeout
--
-- Migration 620 already added qep_decisions.unblocks_recompute_codes, its GIN
-- index, and trigger behavior that refreshes active downstream decisions'
-- ai_prep_packet dependency context when a parent decision resolves. This
-- migration records roadmap status only and does not claim production DB apply.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%753_f42_decision_dependency_recompute_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.2') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.2' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F4.2 dependency graph requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-160 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F4.2 foundation built' ||
      ' | supabase/migrations/620_qep_decision_dependency_recompute.sql' ||
      ' | supabase/migrations/620_qep_decision_dependency_recompute.test.ts' ||
      ' | supabase/migrations/753_f42_decision_dependency_recompute_closeout.test.ts' ||
      ' | supabase/migrations/753_f42_decision_dependency_recompute_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F4.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F4.2 shipped: migration 620 adds qep_decisions.unblocks_recompute_codes, a partial GIN index for non-empty recompute arrays, and an updated fn_qep_decision_resolved_promote_tasks trigger. When a parent decision first transitions into answered, shadow_ship, or superseded, the trigger still promotes gated roadmap rows, still writes precedent rows for answered decisions with answered_option, and now refreshes active child qep_decisions listed in unblocks_recompute_codes. The refresh writes dependency_context.parents, dependency_context.last_parent_resolution, and an append-only dependency_recompute array into child.ai_prep_packet with parent code, status, answered option, rationale, answered_at, and recomputed_at evidence. Focused migration-contract tests pin the column, index, transition guard, active-child filter, and JSON payload shape.'
  END,
  updated_at = now()
WHERE task_id = 'F4.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F4.2',
  'update',
  jsonb_build_object(
    'reason', 'f42_decision_dependency_recompute_closeout',
    'migration', '753_f42_decision_dependency_recompute_closeout.sql',
    'mission_alignment', 'pass: dependency recompute keeps QEP equipment, parts, rental, sales, service, and management decisions from using stale owner context when an upstream decision changes the answer space for dependent work',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F4.2 as Decision dependency graph + auto-recompute with dependency F1.1',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md requires unblocks_recompute_codes and fresh downstream AI prep packets when parent decisions resolve',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-160 / F4.2 Decision dependency graph + auto-recompute as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records F4.2 / QEP-160 as foundation built with migration reconciliation pending',
      'supabase/migrations/620_qep_decision_dependency_recompute.sql adds qep_decisions.unblocks_recompute_codes text[] with a partial GIN index',
      'supabase/migrations/620_qep_decision_dependency_recompute.sql updates fn_qep_decision_resolved_promote_tasks to run only on first transition into answered, shadow_ship, or superseded',
      'the trigger updates child decisions where child.code is in NEW.unblocks_recompute_codes, child.code differs from the parent, and child.status is open, escalated, or shadow_ship',
      'the recompute payload records parent_code, parent_status, answered_option, answered_rationale, answered_at, and recomputed_at',
      'child.ai_prep_packet receives dependency_context.parents, dependency_context.last_parent_resolution, and append-only dependency_recompute evidence',
      'supabase/migrations/620_qep_decision_dependency_recompute.test.ts pins the column/index, transition guard, child filter, and structured ai_prep_packet payload'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime dependency recompute behavior',
      'this closeout marks only F4.2 shipped and does not mark F4.3, F4.4, F5.1, or F5.2',
      'dependency recompute updates active downstream decision prep packets but does not answer child decisions',
      'the parent decision trigger still requires a first transition into a resolved state',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Supabase database apply or production child-decision recompute was run in this source-controlled closeout',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
