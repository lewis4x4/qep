# WAVE — Quote Builder CI / Quality Hardening

**Target orchestrator:** RepoPrompt (multi-model fan-out, strangler-fig per slice)
**Repository:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
**Remote:** `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md` (closed 2026-05-17)

**Scope owner:** Brian Lewis (Speedy)
**Operating mode:** Autonomous per CLAUDE.md. Strangler-fig: extract → verify → push → continue.

---

## Mission Lock

Every slice must pass:

1. **Mission Fit** — protects the mobile-first sales-rep experience from quality regression
2. **Transformation** — quality gates run in CI without slowing rep iteration
3. **Pressure Test** — gates actually fail builds when thresholds breach (not advisory-only)
4. **Operator Utility** — restored bun test confidence; sub-100% pass-rate has been the norm because of infra noise, not real bugs

---

## Context

Three consecutive WAVES landed the mobile sales-rep experience. The shipped UX is good. The quality scaffolding around it is thin:

| Gap | Source | This wave |
|---|---|---|
| Lighthouse mobile perf/a11y never measured automatically | WAVE 1+2 deferred | Slice 1 |
| axe-playwright a11y scan never wired | WAVE 1+2+3 deferred | Slice 2 |
| `bun test` has 5 cross-file pollution failures (1518/1518 in targeted sweep, but full sweep regresses) | WAVE 2 ship report | Slice 3 |
| `bun test` full-suite hangs — never completes | WAVE 1 ship report | Slice 4 |
| No web-vitals tracking in prod for the mobile routes | observed | Slice 5 |

**Out of scope** (handled in separate WAVES):
- Multi-approver workflow — requires backend contract change to `getQuoteApprovalCase` (see memory: single-approval-per-case contract). Dedicated `WAVE-QB-MULTI-APPROVER-HANDOFF.md` after Brian aligns on workflow design (sequential/parallel/threshold)
- Any new product features

---

## Existing CI Footprint

| Workflow | File | Triggers |
|---|---|---|
| `CI` | `.github/workflows/ci.yml` | push to main, all PRs |
| `E2E Staging` | `.github/workflows/e2e-staging.yml` | PRs touching `apps/web/**` + manual dispatch |
| `apply-migrations`, `check-migrations`, `service-cron*`, `deploy-functions` | various | scheduled/manual |

**Existing test infrastructure:**
- Unit: `bun test` with happy-dom preload via `apps/web/bunfig.toml` and root `bunfig.toml`
- Test setup: `apps/web/test-setup/env-vars.ts`, `apps/web/test-setup/happy-dom.ts`
- E2E: Playwright in `apps/web/tests/e2e/` against `http://127.0.0.1:5173` or `PLAYWRIGHT_BASE_URL`
- Credentials: `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` repo secrets

---

## Slice Order

1. Lighthouse CI on mobile sales-rep routes
2. axe-playwright a11y scan integrated into existing E2E
3. bun:test cross-file pollution — root cause + fix
4. bun:test full-suite hang — root cause + fix
5. web-vitals client tracking on `/sales/*` routes

---

## Slice Specs

### Slice 1 — Lighthouse CI (mobile)

**Goal:** Every PR touching `apps/web/**` gets a Lighthouse mobile report against the 8 highest-value sales-rep routes. Fails if perf < 85 or a11y < 95.

**Add dependency:**
```bash
cd apps/web
bun add -d @lhci/cli
```

**Configure** `apps/web/.lighthouserc.cjs`:

```js
module.exports = {
  ci: {
    collect: {
      url: [
        "/sales/today",
        "/sales/pipeline",
        "/sales/customers",
        "/sales/quotes",
        "/sales/quotes/new",
        "/sales/field-note",
        "/sales/voice-quote",
        "/sales/my-mirror",
      ].map((path) => `${process.env.LHCI_BASE_URL ?? "https://qep.blackrockai.co"}${path}`),
      numberOfRuns: 1,
      settings: {
        preset: "mobile",
        // iPhone 14 emulation comes default in mobile preset
        throttlingMethod: "simulate",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        skipAudits: [
          "uses-http2",         // staging may not support
          "redirects-http",     // auth redirects are intentional
        ],
        chromeFlags: "--no-sandbox --disable-dev-shm-usage",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.85 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 600 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
```

