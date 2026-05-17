# WAVE — Mobile-First Sales Advisor Consolidation

**Target orchestrator:** RepoPrompt (multi-model fan-out, strangler-fig per slice)
**Repository:** `/Users/brianlewis/client-projects/qep`
**Scope owner:** Brian Lewis (Speedy)
**Operating mode:** Autonomous execution. Per CLAUDE.md, do not stop between green slices — extract, verify, push, continue.

---

## Mission Lock

Per repo CLAUDE.md, every slice must pass the four mission checks before close:

1. **Mission Fit** — advances equipment/parts sales+rental operations for the field sales rep (iron_advisor)
2. **Transformation** — enables a capability beyond commodity CRM (voice capture in the field, offline-first quoting, instant intelligence in hand)
3. **Pressure Test** — validated on real mobile viewports (375pt iPhone SE, 390pt iPhone 14, 428pt iPhone 14 Pro Max) and offline → online sync
4. **Operator Utility** — measurably faster than the current desktop chrome on a phone for a real rep workflow

---

## Architectural Decision (lock before starting)

The repo already contains a fully built **Sales Companion** mobile surface at `apps/web/src/features/sales/` with its own shell, header, bottom tab bar, offline sync, and four pages. That work is the canonical mobile-first foundation. Today, the Sales nav dropdown in `lib/nav-config.ts` does **not** point reps into Sales Companion — it points them into desktop-chrome routes (`/sales/quotes`, `/sales/field-note`, `/voice-quote`). Reps land on `/sales/today` only via `lib/home-route.ts` default, and the screens they reach from the nav have no mobile treatment.

**Decision: consolidate every sales-rep surface into SalesShell.** Quote Builder, Field Note, Voice Quote, My Mirror, and a new Deal Detail all get hosted inside `SalesShell` at `/sales/*` routes, reuse the existing mobile primitives, and the Sales nav dropdown is repointed to those routes. Shared QRM admin pages (Companies, Contacts, Deals list, Activities, Time Bank, Knowledge Chat) stay on the desktop AppLayout untouched — they serve all departments and admin users on desktop.

**Why this and not "make existing routes responsive":**
- The mobile primitives (`SalesShell`, `SalesTopHeader`, `BottomTabBar`, `CaptureSheet`, `SalesOfflineBanner`, `sync-engine`) are already built and proven on Today/Pipeline/Customers
- Avoids dual maintenance of desktop and mobile layouts on the same route
- Eliminates the current fragmentation where rep lands in two different chromes depending on entry point
- `QuoteBuilderV2Page` is too dense to gracefully reflow inside `AppLayout` — needs a dedicated mobile shell

---

## Existing Mobile Primitives (do not rebuild — reuse)

| Primitive | Path | Use for |
|---|---|---|
| `SalesShell` | `apps/web/src/features/sales/SalesShell.tsx` | Outer chrome for every sales-rep page |
| `SalesTopHeader` | `apps/web/src/features/sales/components/SalesTopHeader.tsx` | 56px fixed top bar: brand + search + avatar |
| `BottomTabBar` | `apps/web/src/features/sales/components/BottomTabBar.tsx` | 64px fixed bottom tabs + center FAB → CaptureSheet |
| `SalesOfflineBanner` | `apps/web/src/features/sales/components/SalesOfflineBanner.tsx` | Offline-state pill |
| `CaptureSheet` | `apps/web/src/features/sales/components/CaptureSheet.tsx` | Bottom sheet for quick voice/note/visit |
| `SalesDealCard` | `apps/web/src/features/sales/components/SalesDealCard.tsx` | Deal card primitive |
| `SalesCustomerCard` | `apps/web/src/features/sales/components/SalesCustomerCard.tsx` | Customer card primitive |
| `ActionItemCard` | `apps/web/src/features/sales/components/ActionItemCard.tsx` | Follow-up card |
| `EquipmentFleet` | `apps/web/src/features/sales/components/EquipmentFleet.tsx` | Customer equipment list |
| `InteractionTimeline` | `apps/web/src/features/sales/components/InteractionTimeline.tsx` | Activity timeline |
| `lib/sync-engine.ts` | `apps/web/src/features/sales/lib/sync-engine.ts` | Offline queue + reconnect sync |

**New mobile primitives required (build in Phase 0):**

| Primitive | New file | Purpose |
|---|---|---|
| `MobileWizardStepper` | `apps/web/src/features/sales/components/MobileWizardStepper.tsx` | Horizontal scrolling chip rail; pins current step; replaces 11-tile grid |
| `MobileStickyActionBar` | `apps/web/src/features/sales/components/MobileStickyActionBar.tsx` | Fixed bottom action bar above BottomTabBar (Save Draft / Continue) |
| `MobileBottomSheet` | `apps/web/src/features/sales/components/MobileBottomSheet.tsx` | Generic bottom sheet for right-rail panels (AI Recommendation, Deal Coach, Financing) |
| `MobileVoiceMicButton` | `apps/web/src/features/sales/components/MobileVoiceMicButton.tsx` | Standardized 96-128pt mic primitive with state (idle/recording/processing) |
| `MobileSectionAccordion` | `apps/web/src/features/sales/components/MobileSectionAccordion.tsx` | Collapsible numbered section primitive matching FloorPage "01 Narrative / 02 Actions" pattern |
| `MobileKpiGrid` | `apps/web/src/features/sales/components/MobileKpiGrid.tsx` | 2-col responsive KPI strip (full-width on ≥640px, 2x2 below) |

