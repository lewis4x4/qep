# WAVE Quote Builder Parity Close — Ship Report
**Date:** 2026-05-17
**Branch:** `main`
**Commits prefix:** `[wave-qb-parity]`
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant` → `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QB-CI-QUALITY-HANDOFF.md` (closed 2026-05-17)
- `WAVE-QB-QUALITY-TAIL-HANDOFF.md` (closed 2026-05-17)

**Reference:** `WAVE-QB-PARITY-CLOSE-HANDOFF.md`

---

## Outcome

The Quote Builder mobile-first parity arc is closed. The three steps
the deep-reflow wave didn't touch — Customer (step 1), Document
(step 10), and Send (step 11) — now match the established
`<lg` / `<640px` reflow pattern, and the residual `/quote-v2` doc
comments that survived the polish-wave link sweep are gone with a
guard test in place to keep them out. All 11 wizard steps are now
phone-native.

## Slice ledger

| # | Slice | Commit | Status |
|---|---|---|---|
| 1 | `CustomerStep` deep reflow | `0c15f2a4` | ✅ shipped |
| 2 | `DocumentStep` deep reflow | `748d1547` | ✅ shipped |
| 3 | `SendStep` deep reflow | `eb77a550` | ✅ shipped |
| 4 | Kill residual `/quote-v2` inline links | `cbad9b6f` | ✅ shipped |
| — | Verification + ship report | this commit | ✅ |

## Per-slice pieces

### Slice 1 — `CustomerStep.tsx`

| Piece | Change |
|---|---|
| Picker surface | Phone reps reach `CustomerPicker` via a `MobileBottomSheet` (`size="tall"`, `data-mobile-sheet="true"`) launched from a full-width "Find a customer" button. Sibling "Add new customer" CTA goes straight to manual entry. Desktop keeps the existing inline `CustomerSection`. |
| Selected-chip / manual modes | Stay inline on both viewports — they're tiny and need persistent visibility. |
| Guardrail card | Collapses into a `MobileSectionAccordion` (default closed) on phone so informational copy doesn't push the primary action below the fold. Desktop renders the inline Card. |
| Tap targets | All visible mobile buttons land `min-h-[44px]`. |
| Test | New `CustomerStep.mobile.test.tsx` — 4 cases (mobile trigger pair renders 44pt, sheet panel carries `data-mobile-sheet="true"`, desktop stays inline, mobile surface hidden at `>= sm`). |

### Slice 2 — `DocumentStep.tsx`

| Piece | Change |
|---|---|
| Sticky action row | Generate Preview PDF + Print Preview pin to `sticky bottom-0` with inline `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.75rem)` so iOS Safari URL chrome can't bury the primary CTAs. Desktop renders the inline action column inside the preview Card. |
| Preview summary | Title + customer total + persistence label render in a compact phone card with a "View summary" trigger that opens the full SummaryRow grid inside a `MobileBottomSheet`. Desktop renders the full grid inline. |
| Storage-artifact intro | Collapses into a `MobileSectionAccordion` (default closed) on phone. |
| Tap targets | Generate / Print / footer Back + Send & log buttons all `min-h-[44px]`. |
| Test | New `DocumentStep.mobile.test.tsx` — 4 cases (sticky row carries sticky + bottom-0 classes, action buttons 44pt, preview sheet opens with `data-mobile-sheet="true"`, desktop card surface intact). |

### Slice 3 — `SendStep.tsx`

| Piece | Change |
|---|---|
| Readiness diagnostics | Approval / Document / Follow-up / Tax / Why this machine collapse into a `MobileSectionAccordion` on phone with a live "All gates clear" / "Action needed" caption — default-open when blockers exist, default-closed once everything is green. Follow-up datetime input and post-approval routing strip nest inside. Desktop keeps the inline Card. |
| Full-bleed success state | A landed delivery (`deliveryActionMessage`) lights up an emerald banner with a check icon at the top of the phone surface (`role="status"`, `aria-live="polite"`). Desktop keeps the existing inline strip below the action cards. |
| Sticky footer | Back + Save follow-up pin to `sticky bottom-0` with safe-area inset on phone. Desktop renders the standard inline footer. |
| Datetime input | `text-base` on phone (no iOS auto-zoom), `min-h-[44px]` everywhere. |
| Test | New `SendStep.mobile.test.tsx` — 5 cases (readiness accordion + caption, sticky footer with 44pt CTAs, full-bleed success banner with `role="status"`, desktop inline rows, desktop never shows the mobile-only banner). |

The brief's "contact picker → `MobileBottomSheet`" item doesn't apply
to SendStep — the customer was selected in `CustomerStep` (Slice 1)
and the picker sheet shipped there. SendStep has no separate contact
selection.

### Slice 4 — `/quote-v2` inline-link sweep

| Piece | Change |
|---|---|
| `apps/web/src/App.tsx` × 2 | Rephrased the legacy-redirect doc comments to drop the literal `/quote-v2` string. The route mount `<Route path="/quote-v2" element={<RedirectPreserveSearch …/>} />` is untouched — that's the inbound-bookmark redirect. |
| `apps/web/src/components/AppLayout.tsx` × 1 | Same rephrase on the `quoteWorkspaceRoute` comment. |
| Guard test | New `features/quote-builder/lib/__tests__/no-residual-quote-v2-links.test.ts` walks every `.ts` / `.tsx` under `apps/web/src` via `Bun.Glob`, excludes `*.test.*` / `*.spec.*` / `*.d.ts` / `__tests__/`, and fails if any `/quote-v2` literal lands on a line that doesn't reference `RedirectPreserveSearch`. Future regressions surface under `bun run test`. |

Final repo grep:
```
grep -rn "/quote-v2" apps/web/src --include="*.tsx" --include="*.ts" \
  | grep -v "RedirectPreserveSearch\|redirect-preserve\|.test.\|.spec." \
  | wc -l
