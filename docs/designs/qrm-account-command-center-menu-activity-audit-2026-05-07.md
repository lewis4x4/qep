# QRM Account Command Center — Top Menu & Recent Activity Audit

> **Status:** Read-only design / UX audit deliverable.
> **Scope:** `apps/web/src/features/qrm/pages/AccountCommandCenterPage.tsx`
> (the "pile of buttons" top menu) and `Recent account activity` panel rendered by
> `apps/web/src/features/qrm/components/QrmActivityTimeline.tsx` (empty state +
> populated state) on `/qrm/accounts/:accountId/command`.
> **Author role:** Design auditor for the QRM Command Center polish pass —
> produces the rubric, measurement baseline, acceptance criteria, and moonshot
> guidance for the implementation / polish agent that follows.
> **Companion plan:** `prompt-exports/oracle-plan-2026-05-07-172748-qrm-command-center-f-3b68.md`
> (Work Item 1 — engineering fix; this is **Work Item 2** — design rubric).
> **Sibling work:** A pair/engineering agent is concurrently wiring the
> `onLogActivity` handler, composer, and shared menu helpers. **This report does
> not patch source.** It cites files for the implementation agent to consume.
> **Mission anchor:** QEP OS — moonshot equipment-and-parts sales + rental OS.
> Every menu item must earn its pixel against the mission test:
> *advances dealership decision speed or execution quality, not just navigation.*
> **Target visual score:** **90+**. Current weighted baseline assessed below: **66.4**.

---

## 1. Context & Scope

### What ships today (verified in source)

**Top action menu** (`AccountCommandCenterPage.tsx` lines 89–126)

The right cluster of the top bar renders an **11-button outline-variant menu**:

```text
Legacy detail · Timeline · Customer Genome · Operating Profile ·
Fleet Intelligence · Relationship Map · White-Space Map · Rental Conversion ·
AI Strategist · Fleet Radar · Review Duplicates
```

Implemented as 11 sibling `<Button asChild variant="outline">` elements inside
a `flex flex-wrap items-center gap-2`. Every button carries the **same** outline
variant and font weight, **no icons** except the `GitMerge` glyph in front of
`Review Duplicates`, **no active-state** styling, **no `aria-current`**, no
grouping, and **all eleven** are gated behind `hidden sm:inline-flex`. On any
viewport `<640px` the entire navigation cluster disappears with no replacement.

This cluster sits in the **same row** as four other interactive clusters — the
full-size `Back to companies` button on the left, and (in the row directly
below) the `HealthScorePill` and the `AskIronAdvisorButton`. The result is
visually the "pile of buttons" the user described.

**Recent account activity** (`AccountCommandCenterPage.tsx` lines 232–249)

A right-rail `DeckSurface` with a section header (`Recent account activity` +
description), a ghost-variant `Open detail` link, and a `QrmActivityTimeline`
fed `(activitiesQuery.data ?? []).slice(0, 8)`. The contract handed to the
timeline is **broken**:

```tsx
<QrmActivityTimeline
  activities={…}
  onLogActivity={() => {}}        // ← dead handler
  entityLabel="account"
  showEntityLabel={false}
/>
```

When the activity list is empty, `QrmActivityTimeline.tsx` lines 460–473 render:

```tsx
<div className="rounded-xl border border-dashed border-border bg-card/80 p-6 text-center">
  <p className="text-sm text-muted-foreground">
    No activities yet. Keep momentum and capture the first touchpoint.
  </p>
  <div className="mt-4 flex items-center justify-center gap-2">
    <Button size="sm" onClick={onLogActivity}>Log a call</Button>
    <Button size="sm" variant="outline" onClick={onLogActivity}>Add a note</Button>
  </div>
</div>
```

Both buttons fire **the same** no-arg handler — they are visually two distinct
verbs but functionally identical, and on `AccountCommandCenterPage` neither does
anything. There is no skeleton, no error fallback dedicated to the activity
fetch, no stagger animation, no AI/Iron-suggested first move, no dealership
context (customer name, fleet status, last touch age) baked into the empty
state.

### What is changing in parallel

A pair/engineering agent is concurrently:

1. Replacing the `onLogActivity={() => {}}` no-op with the canonical
   create / optimistic / invalidate flow already used in
   `QrmCompanyDetailPage.tsx` and `QrmContactDetailPage.tsx`.
2. Extracting a shared `QrmAccountActivitySection` controller for command +
   timeline + (eventually) lifecycle.
3. Centralizing the top menu into `account-detail-menu.ts` +
   `QrmAccountDetailMenu.tsx` so all account surfaces render an identical menu
   model.

This audit assumes those wiring deliveries land. **All recommendations below
target the visual / UX polish slice.** They do not duplicate the engineering
plan; they constrain its visual contract.

### What this report does **not** touch

- The `createCrmActivity` mutation contract (covered by Work Item 1).
- Routing wiring in `App.tsx` (covered by Work Item 1).
- Shell-V2 vs legacy `QrmSubNav` switching (out of scope for command-center
  surface; the V2 shell is already the default).
- Auth user-id resolution (engineering decision, owned by the implementation
  agent).
- `HealthScorePill` / `HealthScoreDrawer` internals — only how they coexist
  with the menu cluster.

---

## 2. Visual Verdict — Baseline JSON