---

## Mobile Design System Lock

These rules apply to every page in scope. Lock them in `apps/web/src/features/sales/lib/mobile-design-tokens.ts`:

```ts
// apps/web/src/features/sales/lib/mobile-design-tokens.ts
export const MOBILE = {
  // Viewport
  breakpoints: { sm: 640, md: 768, lg: 1024 },
  // Chrome
  topHeaderHeight: 56,
  bottomTabBarHeight: 64,
  stickyActionBarHeight: 64,
  // Spacing
  gutterX: 16,       // px-4
  gutterY: 16,
  cardRadius: 16,    // rounded-2xl on cards
  // Touch
  minTouchTarget: 44,
  // Typography ramp (single column)
  text: {
    pageTitle: "text-3xl font-semibold tracking-tight",      // 30px
    sectionTitle: "text-xl font-semibold",                   // 20px
    cardTitle: "text-base font-semibold",                    // 16px
    body: "text-sm",                                         // 14px
    label: "text-xs uppercase tracking-wide font-medium",    // 12px
  },
  // Colors (already in tailwind config — surface tokens)
  surface: {
    bg: "bg-[hsl(var(--qep-bg))]",
    card: "bg-foreground/[0.04] border border-white/[0.06]",
    accentOrange: "bg-qep-orange text-white",
    accentCyan: "border-cyan-500/40 bg-cyan-500/10",
  },
  // Animation
  sheetSpring: "transition-transform duration-300 ease-out",
  // Safe area
  safeAreaTop: "env(safe-area-inset-top)",
  safeAreaBottom: "env(safe-area-inset-bottom)",
} as const;
```

**Layout rules — non-negotiable on every sales-rep page:**

- Single column. No two-column comparisons. No side rails.
- Right-rail panels (AI Recommendation, Deal Coach, Financing Preview, What to Mention, Get Best Results) become `MobileBottomSheet` drawers, opened from chip buttons inside the content or a floating right-side button.
- Wizard step grids (Quote Builder 11-step, Field Note 5-step, Voice Quote 4-step) become `MobileWizardStepper` horizontal scrolling chip rails with the current step pinned to the left edge and snap-scroll.
- Primary action lives in `MobileStickyActionBar` above the bottom tab bar. The action bar uses `safe-area-inset-bottom` so it clears the tab bar visually.
- KPI strips reflow to `MobileKpiGrid` (2-col grid on phones).
- Iron banners (cyan-bordered) stay full-width; inline action buttons wrap below text instead of right-aligning.
- The microphone in voice flows is the dominant element — minimum 96pt, accessible without scrolling on a 375pt-wide iPhone SE.
- Voice transcript pane fills width; extracted-details panel becomes a collapsible section below transcript, not a side panel.

---

## Slice Plan (strangler-fig — per RepoPrompt overnight pattern)

Each phase is independently shippable. Per memory, no timelines. Phases sequence by priority. After each phase, RepoPrompt should:

1. Run the build gates (see "Build Gates" below)
2. Commit with `[wave-mobile-sales] <slice-name>` prefix
3. Push to current branch
4. Continue to next phase

### Phase 0 — Mobile Primitives Baseline (foundation)

**Goal:** All new primitives exist, design tokens locked, no behavior changes to existing pages.

**Slices:**

| # | File to create | Acceptance |
|---|---|---|
| 0.1 | `apps/web/src/features/sales/lib/mobile-design-tokens.ts` | Exports the `MOBILE` const above; unit test asserts shape |
| 0.2 | `apps/web/src/features/sales/components/MobileWizardStepper.tsx` | Renders horizontal scrolling chip rail; props: `steps: { id, label, status: 'done'|'current'|'locked' }[]`, `onStepClick`; auto-scrolls current step into view; supports keyboard arrow nav |
| 0.3 | `apps/web/src/features/sales/components/MobileStickyActionBar.tsx` | Fixed `bottom-16` (clears BottomTabBar), full-width, safe-area-inset-bottom padding; renders children left-to-right with primary action filling remaining space |
| 0.4 | `apps/web/src/features/sales/components/MobileBottomSheet.tsx` | Generic sheet with drag-handle, dismiss on backdrop tap, snap points `[0.4, 0.92]`; uses `framer-motion` if present, otherwise CSS transform |
| 0.5 | `apps/web/src/features/sales/components/MobileVoiceMicButton.tsx` | 96–128pt round button; states `idle | recording | processing | error`; ARIA `aria-pressed` + live region for status; pulse animation while recording |
| 0.6 | `apps/web/src/features/sales/components/MobileSectionAccordion.tsx` | Numbered section header (`01`, `02`...) with collapsible body; matches FloorPage visual style |
| 0.7 | `apps/web/src/features/sales/components/MobileKpiGrid.tsx` | CSS grid 2-col on `<sm`, 4-col on `>=sm`; cards use `MOBILE.surface.card` token |

