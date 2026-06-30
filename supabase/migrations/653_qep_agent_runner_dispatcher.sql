-- ============================================================================
-- Migration 653: QEP agent runner dispatcher roadmap closeout
-- Purpose: mark F2.7 shipped now that the queue dispatcher script and GitHub
--          Actions schedule exist around qep_agent_work_orders.
-- ============================================================================

BEGIN;

INSERT INTO public.qep_roadmap_tasks (
  task_id,
  stream,
  wave,
  title,
  description,
  ship_state,
  owner,
  blocking_decision,
  depends_on,
  evidence_link,
  notes,
  sort_order
)
VALUES
(
  'F2.7',
  'F',
  'F2',
  'Agent runner dispatcher',
  'Build the dispatcher that claims queued qep_agent_work_orders rows and kicks Claude Code /goal first, then Cursor Background Agents or RepoPrompt adapters as second-stage runners.',
  'shipped',
  'Engineer + Orchestrator',
  NULL,
  ARRAY['F2.6'],
  'scripts/agent-work-orders/dispatch.mjs | .github/workflows/qep-agent-work-orders.yml',
  '[2026-06-30] Added runner dispatcher script, 5-minute GitHub Actions dispatcher, and handoff artifact upload. External runners are only claimed when their command env var is configured.',
  5207
),
(
  'F2.8',
  'F',
  'F2',
  'Agent progress comments back to Linear',
  'Post runner checkpoints back to the Linear issue: started, clarification requested, tests green, PR opened, done/failed.',
  'not_started',
  'Engineer + Orchestrator',
  NULL,
  ARRAY['F2.6', 'F2.7'],
  'QEP (1)/QEP_COMMENT_DRIVEN_AGENTS.md',
  '[2026-06-30] Still next after F2.7: wire runner checkpoints back to Linear comments.',
  5208
)
ON CONFLICT (task_id) DO UPDATE SET
  stream = EXCLUDED.stream,
  wave = EXCLUDED.wave,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ship_state = EXCLUDED.ship_state,
  owner = EXCLUDED.owner,
  blocking_decision = EXCLUDED.blocking_decision,
  depends_on = EXCLUDED.depends_on,
  evidence_link = EXCLUDED.evidence_link,
  notes = CASE
    WHEN COALESCE(public.qep_roadmap_tasks.notes, '') LIKE '%' || EXCLUDED.notes || '%'
      THEN public.qep_roadmap_tasks.notes
    ELSE COALESCE(public.qep_roadmap_tasks.notes, '') || E'\n' || EXCLUDED.notes
  END,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;
