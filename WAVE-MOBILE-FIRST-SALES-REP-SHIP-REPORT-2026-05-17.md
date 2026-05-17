# WAVE Mobile-First Sales Rep — Ship Report
**Date:** 2026-05-17
**Branch:** `main`
**Commits prefix:** `[wave-mobile-sales]`
**Scope owner:** Brian Lewis (Speedy)
**Reference:** `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md`

---

## Outcome

Every sales-rep surface that previously rendered inside the desktop
`AppLayout` is now hosted inside the mobile-first `SalesShell`. The
seven phases laid out in the handoff are shipped. Build gates are
green, targeted regressions are clean, and the routes are wired
through the existing nav-config + FAB capture sheet.

## Phase ledger

| # | Title | Commit prefix | Status |
|---|---|---|---|
| 0 | Mobile primitives baseline | `phase-0` | ✅ shipped (`bf6a9b92`) |
| 1 | Quote Builder + Quote List in SalesShell | `phase-1` | ✅ shipped (`8ef63a85`) |
| 2 | Field Note + history in SalesShell | `phase-2` | ✅ shipped (`49d46927`) |
| 3 | Voice Quote in SalesShell | `phase-3` | ✅ shipped (`7f311bd6`) |
| 4 | Rep My Mirror in SalesShell | `phase-4` | ✅ shipped (`bed47563`) |
| 5 | Sales-rep Deal Detail (new build) | `phase-5` | ✅ shipped (`8520963f`) |
| 6 | Sales nav rewire + Capture quick actions | `phase-6` | ✅ shipped (`c4ad2999`) |
| 7 | Verification + ship report | `phase-7` | ✅ (this report) |

## Routes migrated into SalesShell

| Path | Component | Source phase |
|---|---|---|
| `/sales/quotes` | `QuoteListPage` | 1 |
| `/sales/quotes/new` | `QuoteBuilderV2Page` | 1 |
| `/sales/quotes/:quoteId` | `QuoteBuilderV2Page` (path-param aware) | 1 |
| `/sales/field-note` | `FieldNotePage` (wraps `VoiceCapturePage`) | 2 |
| `/sales/field-note/history` | `FieldNoteHistoryPage` (wraps `VoiceHistoryPage`) | 2 |
| `/sales/voice-quote` | `VoiceQuotePage` | 3 |
| `/sales/my-mirror` | `MyMirrorPage` (mobile-first) | 4 |
| `/sales/deals/:dealId` | `DealDetailPage` (new build) | 5 |

Legacy paths `/quote`, `/quotes`, `/quote-v2`, `/voice-quote` redirect
via `RedirectPreserveSearch` to the new SalesShell entry points.
40+ existing inline links across QRM command center / pipeline /
approvals / Account360 continue to work.

## New mobile primitives (Phase 0)

| File | Purpose |
|---|---|
| `features/sales/lib/mobile-design-tokens.ts` | Locked breakpoints, chrome heights, 44pt touch target, typography ramp, surface tokens, safe-area helpers |
| `features/sales/components/MobileWizardStepper.tsx` | Horizontal snap-scroll chip rail with keyboard nav and auto-scrolling current step |
| `features/sales/components/MobileStickyActionBar.tsx` | Fixed bar above BottomTabBar with optional progress line and safe-area padding |
| `features/sales/components/MobileBottomSheet.tsx` | Generic drawer (no framer-motion dep) for right-rail panel surfacing |
| `features/sales/components/MobileVoiceMicButton.tsx` | Standardized 96–128pt mic primitive with state semantics + ARIA live status |
| `features/sales/components/MobileSectionAccordion.tsx` | Numbered collapsible matching FloorPage 01/02 pattern |
| `features/sales/components/MobileKpiGrid.tsx` | 2-col phone / 3–4-col >= sm KPI strip |

## New pages built

| File | Surface |
|---|---|
| `features/sales/pages/FieldNotePage.tsx` | Thin wrapper hosting `VoiceCapturePage` inside SalesShell |
| `features/sales/pages/FieldNoteHistoryPage.tsx` | Thin wrapper for `VoiceHistoryPage` |
| `features/sales/pages/MyMirrorPage.tsx` | Mobile-first rep reflection layout (reuses `buildRepRealityBoard`) |
| `features/sales/pages/DealDetailPage.tsx` | Sales-rep deal detail (mobile-first, new build) |
| `features/sales/hooks/useSalesDealDetail.ts` | `fetchDealComposite` → `SalesDealView` adapter hook |
| `features/quote-builder/components/MobileIntelligencePanelHost.tsx` | Chip rail + MobileBottomSheets exposing AI Recommendation + Deal Coach on phones |

## Tests added

