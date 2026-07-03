-- ============================================================================
-- Migration 747: F2.4 voice memo answer pipeline closeout
--
-- The decision-voice-memo-answer edge function provides the source-controlled
-- OneDrive/URL/storage audio adapter, Whisper transcription, decision-action
-- extraction, candidate persistence, and confirmation payload generation. This
-- migration records roadmap status only and does not assert live Microsoft
-- folder monitoring, OpenAI/Graph credentials, SMS delivery, or email delivery.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%747_f24_voice_memo_answer_pipeline_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.4') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F2.4' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F2.4 voice memo owner channel' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-154 Done' ||
      ' | supabase/functions/decision-voice-memo-answer/index.ts' ||
      ' | supabase/functions/decision-voice-memo-answer/logic.ts' ||
      ' | supabase/functions/decision-voice-memo-answer/logic.test.ts' ||
      ' | apps/web/src/features/decisions/pages/DecisionsPage.tsx voice memo candidate review' ||
      ' | supabase/config.toml functions.decision-voice-memo-answer' ||
      ' | supabase/migrations/747_f24_voice_memo_answer_pipeline_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F2.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F2.4 shipped: decision-voice-memo-answer is a source-controlled owner voice-memo answer pipeline. It accepts decision id/code from service/admin/manager/owner callers, restricts candidate updates to open/escalated/shadow_ship decisions, accepts audio from a OneDrive Graph item, Supabase storage object, or allowlisted HTTPS URL, decrypts onedrive_sync_state access tokens for Graph reads, enforces audio size/MIME/host guardrails, transcribes through OpenAI Whisper, deterministically extracts approve/block/need_info with optional AI JSON fallback, persists only ai_prep_packet.voice_memo_candidate with transcript/action/rationale/confidence/source evidence, and returns confirmation-required SMS/email payloads plus a signed decision magic link for owner confirmation.'
  END,
  updated_at = now()
WHERE task_id = 'F2.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F2.4',
  'update',
  jsonb_build_object(
    'reason', 'f24_voice_memo_answer_pipeline_closeout',
    'migration', '747_f24_voice_memo_answer_pipeline_closeout.sql',
    'mission_alignment', 'pass: voice memo decisions let QEP equipment, parts, rental, sales, service, and management owners answer blockers in the channel that best preserves operating context, while AI extracts a tentative action without silently resolving the decision before confirmation',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F2.4 as the Voice memo answer pipeline row with F1.5 and B2.2 dependencies',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines F2.4 as the OneDrive voice-memo watcher plus Whisper transcription owner channel',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-154 / F2.4 Voice memo answer pipeline as Done on 2026-05-21',
      'supabase/functions/decision-voice-memo-answer/index.ts authorizes service/admin/manager/owner callers before loading qep_decisions',
      'supabase/functions/decision-voice-memo-answer/index.ts only accepts open, escalated, or shadow_ship decisions for confirmation candidates',
      'supabase/functions/decision-voice-memo-answer/index.ts loads audio from graph_item, storage_path, or audio_url and requires graph_item to resolve through onedrive_sync_state',
      'supabase/functions/decision-voice-memo-answer/index.ts decrypts OneDrive tokens, rejects expired tokens, and reads Microsoft Graph item content',
      'supabase/functions/decision-voice-memo-answer/index.ts enforces HTTPS, host allowlist/private-IP rejection, audio size limits, and MIME/extension validation before transcription',
      'supabase/functions/decision-voice-memo-answer/index.ts posts audio to OpenAI audio/transcriptions with verbose_json and captures transcript/language/confidence metadata',
      'supabase/functions/decision-voice-memo-answer/logic.ts deterministically maps voice transcripts to approve, block, or need_info and preserves rationale text',
      'supabase/functions/decision-voice-memo-answer/index.ts optionally falls back to AI JSON extraction for ambiguous transcripts while retaining deterministic fallback behavior',
      'supabase/functions/decision-voice-memo-answer/logic.ts builds an ai_prep_packet.voice_memo_candidate patch and intentionally does not answer or resolve the decision',
      'supabase/functions/decision-voice-memo-answer/index.ts returns confirmation-required SMS and email payloads, plus a signed decision magic link when an allowed confirmation base URL is configured',
      'apps/web/src/features/decisions/pages/DecisionsPage.tsx displays ai_prep_packet.voice_memo_candidate action, rationale, and transcript for owner review',
      'supabase/config.toml registers decision-voice-memo-answer with verify_jwt=false so the function can enforce service/user auth internally'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime voice memo behavior',
      'this closeout marks only F2.4 shipped and does not mark F2.2, F2.5, F3.1, F3.2, F4.3, or F5.2',
      'voice memo extraction writes a confirmation candidate only and never silently resolves qep_decisions',
      'Graph audio reads fail closed without a usable onedrive_sync_state access token',
      'OpenAI transcription fails closed without OPENAI_API_KEY or OPENAI_KEY',
      'SMS and email confirmation payloads are dry-run artifacts until a provider channel sends them',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live OneDrive watched-folder subscription, scheduler, or Microsoft Graph webhook delivery was executed in this source-controlled closeout',
      'OneDrive tenant consent, folder path selection, encrypted user token availability, and production Graph access remain environment/provider verification tasks',
      'OPENAI_API_KEY or OPENAI_KEY configuration and live Whisper transcription billing remain environment/provider verification tasks',
      'live SMS delivery remains blocked by F2.2 / BLK-7 and was not claimed here',
      'live email delivery requires configured Microsoft mail send state and was not claimed here',
      'owner confirmation through the returned magic link must still be verified in the target environment',
      'Linear comment, /decisions fallback, delegation, and audit-artifact rows remain separate downstream rows',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