**Tests for Phase 0:**
- `apps/web/src/features/sales/components/__tests__/MobileWizardStepper.test.tsx` — renders 11 steps, scrolls current into view, click fires `onStepClick(stepId)`
- `apps/web/src/features/sales/components/__tests__/MobileStickyActionBar.test.tsx` — clears BottomTabBar, respects safe area
- `apps/web/src/features/sales/components/__tests__/MobileBottomSheet.test.tsx` — opens, closes on backdrop, snap points work
- `apps/web/src/features/sales/components/__tests__/MobileVoiceMicButton.test.tsx` — state transitions, ARIA correctness

**Build gate:** `bun run build` in `apps/web` is green. No existing test fails.

---

### Phase 1 — Quote Builder Mobile (HIGHEST PRIORITY)

**Goal:** `/sales/quotes/v2` and `/sales/quotes/v2/:quoteId` hosted inside `SalesShell` with full mobile chrome, all 11 wizard steps usable on iPhone SE.

**Current state to migrate from:**
- Route: `/sales/quotes` → `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`
- Shell: Desktop `AppLayout` via `SalesOrAppLayout` in `App.tsx` line 737 (`salesRoutesWithSharedChrome` array includes `/sales/quotes`)
- Step components: `apps/web/src/features/quote-builder/steps/` (CustomerStep, EquipmentStep, ConfigureStep, TradeInStep, PricingStep, PromotionsStep, FinancingStep, DetailsStep, ReviewStep, DocumentStep, SendStep)
- Right-rail panels: `AiRecommendationCard`, `DealCoachSidebar`, `FinancingPreviewCard`, `IntelligencePanel`, `CustomerIntelPanel`, `QuoteBuilderIntelligencePanelHost`
- Sticky bar: `QuoteBuilderStickyBar` (already exists — adapt for mobile)

**Slices:**

#### 1.1 Route wiring
- Remove `/sales/quotes` from `salesRoutesWithSharedChrome` array in `App.tsx` (so it falls through to `SalesShell`)
- Add a route inside `SalesRoutes.tsx`:
  ```tsx
  <Route path="quotes" element={<Suspense fallback={<SalesRouteFallback />}><QuoteListPage /></Suspense>} />
  <Route path="quotes/new" element={<Suspense fallback={<SalesRouteFallback />}><QuoteBuilderV2Page /></Suspense>} />
  <Route path="quotes/:quoteId" element={<Suspense fallback={<SalesRouteFallback />}><QuoteBuilderV2Page /></Suspense>} />
  ```
- Update redirects in `App.tsx` `/quote` → `/sales/quotes/new` (currently `/sales/quotes`)
- Verify `QuoteBuilderGate.tsx` still gates correctly inside SalesShell context

**Acceptance:** Navigating to `/sales/quotes` shows `QuoteListPage` inside SalesShell with BottomTabBar visible. Navigating to `/sales/quotes/new` shows the builder.

#### 1.2 Replace QuoteBuilder header with mobile shell
- `QuoteBuilderV2PageShell.tsx` currently renders a desktop card-style header with logo, breadcrumb, quote ID badge, "Saved 6:35 PM", "$304,200 Cash", "Guided Wizard", "Save Draft" — this fights `SalesTopHeader`
- Move quote-identity row (quote ID + PENDING APPROVAL badge + Save state + $ total) into a **sub-header card** below `SalesTopHeader`, full-width, single line on mobile with truncation
- Move "Save Draft" action into `MobileStickyActionBar` (primary right side, with "Continue" → next step)
- Remove the desktop right-rail entirely; convert each rail panel into a `MobileBottomSheet` trigger chip in a horizontal chip rail at the top of the workspace:
  - `[ AI Recommendation ]` → opens `AiRecommendationCard` in sheet
  - `[ Deal Coach ]` → opens `DealCoachSidebar` content in sheet
  - `[ Financing Preview ]` → opens `FinancingPreviewCard` in sheet
  - `[ Customer Intel ]` → opens `CustomerIntelPanel` in sheet
  - `[ Ask Iron ]` → triggers existing `AskIronAdvisorButton` flow

**Acceptance:** On a 375pt viewport, the quote builder workspace renders without horizontal scroll. All right-rail data is reachable via chip-launched bottom sheets.

#### 1.3 Replace wizard tile grid with MobileWizardStepper
- Current: `WIZARD PROGRESS` block renders 11 tiles in a horizontal flex row that doesn't fit on mobile
- Replace with `<MobileWizardStepper steps={steps} onStepClick={...} />` from Phase 0.2
- Pin current step to left edge with snap-scroll
- Show step name + status ("Now" / "Edit" / "Locked") in chip
- Below stepper, render the current step content full-width

**Acceptance:** Stepper fits on 375pt viewport, horizontally scrolls, current step is always visible without scrolling.

#### 1.4 Step content reflow — single column
For each step in `apps/web/src/features/quote-builder/steps/`, apply these rules:

