# QRM Opportunity Map — UX & Product Review

**Date:** 2026-05-08
**Reviewer:** JARVIS (Claude Opus, Personal AI Butler)
**Scope:** `apps/web/src/features/qrm/pages/OpportunityMapPage.tsx` and its primitives
**Reference screenshot:** sparse "Opportunity Map" page with `0 mapped signals` sidebar, mostly-empty dark map, floating Layers card, no command-deck header, no QRM sub-nav.

---

## 1. Context & Scope

The Opportunity Map at `/qrm/opportunity-map` is one of QRM's flagship "command surfaces" — it is supposed to be the geographic command deck that a rep, sales manager, or COO opens to answer:

- *"Where should I be today, and why?"*
- *"Where is my pipeline geographically concentrated, and where is the white space?"*
- *"Which accounts should I drive past on my way to my next visit?"*

It is also one of two map pages (`/qrm/opportunity-map` and `/qrm/seasonal-opportunity-map`) and is the **canonical route** that other surfaces (Seasonal, Unmapped Territory, TopBar contextual nav) link back to as the source-of-truth visit deck.

The page is wired to:

- `crm_equipment` (lat/lng in `metadata`, ownership filtered to `customer_owned` + `rental_fleet`)
- `crm_deals` (open/uncloseed deals → distributed across mapped sites)
- `predictive_visit_lists.recommendations` (today's predictive visit targets)
- `customer_fleet` (trade-in interest signals)

Aggregation lives in `apps/web/src/features/qrm/lib/opportunity-map.ts → buildOpportunityMapBoard()` and produces a `summary` plus `rows` of marker rows used by the page.

This review evaluates the page strictly against:
1. The QEP CLAUDE.md **Mission Lock** (transformational AI for equipment & parts sales/rental).
2. The QRM command-deck rhythm already established by sibling pages (Seasonal, Threat, Rescue, Graph Explorer).
3. World-class field-sales mapping software (Salesforce Maps, Outfield, Badger Maps, Mapbox Studio for Sales).

---

## 2. Intended Purpose vs. Current Reality

### What the page is supposed to be

A **routeable, signal-aware command deck** that fuses pipeline value, visit timing, rental fleet status, and trade-in intent onto a geographic canvas, then translates that into "what should I do *today*."

### What the screenshot actually shows

| Surface element | Expected | Actual |
|---|---|---|
| **Iron briefing ribbon** | AI narrative framing the page, 1–2 actions | **Missing** |
| **Section crumb** (`GRAPH / MAP / N`) | Monospaced surface/lens crumb | **Missing** — replaced with a plain `<h1>` |
| **Metric strip** (Mapped / Open Revenue / Visits / Rentals / Trades) | 5-cell rail beneath title | Stuffed into 4 `DeckSurface` cards **below** the map (wrong vertical order) |
| **QrmSubNav** | Cross-surface navigation row (Seasonal, Threat, Rescue, etc.) | **Missing** |
| **Data source badge** | Live / Stale / Demo / Manual indicator | **Missing** |
| **Map** | Heatmap + clustered markers + territory polygons | Empty dark canvas; only "No mapped opportunity signals yet" hint |
| **Sidebar** | "Today's route" — prioritized stops with reasoning | "0 mapped signals" with no cards |
| **Right-rail actions** | Build route, send to rep, refresh, filter time horizon | A single **Exit** button |

### Root cause

`OpportunityMapPage.tsx` imports `QrmPageHeader`, `QrmSubNav`, and `DeckSurface` but **never renders the first two**. The page builds its own ad-hoc header (`<h1>` + Exit button) and skips the entire command-deck rhythm. Its sibling `SeasonalOpportunityMapPage.tsx` renders both correctly — the divergence is unintentional and is the single biggest visible regression.

The map being empty is a **separate, real data problem**: the demo workspace has no equipment rows with `metadata.lat` / `metadata.lng`, no `predictive_visit_lists` row for today, and likely no `customer_fleet.trade_in_interest = true` rows. The current empty state hides this entirely; the user sees a black canvas and assumes the feature is broken.

---

## 3. Why the Current UI Fails (Findings)

### 3.1 Command-deck rhythm broken

- No `QrmPageHeader` → no crumb, no metric strip in header, no Iron briefing, no data-source badge.
- No `QrmSubNav` → user is stranded; the only way out is the "Exit" button.
- Metric cards are rendered *below* the map, inverting standard scan order (eyes start top-left, hit a 60% blank map, never reach the metrics).

### 3.2 The map is unhelpful when empty

- Dark canvas with a tiny icon + "No mapped opportunity signals yet" string offers **no diagnostic** (is the data missing? am I filtered out? is the table empty?) and **no remedy** (geocode now, switch workspace, view sample data).
- No fallback rendering: even with zero markers, the canvas could show territory polygons, a heatmap of historical pipeline density, or sample-region overlays so the page doesn't read as "broken."
- No loading skeleton — `boardQuery.isLoading` toggles only the empty-state copy slightly.

### 3.3 The map is unhelpful when full

- **Marker tone logic is shallow** (`OpportunityMapPage.tsx:130`):
  ```ts
  tone: row.kind === "rental" ? "violet"
      : row.tradeSignalCount > 0 ? "orange"
      : row.visitTargetCount > 0 ? "green"
      : "blue"
  ```
  - Ignores **$ value** entirely — a $1k mapped account looks identical to a $1M one.
  - Ignores **freshness / decay** — accounts that haven't been touched in 180 days look identical to today's hot ones.
  - Ignores **urgency tier** — there is no "Critical / Hot / Warm / Cold" gradient.
- **All markers are the same size.** A $1M open-revenue account should be visibly larger than a $5k one.
- **Cluster legend is misleading**: clusters use `point_count` only — a 50-marker cluster of $1k deals colors identically to a 50-marker cluster of $1M deals (`MapLibreCanvas.tsx:151–161`).
- **No popups** — clicking a marker navigates straight to the account command page. There is no inline preview ("3 open deals, $620k weighted, last touch 47 days ago"), no quick-action menu ("Add to route / Log visit / Mark rejected").
- **No heatmap layer** at zoomed-out CONUS view — the user can't see pipeline density at a glance.
- **No territory or whitespace overlays** — counties with zero presence are invisible.
- **Layers panel is anemic** — only 4 toggles (open revenue, visit targets, rentals, trades). No time horizon, no rep filter, no min $ slider, no signal-age filter.

### 3.4 The sidebar is a dump, not a route

- Sidebar header reads `0 mapped signals` (centered, lonely text). When populated, rows are flat `<Card>`s with `Open revenue $X · Visit targets N · Trade signals N`.
- No **priority chip** ("HOT / VISIT TODAY"), no **why-now reason string** (Seasonal does this with `row.reasons.join(" · ")`), no **drive-time** estimate, no **last-touch** age, no **rep ownership**.
- No **route ordering** — rows are sorted by `openRevenue` desc, which is fine as a list but fails as a route plan; a rep needs them grouped by drive proximity.
- No **multi-select to "Build today's route"** action.
- No **per-row quick-actions** beyond `Open` (no "Skip", "Snooze", "Hand to rep", "Mark visited", "Send SMS").

### 3.5 No action layer

- The only outbound CTA in the entire view is `Exit`. There is no:
  - "Build today's route" → optimized 8-stop loop, push to Apple/Google Maps.
  - "Send to rep" → deep-link SMS or push to a rep's mobile app.
  - "Find me 5 unvisited accounts in this region" (rectangle/polygon select on map).
  - Voice: "Iron, plan my Tuesday around Lincoln."

### 3.6 Performance ceiling

- Client-side fetches: `1000` equipment, `1000` deals, `1000` trade signals, `50` visit lists. At Phase-3 stress-test scale (271k assets) this collapses immediately.
- No server-side aggregation, no viewport-bounded RPC, no zoom-aware bin density. The 271k-asset target referenced in `MapLibreCanvas.tsx` comments is currently unreachable through this surface.

### 3.7 Not transformational (mission-lock failure)

Per CLAUDE.md mission lock, every surface must be **materially beyond commodity QRM**. Today's Opportunity Map is, charitably, a Mapbox dot-plot of CRM data — something HubSpot, Salesforce Maps, and Badger Maps already ship. There is **no AI reasoning, no prediction, no pressure-test, no operator-utility lift**:

- No "why this account, why now" explanation per marker.
- No predictive next-best-location ("Where should I be tomorrow?").
- No territory pressure-test for managers ("23 accounts ignored 90+ days").
- No competitive overlay ("competitor density, displacement opportunities").
- No voice-driven planning.
- No cluster reasoning ("these 14 accounts share supplier ABC").

This is the largest single gap. The page passes mission-fit on intent, fails on transformation.

### 3.8 Mobile-first gap

- Layout uses fixed `h-[calc(100vh-12rem)]` (`MapWithSidebar.tsx:42`) and a `w-80` sidebar — usable on desktop, cramped on tablet, unusable in a truck cab.
- Sidebar collapse toggle is a tiny 12px chevron; not thumb-targetable.
- No bottom-sheet pattern for mobile (industry-standard for field-sales mapping).
- No "follow me" / live-position toggle.

---

## 4. Missing Capabilities (Gap Inventory)

Grouped by audience.

### For the rep (field salesperson)

- [ ] Today's optimized route (multi-stop, drive-time-aware)
- [ ] Marker popup with quick actions (Add to route / Log visit / Skip / Call now)
- [ ] Voice planning ("plan my Wednesday around Topeka")
- [ ] Drive-time isochrones from current position
- [ ] Bottom-sheet mobile layout
- [ ] Live position + nearest-opportunity routing
- [ ] One-tap deep-link to Apple/Google Maps with full route
- [ ] Offline cache of today's stops

### For the sales manager

- [ ] Rep coverage heatmap (overlap, gaps, density per rep)
- [ ] Whitespace overlay (counties / zips with zero touches in 90d)
- [ ] Territory polygon overlay with $ closed and $ open per zone
- [ ] "Pressure test my territory" — Iron critiques coverage and recommends reassignments
- [ ] Filter by rep / team / district
- [ ] Push assignments to reps directly from the map

### For corporate / COO / owner

- [ ] National pipeline heatmap (zoom-out density)
- [ ] Pipeline-by-region trend (vs. last 90d)
- [ ] Competitive density overlay (where Caterpillar / Toro / Bobcat dominate)
- [ ] Account-tier overlay (key accounts, strategic targets)
- [ ] Drill-down: click a region → ranked accounts + revenue
- [ ] Predictive: "next 6 months of demand" overlay from seasonal model

### For the operator (always-on)

- [ ] Iron briefing ribbon with cascading headline (mirrors Seasonal pattern)
- [ ] Reason-string per marker ("3 open deals, rental returning Fri, trade signal active")
- [ ] $-aware marker sizing + urgency-tier tone
- [ ] Cluster aggregation by $ value, not just count
- [ ] Layer panel with time horizon, rep, min $, signal type, signal age
- [ ] Diagnostic empty state (data missing → "Geocode now" CTA)
- [ ] QrmSubNav for cross-surface navigation
- [ ] DataSourceBadge

---

## 5. World-Class Target State

The Opportunity Map should be **the surface a rep opens before turning the key in their truck and the surface the COO opens during a Monday-morning forecast meeting.**

### 5.1 Above the map

```
┌──────────────────────────────────────────────────────────────────────┐
│ IRON: 7 high-value visit targets within a 38-mile loop today,        │
│       $4.2M weighted. Start with Ace Equipment — 3 open quotes,      │
│       rented loader returns Friday.   [Build route →] [Send to rep →]│
├──────────────────────────────────────────────────────────────────────┤
│ GRAPH / MAP / 412                                          [● Live]  │
│ Opportunity Map                                                      │
│ Geographic command deck for visit timing, $ pressure, and whitespace.│
├──────────────────────────────────────────────────────────────────────┤
│ Mapped 412   Open Rev $48.2M   Visits 23 (HOT)   Rentals 19   Trades 7│
├──────────────────────────────────────────────────────────────────────┤
│ Activities · Deals · … · Map · … · Seasonal · …  (QrmSubNav)         │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 The map itself

- **Default view:** CONUS heatmap of weighted pipeline density + clustered markers fading in as the user zooms.
- **Markers:**
  - Size = `log(open_revenue + 1)` capped at 24px.
  - Tone = urgency tier from a fused score (visit due × $ value × decay × signal count).
  - Stroke = freshness (solid = touched in 14d, dashed = stale > 90d).
- **Clusters:** show **aggregate $** (e.g., `$2.4M / 27`) not just count; color tier by $ density.
- **Popups:** on click, show a 220-px inline card — company, rep, last touch, top open deal, top reason, "Add to route", "Open command center", "Snooze 7d".
- **Overlays (toggleable):**
  - Pipeline heatmap
  - Territory polygons (rep coverage)
  - Whitespace counties (no presence in 90d)
  - Competitor density
  - Drive-time isochrones from rep home / current location
  - Active rentals returning this week
  - Trade-in ripe accounts
- **Lasso select:** rectangle/polygon select → "Plan a route through these 12 accounts" / "Hand all to Mara".

### 5.3 The sidebar is a route, not a list

- Header: `Today's route · 7 stops · 38 mi · ~3h 10m  [Optimize] [Send]`
- Each row:
  ```
  1.  Ace Equipment           $620k · 3 open · 47d
      ⚡ Rental returns Friday · Trade signal active
      ↳ Open · Add to route · Skip
  ```
- Drag to reorder, swipe to skip, multi-select to bulk-assign.
- Collapses to a bottom-sheet on mobile.

### 5.4 Filter bar

- Time horizon: Today / This week / 30 days
- Rep / team picker
- Min $ open revenue slider
- Signal types (visit due, trade ripe, rental returning, post-sale window, decay > 90d)
- Region (zip / county / state / district)
- Account tier

### 5.5 Manager / COO modes

A single right-rail toggle flips the page into:

- **Coverage mode:** rep heatmap, overlap, gaps. Iron headline: *"Bryce and Mara overlap on 23% of east-zone accounts; reassigning 14 accounts moves $1.8M into white-space coverage."*
- **Whitespace mode:** counties with zero touches in 90d, ranked by historical demand. Iron headline: *"6 counties with $4.1M historical install base have no rep activity in 90 days."*

### 5.6 Moonshot layer (Iron-native, the unlock)

- Voice planning: "Iron, plan my Tuesday around Lincoln" → builds a route, narrates the rationale.
- "Where should I be tomorrow?" — predictive next-best location based on rentals returning, decay risk, and quote velocity.
- "Pressure-test my territory" — Iron critiques coverage gaps, suggests handoffs.
- Hover-cluster reasoning — *"These 14 accounts share supplier ABC; one displacement campaign would move ~$2M."*
- Live, push-to-rep "your next stop" — a rep gets a buzz on their watch when a high-priority opportunity materializes near their current GPS location.
- Voice debrief on drive home — Iron asks 3 questions, updates CRM, schedules the next visit.

### 5.7 Performance

- Server-side viewport RPC: `qrm_opportunity_map_viewport(bbox, zoom, filters)` returns hex-binned aggregates at low zoom and per-marker rows at high zoom.
- Supercluster computed in-edge-function; client only paints.
- Caches 60s in `iron_web_search_cache`-style table keyed by `(workspace, bbox-rounded, zoom-tier, filter-hash)`.
- Phase-3 271k-asset target reachable.

### 5.8 Empty / sparse-data state

- Diagnostic: *"0 mapped accounts. 1,847 equipment rows, 0 with lat/lng metadata. Last geocode run: never."*
- CTA: `[Geocode now] [View sample data] [Open data quality]`.
- Fallback rendering: territory polygons + sample heatmap so the canvas is never pure black.

---

## 6. Prioritized Fix Plan

Ordered by **operator impact / engineering effort**. Each slice closes with the build/release gates from CLAUDE.md (`bun run migrations:check`, `bun run build`, `bun run build` in `apps/web`).

### P0 — Restore command-deck rhythm (1 sprint slice, no backend work)

1. **Render `QrmPageHeader`** with crumb (`GRAPH / MAP / mapped`), metric strip (Mapped / Open Rev / Visits / Rentals / Trades), and an Iron briefing cascading headline (mirror `SeasonalOpportunityMapPage.tsx`'s pattern).
2. **Render `QrmSubNav`** so users can move sideways without using `Exit`.
3. **Delete the duplicate metric `DeckSurface` row below the map** (now covered by `MetricStrip`).
4. **Replace empty-state copy** with a diagnostic: equipment row count, count missing lat/lng, last geocode timestamp, link to data-quality surface.
5. **Add `DataSourceBadge`** through `QrmPageHeader` (default `showDataSourceBadge=true`).
6. **Add reason strings to sidebar rows** (`"3 open · trade ripe · visit due today"`).
7. Add `data-testid` hooks for QA contract tests under `apps/web/src/features/qrm/pages/__tests__/`.

> Outcome: page passes the "looks like the rest of QRM" bar and the empty state stops being a black hole.

### P1 — Field-sales utility (1–2 sprint slices, mostly UI)

8. **$-aware marker sizing** + urgency-tier tone (Critical / Hot / Warm / Cold) computed in `buildOpportunityMapBoard`.
9. **Cluster aggregation by $ value** in `MapLibreCanvas` (sum a `weight` property at cluster time).
10. **Marker popups** with quick info + actions (Open / Add to route / Snooze / Skip).
11. **Filter bar** above the map: time horizon, rep, min $, signal type, signal age. Wire into the existing query key.
12. **"Build today's route" CTA** — optimize stops by nearest-neighbor + drive time, deep-link to Apple/Google Maps.
13. **"Send to rep"** — Edge function `qrm-router` action that fires SMS or in-app notification.
14. **Reorderable sidebar route + multi-select bulk actions.**
15. **Mobile bottom-sheet layout** in `MapWithSidebar` — second variant for narrow viewports.

### P2 — Strategic / management lens (1 sprint, mild backend)

16. **Heatmap layer** for zoomed-out pipeline density (MapLibre `heatmap` layer, source = same markers GeoJSON with `weight = openRevenue`).
17. **Territory polygons** — needs `crm_company_territories` (or similar) table; render rep zones; click-to-filter sidebar.
18. **Whitespace overlay** — counties / zips with no touches in 90d (RPC `qrm_whitespace_geometries(window_days, rep_id)`).
19. **Drive-time isochrones** from rep base or current GPS (Mapbox isochrone API; demo-mode fallback to radius circle).
20. **Coverage / whitespace toggle** on right rail with manager-aware Iron briefing variants.
21. **Server-side viewport RPC** `qrm_opportunity_map_viewport(bbox, zoom, filters)` with hex-bin aggregation; switch the page to viewport-driven fetch.

### P3 — Mission-fit moonshot (parallel research track)

22. **Voice planning entry-point** ("Iron, plan my Tuesday around Lincoln") — wire into `iron-orchestrator`.
23. **Predictive next-best-location** — Edge function `iron-pattern-mining` extension; outputs ranked geographic recommendations.
24. **Pressure-test territory mode** — Iron critique with handoff recommendations; saves to `qrm_territory_handoffs` audit table.
25. **Cluster reasoning hover** — calls `iron-knowledge` with a cluster's account list; returns a 1-line rationale.
26. **Live rep position + push-to-watch** — opt-in mobile capability; `qrm-router` dispatches geofence events.
27. **Competitive density overlay** — needs `competitive_intel` ingestion (out of scope for the map, but the overlay socket is here).

---

## 7. Acceptance Criteria for "World-Class"

A reviewer (or the user) should be able to walk up to `/qrm/opportunity-map` and answer **all** of the following inside 5 seconds of looking at the screen:

1. What is Iron telling me to do today, and how much $ does it represent?
2. How many opportunities are mapped, and how does that compare to my pipeline total?
3. Where is my pipeline geographically concentrated? Where is the white space?
4. Which 5–8 accounts should I visit today, in what order, and why?
5. How fresh is this data, and from which CRM source?
6. Can I move sideways to Seasonal, Threat, or Rescue without leaving the map?

Today the page answers **zero of six**. P0 lifts that to four; P1 reaches all six for a rep audience; P2 adds the manager / COO lens; P3 is the mission-locked transformational layer.

---

## 8. Cross-Cutting Notes

- **Mission lock:** P3 is non-negotiable to keep the surface mission-aligned. P0+P1+P2 alone produce a "good Salesforce Maps clone." That is necessary but not sufficient for QEP.
- **Sibling parity:** `SeasonalOpportunityMapPage.tsx` already implements the right header rhythm. Most of P0 is *literally copy the structure from the seasonal page.* The fact that the canonical map (the one Seasonal *links back to*) is the regressed sibling is the single most jarring inconsistency in QRM today.
- **Zero-blocking integration architecture:** All overlays must keep the page usable without external credentials (no Mapbox token, no isochrone API, no SMS provider). Demo / manual fallbacks required per CLAUDE.md.
- **RLS:** Any new RPC (`qrm_opportunity_map_viewport`, `qrm_whitespace_geometries`, `qrm_territory_handoffs`) must enforce role/workspace via `get_my_role()` / `get_my_workspace()`.
- **Migrations:** New tables follow the canonical `NNN_snake_case_name.sql` sequence. Likely additions: `crm_company_territories`, `qrm_route_plans`, `qrm_territory_handoffs`, plus indexes on `crm_equipment.metadata->>lat,lng` (GIST or a derived geography column).

---

## 9. Files Reviewed

- `apps/web/src/features/qrm/pages/OpportunityMapPage.tsx` (248 lines)
- `apps/web/src/features/qrm/lib/opportunity-map.ts` (148 lines)
- `apps/web/src/components/primitives/MapWithSidebar.tsx` (100 lines)
- `apps/web/src/components/primitives/MapLibreCanvas.tsx` (322 lines)
- `apps/web/src/features/qrm/pages/SeasonalOpportunityMapPage.tsx` (249 lines, reference for parity)
- `apps/web/src/features/qrm/components/QrmPageHeader.tsx` (216 lines)
- `apps/web/src/features/qrm/components/QrmSubNav.tsx` (118 lines)

---

## 10. Bottom Line

The Opportunity Map is **the strategically most important geographic surface in QRM** — every other map in the system points back to it as the canonical command deck. As shipped, it is a regressed sibling of the Seasonal map: it skips the command-deck header, omits the sub-nav, hides empty-state diagnostics, and offers only a single `Exit` action. Even when fully populated, it is a commodity dot-plot with no AI reasoning, no $-awareness, no route-building, and no manager/COO lens.

P0 (one sprint slice, zero backend) closes the cosmetic gap.
P1 + P2 (≈3 weeks) make it competitive with Salesforce Maps / Badger.
P3 — the Iron-native voice, prediction, and pressure-test layer — is what the QEP mission lock actually requires us to ship, and it is currently absent.

Recommend prioritizing P0 next sprint and committing P3 research in parallel.
