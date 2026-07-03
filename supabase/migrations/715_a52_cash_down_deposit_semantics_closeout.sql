-- ============================================================================
-- Migration 708: A5.2 cash down vs deposit semantics closeout
--
-- Quote Builder now treats cash down as a financed-balance reduction and
-- good-faith deposit as a separate hold/payment handoff amount.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/steps/DetailsStep.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-6') ||
      ' | supabase/migrations/359_quote_builder_commercial_terms.sql' ||
      ' | supabase/migrations/542_qrm_quote_wizard_foundation.sql' ||
      ' | apps/web/src/features/quote-builder/steps/DetailsStep.tsx' ||
      ' | apps/web/src/features/quote-builder/steps/FinancingStep.tsx' ||
      ' | apps/web/src/features/quote-builder/components/PricingAdderBuckets.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-workspace.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/local-draft.ts' ||
      ' | apps/web/src/features/quote-builder/lib/saved-quote-draft.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-print-html.ts' ||
      ' | apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/PricingAdderBuckets.test.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/local-draft.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/saved-quote-draft.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-workspace.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.2 shipped: quote_packages.cash_down is the customer cash down applied before amount financed is computed, while quote_packages.deposit_required_amount is the separate good-faith deposit/hold amount. DetailsStep labels the deposit field "Good-faith deposit (holds unit)" and states it is separate from cash down and does not reduce amount financed. FinancingStep labels cash down as reducing financed balance, computes amount financed from customer total minus cash down, and states good-faith deposits are tracked separately in Quote details. PricingAdderBuckets no longer tells reps to use miscellaneous pricing lines for down payment received; the helper copy now says cash down and deposits have dedicated fields. quote-workspace computes cashDown and amountFinanced separately; quote-api persists cash_down and deposit_required_amount separately. local-draft and saved-quote-draft hydrate legacy cash/down-payment aliases into cashDown and legacy deposit aliases into depositRequiredAmount. quote-proposal-data, quote-print-html, and QuotePDFDocument render "Cash down applied" separately from "Good-faith deposit required" and tests guard against the old "Cash down / deposit credit" copy.'
  END,
  updated_at = now()
WHERE task_id = 'A5.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.2',
  'update',
  jsonb_build_object(
    'reason', 'a52_cash_down_deposit_semantics_closeout',
    'migration', '715_a52_cash_down_deposit_semantics_closeout.sql',
    'mission_alignment', 'pass: QEP quote reps and customers see distinct financing and deposit concepts, reducing accounting confusion while preserving clear equipment sales handoff evidence',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/359_quote_builder_commercial_terms.sql quote_packages.cash_down comment',
      'supabase/migrations/542_qrm_quote_wizard_foundation.sql quote_packages.deposit_required_amount',
      'apps/web/src/features/quote-builder/steps/DetailsStep.tsx Good-faith deposit (holds unit) field',
      'apps/web/src/features/quote-builder/steps/DetailsStep.tsx separate from cash down helper copy',
      'apps/web/src/features/quote-builder/steps/FinancingStep.tsx Cash down (reduces financed balance)',
      'apps/web/src/features/quote-builder/steps/FinancingStep.tsx good-faith deposits tracked separately in Quote details',
      'apps/web/src/features/quote-builder/components/PricingAdderBuckets.tsx dedicated fields helper copy',
      'apps/web/src/features/quote-builder/lib/quote-workspace.ts amount financed = customer total - cash down',
      'apps/web/src/features/quote-builder/lib/quote-api.ts cash_down and deposit_required_amount persistence',
      'apps/web/src/features/quote-builder/lib/local-draft.ts legacy alias normalization',
      'apps/web/src/features/quote-builder/lib/saved-quote-draft.ts saved quote alias normalization',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts cashDown and depositRequiredAmount projection',
      'apps/web/src/features/quote-builder/lib/quote-print-html.ts Cash down applied proposal copy',
      'apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx Good-faith deposit required proposal copy',
      'apps/web/src/features/quote-builder/components/__tests__/PricingAdderBuckets.test.tsx misc helper alias guard',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts proposal copy guard'
    ),
    'safety_bounds', jsonb_build_array(
      'cash down reduces amount financed only',
      'good-faith deposit does not reduce amount financed in Quote Builder math',
      'legacy down_payment aliases hydrate to cashDown',
      'legacy deposit aliases hydrate to depositRequiredAmount',
      'customer proposal output avoids Cash down / deposit credit wording',
      'miscellaneous pricing lines no longer instruct reps to enter down payment received'
    ),
    'manual_boundaries', jsonb_build_array(
      'A5.3 SOP deposit recommendation and canonical tier policy remain blocked on owner approval',
      'production accounting policy for whether paid deposits later apply to invoices remains outside Quote Builder estimate math',
      'live finance/accounting UAT for downstream deposit collection and reconciliation'
    )
  ),
  'codex'
);

COMMIT;
