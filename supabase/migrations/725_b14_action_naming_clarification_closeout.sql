-- ============================================================================
-- Migration 718: B1.4 action naming clarification closeout
--
-- The /floor audit asked for code-comment clarification because
-- "ActionItemsWidget" and "AdvisorActionCards" both use action language while
-- owning different UX concepts. The comments now explicitly separate the
-- live task/follow-up queue from the advisor CTA / quick-tool launch surface.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%725_b14_action_naming_clarification_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'IRON_FLOOR_AUDIT_2026-05-17.md §3.4') ||
      ' | apps/web/src/features/floor/widgets/ActionItemsWidget.tsx' ||
      ' | apps/web/src/features/floor/components/AdvisorActionCards.tsx' ||
      ' | apps/web/src/features/floor/lib/floor-widget-registry.tsx' ||
      ' | supabase/migrations/725_b14_action_naming_clarification_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B1.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B1.4 shipped: ActionItemsWidget.tsx documents that it owns the live sales.action-items task/follow-up queue, sorted by deal impact with per-row call/email/mark-done affordances, and explicitly says not to merge it with AdvisorActionCards. AdvisorActionCards.tsx documents that it owns the quote-first CTA / quick-tool surface (quote, voice quote, voice note, service request, add customer), not the sales.action-items widget. floor-widget-registry.tsx repeats the boundary at the registry entry so future widget wiring keeps follow-up task rows separate from advisor launch shortcuts.'
  END,
  updated_at = now()
WHERE task_id = 'B1.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B1.4',
  'update',
  jsonb_build_object(
    'reason', 'b14_action_naming_clarification_closeout',
    'migration', '725_b14_action_naming_clarification_closeout.sql',
    'mission_alignment', 'pass: the sales-advisor home keeps its operational model clear for future AI-agent work, separating ranked follow-up execution from fast launch shortcuts so contributors do not collapse two distinct selling workflows',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/floor/widgets/ActionItemsWidget.tsx documents ActionItemsWidget as the sales.action-items task/follow-up queue',
      'apps/web/src/features/floor/widgets/ActionItemsWidget.tsx explicitly says do not merge this with AdvisorActionCards',
      'apps/web/src/features/floor/components/AdvisorActionCards.tsx documents itself as the CTA / quick-tool surface, not sales.action-items',
      'apps/web/src/features/floor/lib/floor-widget-registry.tsx repeats the boundary on the sales.action-items registry entry',
      'docs/operations/IRON_FLOOR_AUDIT_2026-05-17.md §3.4 is the source audit request'
    ),
    'safety_bounds', jsonb_build_array(
      'comment-only/code-contract closeout; no runtime behavior changes',
      'no route, widget registry id, database schema, or user-facing copy changed',
      'B1.3 remains manual-pending operational review and is not promoted here'
    ),
    'manual_boundaries', jsonb_build_array(
      'AI briefing depth signoff remains blocked/manual-pending for B1.3',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
