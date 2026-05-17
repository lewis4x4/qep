# WAVE — Quote Builder Quality Tail (Auth Lighthouse + Test Pollution Bisect)

**Target orchestrator:** RepoPrompt (multi-model fan-out, strangler-fig per slice)
**Repository:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
**Remote:** `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QB-CI-QUALITY-HANDOFF.md` (closed 2026-05-17)

**Scope owner:** Brian Lewis (Speedy)
**Operating mode:** Autonomous per CLAUDE.md. Strangler-fig: extract → verify → push → continue.

---

## Mission Lock

Every slice must pass:

1. **Mission Fit** — closes the two open quality items from the CI/Quality wave that materially affect rep-experience confidence
2. **Transformation** — Lighthouse now sees the routes a rep actually uses (authenticated), not the login page proxy
3. **Pressure Test** — test suite is reliably 100% green every commit, not "ignore the 31 known-flaky"
4. **Operator Utility** — green-light signal in CI means "ship it" without manual triage

---

## Context

Four consecutive WAVES landed the mobile sales-rep experience plus quality scaffolding. The CI/Quality ship report flagged three queued follow-ups:

| Follow-up | This wave |
|---|---|
| Authenticated Lighthouse runs (currently hitting login redirect) | **Slice 1** |
| Bisect remaining 31 in-suite-only test failures (pass in isolation, fail in full sweep) | **Slice 2** |
| Multi-approver backend wave | **Out of scope** — requires Brian's product direction on workflow design |

---

## Existing Infrastructure (reuse)

| Asset | Path |
|---|---|
| Lighthouse config | `apps/web/.lighthouserc.cjs` |
| Lighthouse workflow | `.github/workflows/lighthouse-mobile.yml` |
| Playwright auth helper | `apps/web/tests/e2e/helpers/auth.ts` (`signInWithPassword`, `playwrightTestCredentials`) |
| Playwright fixtures | `apps/web/tests/e2e/fixtures.ts` |
| E2E credentials | repo secrets: `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD` |
| Test setup | `apps/web/test-setup/happy-dom.ts`, `apps/web/test-setup/env-vars.ts` |
| bun test config | `apps/web/bunfig.toml`, root `bunfig.toml` |
| axe helper | `apps/web/tests/e2e/_helpers/axe-scan.ts` |

---

## Slice Order

1. Authenticated Lighthouse runs against `/sales/*` routes
2. Bisect + fix the 31 in-suite-only test failures

---

## Slice Specs

### Slice 1 — Authenticated Lighthouse Runs

**Goal:** Lighthouse hits the real `/sales/*` routes as a signed-in sales rep, not the login page.

**Approach:** Use a Playwright global-setup step that signs in once and saves storage state to disk, then have Lighthouse run a `puppeteerScript` that loads that state before each audit.

**1.1 — Storage-state generator script**

Create `apps/web/scripts/lighthouse-auth-setup.mjs`:

```js
// Runs a Playwright sign-in flow and writes storage state to disk.
// Lighthouse then loads that state via puppeteerScript before each audit.
//
// Env required:
//   LHCI_BASE_URL                  e.g. https://qep.blackrockai.co
//   PLAYWRIGHT_TEST_EMAIL          rep/advisor account
//   PLAYWRIGHT_TEST_PASSWORD
//
// Output: apps/web/.lighthouse-storage-state.json

import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const baseUrl = process.env.LHCI_BASE_URL;
const email = process.env.PLAYWRIGHT_TEST_EMAIL;
const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

if (!baseUrl || !email || !password) {
  console.error("[lighthouse-auth-setup] missing LHCI_BASE_URL / PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD");
  process.exit(1);
}

const outputPath = resolve(__dirname, "..", ".lighthouse-storage-state.json");

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  // Adapt selectors to the actual login page form — keep in sync with apps/web/src/components/LoginPage.tsx
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Land somewhere authenticated; SalesShell default = /sales/today
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.context().storageState({ path: outputPath });
  console.log(`[lighthouse-auth-setup] wrote storage state to ${outputPath}`);
} catch (err) {
  console.error("[lighthouse-auth-setup] failed:", err);
  process.exit(1);
} finally {
  await browser.close();
}
```