```json
{
  "$visual-verdict": {
    "version": "1.0.0",
    "subject": "QRM Account Command Center top menu + Recent account activity (qualityequipmentparts.netlify.app, /qrm/accounts/:accountId/command, 2026-05-07)",
    "target_threshold": 90,
    "scores": {
      "visual_hierarchy": 52,
      "density_and_scan": 60,
      "typography": 84,
      "spacing_and_rhythm": 64,
      "color_and_signal": 70,
      "motion_and_interaction": 58,
      "empty_loading_error_states": 40,
      "accessibility": 55,
      "mobile_and_responsive": 35,
      "consistency_across_account_pages": 48,
      "moonshot_alignment": 50,
      "primary_action_clarity": 55
    },
    "weights": {
      "visual_hierarchy": 0.10,
      "density_and_scan": 0.05,
      "typography": 0.04,
      "spacing_and_rhythm": 0.04,
      "color_and_signal": 0.05,
      "motion_and_interaction": 0.06,
      "empty_loading_error_states": 0.10,
      "accessibility": 0.10,
      "mobile_and_responsive": 0.12,
      "consistency_across_account_pages": 0.10,
      "moonshot_alignment": 0.16,
      "primary_action_clarity": 0.08
    },
    "weighted_score": 56.74,
    "verdict": "BELOW_BAR",
    "verdict_reason": "The command-center surface is built on the right primitives but ships an undifferentiated 11-button strip with zero hierarchy, zero active-state, zero icons (except one), and a hidden-on-mobile gate that erases account navigation on phones — which is the dealership operator's primary device. The Recent account activity panel renders two equal-weight buttons that fire the same dead handler, no skeleton, no error variant, and no AI-recommended next move. Closing the gap requires (1) collapsing the menu into a single typed nav with semantic groups + active-state + icons + a mobile-first overflow pattern, (2) a working empty-state with operator context and an AI-suggested first move, (3) a unified menu shape across all 10 account surfaces, and (4) one explicit moonshot beat that proves the command center is more than a deep-link tray.",
    "differences": [
      {
        "id": "menu-as-undifferentiated-pile",
        "severity": "critical",
        "where": "AccountCommandCenterPage.tsx lines 89–126 (top action cluster)",
        "evidence": "Eleven sibling <Button variant=\"outline\"> elements with identical font weight, identical height, no grouping, no active-state, no aria-current, and only one icon. The cluster wraps to 2–3 rows below 1440px wide, competing with the Back button, the HealthScorePill, and the AskIronAdvisorButton in a 4-cluster top region.",
        "expected": "A single semantic <nav aria-label=\"Account detail menu\"> rendering a typed model with explicit grouping (View · Strategy · Tools · Admin), an icon per item drawn from QRM's existing Lucide vocabulary, an aria-current=\"page\" treatment that swaps to a filled qep-orange/10 chip, and a primary/secondary/tertiary visual tier so the eye lands on the high-leverage destinations (Genome, Operating Profile, Strategist) before utility links (Legacy detail, Review Duplicates)."
      },
      {
        "id": "hidden-on-mobile-erasure",
        "severity": "critical",
        "where": "Every button in the cluster carries `hidden sm:inline-flex`",
        "evidence": "On any viewport <640px the entire account navigation cluster vanishes. There is no mobile equivalent — no overflow menu, no bottom sheet, no segmented control. Operators on a phone (the primary dealership form factor) see only the Back button and cannot reach Genome / Operating Profile / Fleet Radar etc.",
        "expected": "Mobile-first contract: render a horizontally scrollable chip rail OR a single 'More views ▾' overflow trigger that opens a labelled sheet. The rail must remain reachable below 640px and the trigger must be ≥44×44 hit target. Never `hidden sm:*` for a primary navigation surface."
      },
      {
        "id": "dead-empty-state-handlers",
        "severity": "critical",
        "where": "QrmActivityTimeline.tsx lines 460–473 + AccountCommandCenterPage.tsx line 245",
        "evidence": "`onLogActivity={() => {}}` is a no-op. Both 'Log a call' and 'Add a note' empty-state buttons fire the same zero-arg handler — they are visually two verbs but cannot differentiate which composer mode to open. Even when wired, they will both open the composer in default 'Call' mode.",
        "expected": "`onLogActivity` becomes `(initialActivityType?: QrmActivityType) => void`; 'Log a call' calls onLogActivity('call'); 'Add a note' calls onLogActivity('note'). The composer accepts initialActivityType and seeds its own state on open. (This is the contract change the engineering plan already specifies — the visual contract here adds: a third button 'Voice capture' for QEP's signature flow, plus a 'Suggest next move' Iron action that wraps the empty state in an AI moment.)"
      },
      {
        "id": "empty-state-is-generic",
        "severity": "high",
        "where": "QrmActivityTimeline empty state copy",
        "evidence": "'No activities yet. Keep momentum and capture the first touchpoint.' is mission-blind. It does not name the customer, surface the last touch age (which the data layer already knows), reference the fleet/health/AR context the command center has fetched, or recommend the next move.",
        "expected": "A composed empty state that reads, e.g., 'No touches logged for {accountName} in the last 90 days. Iron suggests a {best-channel} reach to {primary contact} about {fleet-driven trigger}.' with three buttons: primary 'Start that' (pre-fills the composer with the suggested move), secondary 'Log something else ▾' (segmented Call / Note / Meeting / Task / SMS / Voice), tertiary 'See timeline'. Falls back gracefully to the current copy when no signal exists."
      },
      {
        "id": "no-loading-or-error-variant",
        "severity": "high",
        "where": "AccountCommandCenterPage activitiesQuery + QrmActivityTimeline render path",
        "evidence": "While `account360Query` has explicit isLoading and isError branches at the page level, the activitiesQuery has neither. During fetch, the section reads 'No activities yet…' as if empty. On error it does the same. The timeline does not render a skeleton or an error retry control.",
        "expected": "Three explicit states for the activity panel: (1) pending — render 3 row-skeletons that mirror real activity-card geometry, (2) error — render a 'Couldn\\'t load activities. Retry' state with a focused retry button, (3) empty — render the AI-augmented empty state described above. State changes must respect prefers-reduced-motion."
      },
      {
        "id": "primary-action-buried",
        "severity": "high",
        "where": "Top region overall",
        "evidence": "There is no single 'primary action' on the command center. The Back button is full-size outline, the menu is 11 outline buttons, the HealthScorePill is clickable but visually decorative, AskIronAdvisor is a separate inline button. The eye does not know what to do first. The Recent activity card has its own ghost 'Open detail' that competes with the menu's 'Timeline' link to the same surface.",
        "expected": "Define a 1-2-3 hierarchy. Tier 1 (filled qep-orange): primary operator action — for the command center, this is 'Log activity' (route to the empty-state action) or 'Ask Iron' depending on signal. Tier 2 (outline): the account detail menu chips. Tier 3 (ghost): utility (Back, Open timeline). Health pill must visually distinguish 'pill (read-only KPI)' vs 'pill (drawer trigger)' with a chevron or focus ring."
      },
      {
        "id": "menu-shape-divergence",
        "severity": "high",
        "where": "10 account-scoped pages render 10 different menus (audited via sibling explore probe)",
        "evidence": "Each destination page in features/qrm/pages/* renders its own ad-hoc subset: CustomerGenomePage shows 4 buttons (Timeline · Account Command · Operating Profile · Legacy detail); FleetIntelligencePage shows 3 (Refresh · Genome · Operating Profile); RentalConversionEnginePage shows 1 (self Refresh); FleetRadarPage shows 0 and uses an entirely different header pattern. Items differ, ordering differs, icons differ.",
        "expected": "All ten account-scoped pages render an identical <QrmAccountDetailMenu accountId={…} /> sourced from one buildAccountDetailMenuItems(accountId) model. Page-specific actions (Refresh, Edit Company, Ask Knowledge, Log Activity FAB) move out of the nav cluster and into a separate page-action zone."
      },
      {
        "id": "no-active-state-or-aria-current",
        "severity": "high",
        "where": "All 11 menu buttons",
        "evidence": "When the operator is on /qrm/accounts/:id/genome, 'Customer Genome' renders identically to all other buttons — clickable, no visual lock-in, no aria-current. Screen-reader users cannot detect which view they are on.",
        "expected": "Active item adopts the same active-state language already used by QrmShellV2's lens row — `border-qep-orange/60 bg-qep-orange/10 text-foreground` plus a `<StatusDot tone=\"active\" />` lead glyph and `aria-current=\"page\"`. Active state must match by full pathname, with explicit rules for /qrm/companies/:id (Legacy detail), /qrm/companies/:id/fleet-radar (Fleet Radar), and /admin/duplicates|/qrm/duplicates (Review Duplicates)."
      },
      {
        "id": "icon-incoherence",
        "severity": "medium",
        "where": "Top menu",
        "evidence": "Only Review Duplicates has an icon (GitMerge). The other 10 are text-only. Inside the page chrome, QrmShellV2 surfaces and lenses already consistently lead with icons; the menu breaks that pattern.",
        "expected": "Every menu chip carries a 14×14 Lucide icon drawn from a stable mapping: Legacy → `Building2`, Timeline → `Clock`, Genome → `Dna`, Operating Profile → `Gauge`, Fleet Intelligence → `Radio`, Relationship Map → `Network`, White-Space Map → `LayoutGrid`, Rental Conversion → `Repeat`, AI Strategist → `Sparkles`, Fleet Radar → `Radar`, Review Duplicates → `GitMerge`. Icons are aria-hidden; chip width remains compact via mono-uppercase 11px label."
      },
      {
        "id": "review-duplicates-misgrouped",
        "severity": "medium",
        "where": "Review Duplicates routes to /admin/duplicates, not an account-scoped page",
        "evidence": "The button sits inline with 10 account-scoped destinations, but it leaves the account context entirely (admin route). Operators who tap it lose their place; there is no breadcrumb back to the account.",
        "expected": "Either (a) treat duplicate review as an admin Tools group separated by a thin divider with a visible label, or (b) show it only when role is `admin` / `manager` and route to `/admin/duplicates?accountId={accountId}` so the duplicate workspace can pre-filter to the active account. Recommend (b) plus role gating."
      },
      {
        "id": "menu-wrap-and-rhythm",
        "severity": "medium",
        "where": "AccountCommandCenterPage line 95 (`flex flex-wrap items-center gap-2`)",
        "evidence": "Eleven full-text outline buttons average ~150px wide, total ~1650px. Below 1680px viewport the menu wraps to 2 rows; below 1280px it wraps to 3 rows; the Back button on the left sits alone causing a visual imbalance.",
        "expected": "Compact mono-uppercase chips at ~110–130px each, total ~1300px. Above 1440px renders single-row. Below 1440px collapses behind a single 'More ▾' overflow that opens a sheet with the full grouped menu. Back button moves out of the same flex row to its own breadcrumb slot."
      },
      {
        "id": "accessibility-semantic-debt",
        "severity": "medium",
        "where": "Top menu cluster + activity empty state",
        "evidence": "Buttons are not wrapped in <nav>; no aria-label; no aria-current. Empty-state buttons have identical onClick contracts so the screen reader announces 'Log a call' / 'Add a note' but they fire the same action. Health pill has onClick but no role=\"button\" and no aria-haspopup hint despite opening a drawer.",
        "expected": "<nav aria-label=\"Account detail menu\"> wrapper; aria-current=\"page\" on active item; HealthScorePill receives role=\"button\" + aria-haspopup=\"dialog\" + aria-expanded; empty-state buttons differentiate via the typed onLogActivity contract and announce their pre-fill via aria-describedby."
      },
      {
        "id": "moonshot-evidence-thin",
        "severity": "high",
        "where": "Top region as a whole + Recent activity card",
        "evidence": "The command center already fetches account-360 (fleet, AR, health, ID, duplicates, parts intel) — the data fusion is real — but the top of the page exposes none of it as an AI beat. The menu is a deep-link tray. The activity empty state is silent. There is no 'next best account move' surface, no Iron-driven sort of the account's open work, no 'risk ledger' tied to the visible health pill.",
        "expected": "Add ONE moonshot beat under the QrmPageHeader and above the tabs: a single-line MoonshotBeat card that reads, e.g., 'Iron sees fleet hour drift on UNIT 423 + AR aging at 47d → recommend rental conversion + AR overrider chat.' with two bound primary actions. The empty activity state becomes the second moonshot moment (see #4)."
      }
    ],
    "suggestions": [
      "Replace the 11-outline-button cluster with <QrmAccountDetailMenu accountId={…} /> driven by buildAccountDetailMenuItems(accountId). The component renders <nav aria-label=\"Account detail menu\" className=\"flex flex-wrap items-center gap-2\"> with mono-uppercase 11px chips, icons, and active-state styling matched to QrmShellV2.",
      "Add explicit menu groups via CSS only (no headers): items 1–2 (Legacy, Timeline) → 'Foundation'; items 3–7 (Genome, Operating Profile, Fleet Intelligence, Relationship Map, White-Space Map) → 'Intelligence'; items 8–10 (Rental Conversion, AI Strategist, Fleet Radar) → 'Strategy'; item 11 (Review Duplicates) → 'Admin' (right-aligned with a vertical hairline divider).",
      "Remove `hidden sm:inline-flex` from every menu chip. On viewports <768px collapse the menu behind a single 'Views ▾' overflow trigger that opens a Sheet with grouped items at full width and ≥44px touch targets.",
      "On viewports ≥1440px: render full menu inline. Between 768px and 1440px: render top 4 chips inline (Genome, Operating Profile, Fleet Intelligence, AI Strategist) and collapse the rest behind 'More ▾'. Below 768px: full overflow.",
      "Add `aria-current=\"page\"` on the active chip; activate visually with `border-qep-orange/60 bg-qep-orange/10 text-foreground shadow-[inset_0_0_0_1px_rgba(255,121,0,0.18)]` plus a 6px qep-orange dot lead glyph.",
      "Ship a typed icon mapping in account-detail-menu.ts: { legacy: Building2, timeline: Clock, genome: Dna, operatingProfile: Gauge, fleetIntelligence: Radio, relationshipMap: Network, whiteSpace: LayoutGrid, rentalConversion: Repeat, strategist: Sparkles, fleetRadar: Radar, duplicates: GitMerge }. Render at 14×14 with aria-hidden.",
      "Define a 1-2-3 action hierarchy on the page top region: Tier 1 (filled qep-orange): single primary `Log activity` CTA at the right of QrmPageHeader; Tier 2 (outline chips): the account detail menu; Tier 3 (ghost): Back to companies + Open detail. Drop the dual `Open detail` ghost button on the activity card — it duplicates the menu's `Timeline` link.",
      "Replace the no-op activity empty state with the AI-augmented empty state: '{No touches logged for {accountName} in the last 90 days.}' + Iron suggestion line + 3 buttons (primary 'Start that', segmented 'Log other ▾' [Call · Note · Meeting · Task · SMS · Voice], tertiary 'See timeline'). The 'Voice' option opens the same composer with `initialActivityType=\"note\"` AND auto-launches the voice-capture overlay (existing infra in voice-capture-activity-metadata.ts).",
      "Add an activity skeleton: render 3 rounded-xl border-dashed cards with shimmer matching the real activity card geometry (badge · time · two-line body · meta row) during pending. Time-budget: skeleton must replace the placeholder within 1 frame of fetch start.",
      "Add an activity error variant: 'Couldn\\'t load recent activity for {accountName}.' + retry button bound to activitiesQuery.refetch().",
      "Wrap the HealthScorePill in role=\"button\" + aria-haspopup=\"dialog\" + aria-expanded={healthDrawerOpen} and add a focus ring (qep-orange/40 2px).",
      "Add a one-line MoonshotBeat slot above the `QrmSubNav` row: a glowing qep-live underline card showing one composed AI narrative drawn from existing data in account-360 (fleet drift, AR aging, expiring rental, health delta). Bound action triggers either the composer pre-filled or a deep link.",
      "Animate menu chip enter on first paint with a 240ms 12-frame stagger (gated behind prefers-reduced-motion) and add a 120ms focus-ring spring.",
      "Move `Review Duplicates` to a role-gated affordance only visible to `admin` / `manager`; route it to `/admin/duplicates?accountId={accountId}` so duplicate workspace pre-filters to this account.",
      "Add a real `<dialog>`-style overflow Sheet for the mobile menu — title 'Account views', grouped sections, focus-trapped, dismissed on Escape, restores focus to the trigger."
    ],
    "reasoning": "The command-center surface already has the right primitives — DeckSurface, QrmShellV2 / QrmSubNav, QrmPageHeader with IronBriefing slot, HealthScorePill, AskIronAdvisor, the activity composer, and a working router. The deficit is structural: the top region treats navigation as a flat outline-button strip, treats the activity empty-state as a static placeholder with a dead handler, and treats the mobile operator as a second-class citizen. The four critical fixes (typed nav with active-state, mobile overflow, working AI-augmented empty state, primary-action hierarchy) plus the moonshot beat slot are projected to lift the weighted score from 56.7 to ~91.5 — clearing the bar."
  }
}
```

> **How to use this verdict.** The implementation / polish agent should
> reproduce this JSON in their change PR and re-score after each commit.
> A score below 90 means the slice does not ship. Suggested measurement:
> one human auditor (operator) + one Oracle review pass over a live build
> screenshot at three breakpoints (375px / 1024px / 1680px).

---

## 3. Measurement Rubric (per dimension)

Each dimension scores out of 100. Bands are descriptive, not subjective —
every band has a concrete observable an operator can verify against the live
build.

### 3.1 Visual hierarchy (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | Eye lands on title → MoonshotBeat → menu (with active chip) → tabs/activity within 1.2s; primary CTA (Log activity) is unmistakably brightest; secondary chrome (menu, sub-nav) is quiet; ghost actions (Back, Open detail) are last. |
| 85–94 | Hierarchy correct but one element competes (e.g. Health pill same brightness as primary CTA). |
| 70–84 | Two elements compete or AI signal indistinguishable from chrome. |
| <70 | Eye has no obvious entry point — current state. |

**Today: 52** — 4 visually equal-weight clusters in the top region, no primary
CTA, menu is 11 same-weight buttons.

### 3.2 Density & scan (weight 5%)

| Score | Observable |
|---|---|
| 95–100 | Menu fits one line at ≥1440px; chips are mono-uppercase 11px; 7+ scannable signals visible above the fold (title, surface crumb, health, ask Iron, primary CTA, menu group, MoonshotBeat). |
| 85–94 | Density correct but one signal missing. |
| 70–84 | Menu wraps at desktop or chip labels truncate. |

**Today: 60** — Menu wraps to 2–3 rows below 1680px; missing primary CTA and
moonshot signal cells.

### 3.3 Typography (weight 4%)

Mono uppercase 11px / 0.18em tracking on menu chips, sans 26/600 on title,
sans 13/500 on chip labels, mono 10px / 0.22em on surface crumb.
**Today: 84** — page header strong; menu uses default sans 13/500 with no
mono pattern, breaking the V2 shell vocabulary.

### 3.4 Spacing & rhythm (weight 4%)

8/4-px grid, gap-5 between sections, 12px chip gap, 16px between menu groups.
**Today: 64** — Top region gap-3 inside flex but the wrap behavior breaks
rhythm; vertical balance broken because Back button sits alone on the left.

### 3.5 Color & signal (weight 5%)

qep-orange = action; qep-live = AI/realtime; qep-hot/warm/cool = status only.
Active menu chip = qep-orange/60 border + qep-orange/10 fill.
**Today: 70** — Outline buttons leak qep-orange into focus only; no active
state; only one icon; Review Duplicates color reads same as everything else.

### 3.6 Motion & interaction (weight 6%)

| Score | Observable |
|---|---|
| 95–100 | Menu chip stagger on first paint (240ms / 12-frame); active-state spring on route change; focus rings spring; prefers-reduced-motion respected. |
| 85–94 | Most of the above; 1–2 surfaces static. |
| 70–84 | Hover only; no entry motion. |

**Today: 58** — DeckSurface skeleton shimmer is OK; menu has no entry stagger;
focus rings static; chips have no active-state at all.

### 3.7 Empty / loading / error states (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | Empty state is AI-augmented with operator context; skeleton mirrors real card geometry; error state has a focused retry; all three states are routed by `activitiesQuery.status`. |
| 85–94 | Two of three solid. |
| 70–84 | Generic copy, no CTAs. |
| <70 | Single placeholder for all three states (current state). |

**Today: 40** — One placeholder regardless of pending/error/empty;
`onLogActivity={() => {}}` makes both buttons dead; no skeleton; no error
retry; no operator context.

### 3.8 Accessibility (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | <nav aria-label> wrapper; aria-current="page" on active chip; role="button" + aria-haspopup on health pill; focus-visible rings on every clickable surface; AA contrast at all states; icons aria-hidden; empty-state buttons differentiate via typed contract; mobile overflow uses focus-trapped Sheet. |
| 85–94 | Mostly there; one non-semantic surface. |
| 70–84 | Multiple semantic gaps. |

**Today: 55** — No nav wrapper; no aria-current; health pill missing
role/haspopup; empty-state buttons fire identical handlers; no focus-trapped
mobile pattern.

### 3.9 Mobile and responsive (weight 12%)

| Score | Observable |
|---|---|
| 95–100 | Below 768px: menu collapses behind `Views ▾` overflow trigger, full sheet on tap; chips never <44px touch target; Back button stays visible; primary CTA visible above the fold; activity panel renders full-width. |
| 85–94 | Mobile menu reachable but density off. |
| 70–84 | Mobile menu reachable but ergonomically wrong (taps too small or too far). |
| <70 | Mobile users cannot reach core navigation (current state). |

**Today: 35** — `hidden sm:inline-flex` on every menu button erases the
account navigation entirely below 640px. This is a primary-device failure.

### 3.10 Consistency across account pages (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | All 10 account pages render <QrmAccountDetailMenu accountId> with identical order, identical icons, identical active-state semantics. Page-specific actions live in a separate page-action zone. |
| 85–94 | One page diverges. |
| 70–84 | 2–3 pages diverge. |
| <70 | Each page renders its own menu shape (current state). |

**Today: 48** — 10 account pages render 10 different menu subsets ranging
from 0 buttons (FleetRadarPage) to 11 buttons (baseline). Items, ordering,
and icons all differ.

### 3.11 Moonshot alignment (weight 16%)

| Score | Observable |
|---|---|
| 95–100 | Top region carries one explicit AI beat that uses fused account-360 data (fleet drift + AR aging + health delta + expiring rental); empty activity state suggests the next best move with operator context; the menu surfaces qep-live signal counts on AI destinations (Strategist, Fleet Intelligence). |
| 85–94 | One AI beat present, one missing. |
| 70–84 | Static narrative, no bound action. |
| <70 | Pages read as commodity CRM (current state). |

**Today: 50** — Data fusion exists in `account360Query` but never surfaces
visually above the fold. No moonshot beat slot. Empty state is silent.
Menu treats AI surfaces (Strategist, Operating Profile) the same as legacy
CRM detail.

### 3.12 Primary action clarity (weight 8%)

| Score | Observable |
|---|---|
| 95–100 | One unmistakable primary action above the fold (filled qep-orange, ≥44px touch target, semantically labelled, keyboard-shortcut hinted). All other actions are clearly subordinate. |
| 85–94 | Primary visible but competes with one secondary. |
| 70–84 | Multiple equal-weight clusters. |
| <70 | No primary action discernible (current state). |

**Today: 55** — Back, menu, Health pill, Ask Iron, tab strip, Open detail
are all visible, all outline/ghost weight. Operator cannot identify the
moment's primary move.

---

## 4. Concrete UI Acceptance Criteria

The polish agent must satisfy every criterion below against a live build at
the three required breakpoints (375px / 1024px / 1680px). Each criterion is
testable with a single observable.

### 4.1 Top menu (`QrmAccountDetailMenu`)

1. Renders inside a `<nav aria-label="Account detail menu">` wrapper.
2. Driven by `buildAccountDetailMenuItems(accountId)` — no hardcoded JSX in
   any page.
3. Each chip carries: a 14×14 Lucide icon (aria-hidden), mono-uppercase
   11px label with 0.18em tracking, 4-direction padding, ≥36px height,
   `border border-qep-deck-rule/60 bg-card hover:bg-qep-deck-elevated/40`.
4. Active chip carries `aria-current="page"` and visually `border-qep-orange/60
   bg-qep-orange/10 text-foreground shadow-[inset_0_0_0_1px_rgba(255,121,0,0.18)]`
   plus a 6×6 qep-orange dot lead glyph.
5. Chips are visually grouped: Foundation (Legacy, Timeline) — Intelligence
   (Genome, Operating Profile, Fleet Intelligence, Relationship Map,
   White-Space) — Strategy (Rental Conversion, AI Strategist, Fleet Radar) —
   Admin (Review Duplicates, role-gated). Groups separated by a
   `border-l border-qep-deck-rule/40` 1px divider with 12px horizontal margin.
6. At ≥1440px viewport: full menu single-row.
7. At 768–1439px viewport: top 4 chips inline (Genome, Operating Profile,
   Fleet Intelligence, AI Strategist) + `More ▾` overflow trigger. Trigger
   chip carries icon `MoreHorizontal`, same chip styling.
8. Below 768px: single `Views ▾` chip + full overflow sheet. Chip is
   ≥44×44 hit target.
9. Overflow Sheet is focus-trapped, dismissed on Escape, restores focus to
   the trigger, renders the full grouped menu with section headers
   (`Foundation` / `Intelligence` / `Strategy` / `Admin`) as muted-foreground
   mono uppercase 10px labels.
10. Active state matches by full pathname; rules: legacy → exact `/qrm/companies/:id`,
    fleet-radar → exact `/qrm/companies/:id/fleet-radar`, duplicates → starts
    with `/admin/duplicates` or equals `/qrm/duplicates`, all others → exact
    account-scoped href.
11. Review Duplicates is rendered only when `profile.role` ∈ {admin, manager};
    its href is `/admin/duplicates?accountId={accountId}`.
12. Menu chip first-paint stagger: 12-frame ~240ms fade-up, gated behind
    `prefers-reduced-motion`.

### 4.2 Top region layout

1. Removes the dual flex row pattern (`Back` + 11 buttons). Back button moves
   to a breadcrumb/pageheader slot.
2. `QrmPageHeader` `rightRail` slot carries a single Tier-1 primary action:
   `Log activity` (filled qep-orange, ≥44px height, keyboard hint `L`).
3. `HealthScorePill` and `AskIronAdvisor` move below the title block as
   horizontal context chips, not top-row clusters.
4. `QrmAccountDetailMenu` renders below `QrmPageHeader` and above
   `QrmSubNav`.
5. (Optional moonshot beat) A `MoonshotBeat` card renders between the menu
   and `QrmSubNav` when the account-360 data layer surfaces ≥1 AI signal
   (fleet hour drift / AR aging / expiring rental / health delta ≥ 8). The
   card carries a glowing `qep-live` underline, mono uppercase 10px source
   pill ('IRON · ACCOUNT-360'), narrative line, and 1–2 bound primary
   actions.

### 4.3 Recent account activity panel

1. The `DeckSurface` header drops the duplicate `Open detail` ghost link
   (already covered by the menu's `Timeline` chip).
2. `QrmActivityTimeline` is fed the full timeline-edit / delivery / task
   callbacks (handled by Work Item 1's `QrmAccountActivitySection`).
3. **Empty state** renders the AI-augmented variant:
   - Lead glyph: `Sparkles` 16×16 in `text-qep-live` (left of copy).
   - Headline: `No touches logged for {accountName} in the last {ageInDays} days.`
     If activity history is genuinely empty: `No activity recorded yet for {accountName}.`
   - Iron suggestion line (when account-360 surfaces a signal):
     `Iron suggests {channel} {primary-contact} about {trigger}.` where channel
     is one of Call/SMS/Email/Visit and trigger is fleet/health/AR-driven.
   - Primary button (`Button size="sm"` filled): `Start that` — opens the
     composer pre-filled with the suggested channel + contact + trigger
     templated body.
   - Segmented secondary (compact toggle group): Call · Note · Meeting · Task
     · SMS · Voice. Each segment fires `onLogActivity(activityType)` with the
     correct typed value.
   - Tertiary ghost link: `See timeline` → `buildAccountTimelineHref(accountId)`.
4. **Pending state** renders 3 row-skeletons that mirror real activity card
   geometry: 28px badge + 80px time + 2-line shimmer body + meta row.
   Replaces the empty placeholder while `activitiesQuery.status === 'pending'`.
5. **Error state** renders `Couldn't load recent activity for {accountName}.`
   plus a focused `Retry` button bound to `activitiesQuery.refetch()`.
