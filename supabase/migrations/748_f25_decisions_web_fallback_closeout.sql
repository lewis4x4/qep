-- ============================================================================
-- Migration 748: F2.5 /decisions web fallback closeout
--
-- The owner fallback UI already exists as a guarded /decisions route backed by
-- the shared decision triage API. This migration records roadmap status only
-- and does not assert live owner UAT.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%748_f25_decisions_web_fallback_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.5') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.5' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F2.5 /decisions fallback requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-153 Done' ||
      ' | apps/web/src/App.tsx /decisions guarded route' ||
      ' | apps/web/src/features/decisions/pages/DecisionsPage.tsx' ||
      ' | apps/web/src/features/decisions/lib/triage-api.ts' ||
      ' | apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts' ||
      ' | supabase/migrations/748_f25_decisions_web_fallback_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F2.5 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F2.5 shipped: /decisions is a source-controlled owner fallback route guarded to admin/manager/owner roles. DecisionsPage renders a Quiet Operator owner queue, mobile one-card browser with swipe/Previous/Next navigation, desktop queue rail, question/recommendation/gated-impact/citation/voice-memo candidate panels, and owner actions for approve/block/need_info. The triage API loads v_qep_decisions_owner_inbox, normalizes open/escalated/shadow_ship rows, stamps owner_web_last_open/owner_web_open_events when a decision is viewed, resolves approve actions through resolve_qep_decision, and persists block/need_info as owner_web_last_action context without pretending they answer the decision.'
  END,
  updated_at = now()
WHERE task_id = 'F2.5';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F2.5',
  'update',
  jsonb_build_object(
    'reason', 'f25_decisions_web_fallback_closeout',
    'migration', '748_f25_decisions_web_fallback_closeout.sql',
    'mission_alignment', 'pass: the /decisions fallback gives QEP equipment, parts, rental, sales, service, and management owners a direct, mobile-first decision queue so blocked work can continue even when email, Linear, SMS, or voice channels are unavailable',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F2.5 as the /decisions web page fallback row with dependency F1.5',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines F2.5 as the Quiet Operator mobile-swipe /decisions fallback',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-153 / F2.5 /decisions web page as Done on 2026-05-21',
      'apps/web/src/App.tsx lazy-loads DecisionsPage and guards /decisions to admin, manager, and owner profiles',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx calls listDecisionTriageQueue and renders the Quiet Operator owner queue',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx renders a mobile one-decision card browser with touch swipe plus Previous and Next controls',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx renders the desktop queue rail and active decision card with question, recommendation, gated impact, citations, owner action, and voice memo candidate sections',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx disables approve when no recommended option exists and locks actions while saving',
      'apps/web/src/features/decisions/lib/triage-api.ts reads v_qep_decisions_owner_inbox and normalizes only open, escalated, or shadow_ship rows',
      'apps/web/src/features/decisions/lib/triage-api.ts records owner_web_last_open and capped owner_web_open_events when an owner views a decision',
      'apps/web/src/features/decisions/lib/triage-api.ts resolves approve through resolve_qep_decision with owner-web context',
      'apps/web/src/features/decisions/lib/triage-api.ts persists block and need_info as owner_web_last_action context without directly answering the decision',
      'apps/web/src/features/decisions/lib/__tests__/triage-api.test.ts covers queue normalization, owner presence fallback, approve/block/need_info patches, open stamps, and Brian nudge audit entries'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime /decisions behavior',
      'this closeout marks only F2.5 shipped and does not mark F3.1, F3.2, F4.3, F5.1, or F5.2',
      'the route remains role-gated to admin, manager, and owner profiles',
      'approve requires a recommended option and resolves through resolve_qep_decision instead of ad hoc row updates',
      'block and need_info keep the decision visible with owner-web audit context',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live owner UAT session was run in this source-controlled closeout',
      'no production deployment or production route smoke test was run',
      'SMS, Linear, email, and voice owner channels remain separately evidenced rows',
      'delegation and live DM nudge rows remain separate downstream work',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