**Add scripts** in `apps/web/package.json`:

```json
"scripts": {
  "lighthouse:mobile": "lhci autorun --config=.lighthouserc.cjs",
  "lighthouse:mobile:local": "LHCI_BASE_URL=http://127.0.0.1:5173 lhci autorun --config=.lighthouserc.cjs"
}
```

**Create workflow** `.github/workflows/lighthouse-mobile.yml`:

```yaml
name: Lighthouse Mobile

on:
  pull_request:
    paths:
      - "apps/web/**"
      - ".github/workflows/lighthouse-mobile.yml"
  workflow_dispatch:

concurrency:
  group: lighthouse-mobile-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        working-directory: .
        run: bun install --frozen-lockfile

      - name: Warn when staging credentials missing
        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
        env:
          PLAYWRIGHT_TEST_EMAIL: ${{ secrets.PLAYWRIGHT_TEST_EMAIL }}
          PLAYWRIGHT_TEST_PASSWORD: ${{ secrets.PLAYWRIGHT_TEST_PASSWORD }}
        run: |
          if [ -z "$PLAYWRIGHT_TEST_EMAIL" ] || [ -z "$PLAYWRIGHT_TEST_PASSWORD" ]; then
            echo "::warning::PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set — Lighthouse will only hit guest routes."
          fi

      - name: Run Lighthouse against staging
        env:
          LHCI_BASE_URL: https://qep.blackrockai.co
        run: bun run lighthouse:mobile
```

**Constraint:** Lighthouse hits authenticated routes which redirect to login when unauthenticated. For Slice 1 ship, the 8 sales-rep routes will mostly land on the login page when run as guest. Document this and treat the guest-route Lighthouse scores as the baseline; in a follow-on slice (after multi-approver wave) add authenticated Lighthouse runs that use Playwright to sign in first, save storage state, then run Lighthouse with that state.

**Acceptance:**
- Workflow runs on PRs touching `apps/web/**`
- `.lighthouserc.cjs` and `package.json` scripts committed
- Workflow passes on a no-op PR (asserting the 8 URLs return responses; guest routes pass the assertion thresholds for accessibility because login page is simple)
- Test: dry-run the workflow on a test branch, capture the report URL in the PR comment

**Commit:** `[wave-qb-ciq] Lighthouse mobile CI`

---

### Slice 2 — axe-playwright Integration

**Goal:** Every existing E2E run includes axe a11y scan per page. Fails on serious/critical violations.

**Add dependency:**
```bash
cd apps/web
bun add -d @axe-core/playwright
```

**Create helper** `apps/web/tests/e2e/_helpers/axe-scan.ts`:

```ts
import { type Page, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export interface AxeOptions {
  /** Default ['serious', 'critical']. */
  failOn?: ("minor" | "moderate" | "serious" | "critical")[];
  /** Selectors to exclude from scan. */
  exclude?: string[];
  /** Tag filter (e.g. ['wcag2a', 'wcag2aa', 'wcag21aa']). */
  tags?: string[];
}

const DEFAULT_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

export async function expectNoAxeViolations(
  page: Page,
  routeName: string,
  options: AxeOptions = {},
): Promise<void> {
  const failOn = new Set(options.failOn ?? ["serious", "critical"]);
  const builder = new AxeBuilder({ page }).withTags(options.tags ?? DEFAULT_TAGS);
  if (options.exclude) {
    for (const sel of options.exclude) builder.exclude(sel);
  }
  const result = await builder.analyze();
  const offenders = result.violations.filter((v) => failOn.has(v.impact ?? "minor"));
  if (offenders.length > 0) {
    const summary = offenders
      .map(
        (v) =>
          `[${v.impact}] ${v.id} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})\n  ${v.help}\n  ${v.helpUrl}\n  nodes: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`,
      )
      .join("\n\n");
    expect.soft(offenders, `axe violations on ${routeName}:\n\n${summary}`).toHaveLength(0);
    throw new Error(`axe violations on ${routeName} — see soft assert above`);
  }
}
```

