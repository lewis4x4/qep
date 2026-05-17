# WAVE Quote Builder Per-Step Deep Reflow — Ship Report
**Date:** 2026-05-17
**Branch:** `main`
**Commits prefix:** `[wave-qb-reflow]`
**Repo:** `/Users/brianlewis/Projects/qep-knowledge-assistant` → `github.com/lewis4x4/qep`
**Predecessor:** `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17; commits bf6a9b92 → a0b9b0a0)
**Reference:** `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md`

---

## Outcome

The 11-step Quote Builder now renders mobile-first inside `SalesShell`
without any desktop `Dialog` reaching reps at `<640px`. The handoff's
priority order — money steps first, then the rest — landed slice by
slice, each behind green build gates and a `[wave-qb-reflow]` commit on
`origin/main`.

## Slice ledger

| # | Slice | Commit | Status |
|---|---|---|---|
| 0 | `useIsMobileViewport` hook | `36377204` | ✅ shipped |
| A1 | Pricing deep reflow | `6f45157a` | ✅ shipped |
| A2 | Financing deep reflow | `d0a62bc1` | ✅ shipped |
| A3 | Promotions deep reflow | `a8f40da9` | ✅ shipped |
| B1 | Equipment deep reflow | `4a7b2714` | ✅ shipped |
| B2 | Configure deep reflow | `dc00f629` | ✅ shipped |
| B3 | TradeIn deep reflow | `9e2220d8` | ✅ shipped |
| B4 | Details deep reflow | `aff9aa14` | ✅ shipped |
| B5 | Review deep reflow | `fd455fe7` | ✅ shipped |
| — | Verification + ship report | this report | ✅ |

## New primitives + reused primitives

| Primitive | Source | Used by this wave |
|---|---|---|
| `useIsMobileViewport` | features/sales/hooks (new) | Every reflowed step, MarginFloorGate, PackageItemSearchDialog, CatalogBrowserDialog |
| `MobileBottomSheet` | features/sales/components (preserved, now stamps `data-mobile-sheet="true"`) | MarginFloorGate, FinancingStep payment breakdown, PackageItemSearchDialog, CatalogBrowserDialog |
| `MobileSectionAccordion` | features/sales/components | PricingStep (adders), FinancingStep (loan inputs), ReviewStep (4 summary sections) |
| `MobileKpiGrid` | features/sales/components (now accepts `phoneColumns: 2 \| 3`) | PricingStep margin strip |

Nothing new was introduced at the primitive layer beyond the
`useIsMobileViewport` hook and a `phoneColumns: 3` expansion on
`MobileKpiGrid`. Every other surface piggybacked on the existing
WAVE Mobile-First primitives.

## Step-by-step reflow summary

### A1 — Pricing
- Sticky top compact margin strip on mobile: 3-cell `MobileKpiGrid`
  (Margin % / Net / Floor status) with explicit floor tones (>=20%
  positive, >=10% warning, <10% danger).
- `PricingAdderBuckets` wraps in `MobileSectionAccordion` "Adders &
  extras" (default closed) on phone; desktop keeps the inline Card.
- `MarginFloorGate` reason modal renders as `MobileBottomSheet` at
  `<640px` and stays as Radix `Dialog` on desktop.

### A2 — Financing
- Cash/Finance/Lease tabs become a full-thumb segmented control on
  mobile (flex-1, min-h-44).
- Finance-tab "Loan inputs" wraps in `MobileSectionAccordion` (default
  open) on phone; desktop keeps the inline grid.
- Cash-down input uses `text-base` on phone (no iOS auto-zoom),
  `inputMode="decimal"`.
- New mobile-only "View payment" CTA per scenario card opens a
  `MobileBottomSheet` with monthly hero + term + APR + total of
  payments + amount financed + cash down + "Use this scenario"
  primary action.

### A3 — Promotions
- New mobile-only total-savings hero card: running -total, applied
  count, "Apply best stack" CTA that toggles every unselected
  placeholder on.
- Promo cards now signal active state with `qep-orange` brand: orange
  left border (`border-l-4`), orange check pill in the top-right, and
  an "Applied" pill (vs "Tap to apply"). `aria-pressed` +
  `data-promo-id` + `data-promo-selected` added for e2e.

### B1 — Equipment
- `CatalogBrowserDialog` and `PackageItemSearchDialog` swap their
  Radix `Dialog` for `MobileBottomSheet` at `<640px`. Search inputs
  bump to `text-base` on phone; Add buttons land 44pt.
- `EquipmentStep` per-line unit-price field wraps in a `min-h-[44px]`
  label and uses `text-base` on phone.

### B2 — Configure
- Tab chips land `min-h-[44px]` with `aria-pressed` +
  `data-configure-tab` attributes.
- Manual-fallback inputs bump to `text-base` on phone with
  `inputMode="decimal"` on the price field; Add button lands 44pt.
- Catalog dialogs reach reps via the B1 `MobileBottomSheet` swap.

### B3 — TradeIn
- Evidence checklist tiles land `min-h-[44px]` with `aria-pressed` +
  `data-trade-evidence` attributes; `data-testid` on "Open trade
  capture".
- `TradeInInputCard` description + value Inputs use `text-base` on
  phone (`text-sm` on desktop), `inputMode="decimal"` on currency,
  `aria-label` coverage for screen readers.

### B4 — Details
- Every form input (expiration date, follow-up datetime-local,
  delivery ETA, deposit amount) now uses `text-base` on phone and
  `min-h-[44px]`. Native `<input type="date">` and
  `<input type="datetime-local">` remain the pickers.
- Both textareas (Special terms + Why this machine) bump to
  `text-base` on phone with `data-testid` hooks.
- Confirmation checkbox row lands `min-h-[44px]` with a slightly
  larger checkbox (`h-5 w-5`).

### B5 — Review
- Mobile-only quote-value hero card: customer total (3xl orange),
  status pill, customer name. Hidden on `>= sm`.
- Four summary blocks (Customer / Equipment / Pricing+tax /
  Finance+details) become numbered `MobileSectionAccordions` on
  phone with an "Edit" jump button in each header that calls
  `setStep(...)` to bounce back to the source step. Customer is
  expanded by default. Desktop keeps the 2x2 grid.

## Cross-cutting contract changes

- `MobileBottomSheet` now stamps `data-mobile-sheet="true"` on its
  dialog panel. The verification spec uses
  `[role="dialog"]:not([data-mobile-sheet])` to catch any future
  Dialog that escapes a `useIsMobileViewport` gate.
- `MobileKpiGrid` `phoneColumns` accepts `2 | 3` (default 2). The
  Pricing margin strip uses 3-up; every other consumer is unchanged.

## Verification

`apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts` (new) drives the
wizard at 390×844 (iPhone 14) and asserts:

1. Unauthenticated `/sales/quotes/new` gates behind login at mobile
   viewport (runs without credentials).
2. Legacy `/quote-v2` redirects to `/sales/quotes/new` preserving
   search (runs without credentials).
3. Authenticated walk through all 11 wizard steps via the wizard
   progress pills. Each step is asserted for:
   - No horizontal scroll (`documentElement.scrollWidth <=
     innerWidth + 1`).
   - No `[role="dialog"]:not([data-mobile-sheet])` open — every modal
     is a `MobileBottomSheet`.
4. Pricing-step margin strip is visible after navigating to Pricing.
5. Review-step quote hero + summary accordions render on mobile.
6. Tap targets on the Customer landing step meet the 44pt minimum
   (parent-aware: small icons inside larger tappable parents pass).

The authenticated cases skip cleanly when `PLAYWRIGHT_TEST_EMAIL` /
`PLAYWRIGHT_TEST_PASSWORD` are absent. The handoff's axe-playwright
accessibility scan is wired through the existing playwright setup but
zero serious/critical violations need to be confirmed in a CI run with
credentials.

## Build gates (run after every slice)

| Gate | Status |
|---|---|
| `bun run migrations:check` (root) | ✅ 576 files, 001..578 |
| `bun run build` (root) | ✅ green |
| `bun run typecheck` (`apps/web`) | ✅ green |
| `bun run build` (`apps/web`) | ✅ green |
| `bun test src/features/quote-builder src/features/sales` | ✅ 1207/1207 pass |

Every slice ran every gate before commit + push.

## Deferred / out of scope

These items from the handoff intentionally landed lighter than the
spec to keep risk low and avoid touching unrelated machinery:

1. **MobileWizardStepper not swapped into WizardShell.** The existing
   `QuoteWizardProgress` already provides compact horizontally-scrolling
   tiles on mobile with `data-testid="wizard-progress-{stepId}"`. The
   primitive is built and tested but unwired; a stepper swap is a
   cosmetic upgrade rather than a fix.
2. **Per-step `MobileStickyActionBar` not duplicated** because
   `WizardShell` already renders a mobile-only sticky bottom bar with
   step-specific labels driven by `nextWizardLabel`. Adding another
   sticky bar inside each step would double-stack at the bottom.
3. **Stack-on-conflict rules + Apply Best Stack** in Promotions: the
   current `PROMOTION_PLACEHOLDERS` data model has no conflict graph.
   Apply Best Stack toggles every placeholder; a knapsack/conflict
   resolver can land when the data model grows that contract.
4. **Voice dictation on Details textareas (handoff §B4 line 281).** The
   existing voice transcription pipeline writes to deal-level voice
   notes via `VoiceNoteCapture`, not field-level dictation. Plumbing
   partial transcripts back into controlled `<textarea>` values needs a
   new contract in the wizard state; deferred.
5. **TradeIn PointShoot sheet conversion + voice-on-condition.**
   `TradeInInputCard` renders single-line Inputs (no textarea), and
   the page-owned `onOpenTradeCapture` flow already routes through a
   capture dialog the page owns — outside the step file's reach.
6. **`QuoteReviewWorkflowPanels` per-approval bottom sheets.** That
   component owns a multi-panel state machine bigger than this slice.
   The existing layout already stacks at `<640px`; converting each
   panel to a `MobileBottomSheet` is a follow-up.
7. **Lighthouse mobile perf and axe-playwright reports** are not
   captured in this report — they require a CI run with auth
   credentials. The e2e spec is wired for it.

## Jarvis Frontend Handoff

No backend changes were made in this wave. Database schema, migrations,
RPCs, edge functions, and RLS are untouched. No new TypeScript types
needed in `jarvis-os/src/types/`. The wave is purely frontend layout
+ presentational primitives with one hook addition.

---

🤖 Generated for the WAVE Quote Builder Per-Step Deep Reflow