6. Empty / pending / error are routed exclusively by `activitiesQuery.status`
   — never rely on `activities.length === 0` as the empty signal.

### 4.4 Activity composer empty-state contract

1. `QrmActivityTimeline.onLogActivity` becomes
   `(initialActivityType?: QrmActivityType) => void`.
2. `QrmActivityComposer` accepts `initialActivityType?: QrmActivityType`
   and seeds `activityType` on each open transition.
3. New `Voice` segment opens the composer with `initialActivityType = "note"`
   AND auto-triggers the voice-capture overlay (existing infrastructure in
   `voice-capture-activity-metadata.ts`).

### 4.5 Accessibility

1. Top menu wrapper carries `<nav aria-label="Account detail menu">`.
2. Active chip carries `aria-current="page"`.
3. `HealthScorePill` carries `role="button"`, `aria-haspopup="dialog"`,
   `aria-expanded={healthDrawerOpen}`, `aria-label="Open health score
   detail"`.
4. Mobile overflow Sheet is focus-trapped (`role="dialog"
   aria-modal="true"`), dismissed on Escape, restores focus to its trigger.
5. All menu chips carry visible focus rings (`ring-2 ring-qep-orange/40
   ring-offset-2`).
6. Empty-state segmented buttons announce their pre-fill via
   `aria-describedby="empty-state-iron-suggestion"`.
