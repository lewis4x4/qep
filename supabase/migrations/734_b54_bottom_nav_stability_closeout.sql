-- ============================================================================
-- Migration 727: B5.4 bottom nav stability closeout
--
-- HF-3 is satisfied by the active SalesShell/BottomTabBar contract: SalesShell
-- owns vertical scrolling inside a locked 100dvh viewport, BottomTabBar reserves
-- one safe-area-aware 64px bottom offset, and mobile sticky actions clear that
-- offset instead of competing with the nav.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%734_b54_bottom_nav_stability_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-3') ||
      ' | docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md' ||
      ' | apps/web/src/index.css' ||
      ' | apps/web/src/features/sales/SalesShell.tsx' ||
      ' | apps/web/src/features/sales/SalesShell.test.tsx' ||
      ' | apps/web/src/features/sales/components/BottomTabBar.tsx' ||
      ' | apps/web/src/features/sales/components/BottomTabBar.test.tsx' ||
      ' | apps/web/src/features/sales/components/MobileStickyActionBar.tsx' ||
      ' | apps/web/src/features/sales/components/MobileStickyActionBar.test.tsx' ||
      ' | supabase/migrations/734_b54_bottom_nav_stability_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.4 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.4 shipped: SalesShell uses h-[100dvh] plus overflow-hidden and delegates page scrolling to the main sales-shell-scroll-root with data-scroll-owner=sales-shell and paddingBottom var(--sales-shell-bottom-scroll-padding). BottomTabBar exposes a fixed data-bottom-tab-height=64, reserves exactly one safe-area inset through var(--sales-shell-bottom-offset), and stretches every link to a 44px-plus touch target. MobileStickyActionBar clears the bottom nav with bottom-16 by default and Quote Builder can opt into bottom-[var(--sales-shell-bottom-offset)] when hosted inside SalesShell. Existing unit tests lock the shell, nav, safe-area, token, and sticky-action contracts; the 2026-05-21 handoff records prior B5.4 commit 1f23f94b and PASS gate test-results/agent-gates/20260520T232610Z-B5.4-hf-3-bottom-nav-stability.json.'
  END,
  updated_at = now()
WHERE task_id = 'B5.4';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.4',
  'update',
  jsonb_build_object(
    'reason', 'b54_bottom_nav_stability_closeout',
    'migration', '734_b54_bottom_nav_stability_closeout.sql',
    'mission_alignment', 'pass: mobile sales reps keep stable access to Today, Pipeline, Capture, Quote, and Customers while scrolling long field workflows, preserving field execution speed for equipment, sales, and rental operations',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/sales/SalesShell.tsx locks the sales viewport at h-[100dvh] with overflow-hidden and assigns scrolling to sales-shell-scroll-root',
      'apps/web/src/features/sales/SalesShell.tsx gives the scroll root data-scroll-owner=sales-shell and paddingBottom var(--sales-shell-bottom-scroll-padding)',
      'apps/web/src/index.css defines --sales-shell-bottom-tab-height: 64px, --sales-shell-safe-area-bottom, --sales-shell-bottom-offset, and --sales-shell-bottom-scroll-padding',
      'apps/web/src/features/sales/components/BottomTabBar.tsx exports SALES_BOTTOM_TAB_BAR_HEIGHT from MOBILE.bottomTabBarHeight and writes data-bottom-tab-height plus data-safe-area-contract hooks',
      'apps/web/src/features/sales/components/BottomTabBar.tsx applies height var(--sales-shell-bottom-offset) and paddingBottom var(--sales-shell-safe-area-bottom), so safe area is reserved once',
      'apps/web/src/features/sales/components/BottomTabBar.test.tsx proves nav-link semantics, 64px height, 44px-plus touch targets, and the once-only safe-area contract',
      'apps/web/src/features/sales/components/MobileStickyActionBar.tsx sits at bottom-16 by default so page actions clear the 64px BottomTabBar',
      'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx uses bottom-[var(--sales-shell-bottom-offset)] with includeSafeAreaPadding=false when hosted inside SalesShell',
      'docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md records B5.4 as shipped with commit 1f23f94b and PASS gate artifact 20260520T232610Z-B5.4-hf-3-bottom-nav-stability.json'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter runtime navigation, routing, or quote-builder behavior',
      'this closeout does not add dependencies',
      'this closeout preserves link semantics for bottom navigation instead of tablist semantics'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live mobile-device UAT was performed for this closeout',
      'credential-gated Playwright authenticated rep navigation was not rerun in this closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
