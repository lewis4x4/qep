# WAVE — Quote Builder Per-Step Deep Reflow

**Target orchestrator:** RepoPrompt (multi-model fan-out, strangler-fig per slice)
**Repository:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
**Remote:** `github.com/lewis4x4/qep`
**Predecessor:** `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17; commits bf6a9b92 → a0b9b0a0)
**Scope owner:** Brian Lewis (Speedy)
**Operating mode:** Autonomous execution. Per CLAUDE.md, do not stop between green slices — extract, verify, push, continue.

---

## Mission Lock (per repo CLAUDE.md)

Every step that lands must pass:

1. **Mission Fit** — improves a real sales-rep quoting workflow on a phone
2. **Transformation** — keeps voice/intelligence/offline capabilities first-class, not buried
3. **Pressure Test** — verified on 375pt (iPhone SE), 390pt (iPhone 14), 428pt (iPhone 14 Pro Max), AND 768pt (iPad portrait) — the iPad case must still be single-column inside SalesShell, not a regression into desktop two-column
4. **Operator Utility** — every step usable one-handed; no field input requires switching to landscape

---

## Context

WAVE Mobile-First Sales Rep landed Quote Builder inside `SalesShell` and built the mobile primitives. The 11 step components in `apps/web/src/features/quote-builder/steps/` already collapse to single column at `<640px` because most grids use `sm:grid-cols-*`. This wave addresses the **density, intelligence-surfacing, sticky-action, and disclosure problems** still present inside those single columns — the parts that make a step feel "shrunken desktop" instead of "designed for phone."

**Already-built primitives to reuse (do NOT rebuild):**

| Primitive | Path | Use for |
|---|---|---|
| `MobileWizardStepper` | `apps/web/src/features/sales/components/MobileWizardStepper.tsx` | Already in WizardShell (Phase 1.3 of prior wave) |
| `MobileStickyActionBar` | `apps/web/src/features/sales/components/MobileStickyActionBar.tsx` | Per-step primary action |
| `MobileBottomSheet` | `apps/web/src/features/sales/components/MobileBottomSheet.tsx` | Every disclosure/dialog/right-rail panel |
| `MobileVoiceMicButton` | `apps/web/src/features/sales/components/MobileVoiceMicButton.tsx` | Voice-input affordance on any text field that accepts voice |
| `MobileSectionAccordion` | `apps/web/src/features/sales/components/MobileSectionAccordion.tsx` | Collapsible numbered sections inside long steps |
| `MobileKpiGrid` | `apps/web/src/features/sales/components/MobileKpiGrid.tsx` | Numeric stat strips inside Pricing/Financing/Review |
| `MobileIntelligencePanelHost` | `apps/web/src/features/quote-builder/components/MobileIntelligencePanelHost.tsx` | Surfaces AI panels as sheets |
| `mobile-design-tokens` | `apps/web/src/features/sales/lib/mobile-design-tokens.ts` | Source of truth for spacing, type ramp, surfaces |

**Sticky bar contract per step (label of the right primary action):**

| Step | Primary label |
|---|---|
| Customer | "Continue → Equipment" |
| Equipment | "Continue → Configure" |
| Configure | "Continue → Trade-in" |
| TradeIn | "Continue → Pricing" |
| **Pricing** | **"Continue → Promos"** |
| **Promotions** | **"Continue → Finance"** |
| **Financing** | **"Continue → Details"** |
| Details | "Continue → Review" |
| Review | "Continue → Document" |
| Document | "Continue → Send" |
| Send | "Send Quote" |

Left secondary on every step: "Save Draft" (already wired in WAVE Mobile-First).

---

## Slice Order (priority — money steps first)

Per Brian: money steps first within the wave, then the rest.

| Slice | Step | File | Lines today | Why first |
|---|---|---|---|---|
| **A1** | **Pricing** | `steps/PricingStep.tsx` | 428 | Highest density, margin gate is rep's #1 friction |
| **A2** | **Financing** | `steps/FinancingStep.tsx` | 241 | Calculator inputs + results need disclosure refactor |
| **A3** | **Promotions** | `steps/PromotionsStep.tsx` | 146 | Incentive stack tap-to-toggle on phone |
| B1 | Equipment | `steps/EquipmentStep.tsx` | 292 | Picker/dialog → bottom sheet |
| B2 | Configure | `steps/ConfigureStep.tsx` | 260 | Long config groups → accordion |
| B3 | TradeIn | `steps/TradeInStep.tsx` | 170 | Trade-in card composition |
| B4 | Details | `steps/DetailsStep.tsx` | 140 | Form field stacking + voice-mic on long fields |
| B5 | Review | `steps/ReviewStep.tsx` | 348 | Summary sections → accordion; workflow panels → sheets |

Customer (211 lines) was already deep-reflowed in WAVE Mobile-First Phase 1.4 — verify only, do not re-touch.
Document (134) and Send (177) are simple — verify only, do not re-touch unless test fails.

---

## Per-Step Specs

### A1 — Pricing (`steps/PricingStep.tsx`, 428 lines)

**Current desktop pattern observed:**
- `grid sm:grid-cols-[160px_minmax(0,1fr)_auto]` — line/value/action rows
- `grid sm:grid-cols-[minmax(0,1fr)_220px]` — content + side panel
- `grid sm:grid-cols-2` — paired adders
- `PricingAdderBuckets`, `MarginCheckBanner`, `MarginFloorGate`

**Mobile target:**
1. **Top compact margin strip** — convert `MarginCheckBanner` to a fixed pill row directly below the wizard stepper. Use `MobileKpiGrid` with 3 cells: `Margin %`, `Net $`, `Floor status` (green/amber/red dot). Sticky to top of step content (not page-fixed — scroll with content but pinned above adders).
2. **Line items** — replace the 3-column grid with a stacked card per line item:
   - Top row: model name + qty pill
   - Middle row: list price (struck through if discounted) + your price (large)
   - Bottom row: discount % chip + adjust button (opens `MobileBottomSheet` for inline price/discount editor)
3. **Adders** — `PricingAdderBuckets` becomes a `MobileSectionAccordion` titled "Adders & extras". Each adder is a tap-to-toggle pill, not a checkbox row.
4. **Margin floor gate** — `MarginFloorGate` triggers as a `MobileBottomSheet` modal (not inline banner) when rep tries to advance past floor. Sheet contains: explanation, required override field, supervisor-approval CTA.
5. **Sticky action bar** — left "Save Draft", right "Continue → Promos" disabled until margin passes floor OR override approved.
6. **Voice-mic** — none needed for Pricing.

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/PricingStep.tsx` — main rewrite
- `apps/web/src/features/quote-builder/components/PricingAdderBuckets.tsx` — accept `variant: 'desktop' | 'mobile'` prop OR split into `PricingAdderBuckets.mobile.tsx`
- `apps/web/src/features/quote-builder/components/MarginCheckBanner.tsx` — add `compact` mode
- `apps/web/src/features/quote-builder/components/MarginFloorGate.tsx` — extract trigger logic; wrap in `MobileBottomSheet` on mobile viewport

