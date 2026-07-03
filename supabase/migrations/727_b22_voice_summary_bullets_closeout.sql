-- ============================================================================
-- Migration 720: B2.2 voice summary bullets closeout
--
-- VC-2 is satisfied by the existing best-effort summary-bullets pipeline:
-- transcripts persist first, summary generation may fail without failing the
-- capture, and the UI renders 5-8 bullets above expandable transcript text.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%727_b22_voice_summary_bullets_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-2') ||
      ' | supabase/migrations/604_voice_captures_summary_bullets.sql' ||
      ' | supabase/functions/_shared/voice-capture-summary.ts' ||
      ' | supabase/functions/voice-capture/index.ts' ||
      ' | supabase/functions/voice-capture-sync/index.ts' ||
      ' | apps/web/src/components/VoiceCapturePage.tsx' ||
      ' | apps/web/src/components/VoiceHistoryPage.tsx' ||
      ' | apps/web/src/components/voice/VoiceSummaryBullets.tsx' ||
      ' | supabase/migrations/727_b22_voice_summary_bullets_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B2.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B2.2 shipped: migration 604 adds voice_captures.summary_bullets with a 5-8 bullet best-effort contract. The shared voice-capture-summary helper normalizes JSON/object/string output, strips list markers, dedupes, caps at 8, and returns null when fewer than five valid bullets are available. voice-capture and voice-capture-sync persist transcript/QRM state first, then call best-effort summary persistence that logs and returns null on summary failure or missing summary_bullets schema. VoiceCapturePage and VoiceHistoryPage render VoiceSummaryBullets above an expandable Full transcript/Transcript details block.'
  END,
  updated_at = now()
WHERE task_id = 'B2.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B2.2',
  'update',
  jsonb_build_object(
    'reason', 'b22_voice_summary_bullets_closeout',
    'migration', '727_b22_voice_summary_bullets_closeout.sql',
    'mission_alignment', 'pass: field voice capture now gives sales reps short, grounded AI takeaways while preserving the complete transcript, making customer memory faster to review without discarding source evidence',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/604_voice_captures_summary_bullets.sql adds voice_captures.summary_bullets text[] with a best-effort 5-8 bullet comment',
      'supabase/functions/_shared/voice-capture-summary.ts requires 5-8 bullets and returns null for invalid or undersized summaries',
      'supabase/functions/voice-capture/index.ts finalizes the capture record before best-effort summary persistence',
      'supabase/functions/voice-capture/index.ts logs summary generation errors and returns null instead of failing the capture',
      'supabase/functions/voice-capture-sync/index.ts retries loading without summary_bullets when the column is unavailable and uses best-effort summary persistence during sync',
      'apps/web/src/components/VoiceCapturePage.tsx renders VoiceSummaryBullets above expandable Full transcript details',
      'apps/web/src/components/VoiceHistoryPage.tsx renders summary bullets above an expandable Transcript block'
    ),
    'safety_bounds', jsonb_build_array(
      'summary generation is best-effort and never required for transcript persistence',
      'summary_bullets column absence is handled as a compatibility fallback',
      'full transcript remains available behind expandable details when bullets exist',
      'no OpenAI model, credential, route, or storage contract is changed in this closeout'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live OpenAI summary call was made for this roadmap closeout',
      'no live customer call recording was performed',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
