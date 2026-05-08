# QRM Opportunity Map Roadmap

**Date:** 2026-05-08
**Surface:** `/qrm/opportunity-map`
**Source review:** `docs/reviews/qrm-opportunity-map-ux-review-2026-05-08.md`
**Plan reviewed:** `context_builder` plan + Oracle review on 2026-05-08

## Product goal

Rebuild Opportunity Map from a sparse map shell into a QRM geographic command surface: a rep, manager, or owner should know where the highest-value opportunities are, why they matter now, and what action to take next.

## Non-negotiables

- No fabricated opportunities or fake records.
- Preserve existing Supabase contracts for P0/P1.
- No new dependencies.
- Keep `/qrm/opportunity-map` and typo/plural aliases intact.
- Every major slice must be verified, committed, and pushed.
- Empty states must diagnose sparse data honestly.

---

## Phase 0 — Command-surface repair, build now

### Slice 0.1 — Board reasoning lock

**Status:** `[x]`
**Files:**
- `apps/web/src/features/qrm/lib/opportunity-map.ts`
- `apps/web/src/features/qrm/lib/opportunity-map.test.ts`

**Goal:** Make the board model capable of powering a command surface without changing data fetches.

**Build:**
- Add additive row fields: `score`, `urgency`, `reasons`, `routeCandidate`, `openDealCount`.
- Add additive summary fields: `criticalAccounts`, `routeCandidates`.
- Preserve existing fields and revenue-splitting behavior.
- Keep rental rows separate and deterministic.

**Done when:**
- Existing tests still pass.
- New tests cover reason strings, urgency tiers, route candidate counts, rentals, and open deal counts.

### Slice 0.2 — Command-deck parity

**Status:** `[x]`
**Files:**
- `apps/web/src/features/qrm/pages/OpportunityMapPage.tsx`
- `apps/web/src/features/qrm/pages/__tests__/qrm-route-contracts.test.ts`

**Goal:** Make the page visually and structurally match QRM command-deck standards.

**Build:**
- Render `QrmPageHeader`.
- Render `QrmSubNav`.
- Move metrics into `QrmPageHeader.metrics`.
- Add Iron briefing headline with honest loading/error/empty/signal copy.
- Use right rail for Refresh and Command Center/Exit action.
- Remove lower metric cards.
- Preserve current marker click navigation for this slice.

**Done when:**
- Route contract test proves page renders `QrmPageHeader` and `QrmSubNav`.
- Existing `/qrm/opportunity-map` route/nav assertions still pass.
- No Companies redirect/link regression returns.

### Slice 0.3 — Diagnostic empty/error/filter states

**Status:** `[x]`
**Files:**
- `apps/web/src/features/qrm/pages/OpportunityMapPage.tsx`

**Goal:** The page must never look broken when data is sparse.

**Build:**
- Track scanned diagnostics from fetched rows:
  - equipment rows scanned,
  - equipment with coordinates,
  - equipment missing coordinates,
  - open deal rows scanned,
  - visit list rows scanned,
  - trade signal rows scanned.
- Add clear loading, query-error, true-empty, and filtered-empty states.
- Sidebar empty state should explain the reason and next action.
- Map empty state should explain coordinate/signal prerequisites.

**Done when:**
- Zero-data screenshot reads as an explainable data readiness state, not a blank product.
- No fake/demo records are used.

---

## Phase 1 — Field-sales utility, next build

### Slice 1.1 — Priority sidebar and marker preview

**Status:** `[x]`

**Build:**
- Change marker click from immediate navigate to selected-row preview.
- Add preview card with reasons, urgency, open revenue, and actions.
- Keep explicit `Open account` action.

### Slice 1.2 — Filters and route planning

**Status:** `[x]`

**Build:**
- Add min revenue and signal-type filters.
- Add pure `buildOpportunityRoute()` helper using top route candidates and nearest-neighbor ordering.
- Add Google Maps deep-link from ordered stops.

### Slice 1.3 — Marker sizing/weight

**Status:** `[x]`

**Build:**
- Extend `MapMarker` with optional `radius` and `weight`.
- Use revenue-aware marker sizing.
- Add cluster weight metadata without changing existing consumers.

### Slice 1.4 — Mobile field ergonomics

**Status:** `[x]`

**Build:**
- Add opt-in bottom-sheet mode to `MapWithSidebar`.
- Increase collapse target size.
- Preserve default primitive behavior for other pages.

---

## Phase 2 — Scalable geospatial / manager mode, later

**Status:** `[ ]`

**Build:**
- Add viewport-aware RPC behind fallback.
- Add heatmap layer.
- Add territory polygons.
- Add whitespace overlays.
- Add rep/team filters and manager coverage mode.

---

## Phase 3 — Iron-native moonshot, later

**Status:** `[ ]`

**Build:**
- Voice route planner: “Iron, plan my Tuesday around Lincoln.”
- Predictive next-best-location.
- Territory pressure test.
- Cluster reasoning.
- Push/send route to rep.

---

## Current execution decision

Phase 0 is committed and pushed. Phase 1 is now built as the second end-to-end pass: marker preview, field filters, route planning, revenue-aware marker metadata, and opt-in mobile bottom-sheet behavior. Phase 2/P3 remain deferred until the map has enough real coordinates and the team approves a viewport/RPC contract.

## Verification checklist for Phase 1

- [x] `bun test apps/web/src/features/qrm/lib/opportunity-map.test.ts`
- [x] `bun test apps/web/src/features/qrm/pages/__tests__/qrm-route-contracts.test.ts`
- [x] `bun run --filter @qep/web typecheck`
- [x] `bun run build:web`
- [ ] Authenticated visual QA pass (blocked in local headless preview by login redirect; requires real session fixture)
- [x] Commit and push Phase 1 build
