-- ============================================================================
-- Migration 709: A5.5 expiration and follow-up defaults closeout
--
-- Quote Builder now centralizes the 30-day expiration and 3-day follow-up
-- defaults, applies them once in the wizard, and blocks customer-facing send
-- when follow-up is missing or scheduled after expiration.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-9') ||
      ' | apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/useQuoteBuilderDetailsDefaults.ts' ||
      ' | apps/web/src/features/quote-builder/steps/DetailsStep.tsx' ||
      ' | apps/web/src/features/quote-builder/steps/SendStep.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-workspace.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/__tests__/useQuoteBuilderDetailsDefaults.test.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-lifecycle-policy.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-workspace.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.5 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.5 shipped: quote-lifecycle-policy centralizes QUOTE_EXPIRATION_DEFAULT_DAYS = 30 and QUOTE_FOLLOW_UP_DEFAULT_DAYS = 3, builds default ISO dates from the current date, and exposes the follow-up-after-expiration guard plus warning copy. useQuoteBuilderDetailsDefaults applies those defaults only when the details or send wizard step opens and preserves rep-edited dates. DetailsStep displays the 30-day expiration and 3-day follow-up defaults beside the editable fields, while SendStep marks follow-up readiness false when no follow-up exists or the selected follow-up is after expiration. quote-workspace blocks customer-facing email/text send with "follow-up date" or "follow-up before expiration", and quote-api persists expires_at/follow_up_at in the quote package save payload and passes follow_up_at through send-package. Focused tests cover the central constants, seeded defaults, preservation of user-edited dates, and customer-facing send readiness guard.'
  END,
  updated_at = now()
WHERE task_id = 'A5.5';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.5',
  'update',
  jsonb_build_object(
    'reason', 'a55_expiration_followup_defaults_closeout',
    'migration', '709_a55_expiration_followup_defaults_closeout.sql',
    'mission_alignment', 'pass: QEP sales reps get consistent quote validity and follow-up timing defaults, improving customer quote discipline while keeping customer-facing sends gated by real follow-up accountability',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts QUOTE_EXPIRATION_DEFAULT_DAYS = 30',
      'apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts QUOTE_FOLLOW_UP_DEFAULT_DAYS = 3',
      'apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts buildQuoteLifecycleDefaultDates',
      'apps/web/src/features/quote-builder/lib/quote-lifecycle-policy.ts isQuoteFollowUpAfterExpiration',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderDetailsDefaults.ts details/send default seeding',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderDetailsDefaults.ts preserves existing expiresAt and followUpAt',
      'apps/web/src/features/quote-builder/steps/DetailsStep.tsx default helper copy and warning display',
      'apps/web/src/features/quote-builder/steps/SendStep.tsx follow-up readiness and warning display',
      'apps/web/src/features/quote-builder/lib/quote-workspace.ts email/text readiness guard',
      'apps/web/src/features/quote-builder/lib/quote-api.ts expires_at and follow_up_at persistence',
      'apps/web/src/features/quote-builder/hooks/__tests__/useQuoteBuilderDetailsDefaults.test.tsx seeded-default regression',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-lifecycle-policy.test.ts lifecycle policy regression',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-workspace.test.ts send readiness regression'
    ),
    'safety_bounds', jsonb_build_array(
      'default expiration is 30 days from the seeding moment',
      'default follow-up reminder is 3 days from the seeding moment',
      'defaults are seeded only in details/send wizard steps',
      'rep-edited expiration and follow-up dates are not overwritten',
      'customer-facing email/text send remains blocked without follow-up',
      'customer-facing email/text send remains blocked when follow-up is after expiration'
    ),
    'manual_boundaries', jsonb_build_array(
      'production follow-up delivery monitoring remains outside local code verification',
      'customer-specific override policy for non-standard expiration windows remains an operations decision',
      'live rep UAT for follow-up cadence wording remains manual evidence'
    )
  ),
  'codex'
);

COMMIT;
