-- ============================================================================
-- Migration 702: A3.3 cash/finance/lease payment comparison closeout
--
-- Quote Builder now carries customer payment comparison toggles, APR source
-- attribution, payment-hero cards, and lease-safe public filtering across the
-- rep UI, saved payloads, PDFs, printable HTML, and public Deal Room payload.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/steps/FinancingStep.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M3 + §11.7') ||
      ' | apps/web/src/features/quote-builder/steps/FinancingStep.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/finance-apr-source.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-print-html.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-public-safety.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-api.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-public-safety.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.3 shipped: FinancingStep exposes a customer payment view toggle and side-by-side cash / finance / lease preview, with lease cards gated until the lease feature flag and seeded rate/residual data are present. finance-apr-source centralizes ADR-006 APR attribution, quote-api persists the comparison toggle and apr_source metadata, quote-proposal-data filters disabled lease options and selected-only comparison states, QuotePDFDocument and quote-print-html render the payment scenario section with the payment amount as the largest/boldest field, and quote-public-safety keeps public Deal Room finance scenarios customer-safe.'
  END,
  updated_at = now()
WHERE task_id = 'A3.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.3',
  'update',
  jsonb_build_object(
    'reason', 'a33_payment_hero_comparison_closeout',
    'migration', '709_a33_payment_hero_comparison_closeout.sql',
    'mission_alignment', 'pass: QEP sales reps can present cash, finance, and lease payment options as a clear customer decision surface while preserving APR provenance, TILA-aware copy, and public safety boundaries',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/steps/FinancingStep.tsx customer-finance-comparison-preview',
      'apps/web/src/features/quote-builder/lib/finance-apr-source.ts formatAprSourceAttribution',
      'apps/web/src/features/quote-builder/lib/quote-api.ts buildQuoteSavePayload financing_scenarios',
      'apps/web/src/features/quote-builder/lib/quote-api.ts buildPortalRevisionQuoteData lease filtering',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts buildFinancing',
      'apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx FinancingCard',
      'apps/web/src/features/quote-builder/lib/quote-print-html.ts buildFinanceGrid',
      'supabase/functions/quote-builder-v2/quote-public-safety.ts buildPublicDealRoomPayload',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-api.test.ts APR source and comparison persistence',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts comparison toggle and lease filtering',
      'supabase/functions/quote-builder-v2/quote-public-safety.test.ts public comparison safety'
    ),
    'safety_bounds', jsonb_build_array(
      'APR source appears for finance and lease scenarios with a subject-to-lender-approval fallback',
      'disabled lease scenarios are excluded from customer/public output unless lease quoting is enabled',
      'comparison toggle can collapse customer output to the selected scenario',
      'payment amount is emphasized as the hero field in rep preview, PDF, and printable HTML'
    ),
    'manual_boundaries', jsonb_build_array(
      'live lender approval',
      'external lease rate sheets',
      'OEM residual tables',
      'legal/accounting finance policy decisions'
    )
  ),
  'codex'
);

COMMIT;
