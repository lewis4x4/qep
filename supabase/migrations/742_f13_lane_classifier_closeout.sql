-- ============================================================================
-- Migration 742: F1.3 lane classifier closeout
--
-- The canonical qep_roadmap_tasks row F1.3 is "Lane classifier edge
-- function". The source-controlled lane-classifier edge function classifies
-- open decisions into AUTO, RATIFY, and AUTHORIZE lanes from reversibility and
-- risk heuristics, can merge sparse requests with persisted decision rows, and
-- can optionally write the chosen lane back to open decisions. This migration
-- records roadmap status only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%742_f13_lane_classifier_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.3') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F1.3' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Section 4 lane classifier' ||
      ' | supabase/functions/lane-classifier/logic.ts' ||
      ' | supabase/functions/lane-classifier/index.ts' ||
      ' | supabase/functions/lane-classifier/logic.test.ts' ||
      ' | supabase/config.toml functions.lane-classifier' ||
      ' | supabase/migrations/742_f13_lane_classifier_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F1.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F1.3 shipped: the lane-classifier edge function classifies qep_decisions into AUTO, RATIFY, or AUTHORIZE using the Decision Inbox V2 reversibility heuristics. AUTHORIZE wins for money, contract, schema, compliance, legal, data cutover, security, credential, retention, destructive, irreversible, and TILA signals; RATIFY covers policy, integration, rule-based, operational, citation, and financial choices; AUTO covers feature-flag, copy, UI default, low-risk, reversible, and configurable-default changes. The endpoint can fetch an open qep_decisions row by id/code, merge persisted fields with sparse request input, return matched keywords and a reason, and optionally update the open decision lane through the service-role Supabase client.'
  END,
  updated_at = now()
WHERE task_id = 'F1.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F1.3',
  'update',
  jsonb_build_object(
    'reason', 'f13_lane_classifier_closeout',
    'migration', '742_f13_lane_classifier_closeout.sql',
    'mission_alignment', 'pass: QEP decision velocity needs low-risk equipment, parts, sales, rental, service, and management choices to keep moving while irreversible decisions still receive AUTHORIZE handling; the lane classifier provides that deterministic separation for the AI roadmap operating system',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F1.3 as the lane classifier edge function row',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Section 4 defines lane classification as AUTO/RATIFY/AUTHORIZE based on reversibility heuristics',
      'supabase/functions/lane-classifier/logic.ts implements AUTHORIZE, RATIFY, and AUTO keyword heuristics with AUTHORIZE precedence',
      'supabase/functions/lane-classifier/logic.ts merges persisted qep_decisions fields with sparse request input before classification',
      'supabase/functions/lane-classifier/index.ts fetches open qep_decisions rows by id/code and returns lane, matched_keywords, reason, and optional updated_decision',
      'supabase/functions/lane-classifier/index.ts optionally updates only open qep_decisions rows when apply_update=true',
      'supabase/functions/lane-classifier/logic.test.ts covers AUTHORIZE, AUTO, RATIFY, precedence, and persisted-payload merge behavior',
      'supabase/config.toml registers the lane-classifier edge function'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime decision behavior',
      'this closeout marks only F1.3 shipped and does not mark F1.4 or downstream decision-channel rows shipped',
      'lane update writes are limited to open qep_decisions rows addressed by id or code',
      'classification is deterministic and returns matched keywords plus rationale for reviewability',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Supabase edge invocation was performed in this source-controlled closeout',
      'production deployment of lane-classifier remains an edge-function deployment task',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