| Step file | Mobile reflow rule |
|---|---|
| `CustomerStep.tsx` | Search input full-width; Add-new as full-width button below; selected customer chip card full-width; "Fast intake" textarea full-width with voice-input button |
| `EquipmentStep.tsx` | Equipment picker becomes a stacked card list; `EquipmentSelector` opens as `MobileBottomSheet` instead of inline; "Add line" full-width button at bottom |
| `ConfigureStep.tsx` | Each configuration group becomes a `MobileSectionAccordion`; default to first group expanded |
| `TradeInStep.tsx` | `PointShootTradeCard` resizes to full-width; trade-in entries stack vertically |
| `PricingStep.tsx` | Margin badge moves to top of page as compact pill; `PricingAdderBuckets` reflows to single column; `MarginCheckBanner` stays full-width |
| `PromotionsStep.tsx` | `IncentiveStack` becomes a vertical card list; each promo card has tap-to-toggle |
| `FinancingStep.tsx` | `FinancingCalculator` inputs stack; results panel becomes a `MobileBottomSheet` after calculation |
| `DetailsStep.tsx` | Form fields stack; long fields use full-width textareas |
| `ReviewStep.tsx` | `ReviewSummaryBlock` becomes a vertical accordion of sections; `QuoteReviewWorkflowPanels` collapses approvals into stacked cards |
| `DocumentStep.tsx` | Document preview fills width; "Open PDF" full-width button |
| `SendStep.tsx` | `SendQuoteSection` stacks send options vertically; primary send button moves to `MobileStickyActionBar` when this step is active |

**For every step:** Tap targets ≥44pt. Form inputs use `font-size: 16px` minimum (prevents iOS auto-zoom). All disclosure widgets use `MobileBottomSheet`, never desktop dialogs.

**Acceptance per step:** Renders without horizontal scroll on 375pt; all interactive elements tappable; no two-column desktop layouts remain.

#### 1.5 Mobile sticky action bar
- Replace `QuoteBuilderStickyBar` desktop styling with `MobileStickyActionBar`
- Left: "Save Draft" (secondary)
- Right: "Continue" (primary, fills remaining space) — label changes per step (e.g., "Send Quote" on SendStep)
- Above the bar, show a thin progress line representing `currentStep / totalSteps`

**Acceptance:** Action bar visible on all steps, doesn't overlap BottomTabBar, respects safe-area-inset.

#### 1.6 AI panels as bottom sheets
- Create `apps/web/src/features/quote-builder/components/MobileIntelligencePanelHost.tsx` that wraps existing intelligence panels in `MobileBottomSheet`
- Replace `QuoteBuilderIntelligencePanelHost` usage in `QuoteBuilderV2PageShell` with the mobile host on viewports `<lg`
- Triggered by the chip rail from 1.2

**Acceptance:** Tapping any intelligence chip opens the corresponding panel as a bottom sheet; close on backdrop tap; data state preserved across open/close.

#### 1.7 Quote list mobile
- `QuoteListPage` currently uses desktop card grid
- Reflow to single-column stacked cards using existing card primitives
- Each card: quote ID + status badge + customer + machine + total + last-updated + tap → opens builder
- Filter chips at top: All / Draft / Sent / Approved / Lost (horizontal scroll chip rail)
- "New Quote" → `MobileStickyActionBar` primary action

**Acceptance:** Quote list scannable on phone; tap card opens builder.

#### 1.8 Tests
- `apps/web/src/features/quote-builder/pages/__tests__/QuoteBuilderV2Page.mobile.test.tsx` — renders inside SalesShell, no horizontal scroll at 375pt, all 11 steps reachable via stepper
- `apps/web/src/features/quote-builder/components/__tests__/MobileIntelligencePanelHost.test.tsx` — sheets open, close, preserve state
- Update existing `QuoteBuilderV2Page` integration tests to render with `<MemoryRouter initialEntries={["/sales/quotes/new"]}>` inside `SalesShell` test wrapper

**Phase 1 acceptance criteria (full):**

1. Sales rep can open `/sales/quotes/new` on a 375pt viewport and complete every step without horizontal scrolling
2. All 11 wizard steps are reachable via `MobileWizardStepper`
3. All intelligence panels reachable via chip-triggered bottom sheets
4. Sticky action bar primary action progresses through the wizard
5. Save-draft works the same as desktop (no regression in draft flow)
6. `bun run build` in `apps/web` is green
7. All existing Quote Builder tests pass
8. New mobile tests pass
9. Lighthouse mobile score on `/sales/quotes/new` ≥ 85 performance, ≥ 95 accessibility (run via playwright if configured, otherwise document)

---

### Phase 2 — Field Note Mobile

**Goal:** `/sales/field-note` hosted inside `SalesShell` with mobile-first voice cockpit.

**Current state:**
- Route: `/sales/field-note` → renders `apps/web/src/components/VoiceCapturePage.tsx`
- Shell: Desktop `AppLayout` (in `salesRoutesWithSharedChrome` array)
- Layout: 4-column desktop grid (recording / live transcript / extracted details / QRM match)

**Slices:**

#### 2.1 Route migration
- Remove `/sales/field-note` from `salesRoutesWithSharedChrome` in `App.tsx`
- Add to `SalesRoutes.tsx`:
  ```tsx
  <Route path="field-note" element={<Suspense fallback={<SalesRouteFallback />}><VoiceCapturePage /></Suspense>} />
  <Route path="field-note/history" element={<Suspense fallback={<SalesRouteFallback />}><VoiceHistoryPage /></Suspense>} />
  ```
- Move `VoiceCapturePage.tsx` and `VoiceHistoryPage.tsx` from `apps/web/src/components/` to `apps/web/src/features/sales/pages/` (rename to `FieldNotePage.tsx` and `FieldNoteHistoryPage.tsx` while preserving exports for backwards compatibility)

