# QRM Companies & Contacts — Moonshot UX Audit & Implementation Rubric

> **Status:** Read-only design / audit deliverable.
> **Scope:** `/qrm/companies` and `/qrm/contacts` operator-deck pages, as shown in the
> qualityequipmentparts.netlify.app screenshots dated 2026-05-07.
> **Author role:** Design auditor for the QRM Moonshot Uplift — produces the rubric,
> measurement baseline, and implementation guidance for the UI agent that follows.
> **Companion plan:** `prompt-exports/oracle-plan-2026-05-07-162333-qrm-moonshot-uplift-c98e.md`
> **Mission anchor:** QEP OS — moonshot equipment-and-parts sales + rental OS for reps,
> operators, corporate, and management; transformational AI capabilities, not commodity QRM.
> **Target visual score:** **90+** (current baseline assessed below).

---

## 1. Context & Scope

### What ships in the screenshots today

**`/qrm/companies` (Companies page)**
- Header: title `Companies`, subtitle, surface/lens crumb (`GRAPH / COMPANIES · 25`),
  metric rail (`Loaded 25`, `States 7`, `Hot (≥80) 0`, `Cool (<40) 0`, `Tracked 0`),
  Iron briefing ribbon (`25 accounts across 7 states. No breach signal today.`),
  CSV / New buttons, HubSpot DataSourceBadge.
- Shell-V2 nav (`TODAY · GRAPH · PULSE · ASK IRON`) with active lens chip row
  (`COMPANIES`).
- Search rail with the `Extended IntelliDealer search off` toggle pinned right.
- 25 dense list rows: status dot · building glyph · account name · optional
  Search-1/Search-2 · IntelliDealer legacy badge · location · health placeholder (`—`)
  · disclosure chevron.
- Footer pager: `25 loaded` + `Load more` (or `end of list`).

**`/qrm/contacts` (Contacts page)**
- Header: title `Contacts`, subtitle, crumb (`GRAPH / CONTACTS · 25`),
  metric rail (`Loaded 25`, `Hot (≥80) 0`, `Cool (<40) 0`, `New 7d 0`, `Duplicates 100`),
  Iron briefing ribbon (`100 duplicates detected across 25 contacts — resolving keeps
  activity, deals, and timelines on one record.`) with `Review merges →` action.
- A second `Duplicate contacts detected` warm banner repeats the same message with the
  same CTA (`/qrm/duplicates`).
- Search rail (single column with `/` keyboard hint).
- 25 dense list rows: status dot · contact name · reach (email/phone) · role · age · health
  placeholder (`—`) · disclosure chevron.
- Footer pager identical pattern.

### What is changing in parallel

A separate agent is wiring routes/data/router. Per the Oracle plan, that includes:

- `/qrm/contacts` and `/qrm/companies` rendering dedicated pages directly (no
  GraphExplorer swap).
- Adding `GET /qrm/contacts` and `GET /qrm/companies` router endpoints; delegating
  `qrm-api.ts` list functions through the router.
- Hydrating `primaryCompanyName`, `cell`, `directPhone`, `smsOptIn` for contacts.
- Role-aware duplicate signaling (only elevated roles see the duplicate banner /
  `Duplicates` metric).
- Moving company duplicate scan/merge/undo behind router endpoints.