**Wire into existing specs:**

- `apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts` — call `expectNoAxeViolations(page, 'quote-builder-step-N')` after each step navigation
- Any other `tests/e2e/*.spec.ts` that already loads a `/sales/*` route — add a scan after page load

**Create new spec** `apps/web/tests/e2e/sales-rep-a11y.spec.ts`:

```ts
import { test } from "@playwright/test";
import { expectNoAxeViolations } from "./_helpers/axe-scan";

const ROUTES = [
  { path: "/sales/today", name: "today" },
  { path: "/sales/pipeline", name: "pipeline" },
  { path: "/sales/customers", name: "customers" },
  { path: "/sales/quotes", name: "quote-list" },
  { path: "/sales/quotes/new", name: "quote-new" },
  { path: "/sales/field-note", name: "field-note" },
  { path: "/sales/voice-quote", name: "voice-quote" },
  { path: "/sales/my-mirror", name: "my-mirror" },
];

test.describe("Sales rep a11y", () => {
  for (const route of ROUTES) {
    test(`${route.name} has no serious/critical axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page, route.name, {
        // Sales Companion footer credit chip uses a brand-color combo; document any false positives here
        exclude: [],
      });
    });
  }
});
```

**Update `e2e-staging.yml`** — no changes needed; the new spec runs in the existing workflow.

**Acceptance:**
- `bun run test:e2e` includes axe scans
- Zero serious/critical violations on the 8 sales-rep routes — if any exist, fix them in this slice before closing (typical findings: missing aria-label on icon buttons, low-contrast text, missing form labels)
- Per-route violation summary visible in CI logs
- New test file passes; existing E2E spec extended

**Commit:** `[wave-qb-ciq] axe-playwright a11y integration`

---

### Slice 3 — bun:test Cross-File Pollution

**Goal:** Identify the 5 failing tests in full-suite mode, find the shared-state leak(s), fix at source.

**Step 3.1 — Reproduce + isolate**

Run targeted then full sweeps and diff:

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
# Targeted (known green: 1518/1518)
bun test apps/web/src/features/quote-builder apps/web/src/features/sales apps/web/src/lib > /tmp/qb-targeted.log 2>&1

# Full (5 failures + hang)
timeout 600 bun test --bail=20 > /tmp/qb-full.log 2>&1 || true

# Extract failing test names
grep -E "FAIL|fail\(" /tmp/qb-full.log | head -50
```

Document the 5 failing test names + their file paths in the slice's commit message.

**Step 3.2 — Common cross-file pollution sources to audit**

| Source | Where to look | Fix pattern |
|---|---|---|
| `window.localStorage` / `sessionStorage` mutated and not reset | grep for `localStorage.setItem` / `sessionStorage.setItem` in non-test source | Add `afterEach(() => { localStorage.clear(); sessionStorage.clear(); })` in `apps/web/test-setup/happy-dom.ts` |
| Module-level singletons (e.g., React Query default cache, Supabase client) | grep for top-level `new QueryClient` / `createClient` outside `useMemo` | Wrap in factory; reset in `afterEach` |
| Timers (setInterval / setTimeout) not cleared | grep for `setInterval` / `setTimeout` in components and hooks | Ensure cleanup in `useEffect` returns; in tests, add `vi.useFakeTimers()` equivalent for bun (`Bun.gc(true)` between tests) |
| Document-level event listeners left attached | grep for `document.addEventListener` / `window.addEventListener` | Verify cleanup in unmount; reset in `happy-dom.ts` afterEach |
| Global state via Zustand/Jotai stores | grep for `create<` / `atom(` at module level | Add `resetStore()` in test setup, call in afterEach |
| Module mocks (`mock.module`) not restored | grep for `mock.module` | Wrap each in `beforeAll`/`afterAll` pair |
| Service worker registration | check `main.tsx` for `navigator.serviceWorker.register` | Skip SW registration in test env |

**Step 3.3 — Add isolation hardening to `happy-dom.ts`**