**1.2 — Lighthouse puppeteer script**

Create `apps/web/scripts/lighthouse-puppeteer-auth.cjs`:

```js
// Lighthouse puppeteerScript — loads storage state into the page context
// so authenticated routes don't redirect to /login.
//
// Lighthouse passes the headless browser instance + URL; we attach cookies
// from the saved storage state before navigation.
const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = path.resolve(__dirname, "..", ".lighthouse-storage-state.json");

module.exports = async (browser, context) => {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `[lighthouse-auth] storage state not found at ${STATE_PATH}. ` +
      `Run scripts/lighthouse-auth-setup.mjs first.`,
    );
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const page = await browser.newPage();
  // Restore cookies
  if (Array.isArray(state.cookies) && state.cookies.length > 0) {
    await page.setCookie(...state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite === "Strict" ? "Strict" : c.sameSite === "Lax" ? "Lax" : "None",
    })));
  }
  // Restore localStorage / sessionStorage by visiting origin first then setting
  if (Array.isArray(state.origins)) {
    for (const origin of state.origins) {
      await page.goto(origin.origin, { waitUntil: "domcontentloaded" });
      await page.evaluate((store) => {
        for (const item of store.localStorage ?? []) {
          window.localStorage.setItem(item.name, item.value);
        }
      }, origin);
    }
  }
  await page.close();
};
```

**1.3 — Update `.lighthouserc.cjs`**

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
      ].map((p) => `${process.env.LHCI_BASE_URL ?? "https://qep.blackrockai.co"}${p}`),
      numberOfRuns: 1,
      puppeteerScript: process.env.LHCI_AUTHENTICATED === "true"
        ? "./scripts/lighthouse-puppeteer-auth.cjs"
        : undefined,
      settings: {
        preset: "mobile",
        throttlingMethod: "simulate",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        skipAudits: ["uses-http2", "redirects-http"],
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
    upload: { target: "temporary-public-storage" },
  },
};
```

**1.4 — Update `package.json` scripts**

```jsonc
// apps/web/package.json
"scripts": {
  // existing scripts preserved
  "lighthouse:auth-setup": "node ./scripts/lighthouse-auth-setup.mjs",
  "lighthouse:mobile:authed": "bun run lighthouse:auth-setup && LHCI_AUTHENTICATED=true lhci autorun --config=.lighthouserc.cjs",
  "lighthouse:mobile:local:authed": "LHCI_BASE_URL=http://127.0.0.1:5173 bun run lighthouse:auth-setup && LHCI_AUTHENTICATED=true lhci autorun --config=.lighthouserc.cjs"
}
```

**1.5 — Update `.github/workflows/lighthouse-mobile.yml`**

Replace the single Lighthouse step with a two-step pattern:

```yaml
      - name: Lighthouse — sign in and capture storage state
        if: secrets.PLAYWRIGHT_TEST_EMAIL != '' && secrets.PLAYWRIGHT_TEST_PASSWORD != ''
        env:
          LHCI_BASE_URL: https://qep.blackrockai.co
          PLAYWRIGHT_TEST_EMAIL: ${{ secrets.PLAYWRIGHT_TEST_EMAIL }}
          PLAYWRIGHT_TEST_PASSWORD: ${{ secrets.PLAYWRIGHT_TEST_PASSWORD }}
        run: bun run lighthouse:auth-setup

      - name: Lighthouse — authenticated mobile run
        if: secrets.PLAYWRIGHT_TEST_EMAIL != '' && secrets.PLAYWRIGHT_TEST_PASSWORD != ''
        env:
          LHCI_BASE_URL: https://qep.blackrockai.co
          LHCI_AUTHENTICATED: "true"
        run: bun run lighthouse:mobile:authed

      - name: Lighthouse — guest fallback when no credentials
        if: secrets.PLAYWRIGHT_TEST_EMAIL == '' || secrets.PLAYWRIGHT_TEST_PASSWORD == ''
        env:
          LHCI_BASE_URL: https://qep.blackrockai.co
        run: |
          echo "::warning::Running Lighthouse against guest routes only (no test credentials available)."
          bun run lighthouse:mobile
