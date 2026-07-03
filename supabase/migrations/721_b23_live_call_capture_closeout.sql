-- ============================================================================
-- Migration 721: B2.3 live call capture closeout
--
-- VC-3 is satisfied by the existing live-call stream pipeline: sessions are
-- idempotent by client session, chunks are idempotent by index/client chunk id,
-- finalization rejects missing chunks, and a finalized stream creates one
-- voice_captures call plus one local QRM activity receipt.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%721_b23_live_call_capture_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-3') ||
      ' | supabase/migrations/605_voice_capture_stream_sessions.sql' ||
      ' | supabase/functions/voice-capture-stream/index.ts' ||
      ' | supabase/functions/voice-capture-stream/stream-helpers.ts' ||
      ' | apps/web/src/features/sales/components/LiveCallCapture.tsx' ||
      ' | apps/web/src/features/sales/pages/CustomerDetailPage.tsx' ||
      ' | supabase/migrations/721_b23_live_call_capture_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B2.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B2.3 shipped: migration 605 created voice_capture_stream_sessions and voice_capture_stream_chunks with uniqueness for workspace/user/client_session_id, session/chunk_index, and optional client_chunk_id. The voice-capture-stream edge function starts customer-scoped sessions, accepts approximately 10 second MediaRecorder chunks, returns duplicate chunk receipts without reprocessing completed chunks, blocks finalization until expected chunks are present, builds an ordered transcript, upserts one voice_captures call record, writes one local QRM call activity, stores stream metadata, and exposes retry/cancel/finalize behavior through the CustomerDetailPage LiveCallCapture sheet.'
  END,
  updated_at = now()
WHERE task_id = 'B2.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B2.3',
  'update',
  jsonb_build_object(
    'reason', 'b23_live_call_capture_closeout',
    'migration', '721_b23_live_call_capture_closeout.sql',
    'mission_alignment', 'pass: sales reps can capture live customer calls from the customer record into durable transcript and QRM call receipts, reducing lost context while preserving workspace-scoped evidence for follow-up',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/605_voice_capture_stream_sessions.sql creates voice_capture_stream_sessions with unique workspace/user/client_session_id',
      'supabase/migrations/605_voice_capture_stream_sessions.sql creates voice_capture_stream_chunks with unique session/chunk_index and optional client_chunk_id uniqueness',
      'supabase/functions/voice-capture-stream/index.ts loads sessions by id, client_session_id, user_id, and workspace_id before accepting chunks or finalization',
      'supabase/functions/voice-capture-stream/index.ts handles duplicate chunk inserts by returning completed/skipped receipts or 202 processing receipts instead of creating duplicate chunks',
      'supabase/functions/voice-capture-stream/index.ts rejects finalization with missing_chunks when expected chunk indexes are absent',
      'supabase/functions/voice-capture-stream/index.ts upserts one voice_captures row with activity_type call and stream metadata, then writes a local QRM call receipt through writeVoiceCaptureToLocalCrm',
      'apps/web/src/features/sales/components/LiveCallCapture.tsx records approximately 10 second MediaRecorder chunks, retries failed chunks, and finalizes with expectedChunkCount',
      'apps/web/src/features/sales/pages/CustomerDetailPage.tsx mounts LiveCallCapture from the customer detail sheet and refreshes customer activity after save'
    ),
    'safety_bounds', jsonb_build_array(
      'session and chunk writes are workspace/user scoped through requireServiceUser plus session lookup constraints',
      'customer start validates the company belongs to the caller workspace before creating a stream session',
      'finalization is serialized through the finalizing status transition and returns existing finalized receipt data on repeat finalize',
      'missing chunks block finalization instead of producing partial call receipts',
      'this closeout does not alter OpenAI, storage, QRM activity, or microphone runtime behavior'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live customer call recording was performed',
      'no live OpenAI transcription call was made for this roadmap closeout',
      'browser microphone permission behavior was not manually exercised',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
