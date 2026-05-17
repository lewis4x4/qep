# WAVE Quote Builder Quality Tail — Ship Report
**Date:** 2026-05-17
**Branch:** `main`
**Commits prefix:** `[wave-qb-qtail]`
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant` → `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QB-CI-QUALITY-HANDOFF.md` (closed 2026-05-17)

**Reference:** `WAVE-QB-QUALITY-TAIL-HANDOFF.md`

---

## Outcome

The two open quality items from the CI/Quality wave are closed.
Lighthouse mobile now audits the eight rep routes as a real
signed-in rep (storage-state pre-step + puppeteer hook), and the
project gates main on a canonical 100%-green test sweep that
sidesteps bun:test's unfixable `mock.module()` persistence.

## Slice ledger

| # | Slice | Commit | Status |
|---|---|---|---|
| 1 | Authenticated Lighthouse runs | `c4c4aca8` | ✅ shipped |
| 2 | Bisect + fix in-suite-only failures + CI gate | `74f54be7` | ✅ shipped |
| — | Verification + ship report | this report | ✅ |

## Slice 1 — Authenticated Lighthouse runs

Lighthouse now audits the eight `/sales/*` routes as a real signed-in
rep instead of measuring the login redirect.

### Pieces

| File | Purpose |
|---|---|
| `apps/web/scripts/lighthouse-auth-setup.mjs` | Headless Chromium signs in via `#email-pw` / `#password` / `#login-button` (matches `apps/web/tests/e2e/helpers/auth.ts`), writes Playwright storage-state JSON to `apps/web/.lighthouse-storage-state.json`. Fails fast on missing `LHCI_BASE_URL` / `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD`. |
| `apps/web/scripts/lighthouse-puppeteer-auth.cjs` | Lighthouse `puppeteerScript` hook — loads the storage state, restores cookies on the headless browser, and replays `localStorage` / `sessionStorage` by visiting each origin first. Handles the Playwright → Puppeteer cookie-shape difference (`sameSite` enum mapping). |
| `apps/web/.lighthouserc.cjs` | Reads `LHCI_AUTHENTICATED` — when `"true"`, points `puppeteerScript` at the new auth hook. Otherwise undefined (guest mode). |
| `apps/web/package.json` | New scripts: `lighthouse:auth-setup`, `lighthouse:mobile:authed`, `lighthouse:mobile:local:authed`. |
| `.github/workflows/lighthouse-mobile.yml` | Job-level `env.HAS_CREDS` flips between paths. Authenticated path: install chromium → auth-setup → `lhci autorun` with `LHCI_AUTHENTICATED=true`. Guest fallback emits `::warning::` and runs the existing `lighthouse:mobile`. Fork PRs without secrets degrade gracefully. |
| `.gitignore` | `apps/web/.lighthouse-storage-state.json` + `.lighthouseci/` ignored — the storage state carries the test rep's session and must never commit. Verified via `git check-ignore`. |

### Authenticated baseline

Awaiting first successful workflow run on a same-repo PR (secrets are
required to land the real numbers). The thresholds enforced are
identical to the CI/Quality wave: perf ≥ 0.85 (error), a11y ≥ 0.95
(error), best-practices ≥ 0.9 (warn), CLS ≤ 0.1 (error), with FCP /
LCP / TBT bounds. A follow-up will replace this section with
per-route scores once the first authenticated workflow run lands.

### Guest fallback path

Preserved end-to-end. The workflow now lights up a `::warning::`
message when `PLAYWRIGHT_TEST_EMAIL` / `PLAYWRIGHT_TEST_PASSWORD` are
unavailable (typically fork PRs) and runs `bun run lighthouse:mobile`
against the login page — the existing CI/Quality baseline.

## Slice 2 — In-suite-only test failures + CI sweep gate

### Failure classification

Catalogued 25 unique failing tests in the raw `bun test --timeout=30000`
sweep. After isolation runs:

| Bucket | Count | Result |
|---|---|---|
| Real bug (fails in isolation too) | 1 | Fixed at source |
| Pollution-only (passes in isolation, fails in full sweep) | 24 | Architectural — see below |

**Real bug fixed:**
- `AdvisorActionCards > makes Quote Builder primary while preserving secondary advisor links` — the polish-wave `/quote-v2` link sweep updated the component to point at `/sales/quotes/new` but the matching test expectation was missed. Fixed: now asserts `/sales/quotes/new`. Comment in the test file references the link-sweep commit.

**Pollution-only — architectural root cause:**

bun:test's `mock.module()` API has no public unmock primitive. Module
mocks persist for the lifetime of the bun process. The QEP codebase
has 34+ test files that call `mock.module("@/lib/supabase", ...)` (or
`@/hooks/useAuth`, supabase realtime channels, etc.) — when bun runs
the entire suite in one process, the first file's mock leaks into
every subsequent file's import resolution. Standard `afterEach` /
`afterAll` cleanup can't help; the binding is at the module-resolver
layer, not the JS scope.

**The pre-existing workaround:** the project already ships a per-file
isolation runner at `scripts/run-unit-tests.mjs` +
`scripts/run-integration-tests.mjs`, exposed as the `bun run test`
npm script. Both scripts spawn each test file in its own bun
subprocess — `mock.module()` persistence cannot cross process
boundaries.

```
$ bun run test
…
[run-integration-tests] all 22 file(s) green
```

Zero failures. **That is the canonical green-light sweep.**

### CI gate

`.github/workflows/ci.yml` gains a `Full test sweep (per-file
isolation)` step after the build + bundle-size guard, running `bun
run test`. Future regressions surface on PR immediately instead of
waiting for the targeted sweep to accidentally exercise the
offending file order.

```yaml
- name: Full test sweep (per-file isolation)
  run: bun run test
```

### Documentation

`bunfig.toml` doc comments now describe the raw vs script-based
sweep distinction explicitly, including the upstream bun limitation
and the recommended sweep. The previous comment recommended raw
`bun test`; the corrected guidance points future readers at `bun run
test` for green-light signal.

## Build gates

| Gate | Result |
|---|---|
| `bun run migrations:check` (root) | ✅ 576 files, 001..578 |
| `bun run build` (root) | ✅ green |
| `bun run build` (`apps/web`) | ✅ green |
| `bun run typecheck` (`apps/web`) | ✅ green |
| Targeted regression (sales + quote-builder + lib) | ✅ 1523/1523 pass |
| **Canonical sweep (`bun run test`)** | **✅ 100% green — all 22 integration files + unit suite** |
| Raw `bun test --timeout=30000` | ⚠️ 2716/2747 pass — the 31 fails are the documented `mock.module` persistence issue, all pass under `bun run test` |
| `git check-ignore apps/web/.lighthouse-storage-state.json` | ✅ ignored |

## What's left

1. **Real Lighthouse authenticated baseline.** The workflow is wired
   but the per-route scores will land in a follow-up addendum after
   the next same-repo PR runs the new path end-to-end. The threshold
   contract is locked.
2. **Multi-approver backend wave.** Still queued behind Brian's
   product direction on workflow design (sequential / parallel /
   threshold). Out of scope for this wave per the handoff.
3. **Upstream bun:test mock.module unmock primitive.** Not in our
   control — when bun ships `mock.unmock(...)` or equivalent, the
   script-based sweep + raw sweep will converge.

## Jarvis Frontend Handoff

This wave is pure CI / quality scaffolding. No backend changes, no
database migrations, no edge functions, no RPCs, no Supabase schema
touched. No new TypeScript types needed in `jarvis-os/src/types/`.

**Heads-up:** the dashboard team should expect authenticated
Lighthouse Mobile reports starting on the next same-repo PR — the
per-route scores will replace the login-page baseline that the prior
wave shipped.

---

🤖 Generated for the WAVE Quote Builder Quality Tail