#### 2.2 Mobile reflow
- Replace 5-step horizontal indicator (Record → Review → Extract → Match to deal → Synced) with `MobileWizardStepper`
- `MATCH MODE / OFFLINE / QUEUED` triple becomes `MobileKpiGrid` (2-col)
- Recording column collapses: `MobileVoiceMicButton` centered, max-width 200pt
- Live Transcript fills full width below mic
- Extracted Details becomes `MobileSectionAccordion` titled "Extracted details", collapsed by default until transcript exists
- QRM Match & Destination becomes a `MobileBottomSheet` triggered by a chip "Match to deal"
- "Get the best results" tip card moves to a `MobileBottomSheet` triggered by a help icon
- Recent recordings becomes a vertical stack of cards (currently a table)

#### 2.3 Sticky action bar
- Left: "Stop" (when recording), "Re-record" (when stopped)
- Right: "Save & sync" (primary, when transcript ready)

#### 2.4 Tests
- `apps/web/src/features/sales/pages/__tests__/FieldNotePage.mobile.test.tsx` — renders inside SalesShell, mic button accessible without scrolling on 375pt, transcript visible below

**Phase 2 acceptance:** Field Note works one-handed on a 375pt viewport. Voice capture is the dominant element. Offline sync still functions.

---

### Phase 3 — Voice Quote Mobile

**Goal:** `/sales/voice-quote` hosted inside SalesShell.

**Current state:**
- Route: `/voice-quote` (current; rewire to `/sales/voice-quote`)
- File: `apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx`
- Shell: Desktop `AppLayout`
- Layout: 4-column desktop (Voice Capture / Live Transcript + Extracted Details / Scenarios / What to Mention + Offline & Sync)

**Slices:**

#### 3.1 Route migration
- Update `lib/nav-config.ts` Voice Quote `href` from `/voice-quote` to `/sales/voice-quote`
- Add `RedirectPreserveSearch` from `/voice-quote` → `/sales/voice-quote` for back-compat
- Add to `SalesRoutes.tsx`:
  ```tsx
  <Route path="voice-quote" element={<Suspense fallback={<SalesRouteFallback />}><VoiceQuotePage /></Suspense>} />
  ```

#### 3.2 Mobile reflow
- 4-step indicator (Record → Review transcript → Compare scenarios → Open in Quote Builder) → `MobileWizardStepper`
- Top "Try saying something like..." example + mode toggle cards (Voice/Type/Offline/English/Draft queue) → `MobileKpiGrid` 2-col below stepper
- Voice Capture column → centered `MobileVoiceMicButton`
- Live Transcript → full width below mic
- Extracted Details → `MobileSectionAccordion` below transcript
- Scenarios column → vertical stack of `ScenarioCard` components, each tap = "Open in Quote Builder" CTA
- "What to mention" + "Offline & sync" → `MobileBottomSheet` triggered by chips

#### 3.3 Sticky action bar
- Left: "Re-record"
- Right: "Open selected scenario in Quote Builder" (primary, disabled until scenario selected)

#### 3.4 Tests
- `apps/web/src/features/voice-quote/pages/__tests__/VoiceQuotePage.mobile.test.tsx`

**Phase 3 acceptance:** Rep can voice-capture, review scenarios, and launch into Quote Builder without leaving mobile chrome.

---

### Phase 4 — My Mirror (Rep Reality Reflection) Mobile

**Goal:** `/sales/my-mirror` hosted inside SalesShell.

**Current state:**
- Route: `/qrm/my-mirror` → `apps/web/src/features/qrm/pages/RepRealityReflectionPage.tsx`
- Shell: Desktop `AppLayout`
- Uses shared QRM `DeckSurface` + `QrmPageHeader` chrome

**Slices:**

#### 4.1 Route migration
- Keep `/qrm/my-mirror` as a desktop redirect to `/sales/my-mirror` for back-compat
- Add to `SalesRoutes.tsx`:
  ```tsx
  <Route path="my-mirror" element={<Suspense fallback={<SalesRouteFallback />}><MyMirrorPage /></Suspense>} />
  ```
- Create `apps/web/src/features/sales/pages/MyMirrorPage.tsx` that imports the underlying data hooks from `features/qrm/` and renders a mobile-first reflection layout (do NOT reuse `DeckSurface` chrome)

#### 4.2 Mobile layout
- Page header: "My Mirror" + "Private to you" caption (drop the demo badge for production, or move to bottom)
- KPI strip (Pipeline / Time Bank / Voice Notes / Overdue Follow-ups) → `MobileKpiGrid`
- Tab bar (Today / Graph / Pulse / Ask Iron) → horizontal chip rail with snap-scroll
- Lens chips (Activities / Campaigns / Time Bank / Approvals / Blockers / Replace / Rescue / Seasonal / Post-Sale) → secondary horizontal chip rail
- "Your deals" list → vertical stack of `SalesDealCard`
- Empty state ("No deals assigned to you yet.") → full-bleed friendly empty state with CTA to `/sales/customers`

#### 4.3 Tests
- `apps/web/src/features/sales/pages/__tests__/MyMirrorPage.mobile.test.tsx`

