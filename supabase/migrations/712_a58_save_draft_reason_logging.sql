-- ============================================================================
-- Migration 712: A5.8 save-draft reason logging closeout
--
-- QB-12 is implemented by manual low-margin Save Draft flow semantics:
-- autosave pauses when the draft is below the configured margin floor, manual
-- Save Draft captures a rep reason in qb_margin_exceptions, and the saved quote
-- package gets the additive draft_low_margin status until manager approval or a
-- healthy revision advances the lifecycle.
-- ============================================================================

BEGIN;

ALTER TABLE public.quote_packages
  DROP CONSTRAINT IF EXISTS quote_packages_status_check;

ALTER TABLE public.quote_packages
  ADD CONSTRAINT quote_packages_status_check
  CHECK (status IN (
    'draft',
    'draft_low_margin',
    'pending_approval',
    'approved',
    'approved_with_conditions',
    'changes_requested',
    'ready',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired',
    'converted_to_deal',
    'archived'
  ));

COMMENT ON CONSTRAINT quote_packages_status_check ON public.quote_packages IS
  'Covers the full quote lifecycle including draft_low_margin, the additive QB-12 status for manual low-margin Save Draft reason capture before manager approval.';

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%712_a58_save_draft_reason_logging.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-12') ||
      ' | supabase/migrations/712_a58_save_draft_reason_logging.sql' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/useQuoteBuilderSave.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/useDraftAutosave.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/local-draft.ts' ||
      ' | apps/web/src/features/quote-builder/lib/saved-quote-draft.ts' ||
      ' | apps/web/src/features/quote-builder/pages/QuoteListPage.tsx' ||
      ' | scripts/verify/quote-status-constraint-smoke.mjs' ||
      ' | supabase/functions/quote-builder-v2/quote-draft-low-margin-static.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.8 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.8 shipped: low-margin quote drafts now use additive draft_low_margin status semantics. useDraftAutosave keeps below-floor drafts local/autosave-paused until the rep taps Save Draft. useQuoteBuilderSave opens the margin reason gate for manual Save Draft, saves the quote, and records the rep reason to qb_margin_exceptions. quote-builder-v2 independently resolves configured margin floor during POST /save and writes draft_low_margin only for manual saves whose persisted margin is below floor; autosave saves remain ordinary draft. Customer-facing PDF/share/send gates treat draft_low_margin as blocked, while quote-list, saved/local draft hydration, and shared contracts recognize the status as editable draft inventory.'
  END,
  updated_at = now()
WHERE task_id = 'A5.8';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.8',
  'update',
  jsonb_build_object(
    'reason', 'a58_save_draft_reason_logging',
    'migration', '712_a58_save_draft_reason_logging.sql',
    'mission_alignment', 'pass: reps can preserve low-margin equipment quotes with an explicit reason while owners and managers retain a visible approval-controlled status that cannot leak to customers before review',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/712_a58_save_draft_reason_logging.sql widens quote_packages_status_check for draft_low_margin',
      'supabase/functions/quote-builder-v2/index.ts resolveDraftStatusAfterSave derives draft_low_margin from manual save mode plus configured margin floor',
      'supabase/functions/quote-builder-v2/index.ts CUSTOMER_BLOCKED_QUOTE_STATUSES blocks draft_low_margin from share, PDF upload, and send paths',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderSave.ts low-margin manual Save Draft reason gate and margin exception audit',
      'apps/web/src/features/quote-builder/hooks/useDraftAutosave.ts low_margin_reason_required pauses autosave to local state',
      'apps/web/src/features/quote-builder/lib/quote-api.ts status allowlist includes draft_low_margin',
      'apps/web/src/features/quote-builder/lib/local-draft.ts and saved-quote-draft.ts hydrate draft_low_margin safely',
      'apps/web/src/features/quote-builder/pages/QuoteListPage.tsx labels draft_low_margin as low-margin draft and keeps it in the draft/pipeline bucket',
      'scripts/verify/quote-status-constraint-smoke.mjs verifies draft_low_margin across app, server, and schema status surfaces'
    ),
    'safety_bounds', jsonb_build_array(
      'server derives low-margin status from persisted financial metrics and configured floor rather than trusting a client status field',
      'draft_low_margin is additive and remains blocked from public read, PDF upload, and send paths',
      'autosave does not silently create draft_low_margin status',
      'existing approval, approved-with-conditions, sent, accepted, and terminal statuses are preserved unless quote edits invalidate them'
    ),
    'manual_boundaries', jsonb_build_array(
      'live manager coaching on acceptable low-margin reasons remains an operating-process decision',
      'configured margin floor policy values remain owner/manager controlled',
      'production audit volume depends on real quote-builder low-margin save usage'
    )
  ),
  'codex'
);

COMMIT;