**Acceptance:**
- At 375pt: no horizontal scroll on Pricing step
- Margin strip always visible while scrolling adders
- Tap any line item → bottom sheet for inline edit; close preserves edits
- Floor breach → bottom sheet modal blocks Continue until resolved
- All existing `PricingStep` tests still green
- New test: `PricingStep.mobile.test.tsx` asserts margin strip rendered, line items stack, adders collapse

---

### A2 — Financing (`steps/FinancingStep.tsx`, 241 lines)

**Current desktop pattern:**
- Four `sm:grid-cols-2` blocks — inputs paired side-by-side on desktop, stack on mobile already
- `FinancingCalculator` component does the math

**Mobile target:**
1. **Calculator inputs section** (`MobileSectionAccordion` titled "Loan inputs", expanded by default):
   - Down payment (full-width currency input)
   - Term (segmented control: 24 / 36 / 48 / 60 / 72 months) — replace any dropdown
   - Rate (full-width % input)
   - Doc fees (full-width currency input)
   - Each input: `text-base` (16px+) to prevent iOS auto-zoom
2. **Results section** — initially shows skeleton until calculation runs. After calculation, becomes a **`MobileBottomSheet`** triggered by a "View payment" CTA chip:
   - Inside sheet: monthly payment (large), APR, total finance charge, total of payments, amortization preview (collapsed accordion)
