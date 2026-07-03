-- ============================================================================
-- Migration 675: F2.8 agent progress comments closeout
--
-- F2.8 closes the comment-driven agent loop by making the dispatcher post
-- runner lifecycle checkpoints back to the source Linear issue. The work stays
-- in the existing qep_agent_work_orders queue contract; this migration records
-- roadmap status and evidence only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/682_f28_agent_progress_comments_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP (1)/QEP_COMMENT_DRIVEN_AGENTS.md') ||
      ' | scripts/agent-work-orders/dispatch.mjs' ||
      ' | .github/workflows/qep-agent-work-orders.yml' ||
      ' | supabase/migrations/682_f28_agent_progress_comments_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F2.8 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F2.8 shipped: the qep_agent_work_orders dispatcher now posts best-effort Linear progress comments for claimed, handoff-ready, runner-launched, completed, blocked, and failed checkpoints; records skipped/failed comment attempts plus runner result overrides in the work-order result; and passes Linear issue and source comment metadata to configured runners for deeper checkpoints such as tests-green and PR-opened.'
  END,
  updated_at = now()
WHERE task_id = 'F2.8';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F2.8',
  'update',
  jsonb_build_object(
    'reason', 'f28_agent_progress_comments_closeout',
    'migration', '682_f28_agent_progress_comments_closeout.sql',
    'mission_alignment', 'pass: Linear becomes the visible control surface for autonomous equipment, parts, sales, rental, and operations work-order execution without coupling runner vendors to the queue contract',
    'implementation_evidence', jsonb_build_array(
      'scripts/agent-work-orders/dispatch.mjs',
      '.github/workflows/qep-agent-work-orders.yml',
      'supabase/migrations/653_qep_agent_runner_dispatcher.sql'
    )
  ),
  'codex'
);

COMMIT;