**Phase 4 acceptance:** Rep's private reflection surface renders cleanly on phone with all KPIs visible above the fold.

---

### Phase 5 — Sales-Rep Deal Detail (NEW BUILD)

**Goal:** A simplified, sales-rep-focused deal detail page at `/sales/deals/:dealId`. The existing `QrmDealDetailPage` is heavy admin/manager chrome and stays untouched.

**Slices:**

#### 5.1 Hook + types
- Create `apps/web/src/features/sales/hooks/useSalesDealDetail.ts` that wraps `fetchDealComposite` from `features/qrm/lib/deal-composite-api.ts` and exposes a simplified shape:
  ```ts
  export interface SalesDealView {
    dealId: string;
    name: string;
    stage: { name: string; sortOrder: number };
    amount: number | null;
    closingProbability: number | null;
    nextFollowUpAt: string | null;
    customer: { id: string; name: string; phone: string | null; email: string | null };
    primaryEquipment: { id: string; model: string; category: string; qty: number } | null;
    activeQuoteId: string | null;
    lastActivity: { type: string; body: string; occurredAt: string } | null;
    voiceNotes: { id: string; preview: string; createdAt: string }[];
    heatScore: number | null;
  }
  ```

#### 5.2 Page
- Create `apps/web/src/features/sales/pages/DealDetailPage.tsx` with sections in this order (all single column):
  1. Top bar: back chevron + deal name + stage chip + heat badge
  2. KPI strip: Amount, Probability, Next follow-up, Stage age (use `MobileKpiGrid`)
  3. Customer card: avatar + name + phone (tap → tel:) + email (tap → mailto:) + "Open customer" link to `/sales/customers/:companyId`
  4. Equipment card: primary machine + qty + "View all equipment" expand
  5. Next action card: next follow-up date + "Schedule" + "Log activity" buttons
  6. Active quote card (if exists): quote ID + total + status + "Open quote" button → `/sales/quotes/:quoteId`. If no active quote, show "Start a quote" → `/sales/quotes/new?dealId=...`
  7. Voice notes section: vertical list of `voiceNotes` with play + "Add voice note" button → opens `CaptureSheet`
  8. Activity timeline: reuse `InteractionTimeline` component

#### 5.3 Sticky action bar
- Left: "Log activity"
- Right: "Update stage" (opens stage picker bottom sheet)

#### 5.4 Wire up navigation
- In `apps/web/src/features/sales/components/SalesDealCard.tsx`, make card tap navigate to `/sales/deals/:dealId`
- In `PipelineBoardPage`, ensure deal cards link to the new route
- In `CustomerDetailPage`, link any deal rows to the new route

#### 5.5 Route registration
- Add to `SalesRoutes.tsx`:
  ```tsx
  <Route path="deals/:dealId" element={<Suspense fallback={<SalesRouteFallback />}><DealDetailPage /></Suspense>} />
  ```

#### 5.6 Tests
- `apps/web/src/features/sales/pages/__tests__/DealDetailPage.test.tsx` — renders all sections, tel/mailto links work, navigation to quote and customer routes work, voice note capture sheet opens
- `apps/web/src/features/sales/hooks/__tests__/useSalesDealDetail.test.ts` — hook returns simplified shape

**Phase 5 acceptance:** Tapping any deal card in Pipeline opens a mobile-native deal detail with everything a rep needs in the field. No admin-only chrome leaks through.

---

### Phase 6 — Sales Nav Rewire + BottomTabBar Extension

**Goal:** The Sales dropdown points to mobile routes. BottomTabBar reflects the rep's actual workflow.

**Slices:**

#### 6.1 Sales nav dropdown rewire (`apps/web/src/lib/nav-config.ts`)
Update entries:

```ts
// Sales group — for reps, these now point into SalesShell routes
{ label: "Dashboard", href: "/sales/today", icon: BriefcaseBusiness, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Workspace" },
{ label: "Pipeline", href: "/sales/pipeline", icon: BarChart3, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Workspace" },
{ label: "Customers", href: "/sales/customers", icon: Users, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Workspace" },
{ label: "Quotes", href: "/sales/quotes", icon: FileText, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Execution" },
{ label: "Field Note", href: "/sales/field-note", icon: Mic, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Execution" },
{ label: "Voice Quote", href: "/sales/voice-quote", icon: Mic, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Execution" },
{ label: "My Mirror", href: "/sales/my-mirror", icon: UserRound, roles: ["rep","admin","manager","owner"], primaryHeaderId: "sales", sectionLabel: "Reflection" },
```

#### 6.2 QRM nav dropdown — restrict rep-visible items
For roles `["rep"]`, only the following QRM items show:
- Dashboard (`/floor`) — keep for back-compat
- Knowledge (`/chat`)
- Time Bank (`/qrm/time-bank`) — keep visible but renders in desktop chrome (acceptable; rep can still use it on tablet)
- Command Center (`/qrm`) — keep visible but desktop
- The rest (Activities, Deals, Contacts, Companies, Templates, Sequences, Inventory Pressure, Iron in Motion, etc.) become `roles: ["admin","manager","owner"]` only

Update `roles` arrays in `lib/nav-config.ts` accordingly.