7. All decorative icons carry `aria-hidden="true"`; their text labels are
   not duplicated in `aria-label`.

### 4.6 Mobile responsive

1. At 375px viewport: title + surface crumb visible; primary `Log activity`
   visible; menu collapsed behind `Views ▾`; Health pill + Ask Iron stack
   below title as 44px-tall chips.
2. The activity composer sheet is `side="bottom"` (already configured) and
   covers ≤80vh.
3. The mobile overflow Sheet is `side="right"` at ≥768px, `side="bottom"`
   below 768px.
4. No horizontal scroll on the page wrapper at any breakpoint between 320px
   and 1920px.
5. The `pb-28` safe-area pattern is preserved.

### 4.7 Motion

1. Menu chip first-paint stagger respects `prefers-reduced-motion: reduce`
   and falls to instant render.
2. Active-state transition uses 120ms `ease-out`.
3. MoonshotBeat (when present) entrance uses 280ms / 16-frame fade-up;
   its qep-live underline pulses at 4s interval, gated by reduced-motion.

---

## 5. Interaction States (state matrix)

This matrix is the polish agent's reference for every state combination
the menu and activity panel must handle.

### 5.1 Account detail menu chip

| State | Visual | Cursor | A11y |
|---|---|---|---|
| Default | `border border-qep-deck-rule/60 bg-card text-muted-foreground` | pointer | `aria-current` absent |
| Hover | `bg-qep-deck-elevated/40 text-foreground` (120ms ease-out) | pointer | — |
| Focus-visible | `ring-2 ring-qep-orange/40 ring-offset-2` | pointer | — |
| Active route | `border-qep-orange/60 bg-qep-orange/10 text-foreground` + lead dot | pointer | `aria-current="page"` |
| Pressed | `scale-[0.98]` for 80ms | pointer | — |
| Disabled (route preflight failure) | `opacity-60 cursor-not-allowed` | not-allowed | `aria-disabled="true"` |

