-- ============================================================================
-- Migration 746: F2.3 Linear comment bot closeout
--
-- The Linear comment channel exists as a guarded decision-linear-comment edge
-- function wired from ratify-silence-runner. This migration records roadmap
-- status only and does not assert a live Linear bot/API-key post.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%753_f23_linear_comment_bot_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.3') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.3' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md Linear comment owner channel' ||
      ' | supabase/functions/decision-linear-comment/index.ts' ||
      ' | supabase/functions/decision-linear-comment/logic.ts' ||
      ' | supabase/functions/decision-linear-comment/logic.test.ts' ||
      ' | supabase/functions/ratify-silence-runner/index.ts notification attempts' ||
      ' | supabase/config.toml functions.decision-linear-comment' ||
      ' | supabase/migrations/753_f23_linear_comment_bot_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F2.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F2.3 shipped: decision-linear-comment is a source-controlled Linear owner-channel bot. It accepts a decision id/code from service/admin/manager/owner callers, requires LINEAR_API_KEY for live execution, loads open qep_decisions, resolves the Linear issue from ai_prep_packet or the linked qep_roadmap_tasks row, optionally resolves a Linear issue identifier through GraphQL, maps owner_role to an @ mention through LINEAR_OWNER_MENTION_MAP_JSON, builds a recommendation comment with question, recommendation, rationale, task/issue context, and posts it via Linear commentCreate. Dry-run mode returns the issue mapping, owner mention, and comment body without posting.'
  END,
  updated_at = now()
WHERE task_id = 'F2.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F2.3',
  'update',
  jsonb_build_object(
    'reason', 'f23_linear_comment_bot_closeout',
    'migration', '753_f23_linear_comment_bot_closeout.sql',
    'mission_alignment', 'pass: Linear comment delivery gives QEP equipment, parts, sales, rental, service, and management blockers a visible owner-channel recommendation on the mirrored issue, reducing hidden decision debt while preserving the roadmap/Linear audit trail',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F2.3 as the Linear comment bot row',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines the Linear comment owner channel with QEP-bot recommendation posts and owner @ mentions',
      'supabase/functions/decision-linear-comment/index.ts authorizes service/admin/manager/owner callers before loading open qep_decisions',
      'supabase/functions/decision-linear-comment/index.ts requires LINEAR_API_KEY for live Linear GraphQL use and fails closed when it is missing',
      'supabase/functions/decision-linear-comment/index.ts resolves the target issue from ai_prep_packet or linked qep_roadmap_tasks linear fields, with identifier fallback through Linear GraphQL',
      'supabase/functions/decision-linear-comment/index.ts supports dry_run=true and returns the generated comment body without posting',
      'supabase/functions/decision-linear-comment/index.ts posts live comments through the Linear commentCreate GraphQL mutation when dry_run is false',
      'supabase/functions/decision-linear-comment/logic.ts normalizes Linear issue references, extracts issue identifiers from Linear URLs, parses owner mention maps, and builds the recommendation comment',
      'supabase/functions/decision-linear-comment/logic.test.ts covers packet issue resolution, URL identifier extraction, owner mention map parsing, and comment body content',
      'supabase/functions/ratify-silence-runner/index.ts invokes decision-linear-comment as the linear_comment notification attempt',
      'supabase/config.toml registers decision-linear-comment with verify_jwt=false so the function can enforce service/user auth internally'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime Linear behavior',
      'this closeout marks only F2.3 shipped and does not mark F2.4, F2.5, F3.1, F3.2, F4.3, or F5.2',
      'live posting fails closed without LINEAR_API_KEY instead of silently pretending delivery happened',
      'dry-run mode provides local/source-controlled verification of issue mapping and comment body',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Linear comment was posted in this source-controlled closeout',
      'LINEAR_API_KEY, QEP-bot identity, owner mention IDs, and real Linear notification delivery remain credential/provider verification tasks',
      'owner replies in Linear and comment-webhook ingestion remain outside this F2.3 source closeout',
      'SMS, voice memo, /decisions fallback, delegation, and audit-artifact rows remain separate downstream rows',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
