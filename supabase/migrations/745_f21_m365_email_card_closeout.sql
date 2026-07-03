-- ============================================================================
-- Migration 745: F2.1 M365 email card with magic-link buttons closeout
--
-- The owner email channel exists as a guarded decision-email-card edge function
-- plus signed decision-magic-link action endpoint. This migration records
-- roadmap status only and does not assert a live M365 send.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%745_f21_m365_email_card_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.1') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.1' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md primary M365 email channel' ||
      ' | supabase/functions/decision-email-card/index.ts' ||
      ' | supabase/functions/decision-magic-link/index.ts' ||
      ' | supabase/functions/_shared/decision-magic-link.ts' ||
      ' | supabase/functions/_shared/decision-magic-link.test.ts' ||
      ' | supabase/functions/decision-magic-link/logic.ts' ||
      ' | supabase/functions/decision-magic-link/logic.test.ts' ||
      ' | supabase/config.toml functions.decision-email-card and functions.decision-magic-link' ||
      ' | supabase/migrations/745_f21_m365_email_card_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F2.1 shipped: decision-email-card builds a source-controlled owner email card for a qep_decisions row with Approve, Block, and Need info buttons. Each button is a signed decision-magic-link URL with HMAC verification, expiration, owner-role validation, and decision id/code binding. Dry-run mode returns the rendered HTML and signed links without sending. Non-dry-run loads an encrypted onedrive_sync_state M365 token, rejects expired tokens, decrypts via integration-crypto, and posts the HTML card to Microsoft Graph /me/sendMail. decision-magic-link verifies the token and applies the action: approve resolves through resolve_qep_decision, block escalates, and need_info keeps the decision open while stamping ai_prep_packet action context.'
  END,
  updated_at = now()
WHERE task_id = 'F2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F2.1',
  'update',
  jsonb_build_object(
    'reason', 'f21_m365_email_card_closeout',
    'migration', '745_f21_m365_email_card_closeout.sql',
    'mission_alignment', 'pass: owner decisions for equipment, parts, sales, rental, service, and management now have a source-controlled M365 email path that meets owners where they already work and lets them ratify AI recommendations with signed one-click actions',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F2.1 as the M365 email card with signed magic-link buttons',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md names M365 email as the primary owner channel with Approve, Block, and Need more info buttons',
      'supabase/functions/decision-email-card/index.ts authorizes service/admin/manager/owner callers before loading qep_decisions',
      'supabase/functions/decision-email-card/index.ts renders the decision question, lane, owner, recommendation, rationale, citations, and three signed action buttons',
      'supabase/functions/decision-email-card/index.ts supports dry_run=true to return HTML and signed links without sending provider email',
      'supabase/functions/decision-email-card/index.ts loads onedrive_sync_state, rejects expired M365 tokens, decrypts the token, and posts to Microsoft Graph /me/sendMail',
      'supabase/functions/_shared/decision-magic-link.ts signs and verifies HMAC v1 tokens with exp, nonce, decision id/code, action, and owner_role payload fields',
      'supabase/functions/decision-magic-link/index.ts verifies token decision and owner-role matches before applying approve/block/need_info',
      'supabase/functions/decision-magic-link/index.ts resolves approve actions through resolve_qep_decision and records non-approve actions on qep_decisions',
      'supabase/functions/_shared/decision-magic-link.test.ts and supabase/functions/decision-magic-link/logic.test.ts cover signing, tamper rejection, expiration, link generation, approve metadata, and block escalation',
      'supabase/config.toml registers decision-email-card and decision-magic-link edge functions'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime email or decision behavior',
      'this closeout marks only F2.1 shipped and does not mark F2.3, F2.4, F2.5, F3.1, F3.2, or F5.2',
      'signed tokens are required for owner actions and include expiration plus owner-role and decision checks',
      'dry-run mode provides local/source-controlled verification without live provider sends',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live M365 email was sent in this source-controlled closeout',
      'M365 tenant consent, Mail.Send scope, mailbox token freshness, and real owner receipt remain provider/credential verification tasks',
      'no external owner clicked a magic link during this closeout',
      'SMS, Linear comment, voice memo, and /decisions fallback channels remain separate downstream rows',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
