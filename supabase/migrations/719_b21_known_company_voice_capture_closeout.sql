-- ============================================================================
-- Migration 719: B2.1 known-company voice capture closeout
--
-- VC-1 is satisfied by the existing VoiceQRM known-customer launch path:
-- customer/account surfaces pass linked_company_id, the edge function verifies
-- caller access through the user-scoped client, and company resolution forces
-- that company instead of fuzzy matching or creating a new account.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%719_b21_known_company_voice_capture_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md VC-1') ||
      ' | apps/web/src/features/voice-qrm/pages/VoiceQrmPage.tsx' ||
      ' | apps/web/src/features/voice-qrm/lib/voice-qrm-api.ts' ||
      ' | supabase/functions/voice-to-qrm/company-resolution.ts' ||
      ' | supabase/functions/voice-to-qrm/vc1-company-linking.ts' ||
      ' | supabase/functions/voice-to-qrm/index.ts' ||
      ' | supabase/migrations/719_b21_known_company_voice_capture_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B2.1 shipped: VoiceQrmPage reads linked_company_id from the route query string and passes it to submitVoiceToQrm. buildVoiceQrmFormData appends linked_company_id, and voice-to-qrm reads that form field, verifies it with assertCallerCanAccessLinkedCompany using the caller-scoped Supabase client, and then resolveVoiceToQrmCompanyDecision forces that company with exact confidence while disabling fuzzy matching and auto-create. The persisted voice_captures row keeps linked_company_id/link fields and the timeline activity is attached directly to company_id for known-customer recordings.'
  END,
  updated_at = now()
WHERE task_id = 'B2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B2.1',
  'update',
  jsonb_build_object(
    'reason', 'b21_known_company_voice_capture_closeout',
    'migration', '719_b21_known_company_voice_capture_closeout.sql',
    'mission_alignment', 'pass: sales reps can record from a known customer/account context and have the AI capture attach to the correct QRM customer timeline deterministically, reducing duplicate accounts and preserving field-call memory for future advisors',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/qrm/lib/account-detail-menu.ts links Record voice note to /voice-qrm?linked_company_id=...',
      'apps/web/src/features/qrm/pages/QrmCompanyDetailPage.tsx exposes the same linked_company_id launch path',
      'apps/web/src/features/voice-qrm/pages/VoiceQrmPage.tsx reads linked_company_id from search params and passes it to submitVoiceToQrm',
      'apps/web/src/features/voice-qrm/lib/voice-qrm-api.ts appends linked_company_id to multipart FormData',
      'supabase/functions/voice-to-qrm/index.ts reads linked_company_id from formData and verifies access before entity resolution',
      'supabase/functions/voice-to-qrm/company-resolution.ts forces authorizedLinkedCompanyId and sets shouldFuzzyMatch=false and shouldCreateCompany=false',
      'supabase/functions/voice-to-qrm/vc1-company-linking.ts persists linked_company_id and inserts known-company timeline activity'
    ),
    'safety_bounds', jsonb_build_array(
      'known-company access is checked through the caller-scoped Supabase client, not a service-role-only lookup',
      'without linked_company_id the existing fuzzy/create path remains available',
      'no route names, table schemas, storage buckets, or provider secrets change in this closeout'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live customer call recording was performed',
      'no Omi wearable bridge, live-call provider, or external recording credential is required for VC-1',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