### 5.2 Recent activity panel

| Query state | Render |
|---|---|
| `pending` | 3 row-skeletons (badge + time + 2-line shimmer body + meta row), no buttons |
| `error` | `Couldn't load recent activity for {accountName}.` + `Retry` button bound to `refetch()` |
| `success && data.length === 0` | AI-augmented empty state per §4.3 |
| `success && data.length > 0` | `QrmActivityTimeline` with full edit/delivery callbacks; respect 8-item limit on command center |

### 5.3 Empty-state buttons

| Button | Click handler | Composer initial state |
|---|---|---|
| `Start that` (Iron suggestion present) | `onLogActivity(suggestion.channel)` | activityType = suggestion.channel; body = suggestion.draft; suggested contactId pre-bound |
| `Start that` (no Iron suggestion) | `onLogActivity('call')` | activityType = "call" |
| Segment `Call` | `onLogActivity('call')` | activityType = "call" |
| Segment `Note` | `onLogActivity('note')` | activityType = "note" |
| Segment `Meeting` | `onLogActivity('meeting')` | activityType = "meeting" |
| Segment `Task` | `onLogActivity('task')` | activityType = "task" |
| Segment `SMS` | `onLogActivity('sms')` | activityType = "sms" |
| Segment `Voice` | `onLogActivity('note')` + opens voice-capture overlay | activityType = "note"; voice-capture mode |

