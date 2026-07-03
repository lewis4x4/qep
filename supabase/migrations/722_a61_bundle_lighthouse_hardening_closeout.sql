-- ============================================================================
-- Migration 715: A6.1 bundle size and Lighthouse hardening closeout
--
-- Bundle-size control and mobile Lighthouse coverage are now represented by
-- runnable scripts, CI workflow wiring, mobile LHCI assertions, manual chunking,
-- authenticated audit setup, and explicit guest fallback behavior.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%722_a61_bundle_lighthouse_hardening_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'IRON_WIZARD_DECOMPOSITION_PLAN §7') ||
      ' | package.json' ||
      ' | apps/web/package.json' ||
      ' | apps/web/bundle-size-limits.json' ||
      ' | scripts/check-web-bundle-size.mjs' ||
      ' | apps/web/vite.config.ts' ||
      ' | apps/web/.lighthouserc.cjs' ||
      ' | apps/web/scripts/lighthouse-auth-setup.mjs' ||
      ' | apps/web/scripts/lighthouse-puppeteer-auth.cjs' ||
      ' | .github/workflows/ci.yml' ||
      ' | .github/workflows/lighthouse-mobile.yml' ||
      ' | supabase/migrations/722_a61_bundle_lighthouse_hardening_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A6.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A6.1 shipped: bundle-size hardening is covered by the root and app bundle:check scripts, apps/web/bundle-size-limits.json caps the initial index bundle at baseline plus 10%, and .github/workflows/ci.yml runs the guard after the production build. apps/web/vite.config.ts preserves manual chunks for react-query, Supabase, Radix/Lucide UI, markdown, and maplibre while keeping maplibre and react-pdf out of the initial page weight. Lighthouse hardening is covered by apps/web/.lighthouserc.cjs, which audits eight sales-rep routes in mobile emulation, sets CLS as an error gate, tracks performance/FCP/LCP/TBT/accessibility/best-practices as warnings, uses authenticated storage-state when credentials exist, and keeps a guest fallback for fork PRs. .github/workflows/lighthouse-mobile.yml waits for Netlify deploy previews, installs Playwright Chromium for LHCI, captures verified authenticated /sales/today state when secrets exist, and otherwise emits an explicit guest-only warning.'
  END,
  updated_at = now()
WHERE task_id = 'A6.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A6.1',
  'update',
  jsonb_build_object(
    'reason', 'a61_bundle_lighthouse_hardening_closeout',
    'migration', '722_a61_bundle_lighthouse_hardening_closeout.sql',
    'mission_alignment', 'pass: sales and quote teams get a protected mobile web surface where initial bundle growth, route reachability, mobile CLS, and Lighthouse regressions are continuously visible before equipment quote workflows degrade',
    'implementation_evidence', jsonb_build_array(
      'package.json root bundle:check script',
      'apps/web/package.json bundle:check and lighthouse mobile scripts',
      'apps/web/bundle-size-limits.json baseline-plus-10-percent initial index budget',
      'scripts/check-web-bundle-size.mjs production dist index-entry guard',
      'apps/web/vite.config.ts manual chunks for vendor-react-query, vendor-supabase, vendor-ui, vendor-markdown, and vendor-maplibre',
      'apps/web/vite.config.ts maplibre and react-pdf excluded from initial page weight through route/dynamic splitting',
      'apps/web/.lighthouserc.cjs eight mobile sales-rep route audits',
      'apps/web/.lighthouserc.cjs mobile 390x844 emulation and CLS error gate',
      'apps/web/scripts/lighthouse-auth-setup.mjs verified authenticated /sales/today storage-state capture',
      'apps/web/scripts/lighthouse-puppeteer-auth.cjs LHCI storage-state restore hook',
      '.github/workflows/ci.yml production build followed by Web bundle size guard',
      '.github/workflows/lighthouse-mobile.yml deploy-preview wait, authenticated run, and guest fallback'
    ),
    'safety_bounds', jsonb_build_array(
      'bundle guard measures the built index entry files after production build',
      'large maplibre and react-pdf bundles stay outside the initial bundle path',
      'authenticated Lighthouse requires a verified /sales/today canary before storage state is reused',
      'fork PRs without secrets still run guest Lighthouse and emit an explicit warning instead of silently skipping coverage'
    ),
    'manual_boundaries', jsonb_build_array(
      'live Lighthouse scores still depend on the target deploy preview or staging URL being reachable',
      'authenticated SalesShell audits require PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD secrets',
      'performance and accessibility are tracked as warnings until a live score-ratchet pass approves stricter gates'
    )
  ),
  'codex'
);

COMMIT;