#### 6.3 BottomTabBar extension
- Current tabs: Today / Pipeline / [+ CaptureSheet] / Customers
- Optional addition: add a "Quotes" tab (replacing "Customers" as the rightmost? Or add as 5th?). Recommendation: **keep 4 tabs**. Customers moves under a "More" overflow menu OR Customers stays and Quotes is accessible via the Sales nav dropdown.
- Decision: Keep `BottomTabBar` as-is (Today / Pipeline / + / Customers). Quote Builder, Field Note, Voice Quote, My Mirror, Deal Detail are reachable from the `+ CaptureSheet` quick actions or from cards within Pipeline / Customers.
- Update `CaptureSheet.tsx` to include quick actions: "New quote" → `/sales/quotes/new`, "Record field note" → `/sales/field-note`, "Voice quote" → `/sales/voice-quote`, "My Mirror" → `/sales/my-mirror`

#### 6.4 Home route — confirm rep landing
- `lib/home-route.ts` already returns `/sales/today` for `rep`. Confirm `iron_advisor` blend also routes there (currently routes to `/floor` via `isFloorIronRole`)
- Decision: keep `/floor` as the iron_advisor landing for now (it's responsive) and let the rep navigate from the Floor's existing CTAs into Sales Companion routes. Reassess after Phase 7 user testing.

#### 6.5 Tests
- `apps/web/src/lib/__tests__/nav-config.test.ts` — assert rep-visible items match the spec above
- `apps/web/src/features/sales/components/__tests__/BottomTabBar.test.tsx` — CaptureSheet quick-actions navigate correctly

**Phase 6 acceptance:** A rep logging in lands on `/sales/today`, opens the Sales nav dropdown and sees mobile-routed items only, and can reach every workflow without leaving SalesShell.

---

### Phase 7 — Verification & Ship Gates

**Goal:** Prove the whole rep experience is mobile-first end-to-end.

**Slices:**

#### 7.1 Build gates (per CLAUDE.md)
```bash
cd /Users/brianlewis/client-projects/qep
bun run migrations:check
bun run build
cd apps/web && bun run build
```
All must be green.

#### 7.2 Mobile viewport smoke tests
- Add `apps/web/tests/e2e/mobile-sales-rep.spec.ts` (Playwright) that runs at viewport `390x844` (iPhone 14):
  1. Login as a `rep` profile
  2. Land on `/sales/today` — assert SalesTopHeader + BottomTabBar visible, no horizontal scroll
  3. Tap Pipeline tab — assert PipelineBoardPage renders
  4. Tap a deal card — assert DealDetailPage opens
  5. Tap "Start a quote" → /sales/quotes/new — complete steps 1-3 of wizard
  6. Tap MobileWizardStepper to jump to a previous step — assert state preserved
  7. Open AI Recommendation chip → assert MobileBottomSheet opens
  8. Save draft → BottomTabBar Pipeline → assert quote appears
  9. Tap + (FAB) → CaptureSheet → "Record field note" → /sales/field-note
  10. Record (mock audio) → assert transcript renders, stickyActionBar Save & sync works
  11. Navigate /sales/my-mirror — assert KPIs render in 2-col grid
  12. Throughout: assert `document.documentElement.scrollWidth === window.innerWidth` (no horizontal overflow)

#### 7.3 Accessibility audit
- Run `axe-playwright` against each `/sales/*` route at mobile viewport
- Target: zero serious or critical violations
- Verify all tap targets ≥44pt via custom playwright assertion

#### 7.4 Offline-first verification
- Disable network in playwright; load `/sales/today`; assert SalesOfflineBanner shows; create a Field Note offline; re-enable; assert sync-engine reconciles within 5s

#### 7.5 Regression sweep
- Run full existing test suite: `bun run test` from `apps/web`
- Run any contract tests for touched edge functions
- Verify QRM admin routes (`/qrm/companies`, `/qrm/contacts`, `/qrm/deals`, `/qrm/activities`, `/qrm/time-bank`) still render the desktop AppLayout for `admin`, `manager`, `owner` roles — assert no rep-mobile chrome leaks

#### 7.6 Ship report
Generate `WAVE-MOBILE-FIRST-SALES-REP-SHIP-REPORT-YYYY-MM-DD.md` at repo root summarizing:
- Routes migrated into SalesShell
- New primitives created
- New pages built (DealDetailPage)
- Tests added
- Lighthouse / axe scores
- Outstanding work (e.g., if Lighthouse < 85 anywhere)

**Phase 7 acceptance:** Every gate green. Ship report committed. Branch ready to merge.

---

## Build Gates (run after every phase)

```bash
# From repo root /Users/brianlewis/client-projects/qep
bun run migrations:check
bun run build

# From apps/web
cd apps/web
bun run build
bun run test -- --run        # vitest
bun run test:e2e             # playwright (if configured)
```

Per CLAUDE.md: do not close a phase if any of these fail.

---

## Role/Workspace Security Verification

For every page migrated into SalesShell, verify:
- The page respects `useAuth().profile.role` — rep cannot see admin-only data
- Edge function calls inherit the rep's JWT (no service-role bypass)
- RLS policies on touched tables (`quotes`, `quote_drafts`, `deals`, `companies`, `voice_notes`, `crm_activities`) still enforce workspace and ownership
- New `/sales/deals/:dealId` route returns 404 (not 500) if rep tries to access a deal they don't own — verified via test

---

## Per CLAUDE.md Working Rules

- Preserve all in-flight QRM Phase 1 and DGE Sprint 2 work — do not touch `/qrm/*` admin routes
- Do not introduce breaking API shape changes; the migration is purely frontend + routing
- Keep ticket state aligned: update QUA sprint children as each phase closes
- Continue directly into the next phase after green — do not wait for user prompt unless an irreversible decision is encountered

---

## Files Created / Modified Summary

**New files (Phase 0):**
- `apps/web/src/features/sales/lib/mobile-design-tokens.ts`
- `apps/web/src/features/sales/components/MobileWizardStepper.tsx` (+ test)
- `apps/web/src/features/sales/components/MobileStickyActionBar.tsx` (+ test)
- `apps/web/src/features/sales/components/MobileBottomSheet.tsx` (+ test)
- `apps/web/src/features/sales/components/MobileVoiceMicButton.tsx` (+ test)
- `apps/web/src/features/sales/components/MobileSectionAccordion.tsx`
- `apps/web/src/features/sales/components/MobileKpiGrid.tsx`

**Modified files:**
- `apps/web/src/App.tsx` — remove `/sales/quotes`, `/sales/field-note` from `salesRoutesWithSharedChrome`
- `apps/web/src/features/sales/SalesRoutes.tsx` — add routes for quotes, field-note, voice-quote, my-mirror, deals
- `apps/web/src/lib/nav-config.ts` — repoint Sales dropdown, restrict rep QRM items
- `apps/web/src/features/sales/components/CaptureSheet.tsx` — add quick-action links
- `apps/web/src/features/quote-builder/components/QuoteBuilderV2PageShell.tsx` — mobile reflow
- `apps/web/src/features/quote-builder/components/QuoteBuilderStickyBar.tsx` — use MobileStickyActionBar
- All step files in `apps/web/src/features/quote-builder/steps/` — single-column reflow
- `apps/web/src/components/VoiceCapturePage.tsx` — move to `features/sales/pages/FieldNotePage.tsx`, mobile reflow
- `apps/web/src/features/voice-quote/pages/VoiceQuotePage.tsx` — mobile reflow

**New files (Phase 1):**
- `apps/web/src/features/quote-builder/components/MobileIntelligencePanelHost.tsx` (+ test)
- `apps/web/src/features/quote-builder/pages/__tests__/QuoteBuilderV2Page.mobile.test.tsx`

**New files (Phase 2):**
- `apps/web/src/features/sales/pages/FieldNotePage.tsx` (moved + refactored)
- `apps/web/src/features/sales/pages/FieldNoteHistoryPage.tsx` (moved)
- `apps/web/src/features/sales/pages/__tests__/FieldNotePage.mobile.test.tsx`

**New files (Phase 3):**
- `apps/web/src/features/voice-quote/pages/__tests__/VoiceQuotePage.mobile.test.tsx`

**New files (Phase 4):**
- `apps/web/src/features/sales/pages/MyMirrorPage.tsx`
- `apps/web/src/features/sales/pages/__tests__/MyMirrorPage.mobile.test.tsx`

**New files (Phase 5):**
- `apps/web/src/features/sales/hooks/useSalesDealDetail.ts` (+ test)
- `apps/web/src/features/sales/pages/DealDetailPage.tsx` (+ test)

**New files (Phase 7):**
- `apps/web/tests/e2e/mobile-sales-rep.spec.ts`
- `WAVE-MOBILE-FIRST-SALES-REP-SHIP-REPORT-YYYY-MM-DD.md` (at repo root)

---

## Out of Scope (do not touch in this wave)

- `/qrm/companies`, `/qrm/contacts`, `/qrm/deals`, `/qrm/activities`, `/qrm/time-bank`, `/qrm/templates`, `/qrm/sequences`, `/qrm/inventory-pressure`, `/qrm/iron-in-motion`, `/qrm/service-to-sales`, and all other shared QRM pages — they remain desktop-only for admin/manager/owner roles
- Parts, Service, Rentals modules
- Owner/Executive dashboards
- DGE Sprint 2 — preserve in-flight work
- IntelliDealer integration changes — none required
- Database schema — no migrations needed for this wave

---

## /goal one-liner (for RepoPrompt autonomous run)

```
/goal Execute the WAVE-MOBILE-FIRST-SALES-REP-HANDOFF.md plan at the repo root. Work phase by phase in order (Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7). For each phase, complete every slice, run the build gates (bun run migrations:check, bun run build at root, bun run build in apps/web, vitest, playwright if configured), commit with [wave-mobile-sales] <slice-name> prefix, push, then continue to the next phase. Treat Phase 1 (Quote Builder) as highest priority — verify it works end-to-end on a 375pt viewport before moving on. Do not stop between green slices. Stop only if (a) a build gate fails after a reasonable fix attempt, (b) an irreversible destructive decision is required, or (c) the spec is genuinely ambiguous and cannot be resolved from repo context. When all 7 phases close green, generate WAVE-MOBILE-FIRST-SALES-REP-SHIP-REPORT-YYYY-MM-DD.md at the repo root summarizing routes migrated, primitives created, new pages built, tests added, and outstanding items.
```
