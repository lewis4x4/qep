-- ============================================================================
-- Migration 755: F4.4 supersession detection closeout
--
-- Migration 608 already added the DB-native decision supersession watcher,
-- historical blocker tracking, and service-role sweep RPC. This migration
-- records roadmap status only and does not claim production DB apply.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%755_f44_supersession_detection_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.4') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.4' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F4.4 scope-change watcher requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-156 Done' ||
      ' | supabase/migrations/608_qep_decision_supersession_watcher.sql' ||
      ' | supabase/migrations/608_qep_decision_supersession_watcher.test.ts' ||
      ' | supabase/migrations/755_f44_supersession_detection_closeout.test.ts' ||
      ' | supabase/migrations/755_f44_supersession_detection_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F4.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F4.4 shipped: migration 608 adds qep_decision_blocks historical scope backfill, fn_qep_maybe_supersede_decision, fn_qep_roadmap_tasks_track_decision_scope, the qep_roadmap_tasks_track_decision_scope trigger, and the service-role-only recompute_qep_decision_supersessions sweep RPC. The watcher preserves historical decision/task scope, refuses to supersede terminal decisions, refuses to supersede while active blockers remain, treats deferred, na, shipped, and rescoped tasks as resolved scope, clears stale terminal blockers with reconcile audit rows, and marks eligible open/escalated/shadow_ship decisions as superseded with structured descoped/completed/rescoped/stale-blocker evidence. Focused migration-contract tests pin the functions, trigger, guard variable, stale-blocker cleanup, audit payload, and service-role-only RPC grant.'
  END,
  updated_at = now()
WHERE task_id = 'F4.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F4.4',
  'update',
  jsonb_build_object(
    'reason', 'f44_supersession_detection_closeout',
    'migration', '755_f44_supersession_detection_closeout.sql',
    'mission_alignment', 'pass: supersession detection protects QEP sales, rental, parts, service, and management work from stale owner blockers after gated tasks are descoped, completed, or rescoped, keeping operators focused on live decisions instead of obsolete approval debt',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F4.4 as Supersession detection with dependency F1.1',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md lists F4.4 as Supersession detection (scope-change watcher)',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-156 / F4.4 Supersession detection as Done on 2026-05-21',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql backfills qep_decision_blocks from current blocking_decision links',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql adds fn_qep_maybe_supersede_decision to mark eligible open/escalated/shadow_ship decisions superseded only when no active blockers remain',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql treats deferred, na, shipped, and rescoped historical task links as resolved decision scope',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql clears stale terminal qep_roadmap_tasks.blocking_decision links and records qep_roadmap_sync_events reconcile evidence',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql adds qep_roadmap_tasks_track_decision_scope after-insert/update trigger for ship_state and blocking_decision changes',
      'supabase/migrations/608_qep_decision_supersession_watcher.sql exposes recompute_qep_decision_supersessions only to service_role as a CI/operator sweep backstop',
      'supabase/migrations/608_qep_decision_supersession_watcher.test.ts pins the watcher, trigger, stale-blocker cleanup, audit payload, and service-role-only RPC contract'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime supersession behavior',
      'this closeout marks only F4.4 shipped and does not mark F5.1 or F5.2',
      'terminal answered or superseded decisions are not rewritten by the watcher',
      'active pending_decision, blocked, not_started, or in_progress blockers keep decisions live',
      'historical qep_decision_blocks scope is append-only and is not deleted',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Supabase database apply or production supersession sweep was run in this source-controlled closeout',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