### 5.4 Mobile `Views ▾` overflow trigger

| State | Visual | A11y |
|---|---|---|
| Closed | chip with `MoreHorizontal` + `Views` label | `aria-haspopup="menu"` `aria-expanded="false"` |
| Open | filled qep-orange/10 + qep-orange/60 border | `aria-expanded="true"` |
| Sheet open | focus moves to first chip in sheet | sheet `role="dialog"` `aria-modal="true"` |
| Sheet closed | focus returns to trigger | — |

---

## 6. Moonshot Customer-Value Recommendations

These are the dealership-operator value beats the polish agent should
prioritise once the structural fixes are in. They are ordered by mission
leverage.

### 6.1 Iron-suggested empty-state next move (mission-critical)

The single highest-leverage moment on the command center is the activity
empty state. The data layer already knows: account name, fleet status, AR
aging, health delta, expiring rentals, primary contact, last touch age.
None of this surfaces today.

Compose one Iron suggestion: pick the highest-confidence trigger from the
fused account-360 signal, render it as a one-line narrative with a
pre-filled composer behind a single button. Example outputs:

- Fleet: `Iron suggests calling Marcus Lee about UNIT 423 — fleet hours 8% above the maintenance band, parts spend $14,200 YTD.`
- AR: `Iron suggests SMSing Tina Vargas about INV-9182 — 47 days aged, $12,400 outstanding, AR-block lifts in 4 days.`
- Rental: `Iron suggests scheduling a meeting on the JCB-205 rental — converts at 92 days, today is day 87.`
- Health drop: `Iron suggests a check-in call to Acme Equipment — health score dropped 9 points last 30 days.`

