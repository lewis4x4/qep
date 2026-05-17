# WAVE — Quote Builder Polish + Wizard Stepper Swap

**Target orchestrator:** RepoPrompt (multi-model fan-out, strangler-fig per slice)
**Repository:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
**Remote:** `github.com/lewis4x4/qep`
**Predecessors:**
- `WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md` (closed 2026-05-17; commits bf6a9b92 → a0b9b0a0)
- `WAVE-QUOTE-BUILDER-DEEP-REFLOW-HANDOFF.md` (closed 2026-05-17; commits 36377204 → 8af48312)

**Scope owner:** Brian Lewis (Speedy)
**Operating mode:** Autonomous execution per CLAUDE.md. Strangler-fig: extract → verify → push → continue.

---

## Mission Lock

Every slice must pass:

1. **Mission Fit** — closes a real UX rough edge a rep hits inside the mobile quote builder
2. **Transformation** — voice + intelligence stay first-class; no regression of mobile primitives
3. **Pressure Test** — verified at 375pt / 390pt / 428pt phone viewports AND 768pt iPad portrait
4. **Operator Utility** — every change measurably improves rep speed or accuracy in the field

---

## Context

The two prior waves landed the mobile shell, hosted Quote Builder inside `SalesShell`, and deep-reflowed all 11 steps. This wave closes the remaining UX gaps surfaced in the two ship reports:

| Gap | Source | This wave |
|---|---|---|
| `MobileWizardStepper` not yet swapped into `WizardShell` (rep still sees fallback stepper) | WAVE 1 + 2 deferred | **Slice 1** |
| Textareas across steps have no voice dictation affordance | WAVE 2 deferred | **Slice 2** |
| `PointShootTradeCard` / `TradeCaptureDialog` still render as desktop Dialog | WAVE 2 deferred | **Slice 3** |
| `QuoteReviewWorkflowPanels` approvals not yet per-approval `MobileBottomSheet` | WAVE 2 deferred | **Slice 4** |
| Hardcoded `/quote-v2` and `/quote` deep links across 17+ files break the SalesShell entry pattern | WAVE 1 deferred | **Slice 5** |
| `MarginFloorGate`, `TradeCaptureDialog`, `ReviewSendDialog`, `OutcomeCaptureDrawer` still use desktop drawer/dialog patterns inside flow | observed | **Slice 6** |

**CI/quality items** (Lighthouse, axe, bun:test cross-file pollution, full-suite hang) are **out of scope** here — handled in the follow-on `WAVE-QB-CI-QUALITY-HANDOFF.md` so this wave stays user-visible-UX-only.

---

## Existing Primitives to Reuse (do NOT rebuild)

| Primitive | Path |
|---|---|
| `MobileWizardStepper` | `apps/web/src/features/sales/components/MobileWizardStepper.tsx` |
| `MobileStickyActionBar` | `apps/web/src/features/sales/components/MobileStickyActionBar.tsx` |
| `MobileBottomSheet` | `apps/web/src/features/sales/components/MobileBottomSheet.tsx` |
| `MobileVoiceMicButton` | `apps/web/src/features/sales/components/MobileVoiceMicButton.tsx` |
| `MobileSectionAccordion` | `apps/web/src/features/sales/components/MobileSectionAccordion.tsx` |
| `MobileKpiGrid` | `apps/web/src/features/sales/components/MobileKpiGrid.tsx` |
| `useIsMobileViewport` | `apps/web/src/features/sales/hooks/useIsMobileViewport.ts` |
| `MobileIntelligencePanelHost` | `apps/web/src/features/quote-builder/components/MobileIntelligencePanelHost.tsx` |
| `mobile-design-tokens` | `apps/web/src/features/sales/lib/mobile-design-tokens.ts` |

**New primitives required (in Slice 2):**

| Primitive | New file | Purpose |
|---|---|---|
| `MobileVoiceTextarea` | `apps/web/src/features/sales/components/MobileVoiceTextarea.tsx` | Wraps `<textarea>` with `MobileVoiceMicButton` overlay; voice transcript appends to current value; works with `react-hook-form` via `forwardRef` + standard `name/value/onChange` API |

---

## Slice Order

1. WizardShell stepper swap (high visibility, isolated)
2. `MobileVoiceTextarea` primitive + roll out across steps
3. PointShoot + Trade capture → MobileBottomSheet
4. Review per-approval workflow sheets
5. `/quote-v2` link sweep
6. Remaining drawer/dialog conversions inside flow

---

## Slice Specs

