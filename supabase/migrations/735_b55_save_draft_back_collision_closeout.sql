-- ============================================================================
-- Migration 728: B5.5 Save Draft / back collision closeout
--
-- HF-4 is satisfied by the active Quote Builder mobile shell: Save Draft is a
-- persistent MobileStickyActionBar secondary action, while assistant + primary
-- forward action remain inline. The previous mobile Back button collision is
-- locked out by focused tests.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%735_b55_save_draft_back_collision_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-4') ||
      ' | apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuoteBuilderV2PageMobileShell.mobile.test.tsx' ||
      ' | apps/web/src/features/sales/components/MobileStickyActionBar.tsx' ||
      ' | apps/web/src/features/sales/components/MobileStickyActionBar.test.tsx' ||
      ' | supabase/migrations/735_b55_save_draft_back_collision_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.5 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.5 shipped: QuoteBuilderV2PageMobileShell replaces the old mobile footer collision pattern with MobileStickyActionBar. Save Draft is rendered as the persistent secondary action wired to onSaveDraft, disabled while the primary action is pending, and separated from the inline assistant + primary forward action group. The mobile shell test named "keeps Save Draft as persistent secondary action and removes back collision" proves Save Draft invokes onSaveDraft and that no mobile Back button is rendered in the sticky action area; adjacent tests prove the action group stays inline and Save Draft cannot fire while the primary action is pending.'
  END,
  updated_at = now()
WHERE task_id = 'B5.5';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.5',
  'update',
  jsonb_build_object(
    'reason', 'b55_save_draft_back_collision_closeout',
    'migration', '735_b55_save_draft_back_collision_closeout.sql',
    'mission_alignment', 'pass: mobile reps can preserve an in-progress equipment quote without accidentally navigating backward, reducing field data loss during sales and rental conversations',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/components/QuoteBuilderV2PageMobileShell.tsx renders data-testid quote-mobile-action-bar with MobileStickyActionBar',
      'QuoteBuilderV2PageMobileShell passes className bottom-[var(--sales-shell-bottom-offset)] and includeSafeAreaPadding=false so the action bar clears SalesShell bottom chrome',
      'QuoteBuilderV2PageMobileShell renders Save Draft as MobileStickyActionBar.secondary, wired to onSaveDraft and disabled by primaryActionPending',
      'QuoteBuilderV2PageMobileShell renders assistant plus primary forward action in quote-mobile-primary-actions with data-layout=inline',
      'QuoteBuilderV2PageMobileShell.mobile.test.tsx proves Save Draft is persistent, invokes onSaveDraft, and no Back button is rendered in the mobile action bar',
      'QuoteBuilderV2PageMobileShell.mobile.test.tsx proves the primary action group stays inline and Save Draft is disabled while the primary action is pending',
      'apps/web/src/features/sales/components/MobileStickyActionBar.tsx supports separate secondary and primary regions with a fixed bottom action bar above BottomTabBar'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter quote-builder runtime behavior',
      'this closeout does not change quote save semantics, quote financial totals, or approval routing',
      'this closeout does not add dependencies'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live mobile-device UAT was performed for this closeout',
      'credential-gated Playwright authenticated quote-builder mobile navigation was not rerun in this closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