```

**1.6 — Add `.gitignore` entry**

```gitignore
apps/web/.lighthouse-storage-state.json
```

**1.7 — Test selector sync**

The `lighthouse-auth-setup.mjs` script uses selectors that must match `apps/web/src/components/LoginPage.tsx`. Before closing the slice:
- Open LoginPage.tsx
- Confirm `getByLabel(/email/i)`, `getByLabel(/password/i)`, and `getByRole("button", { name: /sign in|log in/i })` all resolve
- If not, update the script with the actual labels/roles in use

**Acceptance:**
- Workflow runs `lighthouse:auth-setup` then `lighthouse:mobile:authed` when credentials present
- Falls back to guest run with warning when credentials absent
- All 8 sales-rep routes now Lighthouse-audited as authenticated (no login redirect)
- Thresholds (perf ≥0.85, a11y ≥0.95, CLS ≤0.1) enforced
- `apps/web/.lighthouse-storage-state.json` in `.gitignore`
- Tests: smoke-test `lighthouse-auth-setup.mjs` against staging via manual workflow dispatch; verify report URL in PR comment

**Commit:** `[wave-qb-qtail] authenticated Lighthouse runs`

---

### Slice 2 — Bisect + Fix Remaining 31 In-Suite-Only Failures

**Goal:** `bun test` from repo root reports 100% pass. No "ignore the 31 known-flaky."

**2.1 — Catalog the 31 failures**

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun test --timeout=30000 2>&1 | tee /tmp/full-sweep.log
# Extract failing test names
grep -E "^(fail|FAIL|\(fail\))" /tmp/full-sweep.log | sort -u > /tmp/failing-tests.txt
wc -l /tmp/failing-tests.txt
```

Document the failing tests in a structured table (test name, file path, failure reason from log).

**2.2 — Confirm each fails in-suite + passes in isolation**

For each unique failing test file:

```bash
# In isolation
bun test --timeout=30000 <path-to-failing-test-file>
# If green here, it's pollution; if red here, it's a real bug — fix at source.
```

Group findings into two buckets:
- **Bucket A (pollution-only)**: passes in isolation, fails in full sweep → bisect to find polluter
- **Bucket B (real bugs)**: fails in isolation too → fix the actual test or production code

**2.3 — Bisect pollution (Bucket A)**

For each Bucket A test:

```bash
# Get full ordered list of test files
find apps/web/src supabase -name "*.test.ts" -o -name "*.test.tsx" 2>/dev/null | sort > /tmp/all-tests.txt

# Find the position of the failing file in the sorted list
FAILING="<path>"
grep -n "$FAILING" /tmp/all-tests.txt

# Run files in chunks before the failing test, halving until the polluter is isolated
head -N /tmp/all-tests.txt | xargs bun test --timeout=30000 -- ; # adjust N to bisect
```

For each polluter found, identify the leak:

| Symptom | Likely source | Fix |
|---|---|---|
| `localStorage` value persists | Component sets via `useEffect` without cleanup | Add `return () => localStorage.removeItem(...)` |
| Stale React Query cache | Module-level `new QueryClient` | Move into component or test wrapper; reset in `afterEach` |
| Dangling timer/interval | `setInterval` without cleanup | Return cleanup from `useEffect` |
| Mocked module bleeds across files | `mock.module()` not paired with `unmock` | Use `beforeAll`/`afterAll` pair, or move mock into the single test file |
| Module-level Supabase client mutated | Test sets `.auth.session` then doesn't reset | Reset in `afterEach` in `test-setup/happy-dom.ts` |
| Document body content persists | Component renders into body, test doesn't unmount | Already addressed in Slice 3 of prior wave; verify cleanup is firing |
| Custom global (window.__qep_*) | Singleton service installed once | Reset in `afterEach` |

**2.4 — Fix Bucket B (real bugs)**

For each test that fails in isolation:
- Read the test to understand what it's asserting
- If the assertion is stale (e.g., old route, old field name) — update the test
- If the production code is wrong — fix it
- If the test is flaky on its own (timing) — stabilize with `waitFor` / explicit awaits, do not mask with retries

**2.5 — Harden `happy-dom.ts` if pattern emerges**