### Slice 1 — WizardShell Stepper Swap

**Goal:** `MobileWizardStepper` replaces the fallback stepper inside `WizardShell` on mobile viewport.

**Files:**
- `apps/web/src/features/quote-builder/wizard/WizardShell.tsx` — mount point
- `apps/web/src/features/quote-builder/wizard/WizardProgress.tsx` — current implementation (keep for desktop fallback)
- `apps/web/src/features/quote-builder/wizard/wizard-navigation.ts` — step list source

**Implementation:**
1. Inside `WizardShell.tsx`, read viewport via `useIsMobileViewport()`
2. When mobile: render `<MobileWizardStepper steps={steps} onStepClick={navigateToStep} />` where `steps` is mapped from `wizard-navigation.ts` with `status: 'done' | 'current' | 'locked'` per the existing wizard state
3. When desktop: render existing `<WizardProgress />` unchanged
4. Pin current step into view on render via `MobileWizardStepper`'s built-in auto-scroll
5. Ensure step labels match prior wave's per-step sticky-action-bar contract (Customer → Equipment → Configure → Trade-in → Pricing → Promos → Finance → Details → Review → Document → Send)

**Acceptance:**
- 375pt viewport: WizardShell renders MobileWizardStepper, no horizontal page overflow
- 1280pt viewport: WizardShell renders WizardProgress unchanged (no desktop regression)
- Tap a step chip → navigates correctly + preserves form state
- Test: `apps/web/src/features/quote-builder/wizard/__tests__/WizardShell.mobile.test.tsx` — asserts MobileWizardStepper renders at mobile viewport, WizardProgress renders at desktop

**Commit:** `[wave-qb-polish] WizardShell mobile stepper swap`

---

### Slice 2 — MobileVoiceTextarea + Step Rollout

**Goal:** Every multiline text input in quote-builder gets voice dictation.

**2.1 — Build the primitive**

Create `apps/web/src/features/sales/components/MobileVoiceTextarea.tsx`:

```tsx
import { forwardRef, useCallback, useState } from "react";
import { MobileVoiceMicButton } from "./MobileVoiceMicButton";
import { useIsMobileViewport } from "../hooks/useIsMobileViewport";
import { cn } from "@/lib/utils";

export interface MobileVoiceTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  voiceEnabled?: boolean;
  onTranscriptAppend?: (text: string) => void;
}

export const MobileVoiceTextarea = forwardRef<
  HTMLTextAreaElement,
  MobileVoiceTextareaProps
>(function MobileVoiceTextarea(
  { className, voiceEnabled = true, onChange, onTranscriptAppend, value, ...rest },
  ref,
) {
  const isMobile = useIsMobileViewport();
  const showMic = voiceEnabled && isMobile;

  const handleTranscript = useCallback(
    (transcript: string) => {
      const current = typeof value === "string" ? value : "";
      const next = current ? `${current.trimEnd()} ${transcript}`.trim() : transcript;
      const event = {
        target: { value: next, name: rest.name },
        currentTarget: { value: next, name: rest.name },
      } as React.ChangeEvent<HTMLTextAreaElement>;
      onChange?.(event);
      onTranscriptAppend?.(transcript);
    },
    [value, onChange, onTranscriptAppend, rest.name],
  );

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-white/10 bg-background/40 px-3 py-2 text-base placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-qep-orange",
          showMic && "pr-14",
          className,
        )}
        value={value}
        onChange={onChange}
        {...rest}
      />
      {showMic && (
        <div className="absolute bottom-2 right-2">
          <MobileVoiceMicButton
            size="sm"
            onTranscript={handleTranscript}
            aria-label="Dictate into this field"
          />
        </div>
      )}
    </div>
  );
});
```

Add unit test `apps/web/src/features/sales/components/__tests__/MobileVoiceTextarea.test.tsx`:
- Renders textarea
- Mic visible only at mobile viewport
- Transcript appends to existing value with single-space separator
- onChange fires synthetic event with combined value
- forwardRef preserved

**2.2 — Rollout (replace `<textarea>` with `<MobileVoiceTextarea>` in these files):**