3. **Cash vs Finance toggle** — segmented control at top of step
4. **Financing programs** — `FinancingPreviewCard` (already a sheet primitive) — keep as the "Programs" chip in the chip rail that triggers the bottom sheet
5. **Sticky action bar** — "Save Draft" left, "Continue → Details" right (disabled until cash OR finance scenario chosen)

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/FinancingStep.tsx` — restructure into accordion + sheet
- `apps/web/src/features/quote-builder/components/FinancingCalculator.tsx` — split desktop vs mobile presentation; preserve calc logic

**Acceptance:**
- All four `sm:grid-cols-2` blocks reflowed into accordion
- iPad portrait (768pt) still single-column — verify no horizontal pair regression
- Results sheet opens with full payment breakdown
- Test: `FinancingStep.mobile.test.tsx`

---

### A3 — Promotions (`steps/PromotionsStep.tsx`, 146 lines)

**Current desktop pattern:**
- `grid sm:grid-cols-3` — incentive cards in 3-col grid on desktop
- Already stacks on mobile

**Mobile target:**
1. **Header strip** — total promo savings as a single large number with caption "$X saved across N promos applied"
2. **Incentive cards** — full-width vertical stack. Each card:
   - Promo name + savings amount (right-aligned)
   - Eligibility note (small grey text)
   - Tap target: full card tap-to-toggle (currently may be a button inside the card)
   - Active state: orange left border accent + check icon
3. **Stack-on conflicts** — when two promos cannot stack, the conflicting one shows a dimmed amber state with "Conflicts with [other promo]" tooltip → tap opens `MobileBottomSheet` explaining the rule
4. **"Best stack" CTA** — a single primary button at top of the card list: "Apply best stack" → applies the highest-savings non-conflicting combination automatically
5. **Sticky action bar** — left "Save Draft", right "Continue → Finance"

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/PromotionsStep.tsx`
- `apps/web/src/features/quote-builder/components/IncentiveStack.tsx` — extract stack logic, add `onApplyBest` callback

**Acceptance:**
- Full-card tap toggles incentive
- Conflicts surface in sheet, not inline tooltip
- "Apply best stack" deterministically picks highest-savings valid combination
- Test: `PromotionsStep.mobile.test.tsx`

---

### B1 — Equipment (`steps/EquipmentStep.tsx`, 292 lines)

**Current pattern:**
- `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` rows
- Uses `EquipmentSelector` (inline component) — likely a desktop side-panel picker

**Mobile target:**
1. **Selected equipment list** — full-width stacked cards, each showing model + qty + thumbnail + remove button (overflow menu icon)
2. **Add equipment** — replace inline `EquipmentSelector` with `MobileBottomSheet` triggered by full-width "+ Add equipment" button at bottom of selected list. Sheet contains:
   - Search input (focused on open)
   - Category chips (horizontal scroll)
   - Result list (single column, tap-to-add)
   - Recent/recommended section at top before search
3. **Package lines** — `PackageItemSearchDialog` (currently a Dialog) → convert to `MobileBottomSheet`
4. **Qty editor** — replace any number input spinner with `MobileBottomSheet` containing tap-to-adjust qty pad (− / number / +) sized for thumb
5. **Sticky action bar** — left "Save Draft", right "Continue → Configure" disabled until ≥1 equipment selected

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/EquipmentStep.tsx`
- `apps/web/src/features/quote-builder/components/EquipmentSelector.tsx` — split desktop vs mobile, OR refactor to render-prop pattern
- `apps/web/src/features/quote-builder/components/PackageItemSearchDialog.tsx` — convert Dialog → MobileBottomSheet on mobile viewport
- `apps/web/src/features/quote-builder/components/CatalogBrowserDialog.tsx` — same conversion

**Acceptance:**
- No desktop Dialog renders on `<640px` — all converted to bottom sheets
- Catalog browser sheet is scrollable, sticky-header search
- Test: `EquipmentStep.mobile.test.tsx`

---

### B2 — Configure (`steps/ConfigureStep.tsx`, 260 lines)

**Current pattern:**
- `grid gap-2 md:grid-cols-[1fr_140px_auto]` — config rows with label/input/action
- Multiple config groups stacked

**Mobile target:**
1. **Each config group** wrapped in `MobileSectionAccordion` titled with the group name (e.g., "Bucket & attachments", "Cab options", "Hydraulics")
2. **First group expanded by default**, all others collapsed
3. **Config rows inside each group:**
   - Label (full-width, top)
   - Input/select (full-width, below label, NOT inline-right)
   - Inline help icon → `MobileBottomSheet` with the help text
4. **Required-vs-optional badges** — small inline pill on each label
5. **Group completion indicator** — accordion header shows `(3 / 5)` count of configured items
6. **Sticky action bar** — left "Save Draft", right "Continue → Trade-in" disabled until all required items configured

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/ConfigureStep.tsx`