If a class of leak shows up in 3+ tests, add the cleanup to `apps/web/test-setup/happy-dom.ts` `afterEach`. Document each addition with a comment explaining which class of leak it addresses.

**2.6 — Add CI gate**

Update `.github/workflows/ci.yml` to include a new step:

```yaml
      - name: Full bun test sweep
        working-directory: .
        run: bun test --timeout=30000
```

Place it after the existing targeted regression tests so a hang surfaces clearly.

**Acceptance:**
- `bun test --timeout=30000` from repo root: 100% pass (or document each remaining exception with a `// SKIP-REASON: <ticket>` annotation if a genuine blocker exists)
- New CI step in `ci.yml` runs full sweep and gates main
- Each polluter fix has a regression test
- Hardening additions to `happy-dom.ts` are documented inline

**Commit (per polluter category):** `[wave-qb-qtail] fix <leak-category> pollution` — multiple commits acceptable if logically grouped (e.g., one commit for storage leaks, one for timer leaks, one for module-state leaks)

**Final commit:** `[wave-qb-qtail] enable full bun test sweep in CI`

---

## Build Gates (after every slice)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
bun run build

cd apps/web
bun run build
bun run test -- --run

# Full sweep — required after Slice 2 closes
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun test --timeout=30000
```

After Slice 1, additionally:
```bash
# Manual workflow_dispatch on lighthouse-mobile.yml — verify authenticated run completes
# Verify storage-state file is gitignored
git check-ignore apps/web/.lighthouse-storage-state.json
```

**Do not close a slice if any gate fails.**

---

## Verification Slice (closes the wave)

1. Trigger `lighthouse-mobile` workflow manually — confirm authenticated audit completes for all 8 routes, thresholds pass
2. Push a no-op commit to a branch — full `CI` workflow runs the new `bun test --timeout=30000` step and passes
3. Generate `WAVE-QB-QUALITY-TAIL-SHIP-REPORT-YYYY-MM-DD.md` at repo root summarizing:
   - Authenticated Lighthouse baseline (per-route perf/a11y/best-practices/seo scores)
   - Test pollution: catalog of 31 failures, classification (pollution vs real bug), root cause per category, fix
   - Any tests genuinely deferred (with reason + ticket)
   - Updated CI gate
   - Open follow-ups (multi-approver backend wave — flagged for product alignment)

**Commit:** `[wave-qb-qtail] verification + ship report`

---

## Out of Scope (do not touch)

- Multi-approver backend wave — separate WAVE pending Brian's product direction on approver workflow (sequential vs parallel vs threshold-based escalation)
- Adding new test cases beyond regression coverage for fixes
- Any UI changes beyond what's required to fix in-isolation test failures
- Authenticated runs against production (staging only)
- Lighthouse perf tuning — if a route fails the 0.85 perf threshold, document and add a follow-up; do not lower the threshold

---

## /goal one-liner

```
/goal Execute WAVE-QB-QUALITY-TAIL-HANDOFF.md at /Users/brianlewis/Projects/qep-knowledge-assistant. Slices in order: 1 authenticated Lighthouse runs (Playwright sign-in → storage state → puppeteerScript), 2 bisect and fix the 31 in-suite-only test failures, then verification. After every slice run bun run migrations:check + bun run build at root, bun run build + bun run test --run in apps/web, then after Slice 2 also run bun test --timeout=30000 from repo root. Commit with [wave-qb-qtail] <slice-name> prefix, push origin/main, continue. For Slice 1: keep the guest-fallback path so the workflow degrades cleanly when credentials are missing. For Slice 2: classify each failure as pollution-only (passes in isolation) or real-bug (fails in isolation) and fix at source — do not mask with retries or skips unless a genuine external blocker exists, in which case annotate with // SKIP-REASON. Add a new CI step that runs the full bun test sweep so future regressions surface immediately. Do not stop between green slices. Stop only on (a) build gate fail after a reasonable fix attempt, (b) irreversible destructive decision, (c) genuinely ambiguous spec. When verification closes, write WAVE-QB-QUALITY-TAIL-SHIP-REPORT-YYYY-MM-DD.md at repo root.
```