| File | Field(s) |
|---|---|
| `apps/web/src/features/quote-builder/wizard/IntakeInput.tsx` | fast-intake textarea |
| `apps/web/src/features/quote-builder/components/OutcomeCaptureDrawer.tsx` | outcome notes |
| `apps/web/src/features/quote-builder/components/QuoteReviewWorkflowPanels.tsx` (lines 384, 394) | approval notes |
| `apps/web/src/features/quote-builder/components/ConversationalDealEngine.tsx` | conversational input |
| `apps/web/src/features/quote-builder/components/DealCopilotPanel.tsx` | copilot prompt |
| `apps/web/src/features/quote-builder/components/EquipmentSelector.tsx` | equipment notes |
| `apps/web/src/features/quote-builder/components/MarginFloorGate.tsx` | override justification |
| `apps/web/src/features/quote-builder/components/TradeCaptureDialog.tsx` | trade-in condition notes |
| `apps/web/src/features/quote-builder/components/ReviewSendDialog.tsx` | send-email body |

Preserve existing props (rows, placeholder, maxLength, aria-label, name, etc.) and form integration. Do not change validation or submit behavior.

**Acceptance:**
- Mic icon appears only at `<640px` viewport
- Dictation appends to existing value (does not replace)
- All existing tests pass; new `MobileVoiceTextarea.test.tsx` passes
- Manual smoke: dictate into IntakeInput at 390pt → text appears, sticky action bar still works

**Commit:** `[wave-qb-polish] MobileVoiceTextarea primitive + step rollout`

---

### Slice 3 — PointShoot + TradeCapture → MobileBottomSheet

**Goal:** Trade-in capture flow runs in `MobileBottomSheet` instead of desktop Dialog.

**Files:**
- `apps/web/src/features/quote-builder/components/PointShootTradeCard.tsx`
- `apps/web/src/features/quote-builder/components/TradeCaptureDialog.tsx`
- `apps/web/src/features/quote-builder/components/TradeInInputCard.tsx`
- `apps/web/src/features/quote-builder/components/TradeInSection.tsx`
- `apps/web/src/features/quote-builder/steps/TradeInStep.tsx` (verify wiring)

**Implementation:**
1. In `TradeCaptureDialog.tsx`, wrap the Dialog content in a viewport-aware container:
   ```tsx
   const isMobile = useIsMobileViewport();
   if (isMobile) {
     return (
       <MobileBottomSheet
         open={open}
         onOpenChange={onOpenChange}
         title="Capture trade-in"
         data-mobile-sheet="true"
       >
         {/* existing content */}
       </MobileBottomSheet>
     );
   }
   // existing desktop Dialog return
   ```
2. In `PointShootTradeCard.tsx`, the "📸 Photo appraisal" CTA opens the same TradeCaptureDialog, which now renders as MobileBottomSheet on mobile
3. Photo capture input (`<input type="file" accept="image/*" capture="environment">`) inside the sheet — preserves native camera access
4. After capture, extracted-details preview renders inside the sheet (do not navigate away)
5. "Save trade-in" CTA at sheet bottom, fixed within sheet's safe-area

**Acceptance:**
- At 390pt: tapping "📸 Photo appraisal" opens MobileBottomSheet with `data-mobile-sheet="true"` (e2e check)
- Camera input launches native picker
- Captured image preview renders inside sheet
- Existing desktop Dialog flow unchanged at 1280pt
- Test: `apps/web/src/features/quote-builder/components/__tests__/TradeCaptureDialog.mobile.test.tsx`

**Commit:** `[wave-qb-polish] TradeCapture mobile sheet conversion`

---

### Slice 4 — Review Per-Approval Workflow Sheets

**Goal:** `QuoteReviewWorkflowPanels` renders each approval as a tappable card; tapping opens that approval's detail in `MobileBottomSheet`.

**Files:**
- `apps/web/src/features/quote-builder/components/QuoteReviewWorkflowPanels.tsx`
- `apps/web/src/features/quote-builder/steps/ReviewStep.tsx` (verify wiring)

**Implementation:**
1. At mobile viewport, replace the multi-panel side-by-side layout with a vertical stack of approval cards. Each card:
   - Approver name + role
   - Status pill (pending / requested / approved / rejected)
   - "Last update" timestamp
   - Tap area covers full card
