-- ============================================================================
-- Migration 703: A3.4 trade market context closeout
--
-- Trade-in comp ranges and credit-basis context now live on rep-facing Deal IQ
-- and QRM trade walkaround surfaces. Customer proposal output receives only
-- sanitized trade allowance evidence and explicitly filters internal comp text.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/qrm/components/TradeMarketContextCard.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M4 amended by §11.4') ||
      ' | apps/web/src/features/qrm/lib/trade-market-context.ts' ||
      ' | apps/web/src/features/qrm/components/TradeMarketContextCard.tsx' ||
      ' | apps/web/src/features/qrm/pages/TradeWalkaroundPage.tsx' ||
      ' | apps/web/src/features/quote-builder/components/DealCoachSidebar.tsx' ||
      ' | apps/web/src/features/quote-builder/hooks/useQuoteBuilderV2Orchestrator.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/point-shoot-trade-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/trade-valuation-range.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/point-shoot-trade-api.test.ts' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageShell.trade-props.test.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageMobileShell.mobile.test.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.4 shipped: trade-market-context builds comp-range, confidence, source, and credit-basis summaries from durable trade valuation snapshots. DealCoachSidebar renders TradeMarketContextCard as a rep-facing-only panel, and TradeWalkaroundPage renders the same context as internal comparable market context. Point-Shoot Trade persists trade_valuations rows/photos and normalizes durable snapshots for proposal enrichment. Customer proposal output receives only sanitized trade allowance media, hours, condition, and safe evidence text; tests prove Deal IQ, margin/economics, comp range, preliminary value, market midpoint, and internal trade valuation prose do not leak into customer PDF/print data.'
  END,
  updated_at = now()
WHERE task_id = 'A3.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.4',
  'update',
  jsonb_build_object(
    'reason', 'a34_trade_market_context_closeout',
    'migration', '703_a34_trade_market_context_closeout.sql',
    'mission_alignment', 'pass: QEP reps get defensible trade-in market context and source provenance inside the sales workflow while customer artifacts stay clean, contractual, and free of internal valuation strategy',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/qrm/lib/trade-market-context.ts inferTradeRangeSummary',
      'apps/web/src/features/qrm/lib/trade-market-context.ts describeTradeCreditBasis',
      'apps/web/src/features/qrm/components/TradeMarketContextCard.tsx Rep-facing only',
      'apps/web/src/features/qrm/pages/TradeWalkaroundPage.tsx Internal comparable market context',
      'apps/web/src/features/quote-builder/components/DealCoachSidebar.tsx TradeMarketContextCard',
      'apps/web/src/features/quote-builder/hooks/useQuoteBuilderV2Orchestrator.tsx tradeMarketContext',
      'apps/web/src/features/quote-builder/lib/point-shoot-trade-api.ts normalizeTradeValuationProposalSnapshot',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts buildTradeAllowanceLine',
      'apps/web/src/features/quote-builder/lib/__tests__/trade-valuation-range.test.ts comp range and credit-basis tests',
      'apps/web/src/features/quote-builder/lib/__tests__/point-shoot-trade-api.test.ts durable trade valuation snapshot tests',
      'apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageShell.trade-props.test.tsx desktop prop threading',
      'apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageMobileShell.mobile.test.tsx mobile prop threading',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts customer trade-in leak guards'
    ),
    'safety_bounds', jsonb_build_array(
      'TradeMarketContextCard is explicitly labeled rep-facing only',
      'customer proposal data strips Deal IQ and internal economics',
      'customer trade allowance line excludes preliminary value, market midpoint, and comp-range prose',
      'unsafe trade photo URLs are rejected before PDF/print rendering'
    ),
    'manual_boundaries', jsonb_build_array(
      'live auction/provider feed contracts',
      'external appraiser signoff',
      'final manager approval of over-allowance decisions'
    )
  ),
  'codex'
);

COMMIT;