**Acceptance:**
- Each group collapsible
- Required-item count visible without opening group
- Help opens as sheet
- Test: `ConfigureStep.mobile.test.tsx`

---

### B3 — TradeIn (`steps/TradeInStep.tsx`, 170 lines)

**Current pattern:**
- `grid gap-2 sm:grid-cols-2` — paired fields
- Uses `PointShootTradeCard`

**Mobile target:**
1. **Trade-in entries** — full-width stacked cards. Each card:
   - Top: equipment make/model/year (large)
   - Middle: condition pill + appraised value (right-aligned)
   - Bottom: tap to expand inline edit (or open `MobileBottomSheet` for full edit)
2. **Add trade-in** — full-width button below list opens a sheet with the appraisal form
3. **Point-and-shoot trade capture** — `PointShootTradeCard` becomes a sheet-launched flow:
   - "📸 Photo appraisal" CTA → opens camera-input sheet
   - After capture, sheet shows extracted details + appraisal estimate
4. **Voice notes on trade-in condition** — embed `MobileVoiceMicButton` next to the "Condition notes" textarea for voice → text dictation
5. **Sticky action bar** — left "Save Draft", right "Continue → Pricing" (always enabled — trade-in optional)

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/TradeInStep.tsx`
- `apps/web/src/features/quote-builder/components/PointShootTradeCard.tsx`

**Acceptance:**
- Point-and-shoot flow opens in sheet, not separate route
- Voice note on condition transcribes inline
- Test: `TradeInStep.mobile.test.tsx`

---

### B4 — Details (`steps/DetailsStep.tsx`, 140 lines)

**Current pattern:**
- `grid gap-3 sm:grid-cols-2` — paired fields

**Mobile target:**
1. **Fields stack** — full-width inputs, label-above-input pattern (not inline-left)
2. **Long text fields** (special instructions, delivery notes, internal notes):
   - `<textarea>` with `MobileVoiceMicButton` positioned bottom-right inside the field
   - Voice → text appends to current value, doesn't replace
3. **Date pickers** (delivery date, expiration) — use native `<input type="date">` for mobile, not custom datepicker library — better thumb UX
4. **Sticky action bar** — left "Save Draft", right "Continue → Review"

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/DetailsStep.tsx`

**Acceptance:**
- Voice mic on every textarea, transcribes to that field
- Native date picker on mobile
- Test: `DetailsStep.mobile.test.tsx`

---

### B5 — Review (`steps/ReviewStep.tsx`, 348 lines)

**Current pattern:**
- `grid gap-3 sm:grid-cols-2` for summary blocks
- Uses `ReviewSummaryBlock`, `QuoteReviewWorkflowPanels`, `SummaryRow`

**Mobile target:**
1. **Top hero** — total quote value (large) + status badge + customer name
2. **Summary sections** — `MobileSectionAccordion` per section:
   - Customer (expanded)
   - Equipment + configure summary
   - Trade-in
   - Pricing breakdown (with margin chip)
   - Promotions applied
   - Financing terms
   - Details (delivery/notes)
   Each section: tap to expand, "Edit" button in accordion header jumps back to that step via `MobileWizardStepper`
3. **Approval workflow panels** — `QuoteReviewWorkflowPanels` becomes per-approval cards, vertically stacked. Each card: approver name + status + "Request" or "Pending since X" + tap → `MobileBottomSheet` with approval detail
4. **Quote PDF preview** — full-width thumbnail card with "Preview PDF" CTA → opens `MobileBottomSheet` with PDF viewer (use existing `QuotePDFDocument` rendered into the sheet)
5. **Sticky action bar** — left "Save Draft", right "Continue → Document"

**Files to touch:**
- `apps/web/src/features/quote-builder/steps/ReviewStep.tsx`
- `apps/web/src/features/quote-builder/components/ReviewSummaryBlock.tsx`
- `apps/web/src/features/quote-builder/components/QuoteReviewWorkflowPanels.tsx`
- `apps/web/src/features/quote-builder/components/SummaryRow.tsx`

**Acceptance:**
- Every section collapsible; "Edit" jumps to source step preserving state
- Approval requests work from sheet
- PDF preview renders in sheet
- Test: `ReviewStep.mobile.test.tsx`