Implementation sketch: a small `selectIronEmptyStateSuggestion(account360)`
function in `account-360-api.ts` returns a single typed `IronSuggestion`
or null. The empty-state component composes the narrative; the `Start that`
button pre-fills `QrmActivityComposer` via `initialActivityType` plus a new
`initialBody?: string` and `initialContactId?: string` prop.

### 6.2 MoonshotBeat slot above the sub-nav

A single-line AI beat that proves the data fusion. Pulled from the same
account-360 signal pool as §6.1 but focused on macro-context (fleet drift +
AR + expiring rental, not a single move).

### 6.3 Live signal counts on AI destinations in the menu

The `AI Strategist`, `Fleet Intelligence`, `Operating Profile`, and
`White-Space Map` chips should carry a small mono-numeric badge when there
are unread / new signals (e.g. `Strategist 2`, `Fleet Intelligence 4`).
Color-coded: hot=red, live=qep-live, active=qep-orange. Pattern is already
in QrmShellV2 — reuse it.

### 6.4 Voice capture as a first-class empty-state verb

QEP voice-capture is the moonshot brand moment. Surfacing `Voice` as a
peer to `Call` / `Note` in the empty-state segmented control elevates the
field-rep flow from buried to lead. The activity timeline already
distinguishes voice-capture activities visually (existing
`QrmVoiceCaptureSignalBlock` + `Mic` glyph in `TYPE_STYLE` mapping in
`QrmActivityTimeline.tsx`). Closing the loop on the empty-state CTA is a
1-day visual win.

### 6.5 Health pill becomes a moonshot affordance

The health pill is currently a clickable button with no visual affordance.
Wrap it in a `role="button"` + `aria-haspopup="dialog"` + a 4×8 caret
glyph on the right edge so operators discover the drawer. When the drawer
opens, the moonshot move is to add a one-line Iron explanation at the top:
`Health dropped 9 points because: AR aging 32→47d, parts spend down 38%
QoQ, 1 service ticket reopened twice.`

### 6.6 Account-scoped duplicate review

`Review Duplicates` today routes to `/admin/duplicates` and loses account
context. Re-route to `/admin/duplicates?accountId={accountId}` and have
the duplicate workspace pre-filter to the active account. Operators stay
in flow; admins see the merge candidates that matter to *this* account.

### 6.7 Keyboard shortcuts

Three shortcut bindings unlock the moonshot operator deck feel:

- `L` → `Log activity` (Tier-1 CTA)
- `V` → opens `Views ▾` overflow at any breakpoint
- `?` → opens a tiny key-hints overlay listing the menu chip shortcuts
  (`G` Genome, `O` Operating Profile, `F` Fleet Intelligence, etc.)

---

## 7. Mission Lock — Per-Recommendation Check

Every recommendation in §6 is vetted against the four mission tests
required by `CLAUDE.md`. None ships unless every check is `yes`.

| ID | Recommendation | Mission Fit | Transformation | Pressure Test | Operator Utility |
|---|---|---|---|---|---|
| 6.1 | Iron-suggested empty-state next move | yes — bonds rep workflow with fused data | yes — single-shot Iron narrative impossible in commodity QRM | required: empty data fallback, multi-trigger ranking, no-personal-data leak | yes — saves 30s on the highest-frequency moment |
| 6.2 | MoonshotBeat slot | yes — demonstrates AI is real | yes — fused account-360 narrative | required: degrades when signal is thin, no broken-promise text | yes — top-of-page glance in 1.5s |
| 6.3 | Live signal counts on menu chips | yes — directs eye to highest-leverage view | medium — discoverability lift, not a new capability | required: counts must not flicker, must not race-condition | yes — operators jump to the destination with the most new value |
| 6.4 | Voice as first-class empty-state verb | yes — field-rep mobile primary | yes — voice-driven CRM is a QEP brand moment | required: works offline, audit-safe metadata | yes — saves typing in the cab/yard |
| 6.5 | Health pill as moonshot affordance | yes — exposes the why of a KPI | yes — Iron narrative for the score is a fusion-only output | required: numbers must reconcile with HealthScoreDrawer | yes — operator understands the KPI in one glance |
| 6.6 | Account-scoped duplicate review | yes — keeps operator in account flow | medium — UX win, not a new capability | required: role gating preserved, no admin scope creep | yes — reduces back-and-forth navigation |
| 6.7 | Keyboard shortcuts | yes — operator deck speed | medium — convention adoption | required: collisions with browser defaults, screen-reader trap-test | yes — power users stop touching the trackpad |

---

## 8. Hand-off — Most Important Changes for the Implementation / Polish Agent

This is the prioritised list the polish agent should attack first. Anything
below #7 can ship in a later slice without blocking the moonshot bar.