This audit assumes those backend/data deliveries land. **All recommendations below
target the UI uplift slice** (Oracle work item #3) — they presume the page is the
canonical owner of `/qrm/companies` and `/qrm/contacts` and that richer fields land
shortly.

### What this report does **not** touch

- Routing wiring (App.tsx)
- Router HTTP contracts (`qrm-router-api.ts`, `crm-router/index.ts`)
- Database RPCs / migrations
- Auth/role logic (only how roles influence visibility)

---

## 2. Visual Verdict — Baseline JSON

```json
{
  "$visual-verdict": {
    "version": "1.0.0",
    "subject": "QRM Companies & Contacts (qualityequipmentparts.netlify.app, 2026-05-07)",
    "target_threshold": 90,
    "scores": {
      "visual_hierarchy": 88,
      "density_and_scan": 86,
      "typography": 92,
      "spacing_and_rhythm": 88,
      "color_and_signal": 85,
      "motion_and_interaction": 70,
      "empty_loading_error_states": 74,
      "accessibility": 78,
      "demo_credibility": 64,
      "moonshot_alignment": 72,
      "consistency_between_pages": 81
    },
    "weights": {
      "visual_hierarchy": 0.10,
      "density_and_scan": 0.10,
      "typography": 0.05,
      "spacing_and_rhythm": 0.05,
      "color_and_signal": 0.05,
      "motion_and_interaction": 0.10,
      "empty_loading_error_states": 0.10,
      "accessibility": 0.10,
      "demo_credibility": 0.15,
      "moonshot_alignment": 0.15,
      "consistency_between_pages": 0.05
    },
    "weighted_score": 79.65,
    "verdict": "BELOW_BAR",
    "verdict_reason": "Strong typographic system and command-deck bones, but credibility and moonshot evidence are thin: zero-valued metrics dominate the rail, the IronBar narrative is templated rather than reasoned, and Contacts shows the duplicate banner twice. Closing the 10-point gap requires (1) credible metric-fallbacks when health/duplicate data is empty, (2) one true AI 'next move' surface per page rather than a static headline, (3) consolidated duplicate signaling, (4) richer row content (company name on contacts, territory/terms on companies), (5) keyboard-first interaction model, (6) skeleton/empty/error states that look authored not stock.",
    "differences": [
      {
        "id": "metrics-zero-state",
        "severity": "high",
        "where": "MetricStrip on both pages",
        "evidence": "Companies shows Hot 0 / Cool 0 / Tracked 0; Contacts shows Hot 0 / Cool 0 / New 7d 0. Three of five cells read zero on a sales operator deck.",
        "expected": "Cells either (a) render a useful proxy when underlying signal is absent (e.g. 'Tracked' becomes 'Coverage 0/25' with a one-click 'Backfill' affordance, 'New 7d' shifts to 'Newest 32d' if zero this week), or (b) collapse with a muted explanatory glyph ('— sync pending')."
      },
      {
        "id": "ironbar-static-narrative",
        "severity": "high",
        "where": "IronBar on both pages",
        "evidence": "Headline is a deterministic template ('25 accounts across 7 states. No breach signal today.') without source attribution, no drill-in, no recommended next move.",
        "expected": "IronBar should expose at least one (a) signal source pill ('Pulse · Pricing · Service'), (b) a confidence/freshness affix, (c) a bound 'next move' action that maps to a real route or mutation, and optionally (d) a sparkline / trend microviz in the headline tail."
      },
      {
        "id": "duplicate-banner-double",
        "severity": "high",
        "where": "Contacts page",
        "evidence": "Same duplicate-count claim appears in IronBar AND in a warm DeckSurface banner directly below it. Two CTAs both go to /qrm/duplicates.",
        "expected": "Single source of duplicate signal — IronBar headline OR banner, never both. Prefer IronBar with action; reserve banner only when role is elevated AND IronBar is being used for an unrelated proactive narrative."
      },
      {
        "id": "row-information-density",
        "severity": "medium",
        "where": "List rows on both pages",
        "evidence": "Companies row shows account name + Search1/2 + IntelliDealer + city/state — but no territory, terms, do-not-contact, or rep ownership. Contact row lacks primary company name (clearly available downstream) and reach is collapsed into a single channel.",
        "expected": "Rows expose the operator's real first-glance need: Companies → assigned-rep, territory/terms, last-touch age, opportunity count; Contacts → primary company, role, age, last-touch and an SMS-opt-in chip when present."
      },
      {
        "id": "extended-search-affordance",
        "severity": "medium",
        "where": "Companies search rail",
        "evidence": "'Extended IntelliDealer search off' is a wide outline button that shouts at the same visual weight as the search input, then reveals an explanatory paragraph below.",
        "expected": "Inline switch (segmented or toggle pill) docked inside the search field's right edge with a small info tooltip; helper copy folds into a one-line caption below the rail."
      },
      {
        "id": "consistency-between-pages",
        "severity": "medium",
        "where": "Search rail layout",
        "evidence": "Contacts search has a `/` keyboard hint chip; Companies search does not. Companies rail uses a 1fr/auto grid, Contacts rail is a single relative column.",
        "expected": "Identical search anatomy on both pages: same `/` hint, same height, same focus ring, same right-side filter slot, same caption structure."
      },
      {
        "id": "skeleton-and-empty",
        "severity": "medium",
        "where": "Loading / no-results states",
        "evidence": "Skeleton is 8 grey bars. Empty state is centered text 'No results / No companies found. Try a different search term.'",
        "expected": "Skeleton should match the real row geometry (status dot · glyph · two-line label · meta · chip · chevron) so the page does not visually re-flow when data lands. Empty state should suggest the next operator move (e.g. 'Add company', 'Search IntelliDealer legacy fields', 'Reset filters'), not just acknowledge emptiness."
      },
      {
        "id": "motion-and-microinteraction",
        "severity": "medium",
        "where": "Whole page",
        "evidence": "Only hover translate on the chevron and a `deck-pulse` on hot status dots. No row reveal cascade, no IronBar entry, no metric-cell tally animation, no focus ring spring.",
        "expected": "Use a 12-frame, ~280ms staggered fade-in for first-paint rows; a 1-frame metric tally when numbers cross zero; a soft pulse on the IronBar Sparkles glyph when narrative refreshes; respect prefers-reduced-motion."
      },
      {
        "id": "accessibility-semantics",
        "severity": "medium",
        "where": "List + column legend",
        "evidence": "Column legend is a div grid, not <thead>. Rows are <Link> elements grid-laid out, so screen readers announce one long anchor with no role/column context.",
        "expected": "Either keep the link semantics and add aria-describedby per row carrying the stitched announcement (e.g. 'Acme Equipment, Phoenix AZ, health 82'), or migrate to a real <table role='grid'> with row/column headers and arrow-key navigation."
      },
      {
        "id": "moonshot-evidence",
        "severity": "high",
        "where": "Both pages, especially IronBar and metric rail",
        "evidence": "Nothing on either page demonstrates a transformational, superintelligence-only capability — no 'next best account', no churn-risk-driven sort, no cross-channel intent-fusion chip on contacts, no auto-territory rebalance suggestion. The pages read as a polished CRM list, not a moonshot operator deck.",
        "expected": "Each page must surface ONE explicit moonshot beat that is impossible without QEP's data fusion: e.g. (a) on Companies, an 'Iron sort' that re-ranks by predicted parts-revenue-at-risk in the next 30 days; (b) on Contacts, a 'reach intelligence' chip that shows the predicted best channel right now (call vs SMS vs email) with confidence."
      }
    ],
    "suggestions": [
      "Replace the IronBar text-only headline with the IronBriefing v2 component: 1 narrative line + 1 evidence pill + 1 bound action + freshness affix. Accept ironBriefing.evidence and ironBriefing.confidence on QrmPageHeader.",
      "Introduce a MoonshotBeat slot on each page (between IronBar and the search rail): a single-line, AI-styled card with a glowing qep-live underline, headline, predicted action, and 'why this' drawer trigger.",
      "Add a HealthCoveragePill to the metric rail when scored < 100% (e.g. '7 of 25 tracked · backfill →').",
      "Collapse the Contacts duplicate banner when IronBar already carries the duplicate narrative; keep the banner only for surfaced exceptions IronBar is not currently telling.",
      "Move the Companies extended-search toggle into the search input's right slot as a labelled pill with an info tooltip; collapse the explanatory paragraph into a one-line caption beneath.",
      "Author a real skeleton row component (RowSkeleton) that reproduces the Status/Glyph/Title/Meta/Chip/Chevron geometry; use it on both pages.",
      "Author a real EmptyState component with a primary CTA plus a 'try ___' secondary; route the primary to the editor sheet on Companies and Contacts.",
      "Add /-key focus binding to both searches; mirror the Contacts visual hint chip on Companies.",
      "Add an 'Iron sort' segmented control next to the search rail with options Default / Hottest / Highest Risk / Newest Touch / Largest Pipeline (Companies) and Default / Hottest / Best-Channel-Now / Newest (Contacts). Default to 'Default' until user changes.",
      "Add an aria-described announcement per row (status + name + locality/role + health) so the screen-reader experience doesn't dump the entire 12-cell grid as a single anchor.",
      "Animate the metric strip with a 280ms stagger on first paint and a 600ms tally when a value changes; gate behind prefers-reduced-motion.",
      "Add focus-visible rings (qep-orange/40 ring 2px) to every clickable surface — search, toggle, row link, chevron, health chip, IronBar action.",
      "On Contacts rows, render the new primaryCompanyName as a sub-line; on Companies rows, render assigned-rep / territory when available; both lazy-fall to a soft '—' that does not eat vertical space."
    ],
    "reasoning": "The pages already nail typographic discipline, monospace meta vocabulary, hairline borders, qep-orange-as-action, and the command-deck primitive system. The deficit is not aesthetic — it is the gap between 'polished CRM' and 'moonshot operator deck'. Closing it means (a) credibility under empty data (zero-valued KPIs broadcast that the demo is a shell), (b) explicit AI evidence (IronBar must do work, not narrate), (c) a single moonshot beat per page that proves the data fusion is real, (d) interaction model parity (keyboard + motion + a11y), and (e) deduplicated signal channels. Estimated lift: +10.5 points to a weighted ~90.2."
  }
}
```

> **How to use this verdict.** The UI agent should reproduce this JSON in their own
> change PR and re-score after each commit. A score below 90 means the slice does not
> ship. Suggested measurement: one human auditor (you) + one Oracle review pass over a
> live build screenshot.

---

## 3. Measurement Rubric (per dimension)

Each dimension scores out of 100. The rubric is descriptive, not subjective — every
band has a concrete observable.

### 3.1 Visual hierarchy (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | Eye lands on title → IronBar → metric → search → list within 1.5s; AI signal is visually distinct; secondary chrome (sub-nav, badges) is quiet. |
| 85–94 | Hierarchy correct but one element competes (e.g. duplicate banner louder than IronBar). |
| 70–84 | Two elements compete or AI signal indistinguishable from chrome. |
| <70 | Eye has no obvious entry point. |

**Today: 88** — Title block reads first, but the duplicate banner on Contacts visually
echoes the IronBar.

### 3.2 Density & scan (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | ≥25 rows visible on a 1080p frame, every row carries 4+ scannable signals, no truncation pain. |
| 85–94 | Density correct, but a row signal is missing (e.g. company name on contact rows). |
| 70–84 | Either too sparse (rows >56px) or too dense (eye cannot resolve columns). |

**Today: 86** — 14×N row height is right; missing signals (primary company on Contacts,
territory/terms on Companies) drop the score.

### 3.3 Typography (weight 5%)

Mono for meta/counts/labels; sans for content; weight contrast disciplined.
**Today: 92** — strong; only nit is the title 26/600 vs metric 24/600 contrast is
narrow.

### 3.4 Spacing & rhythm (weight 5%)

8/4-px grid honored, page max-width 1680, gap-5 between sections.
**Today: 88** — good; the `-mt-3` hack on the extended-search caption breaks rhythm.

### 3.5 Color & signal (weight 5%)

qep-orange = action; qep-live = AI/realtime; qep-hot/warm/cool are status only.
**Today: 85** — qep-orange leaks into a pure-decorative chevron; warm tone overused on
the duplicate banner.

### 3.6 Motion & interaction (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | First-paint stagger, IronBar entry, metric tally, focus rings spring, prefers-reduced-motion respected, every clickable surface has a hover, focus, active state. |
| 85–94 | Most of the above; 1–2 surfaces are static. |
| 70–84 | Only hover micro-interactions, no entry motion. |

**Today: 70** — chevron translate + status pulse only.

### 3.7 Empty / loading / error states (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | Skeleton mirrors row geometry; empty has primary CTA + reset; error gives retry + diag. |
| 85–94 | Two of three solid. |
| 70–84 | Generic copy, no CTAs. |

**Today: 74** — skeleton is generic bars, empty is text-only, error is text-only.

### 3.8 Accessibility (weight 10%)

| Score | Observable |
|---|---|
| 95–100 | Real semantic table or aria-described row; keyboard navigates rows; focus rings everywhere; AA contrast everywhere; all icons hidden from AT. |
| 85–94 | Mostly there; one non-semantic surface. |
| 70–84 | Multiple semantic gaps (link-as-grid-row, no row keyboard nav). |

**Today: 78** — aria labels on skeletons and duplicate banner, but rows are anchors
laid out on a 12-col grid; no row-level keyboard navigation.

### 3.9 Customer demo credibility (weight 15%)

This is the moonshot-specific dimension. **Zero-valued metrics on a sales deck are an
existential credibility problem** — the page must look right under empty data, partial
data, error data.

| Score | Observable |
|---|---|
| 95–100 | All five metric cells carry useful information across empty / partial / full data; IronBar narrative changes accordingly; no cell ever displays a flat 0. |
| 85–94 | One cell may show 0 if it is a true status (e.g. duplicates). |
| 70–84 | Two cells show 0; IronBar is templated. |
| <70 | Three or more zero-valued cells; IronBar reads as boilerplate. |

**Today: 64** — Companies has Hot/Cool/Tracked all 0; Contacts has Hot/Cool/New 7d
all 0. The page reads as a stock CRM list.

### 3.10 Moonshot / superintelligence alignment (weight 15%)

Borrowed from CLAUDE.md mission lock. Must be **observable in the UI**, not asserted.

| Score | Observable |
|---|---|
| 95–100 | Page surfaces ≥1 capability that is impossible without QEP's data fusion (predicted parts-revenue-at-risk, predicted best reach channel, auto-suggested rep handoff). The user can see WHY (evidence pill or drawer) and ACT on it (1-click). |
| 85–94 | Capability is present but one of why/act is missing. |
| 70–84 | AI scaffolding is visible (IronBar, qep-live tones) but produces only narrative. |
| <70 | Page is indistinguishable from a stock CRM list. |

**Today: 72** — IronBar exists, but its narrative is templated; nothing is uniquely
QEP.

### 3.11 Consistency between pages (weight 5%)

Both pages should feel like instances of the same component family, not siblings.
**Today: 81** — search rail differs, extended-search toggle is page-local, duplicate
banner is contact-only.

---

## 4. Implementation Guidance for the UI Agent

> **Read first:** Oracle plan §3.C and §3.D. The recommendations below sit ON TOP of
> that plan — they are the visual/interaction layer, not the data-flow layer.

### 4.1 Components to touch (UI-only)

| File | Change kind | What |
|---|---|---|
| `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx` | edit | Header metrics with health-coverage cell, MoonshotBeat slot, search rail uplift, row enrichment, skeleton/empty/error replacement, motion gating. |
| `apps/web/src/features/qrm/pages/QrmContactsPage.tsx` | edit | Same family of changes; collapse duplicate banner into IronBar; render `primaryCompanyName` once available; SMS chip when `smsOptIn`. |
| `apps/web/src/features/qrm/components/QrmPageHeader.tsx` | edit | Extend `ironBriefing` prop with `evidence?`, `confidence?`, `freshness?`. Render a small evidence pill before the headline; keep API additive. |
| `apps/web/src/features/qrm/components/command-deck.tsx` | edit (additive) | Add `MoonshotBeat`, `RowSkeleton`, `EmptyState`, `RetryState`, `KbdHint` primitives. Do NOT modify existing exports. |
| `apps/web/src/features/qrm/components/QrmSubNav.tsx` | none | Already correct. |
| `apps/web/src/features/qrm/shell/QrmShellV2.tsx` | none | Out of scope for this slice. |
| Tailwind theme tokens | none | All `qep-*` tokens already defined. |

### 4.2 Components / files NOT to touch

- `apps/web/src/App.tsx` — the parallel agent owns route wiring.
- `apps/web/src/features/qrm/lib/qrm-api.ts` — parallel agent.
- `apps/web/src/features/qrm/lib/qrm-router-api.ts` — parallel agent.
- `apps/web/src/features/qrm/lib/types.ts` — parallel agent will add `primaryCompanyName`. Use it once it lands; do not introduce conflicting fields.
- `supabase/functions/**` — out of scope.
- Any DB migration / RPC — out of scope.
- Editor sheets (`QrmCompanyEditorSheet.tsx`, `QrmContactEditorSheet.tsx`) — owned by the parallel agent's hardening pass; the UI uplift slice should only touch their `onSaved` invocations indirectly via page-level navigation.

### 4.3 Concrete change list (in commit order)

1. **`command-deck.tsx`: add primitives (additive).**
   - `MoonshotBeat({ headline, evidence, action, why })` — one-line card with a 1px
     `qep-live` glow underline, sparkline-friendly tail. Default off; opt-in per page.
   - `RowSkeleton({ density })` — match the actual row geometry (status dot · glyph ·
     two-line label · meta · chip · chevron). Use for both Companies and Contacts.
   - `EmptyState({ headline, body, primary, secondary })` — slot for primary action
     button + a quiet secondary link.
   - `RetryState({ message, onRetry })` — error state with a real retry button.
   - `KbdHint({ children })` — `/`-style chip; reuse on both pages.
2. **`QrmPageHeader.tsx`: extend `ironBriefing`.**
   - Add optional `evidence: string`, `confidence: number (0–1)`, `freshness: ISO`.
   - Render evidence as a `SignalChip tone="live"` before the headline; render
     freshness as a faint mono affix at the right edge before the actions slot.
3. **`QrmCompaniesPage.tsx`: header metrics rebuild.**
   - Add `Coverage` cell: `${tracked}/${loaded}` with a `tone="warm"` and
     `delta: { value: 'Backfill', direction: 'flat' }` when `tracked < loaded`.
   - Replace `Tracked 0` with `Coverage` cell.
   - Drop `Hot 0` and `Cool 0` when both equal zero AND coverage is 0; otherwise keep.
   - When health data is fully missing, IronBar narrative shifts to: `Health intel
     pending sync · last refresh {age}` with action `Refresh now`.
4. **`QrmContactsPage.tsx`: collapse duplicate banner; enrich rows.**
   - Remove the warm `Duplicate contacts detected` `DeckSurface` block; keep the
     IronBar `Review merges →` action when `canReviewDuplicates && duplicateCount > 0`.
   - Add `primaryCompanyName` sub-line to the row title block (when present).
   - Add `SignalChip label="SMS"` when `smsOptIn === true`.
   - When `cell` is set and `email` is empty, prefer the call icon and the cell number
     in the reach column; otherwise use email.
5. **Both pages: search rail parity.**
   - Identical anatomy: `relative` wrapper, search icon left, input, `KbdHint` right,
     optional toggle docked into the right edge as a `SignalChip`-like switch.
   - On Companies, the Extended IntelliDealer toggle becomes a docked switch; the
     explanatory paragraph becomes a one-line muted caption beneath, removing the
     `-mt-3` hack.
   - Bind `/` to focus the search input on both pages (mount-time keydown listener
     scoped to the page).
6. **Both pages: row geometry + skeleton.**
   - Use `RowSkeleton` for the loading state.
   - Add `aria-describedby` to each `<Link>` row pointing at a hidden span that
     stitches the row's signal into one announcement: `"<name>, <locality or role>,
     health <score|unknown>, last touch <age>"`.
   - Add a focus-visible ring `ring-2 ring-qep-orange/40 ring-offset-2
     ring-offset-qep-deck-elevated` to the row.
7. **Both pages: empty / error.**
   - Empty state primary CTA → opens the editor sheet (`setEditorOpen(true)`);
     secondary → clears search / treeRoot.
   - Error state retry button → `companiesQuery.refetch()` /
     `contactsQuery.refetch()`. Show a tiny diagnostic line under the message:
     `${query.error?.name ?? 'Unknown'} · ${new Date().toLocaleTimeString()}`.
8. **Both pages: motion.**
   - First-paint stagger on rows: `style={{ animationDelay: \`${Math.min(i, 12) * 22}ms\` }}` with a `data-deck-fade` class.
   - Metric tally: when a value changes, animate from previous to next (200ms,
     `requestAnimationFrame` ramp, mono number).
   - Gate everything behind `@media (prefers-reduced-motion: reduce)`.
9. **Both pages: Iron sort segmented control.**
   - Tiny `SegmentedControl` (3–4 options) inline above the column legend.
   - Companies: `Default · Hottest · Largest pipeline · Newest touch`.
   - Contacts: `Default · Hottest · Best channel now · Newest`.
   - The non-default options are visible but disabled with a `qep-live` "soon" hint
     until the data layer lands them — this signals moonshot intent without faking it.
10. **Both pages: MoonshotBeat slot.**
    - Companies: `Predicted parts-revenue-at-risk for accounts in this view: $—.
      <Why this>`. Disabled until data lands.
    - Contacts: `Predicted best reach channel right now: 4× SMS · 12× call · 9× email.
      <Why this>`. Disabled until data lands.
    - The point is to **place the slot now** so the moonshot beat has a permanent
      visual home, not bolt it on later.

### 4.4 Code-quality guardrails

- All new strings must be ASCII; reuse existing typographic glyphs (`·`, `→`, `—`).
- No new colors. Reuse `qep-orange`, `qep-live`, `qep-hot`, `qep-warm`, `qep-cold`,
  `success`, and the `qep-deck-rule` / `qep-deck-elevated` neutrals.
- Keep `font-mono text-[10|10.5|11|13]px` exactly — do not introduce arbitrary sizes.
- Keep `tracking-[0.1em|0.12em|0.14em|0.18em]` only — those are the existing tokens.
- Animations use `motion-safe:` Tailwind variants.
- Run `bun run build` and `bun run build` from `apps/web` before commit.
- Do not add new dependencies. Everything required already exists.

### 4.5 Test surface (this slice)

- Add a `QrmCompaniesPage.test.tsx` and `QrmContactsPage.test.tsx` if not present.
- Render with React Testing Library + a mocked router/query. Assert:
  1. IronBar always renders with non-templated evidence pill when health data is
     present.
  2. Duplicate banner does NOT double-render on Contacts.
  3. Skeleton row count equals `8` and uses the same grid as a real row.
  4. Empty state renders the primary CTA and clicking it opens the editor sheet.
  5. Error state renders a retry button that re-invokes the query.
  6. `/` keypress focuses the search input on both pages.
  7. `prefers-reduced-motion: reduce` disables all entrance/tally animations.

---

## 5. Mission Alignment Verdict

Per CLAUDE.md, every segment must be vetted against the four mission checks.

| Mission check | Verdict | Evidence |
|---|---|---|
| **Mission Fit** | ✅ Strong | Companies/Contacts ARE the spine of equipment/parts sales+rental for reps, salesmen, corporate. Both pages are operator-facing, role-gated, and feed into account command, deal, parts, and service surfaces via `buildAccountCommandHref` and `/qrm/contacts/:id`. |
| **Transformation** | ⚠️ Partial today; **must** be earned by this slice | Today the pages are polished list views with an IronBar narrative ribbon — not visibly beyond commodity QRM. After this slice: `Coverage` cell + MoonshotBeat slot + Iron sort segmented + role-aware reach intelligence on Contacts move the pages into territory only QEP's fused data layer can address. The transformational beat lives in the MoonshotBeat slot — without it, mission check #2 fails for this slice. |
| **Pressure Test** | ⚠️ Half-met | Empty-data state today exposes credibility risk (Hot 0 / Cool 0 / Tracked 0). Recommendations §4.3.3 (`Coverage` fallback, IronBar `health intel pending sync`) and §4.3.7 (authored empty/error) are the explicit mitigations. The slice is not green until the page reads correctly under (a) zero rows, (b) zero health profiles, (c) router error, (d) elevated vs rep role, (e) treeRoot scoped, (f) extended-search on. |
| **Operator Utility** | ✅ Improves | `/`-key focus, primary-company sub-line, SMS opt-in chip, IntelliDealer legacy badge, role-aware duplicate signal, retry on error, and an Iron sort skeleton each materially shorten the path from "open the page" to "act on the right account/contact." |

**Overall mission-alignment verdict: PROCEED — conditional on the MoonshotBeat slot
landing in this slice.** Without it, the page is still a polished CRM and fails check
#2. With it (even disabled-with-evidence), the page declares its moonshot direction,
and the data layer can fill the slot in a follow-up slice without re-doing the visual
contract.

---

## 6. Quick-reference checklist for the UI agent

- [ ] Add `MoonshotBeat`, `RowSkeleton`, `EmptyState`, `RetryState`, `KbdHint` to
      `command-deck.tsx`.
- [ ] Extend `QrmPageHeader.ironBriefing` with `evidence`, `confidence`, `freshness`.
- [ ] Companies metric rail: `Loaded · States · Coverage · Hot · Cool` (drop bare
      `Tracked 0`; introduce `Coverage`).
- [ ] Contacts metric rail: `Loaded · Reachable · Hot · Cool · Duplicates` (Duplicates
      visible only when `canReviewDuplicates`).
- [ ] Remove the warm `Duplicate contacts detected` banner; keep IronBar action.
- [ ] Search rail parity: identical input, identical `KbdHint`, identical right-side
      slot, identical caption pattern.
- [ ] Companies: dock the Extended IntelliDealer toggle inside the search rail's right
      slot.
- [ ] Add `/` keybinding to focus search on both pages.
- [ ] Render `primaryCompanyName` and `SMS` chip on Contacts rows when present.
- [ ] Replace generic skeleton with `RowSkeleton`.
- [ ] Replace empty / error states with `EmptyState` / `RetryState`.
- [ ] Add row `aria-describedby` stitched announcement.
- [ ] Add motion-safe entrance stagger and metric tally; respect
      `prefers-reduced-motion`.
- [ ] Add the Iron sort segmented control with disabled-with-evidence non-default
      options.
- [ ] Place the MoonshotBeat slot beneath the IronBar and above the search rail —
      disabled-with-evidence until data lands.
- [ ] Re-score the visual verdict; weighted ≥90 to ship.

---

## 7. Risks, ambiguities, follow-ups

1. **Disabled-with-evidence vs hidden slots.** Showing a disabled MoonshotBeat asserts
   capability we have not yet shipped. Acceptable because (a) it is visually
   honest (`pending` state, `qep-live` muted), (b) it commits a permanent visual home
   so future slices don't disturb the layout. If product wants stricter honesty, hide
   until data lands.
2. **Iron sort options leaking ahead of data.** Same trade-off; recommend visible-but-
   disabled with a tiny "soon" hint until the data layer can score them.
3. **Aria-described row vs <table>.** A real grid-table is the technically correct
   move but a heavier refactor. The aria-described anchor approach is the cheaper, in-
   slice option; if accessibility audit returns a fail, escalate to a `role="grid"`
   refactor in a follow-up slice.
4. **Animation budget.** Stagger on first paint plus metric tally is small (<2KB JS).
   Re-confirm during implementation that none of the new motion layers conflict with
   existing `deck-pulse` keyframes.
5. **prefers-reduced-motion coverage.** Audit every new animation under that media
   query; the existing `deck-pulse` already complies.

---

## 8. Saved location

This report lives at:

```
docs/designs/qrm-companies-contacts-moonshot-audit-2026-05-07.md
```

Companion artifacts the UI agent should reference:

- Oracle plan: `prompt-exports/oracle-plan-2026-05-07-162333-qrm-moonshot-uplift-c98e.md`
- Existing primitives: `apps/web/src/features/qrm/components/command-deck.tsx`
- Existing pages: `apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx`,
  `apps/web/src/features/qrm/pages/QrmContactsPage.tsx`
- Existing header: `apps/web/src/features/qrm/components/QrmPageHeader.tsx`
- Shell V2: `apps/web/src/features/qrm/shell/QrmShellV2.tsx`,
  `apps/web/src/features/qrm/components/QrmSubNav.tsx`

— end of audit —