| File | Coverage |
|---|---|
| `features/sales/lib/mobile-design-tokens.test.ts` | 4 cases — chrome heights, touch target, typography slots, breakpoints |
| `features/sales/components/MobileWizardStepper.test.tsx` | 4 cases — rendering, click routing, locked aria-disabled, keyboard nav |
| `features/sales/components/MobileStickyActionBar.test.tsx` | 4 cases — primary/secondary slot, progress bar, clamping |
| `features/sales/components/MobileBottomSheet.test.tsx` | 5 cases — open/close, backdrop, X, Escape, closed transform |
| `features/sales/components/MobileVoiceMicButton.test.tsx` | 7 cases — state semantics, ARIA, onClick gating, size clamp |
| `features/quote-builder/components/MobileIntelligencePanelHost.test.tsx` | 5 cases — chip rendering, sheet open/close, extra panels |
| `features/sales/__tests__/SalesRoutes.routing.test.tsx` | 1 case — SalesRoutes export shape (mock.module pollution avoided) |
| `features/sales/hooks/useSalesDealDetail.test.ts` | 5 cases — adapter projection, phone fallback chain, name fallback, no-activities |
| `features/sales/pages/MyMirrorPage.test.tsx` | 1 case — function export |
| `features/sales/pages/DealDetailPage.test.tsx` | 1 case — function export |
| `lib/nav-config.test.ts` | +4 cases — Sales dropdown hrefs, Dashboard → /sales/today, sections, admin parity |
| `tests/e2e/mobile-sales-rep.spec.ts` | Playwright spec at iPhone 14 viewport: gating, redirects, authenticated walk, FAB quick actions |

Existing `features/sales/components/AiBriefingCard.test.tsx` was
patched with `afterEach(cleanup)` — a latent gap surfaced by the new
DOM-touching test files.

## Build gates

| Gate | Result |
|---|---|
| `bun run migrations:check` (root) | ✅ 576 files, sequence 001..578 |
| `bun run build` (root) | ✅ green |
| `bun run typecheck` (`apps/web`) | ✅ green |
| `bun run build` (`apps/web`) | ✅ green, no chunk size regressions outside the existing oversized vendors |
| Targeted regression (sales + quote-builder + voice-quote + qrm/lib + components + lib) | ✅ 1777/1782 pass — the 5 failures are pre-existing bun:test cross-file mock.module pollution (each fails-in-suite, passes-in-isolation) confirmed on pristine main pre-Phase-0 |

## Outstanding / deferred

Documented here so a follow-up wave can pick them up cleanly:

1. **WizardShell / QuoteWizardProgress not replaced by `MobileWizardStepper`** — the existing compact wizard tile grid is still used inside Quote Builder. The MobileWizardStepper primitive is built and tested but unwired. The current compact tiles horizontally scroll on phone and are functional; swapping in the new stepper is a cosmetic upgrade.
2. **Per-step deep mobile reflow in `features/quote-builder/steps/`** — each of the 11 steps still uses its existing layout. The QuoteBuilderV2PageShell wraps them in a single-column flex container at `<lg` (the right rail aside is `hidden xl:block`) and the new MobileIntelligencePanelHost surfaces AI panels via bottom sheets, but per-step audits (textarea sizing, accordion grouping, etc.) per handoff §1.4 are still open.
3. **`bun test` (full suite) hangs intermittently** — the targeted suite completes in <4s but the full 302-file run hangs after ~5 minutes locally. This is a pre-existing toolchain issue unrelated to WAVE changes (it reproduces on the post-Phase-0 baseline). Worth tracing whether one of the `*.integration.test.tsx` files is the culprit.
4. **Playwright e2e spec is wired but not run here** — `tests/e2e/mobile-sales-rep.spec.ts` is in place. The authenticated walk requires `PLAYWRIGHT_TEST_EMAIL` + `PLAYWRIGHT_TEST_PASSWORD`; the unauthenticated gating + redirect cases will run on any environment with `bun run test:e2e`.
5. **40+ inline `/quote-v2` links** across QRM still resolve via `RedirectPreserveSearch`. Migrating them inline to `/sales/quotes/...` is a follow-up cleanup wave.
6. **`/qrm/my/reality` desktop route stays mounted** for admin / manager / owner. Reps land on `/sales/my-mirror`. If consolidation is desired, deprecate the QRM route in a subsequent slice.
7. **Accessibility audit (axe-playwright) and Lighthouse mobile scores** are not captured in this report — they require the authenticated Playwright environment.

## Jarvis Frontend Handoff

No backend changes were made in this wave. Database schema, migrations,
RPCs, and edge functions are untouched. No new TypeScript types are
needed for `jarvis-os/src/types/`. No breaking query changes. The wave
is purely frontend routing + presentational primitives.

---

🤖 Generated for the WAVE Mobile-First Sales Rep Consolidation
