-- ============================================================================
-- Migration 705: A3.6 Deal IQ sidebar closeout
--
-- Deal IQ is now a rep/internal-only Deal Coach panel with margin economics,
-- win-probability, commission-readiness status, and governance risk flags.
-- Customer proposal/PDF projections explicitly strip Deal IQ internals.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/components/DealIQSummaryCard.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M6') ||
      ' | apps/web/src/features/quote-builder/lib/deal-iq.ts' ||
      ' | apps/web/src/features/quote-builder/components/DealIQSummaryCard.tsx' ||
      ' | apps/web/src/features/quote-builder/components/DealCoachSidebar.tsx' ||
      ' | apps/web/src/features/quote-builder/components/QuoteBuilderV2PageShell.tsx' ||
      ' | apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/deal-iq.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageShell.trade-props.test.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageMobileShell.mobile.test.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.6 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.6 shipped: computeDealIqSummary produces the rep/internal Deal IQ economics snapshot for margin %, margin $, win-probability score/band/headline, commission-readiness status, and flagged governance risks for margin below floor, trade credit above max, and discount above cap. DealCoachSidebar loads approval-policy caps, falls back to the default margin floor when caps are unavailable, computes Deal IQ from the current quote draft, and renders DealIQSummaryCard in both desktop and mobile Quote Builder shells. DealIQSummaryCard labels the surface Internal only and describes the commission state as status-only until a real commission-dollar plan feed exists. Customer proposal, printable HTML, and PDF data strip Deal IQ, win probability, commission, margin, dealer cost, approval-policy, trade-cap, and discount-cap prose before rendering.'
  END,
  updated_at = now()
WHERE task_id = 'A3.6';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.6',
  'update',
  jsonb_build_object(
    'reason', 'a36_deal_iq_sidebar_closeout',
    'migration', '712_a36_deal_iq_sidebar_closeout.sql',
    'mission_alignment', 'pass: QEP reps get a governed internal economics cockpit inside quote creation while customers receive only clean proposal artifacts, enabling sharper sales decisions without leaking margin strategy',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/lib/deal-iq.ts computeDealIqSummary',
      'apps/web/src/features/quote-builder/lib/deal-iq.ts margin_below_floor risk',
      'apps/web/src/features/quote-builder/lib/deal-iq.ts trade_above_max risk',
      'apps/web/src/features/quote-builder/lib/deal-iq.ts discount_above_cap risk',
      'apps/web/src/features/quote-builder/lib/deal-iq.ts win probability summary',
      'apps/web/src/features/quote-builder/lib/deal-iq.ts commission readiness status',
      'apps/web/src/features/quote-builder/components/DealIQSummaryCard.tsx Internal only badge',
      'apps/web/src/features/quote-builder/components/DealCoachSidebar.tsx approval-policy cap loading',
      'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageShell.tsx desktop DealCoachSidebar',
      'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageShell.tsx MobileIntelligencePanelHost Deal Coach panel',
      'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx mobile Deal Coach sheet',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts FORBIDDEN_CUSTOMER_INTERNAL_ECONOMICS_PROSE',
      'apps/web/src/features/quote-builder/lib/__tests__/deal-iq.test.ts Deal IQ governance and commission status tests',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts customer artifact leak guard'
    ),
    'safety_bounds', jsonb_build_array(
      'Deal IQ card is explicitly labeled Internal only',
      'approval-policy caps are used when available and fall back without blocking quote work',
      'commission is status-only until a signed commission-dollar plan feed exists',
      'customer proposal/PDF/print projections filter Deal IQ, win probability, commission, margin, dealer cost, approval policy, trade cap, and discount cap prose'
    ),
    'manual_boundaries', jsonb_build_array(
      'QA-R2 commission-dollar rule signoff and final payout formula',
      'manager/accounting approval of commission plan policy',
      'production validation that internal-only Quote Builder surfaces are role-scoped as intended'
    )
  ),
  'codex'
);

COMMIT;