```ts
// apps/web/test-setup/happy-dom.ts (append to existing setup)
import { afterEach, beforeEach } from "bun:test";

afterEach(() => {
  // Reset browser storage between tests to prevent cross-file leaks
  try {
    window.localStorage?.clear();
    window.sessionStorage?.clear();
  } catch {
    // happy-dom may not always have storage available
  }
  // Reset cookies
  if (typeof document !== "undefined") {
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
    });
  }
  // Cancel pending RAF
  // (happy-dom rAF is sync; nothing to do — but document the intent)
});

beforeEach(() => {
  // Fresh document body
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
  }
});
```

**Step 3.4 — Fix the actual 5 failures**

For each failing test, after Step 3.3:
- Re-run in isolation: `bun test <path-to-failing-test>` → expect green
- Re-run in full sweep: if still failing, the issue is a non-storage leak. Bisect by running the failing test after each preceding test file individually until the polluter is found.
- Fix the polluter at source (component/hook with leaky state, not the test).

**Acceptance:**
- `bun test` from repo root completes without the 5 cross-file failures
- Slice ships even if the hang persists (Slice 4 handles that)
- `happy-dom.ts` hardening documented in a comment block
- Test: re-run targeted sweep, must still be 1518/1518; re-run full sweep, the 5 specific failures must be gone

**Commit:** `[wave-qb-ciq] bun:test cross-file pollution fix`

---

### Slice 4 — bun:test Full-Suite Hang

**Goal:** `bun test` from repo root completes without hanging.

