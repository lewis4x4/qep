-- ============================================================================
-- Migration 722: B2.4 speaker labeling closeout
--
-- VC-4 is satisfied by the existing workspace-scoped speaker label pipeline:
-- suggestions are label-only and auditable, service/edge writers cannot assign
-- labels silently, and authenticated users must explicitly confirm or reject
-- suggestions through RPCs.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%722_b24_speaker_labeling_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-4') ||
      ' | supabase/migrations/609_voice_capture_speaker_labels.sql' ||
      ' | supabase/functions/_shared/voice-speaker-labels.ts' ||
      ' | supabase/functions/voice-capture/index.ts' ||
      ' | supabase/functions/voice-capture-stream/index.ts' ||
      ' | apps/web/src/components/voice/VoiceSpeakerLabelPanel.tsx' ||
      ' | apps/web/src/components/VoiceCapturePage.tsx' ||
      ' | supabase/migrations/722_b24_speaker_labeling_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B2.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B2.4 shipped: migration 609 creates workspace-scoped voice_capture_speaker_labels and voice_capture_speaker_label_audit tables, forbids service-role confirmed/rejected writes, enforces parent-capture workspace matching, and exposes authenticated confirm/reject RPCs that require explicit user action and audit rows. The shared voice-speaker-labels helper creates or refreshes suggested labels only, avoids foreign-workspace linked names, preserves confirmed rows, and is called by both field-note and live-call capture paths. VoiceSpeakerLabelPanel loads suggestions in VoiceCapturePage and requires the user to Confirm, Edit name, or Reject; it does not auto-assign on render.'
  END,
  updated_at = now()
WHERE task_id = 'B2.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B2.4',
  'update',
  jsonb_build_object(
    'reason', 'b24_speaker_labeling_closeout',
    'migration', '722_b24_speaker_labeling_closeout.sql',
    'mission_alignment', 'pass: voice captures can offer accountable speaker context for sales follow-up while keeping identity assignment human-confirmed, workspace-scoped, and auditable',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/609_voice_capture_speaker_labels.sql creates voice_capture_speaker_labels with status suggested/confirmed/rejected and assignment shape checks',
      'supabase/migrations/609_voice_capture_speaker_labels.sql comments explicitly state rows remain suggestions until a user confirms or rejects through RPCs',
      'supabase/migrations/609_voice_capture_speaker_labels.sql enforces label workspace matching against the parent voice_captures row',
      'supabase/migrations/609_voice_capture_speaker_labels.sql records suggestion_created, suggestion_updated, assignment_confirmed, and assignment_rejected audit events',
      'supabase/migrations/609_voice_capture_speaker_labels.sql prevents service_role writers from inserting or updating confirmed/rejected labels',
      'supabase/migrations/609_voice_capture_speaker_labels.sql exposes authenticated confirm_voice_capture_speaker_label and reject_voice_capture_speaker_label RPCs with workspace, capture-owner, and entity workspace checks',
      'supabase/functions/_shared/voice-speaker-labels.ts creates suggested rows only, marks metadata privacy as label_only_no_voiceprint, and refreshes only duplicate suggested rows',
      'supabase/functions/voice-capture/index.ts and supabase/functions/voice-capture-stream/index.ts call ensureVoiceCaptureSpeakerSuggestions for field_note and live_call captures',
      'apps/web/src/components/voice/VoiceSpeakerLabelPanel.tsx presents Suggested speaker label - not assigned yet and calls confirm/reject RPCs only from user button clicks'
    ),
    'safety_bounds', jsonb_build_array(
      'speaker labels store display labels and entity references, not voiceprints, fingerprints, embeddings, or waveform features',
      'service/edge automation may create or refresh suggestions only',
      'confirmed and rejected states require authenticated user RPC calls',
      'RLS select policies scope labels and audit rows to the caller workspace and either the capture owner or elevated roles',
      'this closeout does not alter speaker-label runtime code, transcription, storage, or CRM sync behavior'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live customer call recording was performed',
      'no biometric identity verification or speaker diarization model was run',
      'no manual user acceptance of a real speaker suggestion was performed',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
