-- ============================================================================
-- Migration 726: B5.3 voice-note dropdown contrast closeout
--
-- HF-2 is satisfied on the active voice-note customer attach surface. The old
-- VoiceNoteCapture.tsx doc path is no longer present in app source; the current
-- SmartVoiceCapture review flow renders CustomerPickerInline, whose input and
-- list options use design-token foreground/background, hover, and focus states.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%733_b53_voice_note_dropdown_contrast_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-2') ||
      ' | apps/web/src/features/sales/components/CustomerPickerInline.tsx' ||
      ' | apps/web/src/features/sales/components/SmartVoiceCapture.tsx' ||
      ' | apps/web/src/features/sales/components/SmartVoiceCapture.customer-picker.test.tsx' ||
      ' | supabase/migrations/733_b53_voice_note_dropdown_contrast_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.3 shipped: the active voice-note customer attach dropdown is CustomerPickerInline inside SmartVoiceCapture, not the retired VoiceNoteCapture.tsx doc path. CustomerPickerInline uses design-token classes for the input and customer list option states: border-input, bg-background, text-foreground, placeholder:text-muted-foreground, focus-visible:ring-ring/40, hover:bg-accent, hover:text-accent-foreground, focus-visible:bg-accent, and focus-visible:text-accent-foreground. SmartVoiceCapture.customer-picker.test.tsx locks those contrast classes so future dropdown edits cannot regress into hard-coded white-on-white or untokened hover/focus states.'
  END,
  updated_at = now()
WHERE task_id = 'B5.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.3',
  'update',
  jsonb_build_object(
    'reason', 'b53_voice_note_dropdown_contrast_closeout',
    'migration', '733_b53_voice_note_dropdown_contrast_closeout.sql',
    'mission_alignment', 'pass: field reps using voice capture can read and tap customer attach options reliably across light and dark themed workspaces, preserving the sales and equipment account memory that QEP depends on',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/sales/components/SmartVoiceCapture.tsx imports CustomerPickerInline and renders it in the captured voice-note customer review block',
      'apps/web/src/features/sales/components/CustomerPickerInline.tsx input uses border-input, bg-background, text-foreground, placeholder:text-muted-foreground, and focus-visible:ring-ring/40',
      'apps/web/src/features/sales/components/CustomerPickerInline.tsx customer option buttons use text-foreground, hover:bg-accent, hover:text-accent-foreground, focus-visible:bg-accent, and focus-visible:text-accent-foreground',
      'apps/web/src/features/sales/components/SmartVoiceCapture.customer-picker.test.tsx includes a token-based contrast test for picker input and option states',
      'repository search shows the old VoiceNoteCapture.tsx references remain documentation-only; the active app source uses SmartVoiceCapture plus CustomerPickerInline for this dropdown'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter customer picker runtime behavior',
      'this closeout does not add dependencies or widen customer data access',
      'this closeout does not reintroduce the retired VoiceNoteCapture.tsx path'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live mobile-device UAT was performed for this closeout',
      'no external customer list, portal credential source, or OEM file was used',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