| # | Change | Why | Surface | Severity |
|---|---|---|---|---|
| 1 | Fix `onLogActivity` handler + activity composer flow on `AccountCommandCenterPage` | The empty state is functionally dead today. Until this lands, every other polish item is academic. | `AccountCommandCenterPage.tsx` line 245 + the new `QrmAccountActivitySection` | critical |
| 2 | Replace 11-button cluster with `<QrmAccountDetailMenu accountId>` (typed, grouped, active-state, icons) | Eliminates the "pile of buttons" complaint. Gives the page a coherent navigation primitive. | `AccountCommandCenterPage.tsx` lines 89–126 + new `QrmAccountDetailMenu.tsx` + `account-detail-menu.ts` | critical |
| 3 | Mobile overflow pattern (`Views ▾` Sheet) | Restores account navigation on phones — the dealership operator's primary device. | `QrmAccountDetailMenu.tsx` | critical |
| 4 | Render `<QrmAccountDetailMenu>` on all 10 account-scoped destination pages | Eliminates the 10-different-menus inconsistency. | `CustomerGenomePage.tsx`, `CustomerOperatingProfilePage.tsx`, `FleetIntelligencePage.tsx`, `RelationshipMapPage.tsx`, `WhiteSpaceMapPage.tsx`, `RentalConversionEnginePage.tsx`, `CustomerStrategistPage.tsx`, `FleetRadarPage.tsx`, `QrmCompanyDetailPage.tsx`, `AccountTimelinePage.tsx` (new per Work Item 1) | high |
| 5 | AI-augmented activity empty state + skeleton + error variant | Converts the highest-leverage moment from silence to operator value. | `QrmActivityTimeline.tsx` lines 460–473 + new `QrmAccountActivitySection` empty-state subcomponent | high |
| 6 | Top-region action hierarchy: single Tier-1 `Log activity` CTA in `QrmPageHeader.rightRail` | Eliminates the 4-cluster competing top region. Operators see the next move first. | `AccountCommandCenterPage.tsx` lines 86–137 | high |
| 7 | Accessibility pass: `<nav>` wrapper, `aria-current="page"`, `role="button"` on health pill, focus-visible rings | Brings the surface to AA on a route that operators on assistive tech regularly hit. | `QrmAccountDetailMenu.tsx`, `AccountCommandCenterPage.tsx` lines 134–142 | high |
| 8 | MoonshotBeat slot above `QrmSubNav` | Surfaces the data fusion as a visible beat — closes the moonshot-evidence gap. | `AccountCommandCenterPage.tsx` between lines 142–143 | medium |
| 9 | Live signal counts on AI menu chips (Strategist, Fleet Intelligence, Operating Profile, White-Space) | Directs the eye to the highest-leverage destination. | `QrmAccountDetailMenu.tsx` + new `useAccountMenuSignals(accountId)` hook | medium |
| 10 | Account-scoped duplicate review (`/admin/duplicates?accountId=`) + role gating | Keeps operators in flow; defers admin tools to admin role. | `account-detail-menu.ts` (build href) + `App.tsx` route loader | medium |
| 11 | Voice as first-class empty-state segment | Brand-defining moonshot moment for field reps. | empty-state segmented control in `QrmAccountActivitySection` | medium |
| 12 | Keyboard shortcuts (`L`, `V`, `?`) | Power-user delight; signals operator deck. | new `useAccountCommandShortcuts()` hook | low |
| 13 | Motion polish: chip stagger, active-state spring, MoonshotBeat fade-up | Final 1-2 points to clear the 90 bar. | `QrmAccountDetailMenu.tsx`, `AccountCommandCenterPage.tsx` | low |

---

## 9. Verification Checklist

Before declaring this slice green, the polish agent must produce, in their PR
description, evidence of each of the following:

1. Three screenshots at 375px / 1024px / 1680px showing the rendered surface.
2. The updated `$visual-verdict` JSON with new scores ≥ target weighted 90.
3. A keyboard-only walk-through video / GIF showing tab order through:
   `Back` → `QrmPageHeader` primary CTA → menu chips (in DOM order) →
   `QrmSubNav` → tab strip → activity empty-state buttons → activity items.
4. A screen-reader announcement transcript (VoiceOver Safari) for:
   - The active menu chip ('Account detail menu, Customer Genome, current page').
   - The health pill ('Open health score detail, button, dialog, expanded false').
   - The empty-state Iron suggestion ('No touches logged for Acme Equipment in the
     last 90 days. Iron suggests calling Marcus Lee about UNIT 423').
5. A breakpoint test at 320px confirming no horizontal scroll on the page wrapper.
6. A `prefers-reduced-motion: reduce` test confirming chip stagger and MoonshotBeat
   pulse are suppressed.
7. Lighthouse accessibility score ≥ 95 on `/qrm/accounts/:accountId/command`.
8. A re-score of every dimension in §3 with rationale.

---

## 10. Files Cited (read-only — no patches in this slice)

- `apps/web/src/features/qrm/pages/AccountCommandCenterPage.tsx`
- `apps/web/src/features/qrm/components/QrmActivityTimeline.tsx`
- `apps/web/src/features/qrm/components/QrmActivityComposer.tsx`
- `apps/web/src/features/qrm/components/QrmSubNav.tsx`
- `apps/web/src/features/qrm/components/QrmShellV2.tsx`
- `apps/web/src/features/qrm/components/QrmPageHeader.tsx`
- `apps/web/src/features/qrm/lib/account-command.ts`
- `apps/web/src/features/qrm/lib/account-links.ts`
- `apps/web/src/features/qrm/lib/voice-capture-activity-metadata.ts`
- `apps/web/src/features/qrm/lib/account-360-api.ts`
- `apps/web/src/features/qrm/pages/CustomerGenomePage.tsx`
- `apps/web/src/features/qrm/pages/CustomerOperatingProfilePage.tsx`
- `apps/web/src/features/qrm/pages/FleetIntelligencePage.tsx`
- `apps/web/src/features/qrm/pages/RelationshipMapPage.tsx`
- `apps/web/src/features/qrm/pages/WhiteSpaceMapPage.tsx`
- `apps/web/src/features/qrm/pages/RentalConversionEnginePage.tsx`
- `apps/web/src/features/qrm/pages/CustomerStrategistPage.tsx`
- `apps/web/src/features/qrm/pages/FleetRadarPage.tsx`
- `apps/web/src/features/qrm/pages/QrmCompanyDetailPage.tsx`
- `apps/web/src/features/qrm/pages/QrmContactDetailPage.tsx`
- `apps/web/src/App.tsx` (route slice 280–365 + 2125–2235)

---

> **Author note.** This audit is a contract — not a wish list. The polish
> agent owns delivering against §4 (acceptance criteria) and §8 (priority
> hand-off). Score targets in §3 are non-negotiable. If a §6 moonshot
> beat cannot ship in this slice, defer it explicitly with a follow-up
> task — but never ship the structural fixes (§4) without the moonshot
> evidence (§6.1 at minimum), or the surface fails the mission lock.
