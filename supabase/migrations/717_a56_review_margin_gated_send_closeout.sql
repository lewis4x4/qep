-- ============================================================================
-- Migration 710: A5.6 review margin-gated send closeout
--
-- Quote Builder review is the authoritative customer-send gate: low-margin
-- quotes require a rep note before approval submission, packet readiness alone
-- cannot bypass approval canSend, and edge send/share paths use the configured
-- margin floor rather than a hardcoded threshold.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/lib/review-gates.ts%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-10') ||
      ' | apps/web/src/features/quote-builder/lib/review-gates.ts' ||
      ' | apps/web/src/features/quote-builder/steps/ReviewStep.tsx' ||
      ' | apps/web/src/features/quote-builder/hooks/useQuoteBuilderPrimaryAction.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/useQuoteBuilderV2Orchestrator.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-workspace.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-builder-approval-blocker.ts' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-financial-integrity-regression.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/review-gates.test.ts' ||
      ' | apps/web/src/features/quote-builder/hooks/__tests__/useQuoteBuilderPrimaryAction.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-workspace.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.6 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.6 shipped: ReviewStep computes the review send gate from active approval-case canSend plus packet send readiness, displays locked/unlocked Review status, and requires a rep submission note when the configured margin floor is resolved and manager approval is needed. review-gates fails closed while the margin-floor policy is unresolved and disables approval submission until the low-margin note is present. useQuoteBuilderPrimaryAction routes the global CTA back to Review whenever approval justification is required and now has a regression proving packet readiness alone cannot bypass approval canSend. quote-workspace uses the configured marginFloorPct to compute approvalState and packetReadiness, blocking below-floor sends until approved. quote-builder-v2 loadConfiguredMarginFloorPct reads qb_margin_thresholds, falls back to approval policy/default floor, and both assertQuoteCustomerShareable and send-package use that configured floor plus shared conditional-approval readiness before customer-facing delivery.'
  END,
  updated_at = now()
WHERE task_id = 'A5.6';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.6',
  'update',
  jsonb_build_object(
    'reason', 'a56_review_margin_gated_send_closeout',
    'migration', '717_a56_review_margin_gated_send_closeout.sql',
    'mission_alignment', 'pass: QEP quote review now enforces manager approval accountability before low-margin customer delivery, preserving equipment-sales gross margin discipline while still allowing approved exceptions to move quickly',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/lib/review-gates.ts computeReviewSendGate requires approvalCaseCanSend and packet readiness',
      'apps/web/src/features/quote-builder/lib/review-gates.ts computeReviewApprovalSubmissionState fails closed on unresolved margin floor',
      'apps/web/src/features/quote-builder/lib/review-gates.ts low-margin approval submission requires a non-empty note',
      'apps/web/src/features/quote-builder/steps/ReviewStep.tsx Review send gate card',
      'apps/web/src/features/quote-builder/steps/ReviewStep.tsx required low-margin submission note field',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderPrimaryAction.ts sticky primary CTA routes to Review when justification is required',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderV2Orchestrator.tsx requiresApprovalJustification uses unresolved policy or manager-approval state',
      'apps/web/src/features/quote-builder/lib/quote-workspace.ts configured margin floor drives approvalState and packetReadiness',
      'apps/web/src/features/quote-builder/lib/quote-builder-approval-blocker.ts customer-facing actions require canSend',
      'supabase/functions/quote-builder-v2/index.ts loadConfiguredMarginFloorPct',
      'supabase/functions/quote-builder-v2/index.ts assertQuoteCustomerShareable configured margin floor gate',
      'supabase/functions/quote-builder-v2/index.ts send-package configured margin floor gate',
      'supabase/functions/quote-builder-v2/index.ts assertApprovedWithConditionsSendReady shared conditional approval helper',
      'supabase/functions/quote-builder-v2/quote-financial-integrity-regression.test.ts customer share/send margin floor regression',
      'apps/web/src/features/quote-builder/hooks/__tests__/useQuoteBuilderPrimaryAction.test.ts packet readiness alone cannot bypass approval canSend'
    ),
    'safety_bounds', jsonb_build_array(
      'Review send readiness requires active approval-case canSend',
      'global primary CTA cannot submit approval while a low-margin justification is required',
      'margin-floor policy lookup fails closed before approval submission unlocks',
      'below-floor packet readiness remains blocked until quote status/approval satisfies the gate',
      'server customer share path uses the configured/default floor, not a hardcoded 10 percent value',
      'server send-package path uses the configured/default floor, not a hardcoded 10 percent value',
      'approved_with_conditions requires condition evaluation before share or send'
    ),
    'manual_boundaries', jsonb_build_array(
      'owner tuning of exact margin floor percentages remains an operations policy decision',
      'live manager approval UAT with real users remains manual evidence',
      'production notification delivery for approval routing remains outside local verification'
    )
  ),
  'codex'
);

COMMIT;
