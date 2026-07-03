-- ============================================================================
-- Migration 744: F1.5 Brian triage queue closeout
--
-- The Brian triage queue already exists as a guarded /decisions/triage page
-- backed by v_qep_decisions_owner_inbox and qep_decisions.ai_prep_packet
-- metadata updates. This migration records roadmap status only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%751_f15_brian_triage_queue_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.5') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.5' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Revised Stream F roadmap F1.5' ||
      ' | apps/web/src/App.tsx /decisions/triage route' ||
      ' | apps/web/src/features/decisions/pages/DecisionsTriagePage.tsx' ||
      ' | apps/web/src/features/decisions/lib/triage-api.ts' ||
      ' | apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts' ||
      ' | supabase/migrations/617_qep_decisions_owner_inbox_triage_packet.sql' ||
      ' | supabase/migrations/751_f15_brian_triage_queue_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F1.5 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F1.5 shipped: /decisions/triage is an admin/owner-only Brian triage queue that loads open, escalated, and shadow_ship qep_decisions from v_qep_decisions_owner_inbox. The page gives Brian a one-screen review surface with owner rollups, lane aging buckets, AUTHORIZE 7+ day escalation candidates, recommendation/rationale/citation fields, gated task and stream impact, owner-presence signals, triage approval, and queued DM-nudge audit metadata. Approval records brian_triage_approved_at/by in ai_prep_packet and leaves the decision open for owner-channel handling; nudges are queued as brian_dm_last_nudge and brian_dm_nudges metadata only.'
  END,
  updated_at = now()
WHERE task_id = 'F1.5';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F1.5',
  'update',
  jsonb_build_object(
    'reason', 'f15_brian_triage_queue_closeout',
    'migration', '751_f15_brian_triage_queue_closeout.sql',
    'mission_alignment', 'pass: the queue turns AI-generated equipment, parts, sales, rental, service, and management decision drafts into a fast Brian review surface so the autonomous build can continue without Brian hand-authoring triage packets',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F1.5 as Brian triage queue at /decisions/triage with dependency on F1.4',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md revised Stream F roadmap defines F1.5 as the Brian triage queue UI after the auto-triage pipeline',
      'apps/web/src/App.tsx guards /decisions/triage to admin and owner roles and renders DecisionsTriagePage',
      'apps/web/src/features/decisions/pages/DecisionsTriagePage.tsx loads listDecisionTriageQueue, displays owner rollup, lane aging buckets, AUTHORIZE 7+ day escalations, recommended option/rationale/citations, gated impact, and owner presence',
      'apps/web/src/features/decisions/pages/DecisionsTriagePage.tsx exposes Approve triage and Queue DM nudge controls that update cached ai_prep_packet metadata',
      'apps/web/src/features/decisions/lib/triage-api.ts reads v_qep_decisions_owner_inbox, normalizes ai_prep_packet, owner presence, gated counts, and gated streams',
      'apps/web/src/features/decisions/lib/triage-api.ts records brian_triage_approved_at/by and queued brian_dm_nudge metadata without resolving or answering the decision',
      'supabase/migrations/617_qep_decisions_owner_inbox_triage_packet.sql exposes open/escalated/shadow_ship rows with age_days, gated_task_count, gated_streams, and ai_prep_packet',
      'apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts covers queue normalization, owner-presence fallback, and queued nudge audit entries'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime decision behavior',
      'this closeout marks only F1.5 shipped and does not mark F2.1, F2.3, F2.4, F2.5, F4.3, or F5.2',
      'triage approval writes metadata only and does not answer, resolve, or auto-ship owner decisions',
      'DM nudge control records queued metadata only and does not send live Slack, Teams, SMS, or email messages',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Brian approval session was performed in this source-controlled closeout',
      'no outbound DM, SMS, email, or Linear channel was invoked',
      'owner-channel delivery remains covered by downstream F2 rows',
      'production deployment remains an application deployment task',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