**Step 4.1 — Reproduce**

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
timeout 600 bun test --bail=0 2>&1 | tail -100
# If exit 124, hang is reproduced. Note the last test file mentioned.
```

**Step 4.2 — Likely causes (audit in order)**

| Cause | Investigation | Fix |
|---|---|---|
| Long-lived `setInterval` (e.g., polling hook in a component under test) | grep for `setInterval` in components/hooks; check tests that import these | Use `jest.useFakeTimers()` equivalent or stub the interval |
| `EventSource` / `WebSocket` opened in test, never closed | grep for `new EventSource` / `new WebSocket` | Stub in test setup, OR ensure component unmounts close them |
| `fetch` polling with `setTimeout` recursion | trace any infinite-retry pattern | Add abort signal in test or stub fetch |
| React Query background refetch | check QueryClient default options in tests | Set `defaultOptions: { queries: { refetchOnWindowFocus: false, refetchInterval: false } }` in test wrapper |
| Supabase realtime channel subscription | grep for `.channel(` / `.subscribe(` in tested code | Stub Supabase client in test setup |
| Open file handles from edge function tests | check `supabase/functions/_shared` test files | Use `--timeout=10000` per test |

**Step 4.3 — Add safety net**

Add `--timeout=30000` to test scripts so individual test files cannot hang indefinitely:

```jsonc
// apps/web/package.json
"scripts": {
  "test": "bun test --timeout=30000",
  "test:full": "bun test --timeout=30000 --bail=20"
}
```

```jsonc
// root package.json
"scripts": {
  "test": "bun test --timeout=30000"
}
```

**Step 4.4 — Bisect**

If the hang persists after isolation hardening, bisect with `find ... | sort | xargs bun test` in 50%-chunks until the offending file is found. Document the path.

**Acceptance:**
- `bun test` from repo root completes within 10 minutes
- `bun test` from `apps/web` completes within 5 minutes
- Per-test timeout of 30s in place
- The offending hang source documented (commit message + ship report)

**Commit:** `[wave-qb-ciq] bun:test full-suite hang fix`

---

### Slice 5 — web-vitals Client Tracking

**Goal:** Real-user metrics on `/sales/*` routes. Quietly emit to Sentry (already installed) so we see field perf, not just synthetic Lighthouse.

**Add dependency:**
```bash
cd apps/web
bun add web-vitals
```

**Create** `apps/web/src/features/sales/lib/web-vitals-reporter.ts`:

```ts
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from "web-vitals";

type Reporter = (metric: Metric) => void;

let installed = false;

export function installSalesWebVitals(reporter: Reporter): void {
  if (installed) return;
  installed = true;
  const wrapped: Reporter = (m) => {
    // Only report when current route is /sales/*
    if (!window.location.pathname.startsWith("/sales/")) return;
    reporter(m);
  };
  onCLS(wrapped);
  onINP(wrapped);
  onLCP(wrapped);
  onFCP(wrapped);
  onTTFB(wrapped);
}
```

**Wire** in `apps/web/src/main.tsx` (or wherever Sentry is initialized — `instrument.ts`):

```ts
import { installSalesWebVitals } from "@/features/sales/lib/web-vitals-reporter";
import * as Sentry from "@sentry/react";

installSalesWebVitals((metric) => {
  Sentry.metrics.distribution(`web_vitals.${metric.name.toLowerCase()}`, metric.value, {
    tags: {
      route_prefix: "sales",
      navigation_type: metric.navigationType,
    },
    unit: metric.name === "CLS" ? "" : "millisecond",
  });
});
```

**Acceptance:**
- Build green with new dep
- Sentry receives CLS / INP / LCP / FCP / TTFB metrics tagged `route_prefix=sales`
- No metrics emitted for non-`/sales/*` routes
- Test: `apps/web/src/features/sales/lib/__tests__/web-vitals-reporter.test.ts` — reporter not called for non-sales routes, called for sales routes

**Commit:** `[wave-qb-ciq] web-vitals on /sales/* routes`

---

## Build Gates (after every slice)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
bun run build

cd apps/web
bun run build
bun run test -- --run        # targeted suite (must stay 1518+/1518+)
```

After Slices 3 + 4 close, additionally:

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun test --timeout=30000     # full-suite must now complete without hang
```

**Do not close a slice if any gate fails.**

---

## Verification Slice (closes the wave)

1. Run all five workflows on a verification PR:
   - `CI` (existing) — green
   - `E2E Staging` (with new axe scans) — green, zero serious/critical violations
   - `Lighthouse Mobile` (new) — green, all 8 routes meet thresholds OR documented exclusions
2. Re-run full bun test sweep at repo root — completes within 10 min, no cross-file failures, no hang
3. Verify Sentry receives web-vitals from a manual visit to `/sales/today` on a real phone
4. Generate `WAVE-QB-CI-QUALITY-SHIP-REPORT-YYYY-MM-DD.md` at repo root summarizing:
   - Lighthouse baseline scores per route
   - axe violation counts (before fixes / after fixes)
   - bun:test cross-file pollution root cause and fix
   - bun:test hang root cause and fix
   - web-vitals routing
   - Outstanding work (multi-approver backend wave; authenticated Lighthouse runs)

**Commit:** `[wave-qb-ciq] verification + ship report`

---

## Out of Scope (do not touch)

- Multi-approver workflow — backend contract change required first (see memory: project_qep_approval_contract)
- New product features
- Edge function quality gates
- Database migration test patterns
- Any UI changes beyond a11y fixes flagged by axe

---

## /goal one-liner

```
/goal Execute WAVE-QB-CI-QUALITY-HANDOFF.md at /Users/brianlewis/Projects/qep-knowledge-assistant. Slices in order: 1 Lighthouse mobile CI, 2 axe-playwright integration, 3 bun:test cross-file pollution fix, 4 bun:test full-suite hang fix, 5 web-vitals on /sales/* routes, then verification. After every slice run bun run migrations:check + bun run build at root, bun run build + bun run test --run in apps/web; after Slices 3+4 also run bun test --timeout=30000 from repo root. Commit with [wave-qb-ciq] <slice-name> prefix, push origin/main, continue. Do not stop between green slices. Stop only on (a) build gate fail after a reasonable fix attempt, (b) irreversible destructive decision, (c) genuinely ambiguous spec. For Slice 2: if axe finds serious/critical violations on /sales/* routes, FIX them at source (typical fixes: aria-label on icon-only buttons, color-contrast tweaks via tailwind, form-label associations) before closing the slice — do not lower the threshold. For Slice 1: guest-route Lighthouse scores are acceptable as baseline; authenticated runs deferred. When verification closes, write WAVE-QB-CI-QUALITY-SHIP-REPORT-YYYY-MM-DD.md at repo root.
```