```
returns `0`.

## Build gates

| Gate | Result |
|---|---|
| `bun run migrations:check` (root) | ✅ 576 files, sequence 001..578 |
| `bun run build` (root) | ✅ green |
| `bun run build` (`apps/web`) | ✅ green |
| `bun run typecheck` (`apps/web`) | ✅ green |
| `bun run test` (canonical sweep — per-file isolation) | ✅ all 22 file(s) green |
| Targeted regression (sales + quote-builder + lib) | ✅ 1537/1537 pass (+14 new tests across the wave) |
| Residual `/quote-v2` grep | ✅ 0 hits |

Every slice ran the per-slice gate set before commit + push; the
final completion gate runs again before the ship-report commit.

## What's left

Inherited from the predecessor waves; out of scope here per the
parity-close handoff.

1. **Real authenticated Lighthouse baseline.** The
   `lighthouse-mobile` workflow is wired (CI/Quality wave Slice 1 +
   Quality Tail Slice 1) but the per-route scores will land on the
   next same-repo PR that runs the new path end-to-end against
   staging. Thresholds are locked.
2. **Remaining bun:test mock.module pollution.** Raw `bun test`
   still reports ~31 fails — all pass under `bun run test` (the
   canonical per-file isolation sweep that CI gates on). Upstream
   bun limitation; no userland fix.
3. **Multi-approver backend wave.** Still queued behind Brian's
   product direction on the workflow design.

## Jarvis Frontend Handoff

No backend changes were made in this wave. Database schema,
migrations, RPCs, edge functions, and RLS are untouched. No new
TypeScript types needed in `jarvis-os/src/types/`. The wave is purely
frontend reflow + a guard test:

- 3 step components reflowed for `<640px` (Customer, Document, Send).
- 3 doc comments rephrased to drop the literal `/quote-v2`.
- 1 guard test added to keep new inline `/quote-v2` references out of
  `apps/web/src`.
- 14 new tests landed (4 + 4 + 5 + 1 across the slices).

The Quote Builder mobile-first parity arc is closed. All 11 wizard
steps now follow the established `<lg` single-column / `<640px`
sheet-swap pattern.

---

🤖 Generated for the WAVE Quote Builder Parity Close