---

## Cross-Step Conventions (apply to every slice)

1. **Tap targets ≥44pt** — verify via test helper at end of each slice
2. **No iOS auto-zoom** — every text input uses `text-base` (16px) or larger
3. **No desktop `Dialog`/`AlertDialog`** at `<640px` viewport — convert to `MobileBottomSheet` via media-query hook
4. **All sticky-action-bar primary actions** correctly disable when step is invalid
5. **All accordions** preserve open/closed state across step navigation (use sessionStorage keyed by `quoteId + stepId + sectionId`)
6. **All step-level voice inputs** route through `MobileVoiceMicButton` → existing transcription pipeline (do not introduce new voice infra)
7. **`MobileSectionAccordion`** must NEVER nest more than 2 levels deep — flatten if it would
8. **Performance:** each step renders below 16ms on a simulated mid-tier phone (Lighthouse mobile perf ≥85 per step)

---

## Reusable Helper to Build (Slice 0 of this wave)

Before A1, create `apps/web/src/features/sales/hooks/useIsMobileViewport.ts`:

```ts
import { useSyncExternalStore } from "react";

const BREAKPOINT = 640;

function subscribe(cb: () => void) {
  const mql = window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`).matches,
    () => true, // SSR default to mobile-first
  );
}
```

Use this hook to gate Dialog → MobileBottomSheet swaps throughout the steps. Add unit test `useIsMobileViewport.test.ts`.

---

## Build Gates (per CLAUDE.md, run after every slice)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
bun run build

cd apps/web
bun run build
bun run test -- --run        # vitest
```

**Per-slice commit format:** `[wave-qb-reflow] <step-name> deep reflow`

**Do not close a slice if any gate fails.** Investigate, fix, then commit.

---

## Verification Slice (closes the wave)

After B5 ships, add an end-to-end playwright test at `apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts`:

1. Viewport 390x844
2. Login as rep
3. `/sales/quotes/new`
4. Walk all 11 steps using `MobileWizardStepper`, fill each step with realistic data
5. At each step:
   - Assert no horizontal scroll
   - Assert all interactive elements ≥44pt
   - Assert no `[role="dialog"]:not([data-mobile-sheet])` is open (catches missed Dialog conversions)
   - Assert sticky action bar visible
6. Complete the quote through SendStep
7. Verify quote appears in `/sales/quotes` list

Plus axe-playwright accessibility scan per step — zero serious/critical violations target.

Generate ship report: `WAVE-QUOTE-BUILDER-DEEP-REFLOW-SHIP-REPORT-YYYY-MM-DD.md` at repo root summarizing files touched, primitives used, tests added, Lighthouse mobile scores per step, axe results, and any deferred items.

---

## Out of Scope (do not touch)

- Step-flow ordering — wizard sequence is locked
- Pricing math, margin formulas, financing calculator math — UI only, logic preserved
- Backend edge functions, migrations, RLS — none required
- QRM admin routes — all `/qrm/*` admin pages remain desktop-only
- Customer step — already deep-reflowed in prior wave
- Document & Send steps — currently acceptable; only touch if verification slice fails them

---

## /goal one-liner

```
/goal Execute WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md at the repo root /Users/brianlewis/Projects/qep-knowledge-assistant. Work slices in this exact order: useIsMobileViewport hook → A1 Pricing → A2 Financing → A3 Promotions → B1 Equipment → B2 Configure → B3 TradeIn → B4 Details → B5 Review → Verification. After every slice, run build gates (bun run migrations:check, bun run build at root, bun run build + bun run test --run in apps/web), commit with [wave-qb-reflow] <step-name> deep reflow prefix, push to origin/main, then continue to the next slice. Use existing primitives from features/sales/components (MobileWizardStepper, MobileStickyActionBar, MobileBottomSheet, MobileVoiceMicButton, MobileSectionAccordion, MobileKpiGrid) and features/quote-builder/components (MobileIntelligencePanelHost) — do not rebuild them. Convert any desktop Dialog/AlertDialog inside steps to MobileBottomSheet at <640px via useIsMobileViewport. Do not stop between green slices. Stop only if a build gate fails after a reasonable fix attempt, an irreversible destructive decision is required, or the spec is genuinely ambiguous. When all slices close green, write WAVE-QUOTE-BUILDER-DEEP-REFLOW-SHIP-REPORT-YYYY-MM-DD.md at the repo root.
```
