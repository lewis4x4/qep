-- ============================================================================
-- Migration 757: F5.2 Brian live-presence + DM-nudge surface closeout
--
-- The Brian command surface already exists through /decisions/triage and the
-- owner /decisions fallback. This migration records roadmap status only and
-- does not claim production DB apply or live outbound DM delivery.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%764_f52_live_presence_dm_nudge_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F5.2') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F5.2' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F5.2 command surface requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-157 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F5.2 admin view built' ||
      ' | apps/web/src/features/decisions/pages/DecisionsTriagePage.tsx' ||
      ' | apps/web/src/features/decisions/pages/DecisionsPage.tsx' ||
      ' | apps/web/src/features/decisions/lib/triage-api.ts' ||
      ' | apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts' ||
      ' | supabase/migrations/751_f15_brian_triage_queue_closeout.sql' ||
      ' | supabase/migrations/755_f25_decisions_web_fallback_closeout.sql' ||
      ' | supabase/migrations/764_f52_live_presence_dm_nudge_closeout.test.ts' ||
      ' | supabase/migrations/764_f52_live_presence_dm_nudge_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F5.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F5.2 shipped: /decisions records owner_web_last_open and capped owner_web_open_events when an owner opens a decision card, while preserving legacy owner presence fallback keys. /decisions/triage gives Brian an admin/owner command surface with owner rollups, lane aging buckets, AUTHORIZE 7+ day escalation candidates, owner-presence timestamps rendered as relative time, per-row Queue DM nudge controls, and explanatory copy that approval/nudge controls only record or queue ai_prep_packet metadata. queueBrianDecisionNudge writes brian_dm_last_nudge and append-only brian_dm_nudges entries with requested_by, requested_at, state=queued, note, and surface=/decisions/triage. Focused triage-api tests cover owner-presence fallback, owner open stamps with capped event history, and queued nudge audit entries.'
  END,
  updated_at = now()
WHERE task_id = 'F5.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F5.2',
  'update',
  jsonb_build_object(
    'reason', 'f52_live_presence_dm_nudge_closeout',
    'migration', '764_f52_live_presence_dm_nudge_closeout.sql',
    'mission_alignment', 'pass: Brian can see stale and actively viewed QEP equipment, parts, rental, sales, service, and management decisions in one command surface, then queue a bounded nudge without inventing an answer or bypassing owner review',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F5.2 as Brian live-presence + DM-nudge surface with dependency F1.5',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines the WATCH row where Brian sees owner presence and can DM-nudge from the row',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-157 / F5.2 Brian live-presence + DM-nudge surface as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records the F5.2 Brian/admin bottleneck view, owner-open tracking, and Queue DM nudge behavior',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx calls recordOwnerDecisionOpen when the selected owner decision changes',
      'apps/web/src/features/decisions/lib/triage-api.ts writes owner_web_last_open and capped owner_web_open_events with actor, owner_role, at, action=opened, and surface=/decisions',
      'apps/web/src/features/decisions/lib/triage-api.ts normalizes ownerPresenceSignal and ownerPresenceAt from owner_web_last_open, owner_web_last_action, and legacy owner presence keys',
      'apps/web/src/features/decisions/pages/DecisionsTriagePage.tsx displays owner rollup, lane aging buckets, AUTHORIZE 7+ day escalation candidates, owner presence relative time, and per-row Queue DM nudge controls',
      'apps/web/src/features/decisions/lib/triage-api.ts writes brian_dm_last_nudge and append-only brian_dm_nudges metadata with queued state and /decisions/triage surface',
      'apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts covers owner presence fallback, owner open event capping, and queued Brian DM nudge audit entries',
      'supabase/migrations/751_f15_brian_triage_queue_closeout.sql and supabase/migrations/755_f25_decisions_web_fallback_closeout.sql already pin the command-surface and owner-open source evidence'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime presence or nudge behavior',
      'this closeout marks only F5.2 shipped',
      'Queue DM nudge records queued metadata only and does not send live Slack, Teams, SMS, email, or Linear messages',
      'owner open stamps are ai_prep_packet audit metadata, not a new real-time websocket dependency',
      'nudge metadata does not answer, resolve, shadow-ship, or supersede decisions',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Brian/owner session was performed in this source-controlled closeout',
      'no outbound Slack, Teams, SMS, email, Linear, or other DM provider was invoked',
      'production deployment remains an application deployment task',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