2. Tap → opens `MobileBottomSheet` with full approval detail:
   - Approval summary (what's being approved, dollar amount, margin impact)
   - Request notes textarea (use `MobileVoiceTextarea` from Slice 2)
   - "Request approval" / "Approve" / "Reject" CTAs (role-gated, matching existing logic)
   - Comment thread (if existing logic supports it)
3. Preserve all existing approval mutation hooks and edge function calls — UI only
4. Active approval sheet uses `data-mobile-sheet="true"` stamp

**Acceptance:**
- At 390pt: approvals render as stacked cards, no horizontal scroll
- Tap card → sheet opens with full detail
- Approval actions still mutate state via existing hooks (no regression to approval flow)
- Test: `apps/web/src/features/quote-builder/components/__tests__/QuoteReviewWorkflowPanels.mobile.test.tsx`

**Commit:** `[wave-qb-polish] Review per-approval sheets`

---

### Slice 5 — /quote-v2 Link Sweep

**Goal:** Replace all hardcoded `/quote-v2` and `/quote` deep links with the canonical `/sales/quotes/new` route so SalesShell hosts the builder regardless of entry point.

**Helper to create first:**

`apps/web/src/features/quote-builder/lib/quote-route.ts`:

```ts
export interface QuoteBuilderLinkParams {
  dealId?: string;
  contactId?: string;
  companyId?: string;
  packageId?: string;
  quoteId?: string;
  prospectConverted?: boolean;
}

export function buildQuoteBuilderHref(params: QuoteBuilderLinkParams = {}): string {
  // If editing an existing quote, route to /sales/quotes/:quoteId
  if (params.quoteId) {
    const qs = buildQuoteQuery(params);
    return qs ? `/sales/quotes/${params.quoteId}?${qs}` : `/sales/quotes/${params.quoteId}`;
  }
  const qs = buildQuoteQuery(params);
  return qs ? `/sales/quotes/new?${qs}` : "/sales/quotes/new";
}

export function buildQuoteListHref(): string {
  return "/sales/quotes";
}

function buildQuoteQuery(params: QuoteBuilderLinkParams): string {
  const sp = new URLSearchParams();
  if (params.dealId) sp.set("crm_deal_id", params.dealId);
  if (params.contactId) sp.set("crm_contact_id", params.contactId);
  if (params.companyId) sp.set("crm_company_id", params.companyId);
  if (params.packageId) sp.set("package_id", params.packageId);
  if (params.prospectConverted) sp.set("prospect_converted", "1");
  return sp.toString();
}
```

Add unit test `quote-route.test.ts` covering all permutations.

**Files to migrate (replace inline string-building with `buildQuoteBuilderHref` / `buildQuoteListHref`):**

| File | Lines |
|---|---|
| `apps/web/src/features/admin/lib/action-links.ts` | 46, 62, 86, 88 |
| `apps/web/src/features/admin/pages/DealVelocityPage.tsx` | 151 |
| `apps/web/src/features/qrm/command-center/components/QuoteVelocityCenterPage.tsx` | 185, 363 |
| `apps/web/src/features/qrm/command-center/components/ApprovalCenterPage.tsx` | 457 |
| `apps/web/src/features/qrm/command-center/lib/approvalTypes.ts` | 472 |
| `apps/web/src/features/qrm/components/PipelineDealTableRow.tsx` | 107 |
| `apps/web/src/features/qrm/components/Account360Tabs.tsx` | 239, 244 |
| `apps/web/src/features/qrm/components/PipelineDealCard.tsx` | 124 |
| `apps/web/src/features/qrm/lib/deal-coach.ts` | 95 |
| `apps/web/src/features/qrm/pages/TradeWalkaroundPage.tsx` | 324 |
| `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx` | 556 |
| `apps/web/src/features/qrm/pages/QrmDealDetailPage.tsx` | 380, 494, 513 |
| `apps/web/src/features/qrm/pages/QrmContactDetailPage.tsx` | 212 |

Plus a final repo grep:
```bash
grep -rn "/quote-v2\|to=\"/quote\"" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "test\|RedirectPreserveSearch"
```
should return zero hits after this slice.

**Acceptance:**
- Repo grep above returns zero hits
- Every callsite uses `buildQuoteBuilderHref` / `buildQuoteListHref`
- Existing `RedirectPreserveSearch` from `/quote-v2` → `/sales/quotes/new` in `App.tsx` stays as belt-and-suspenders (do not remove)
- All existing tests pass; new `quote-route.test.ts` passes
- Manual smoke: tap "Open quote" from QrmDealDetailPage, ApprovalCenterPage, PipelineDealTableRow → lands in SalesShell with correct query params

**Commit:** `[wave-qb-polish] quote-v2 link sweep`

---

### Slice 6 — Remaining Drawer/Dialog Sweep

**Goal:** Catch any remaining desktop Dialog/Drawer that fires inside the quote-builder flow on mobile.

**Files to audit + convert:**
- `apps/web/src/features/quote-builder/components/MarginFloorGate.tsx` — verify Slice 1 (prior wave) is fully wrapped; if any code-path still uses Dialog, convert
- `apps/web/src/features/quote-builder/components/ReviewSendDialog.tsx` — convert send flow to MobileBottomSheet on mobile
- `apps/web/src/features/quote-builder/components/OutcomeCaptureDrawer.tsx` — convert side-drawer to bottom sheet on mobile (drawer pattern doesn't work well on small viewports)
- Any other component whose name contains "Dialog" or "Drawer" inside `features/quote-builder/components/` — audit and convert with `useIsMobileViewport`

**Implementation pattern (apply consistently):**

```tsx
const isMobile = useIsMobileViewport();
if (isMobile) {
  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      data-mobile-sheet="true"
    >
      {/* same content */}
    </MobileBottomSheet>
  );
}
return (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {/* existing desktop content */}
  </Dialog>
);
```

**Acceptance:**
- E2E spec at `apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts` already asserts no `[role="dialog"]:not([data-mobile-sheet])` — running it after this slice must pass for the full 11-step walk INCLUDING send, approval, outcome capture, and margin override paths
- All converted components retain desktop Dialog at ≥640px
- Tests: per-component `.mobile.test.tsx` for each converted component

**Commit:** `[wave-qb-polish] remaining dialog/drawer sweep`

---

## Build Gates (run after every slice)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
bun run build

cd apps/web
bun run build
bun run test -- --run        # vitest, targeted
```

**Do not close a slice if any gate fails.** Investigate, fix, then commit.

---

## Verification Slice (closes the wave)

After Slice 6 ships:

1. Re-run `apps/web/tests/e2e/quote-builder-mobile-deep.spec.ts` at 390x844 — must pass full 11-step walk
2. Add a new viewport assertion to the E2E: also walk on 768x1024 (iPad portrait) — single-column SalesShell, no desktop two-column regression
3. Grep verification:
   ```bash
   # No leftover hardcoded /quote-v2 routes:
   grep -rn "/quote-v2\|to=\"/quote\"" apps/web/src --include="*.tsx" --include="*.ts" | grep -v "test\|RedirectPreserveSearch"
   # → 0 hits

   # No raw <textarea> in quote-builder that wasn't intentionally left:
   grep -rn "<textarea" apps/web/src/features/quote-builder --include="*.tsx" | grep -v "MobileVoiceTextarea\|test"
   # → should be empty or only intentional exceptions (document them)
   ```
4. Generate ship report: `WAVE-QUOTE-BUILDER-POLISH-SHIP-REPORT-YYYY-MM-DD.md` at repo root summarizing:
   - Files touched per slice
   - Primitives created (`MobileVoiceTextarea`, `quote-route.ts`)
   - Approvals/trade-capture/send/outcome flows now in MobileBottomSheet
   - Updated link sweep count
   - Test count delta
   - Outstanding work (hand off to CI/Quality wave)

**Commit:** `[wave-qb-polish] verification + ship report`

---

## Out of Scope (do not touch)

- Lighthouse/axe CI integration — separate WAVE
- bun:test cross-file pollution and full-suite hang — separate WAVE
- Quote calculation logic (pricing, margin, financing math) — UI only
- Edge functions, migrations, RLS — none required
- Step ordering or wizard navigation logic — locked
- Desktop AppLayout for `/qrm/*` admin pages — remain unchanged

---

## /goal one-liner

```
/goal Execute WAVE-QUOTE-BUILDER-POLISH-HANDOFF.md at /Users/brianlewis/Projects/qep-knowledge-assistant. Slices in order: 1 WizardShell stepper swap, 2 MobileVoiceTextarea + step rollout, 3 PointShoot/TradeCapture sheet, 4 Review per-approval sheets, 5 /quote-v2 link sweep, 6 remaining dialog/drawer sweep, then verification. After every slice: run bun run migrations:check + bun run build at root, bun run build + bun run test --run in apps/web, commit with [wave-qb-polish] <slice-name> prefix, push to origin/main, continue. Reuse existing primitives in features/sales/components and features/quote-builder/components — do not rebuild. Use useIsMobileViewport for every viewport gate. Stamp data-mobile-sheet="true" on every MobileBottomSheet so the e2e spec's [role="dialog"]:not([data-mobile-sheet]) assertion keeps passing. Do not stop between green slices. Stop only on (a) build gate fail after reasonable fix attempt, (b) irreversible destructive decision, (c) genuinely ambiguous spec. When verification closes, write WAVE-QUOTE-BUILDER-POLISH-SHIP-REPORT-YYYY-MM-DD.md at the repo root.
```
