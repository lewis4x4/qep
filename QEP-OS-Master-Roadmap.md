# QEP OS — Master Roadmap

**Date:** 2026-04-09
**Repository:** `lewis4x4/qep` on GitHub, `main` branch
**Supabase project:** `iciddijgonywtxoelous` (the ONLY production project)
**Current state:** 215 migrations, 111 edge functions, 430 TypeScript files, tsc clean
**This document replaces:** All prior roadmaps (see §14 for lineage)

---

## 0. Mission Lock

> Build a moonshot equipment-and-parts sales+rental operating system for field reps, salesmen, corporate operations, and management. Every shipped slice must measurably improve decision speed or execution quality for at least one real dealership role and must include or enable a capability beyond commodity CRM behavior.

Every feature must pass ALL four gates:

1. **Mission Fit** — Advances equipment/parts sales+rental operations
2. **Transformation** — Creates capability beyond commodity CRM behavior
3. **Pressure Test** — Validated under realistic usage and edge cases
4. **Operator Utility** — Improves decision speed or execution quality for a real role

---

## 1. What Has Already Shipped

### Security Lockdown (formerly Unified Roadmap Sprint 0) ✅ COMPLETE
All 8 critical security items verified fixed as of 2026-04-09:
- deal_composite workspace isolation (migration 092)
- Service key exposure guarded in meta-social + telematics-ingest
- nudge-scheduler workspace derivation from profile
- dge-optimizer uses user-scoped client (RLS enforced)
- voice-to-qrm JSON.parse try-catch
- portal-api trusted IP header chain (cf-connecting-ip → x-real-ip → x-forwarded-for)
- Error message leaking eliminated (generic responses + Sentry capture)
- CORS standardized via shared safe-cors utility

### Schema Hardening (formerly Unified Roadmap Sprint 1) ✅ COMPLETE
- Type regeneration done; `as any` casts reduced to 12 (all in legitimate contexts)
- Database types synced with remote schema

### QRM Moonshot Phase 0 — Substrate ✅ COMPLETE
All 8 substrate tracks shipped (migrations 207–215):
- P0.1: Slice 1 committed and pushed
- P0.2: Signal taxonomy + deal-signal bridge (4-source; `deal_timing_alerts` deferred)
- P0.3: Prediction Ledger + nightly scorer
- P0.4: Flow Bus (pub/sub alongside existing Flow Engine)
- P0.5: Role-blend data model + frontend adoption
- P0.6: Honesty Calibration Index (6 live probes, 2 stubbed)
- P0.7: Time primitive + stage transition tracking
- P0.8: Telemetry + trace substrate

### QRM Moonshot Phase 1 — Command Center Spine ✅ COMPLETE
Shipped at `/qrm/command`:
- Global Command Strip + AI Chief of Staff (rules-based)
- Live Action Lanes (Revenue Ready / At Risk / Blockers)
- Pipeline Pressure Map (5 meta-stages)
- Role-variant ordering with blended role support
- Per-section freshness chips + terminology-locked rationale

---

## 2. Phase Structure

The roadmap is organized into **7 Tracks** that run in a dependency-aware sequence. Tracks are not isolated silos — they have explicit entry conditions and handoff points. Each track contains numbered delivery slices.

```
Track 1: Command Center Completion     (QRM Phase 2 — near-term, next up)
Track 2: Core Business Workflows       (Quote Builder, Post-Sale, Pipeline)
Track 3: Intelligence Layer            (DGE, Health Scores, Attribution, Forecasting)
Track 4: Field & Mobile Operations     (Equipment intake, PDI, driver, rental returns)
Track 5: Executive & Management        (Executive Intelligence Center, role dashboards)
Track 6: Customer Portal & Payments    (Portal frontend, Stripe, document library)
Track 7: Moonshot Operating Surfaces   (Phase 3-5 QRM surfaces, fleet visibility, hidden forces)
```

**Execution rule:** Within each track, complete slices top to bottom. Tracks with no dependency conflicts can run in parallel (marked where applicable).

---

## 3. Track 1 — Command Center Completion

**Goal:** Finish the QRM Command Center and cut over from the legacy `/qrm` page.
**Entry condition:** Phase 0 complete ✅
**Exit condition:** `/qrm` renders the new command center. `QrmHubPage.tsx` deleted.
**Estimated effort:** 12–15 engineer-days

### 1.1 — Revenue Reality Board
Open pipeline, weighted revenue, closable-7d/30d, at-risk, margin-at-risk, stalled quotes, blocker breakdown. Hooks DGE optimizer output for close-probability adjustments.
**Idea IDs:** IDEA-006, IDEA-009

### 1.2 — Dealer Reality Grid
6-tile operational dashboard: Quotes, Trades, Demos, Traffic/Deliveries, Rentals, Service Escalations. Each tile always rendered — unavailable integrations show muted state with "Request integration" CTA. Never hide a tile.
**Idea IDs:** IDEA-010, IDEA-031 (tile), IDEA-032 (tile), IDEA-033 (tile)

### 1.3 — Quote Velocity Center
Dedicated `/qrm/command/quotes` page: creation time, aging, presentation lag, conversion pressure. Uses P0.7 time primitive.
**Idea ID:** IDEA-031 (full)

### 1.4 — Approval Center
Dedicated `/qrm/command/approvals` page: margin flags, deposit exceptions, trade approvals, demo approvals, goodwill exceptions. One-click approve/deny with audit trail.
**Idea ID:** IDEA-032 (full)

### 1.5 — Blocker Board
Dedicated `/qrm/command/blockers` page grouped by blocker type with resolver CTAs.
**Idea ID:** IDEA-033 (full)

### 1.6 — Relationship & Opportunity Engine + Field Intelligence Feed
Heating up, cooling off, competitor mentions rising, fleet replacement opportunities, silent key accounts, field feed. Uses voice captures + health score deltas + deal-timing bridge.
**Idea IDs:** IDEA-011, IDEA-012

### 1.7 — Knowledge Gaps + Absence Engine
Knowledge Gaps with Iron-role attribution. Absence Engine: nightly function scoring which fields each rep systematically blanks — visible to managers only, never shown to the rep directly.
**Idea IDs:** IDEA-061, NEW-RES-064

### 1.8 — Executive Intelligence Layer v1
Role-gated section for elevated roles: forecast confidence preview, rep performance summary, margin pressure, branch health. Read-only in this track; full version in Track 5.
**Idea ID:** IDEA-013

### 1.9 — Cutover
Flip `/qrm` route to `QrmCommandCenterPage`. Delete `QrmHubPage.tsx`. PR description carries an explicit capability-diff.

### Track 1 Exit Gate
- `/qrm` renders the new page; legacy page deleted
- Dealer Reality Grid renders all 6 tiles with clear status per tile
- Absence Engine running nightly for ≥7 days with manager-reviewable data
- Flow Bus dual-write side-effects retired at Slice 1.2 exit

---

## 4. Track 2 — Core Business Workflows

**Goal:** Quote Builder becomes the first owner-demo-able revenue workflow. Pipeline board gets polish. Post-sale automation wires up.
**Entry condition:** Track 1 Slice 1.2 complete (Dealer Reality Grid drives quote/trade/demo tiles)
**Can run in parallel with:** Track 3 (after Slice 2.1 ships)
**Estimated effort:** 18–22 engineer-days

### 2.1 — Quote Builder Completion
**Sub-slices:**

**2.1a — Zero-blocking manual catalog**
CSV bulk-import admin UI. Catalog query adapter: IntelliDealer first → `catalog_entries` fallback. Clear live/manual status indicator.

**2.1b — Three entry modes**
Voice (via `voice-to-qrm` pipeline → auto-populate), AI Chat (text → same extraction), Traditional Form (decomposed from the current monolith). `QuoteBuilderPage.tsx` decomposed to <200 lines.

**2.1c — Financing preview**
3 scenarios side by side from `financing_rate_matrix`: cash price, 60-month finance, 48-month lease.

**2.1d — Trade-in pull-through**
Pre-populate trade-in section from `trade_valuations`: make, model, year, hours, preliminary value, conditional language.

**2.1e — Margin check UI**
Margin waterfall visualization at review step. "Requires Iron Manager Approval" state when margin <10%. Approval routing notification.

**2.1f — Proposal PDF generation**
4-page branded proposal: cover, equipment details, pricing, terms. `@react-pdf/renderer`.

**2.1g — Quote package auto-send**
Quote + photos + brochure + credit application + video link. "Send Package" button.

**2.1h — E-signature**
Signature capture UI, signer name + IP + timestamp. State machine: draft → sent → viewed → signed.

### 2.2 — Quote Tax & Incentive Intelligence
- Tables: `quote_tax_breakdowns`, `manufacturer_incentives`, `quote_incentive_applications`, `section_179_calculations`
- Extend `tax-calculator` with jurisdiction lookup; new `quote-incentive-resolver` function
- Frontend: `TaxBreakdown.tsx`, `Section179Card.tsx`, `IncentiveStack.tsx`, `IncentiveCatalogPage.tsx` (admin)
- Rep never types a tax rate

### 2.3 — Price Intelligence
- `price-file-import` extended for xlsx/pdf/csv
- Tables: `price_file_imports`, `price_change_events`
- `quote-impact-analyzer`: find affected open quotes, sort by dollar impact
- `requote-batch-launcher`: auto-draft re-quote emails via `draft-email` service
- Yard-first sourcing: check branch inventory before manufacturer order
- Frontend: `PriceFileImportPage.tsx`, `PriceImpactDashboard.tsx`, `YardFirstSourcing` widget

### 2.4 — Pipeline Board Polish
- Card reordering within columns (`sort_position` column + `@dnd-kit/sortable`)
- Multi-select drag
- Gate validation in drag UI (visual rejection + toast for gated stages)
- Pipeline analytics overlay (toggle-able: avg time per stage, conversion rates, bottlenecks, velocity trends)

### 2.5 — Post-Sale Automation Wiring
- Voice → escalation pipeline (detect escalation intent → ticket + email draft + follow-up task)
- 2 PM prospecting nudge (daily check against `prospecting_kpis`, notify manager for under-target advisors)
- Pre-generated follow-up content (at cadence creation, refresh at 48-hour window)
- Escalation intelligence (auto-identify department manager, score severity by LTV, suggest resolution)

### Track 2 Exit Gate
- Quote Builder works without IntelliDealer (manual catalog mode)
- Voice/AI/Form entry modes all populate quote fields
- Tax auto-computed per jurisdiction; incentives auto-applied
- Price file import → impact analysis → batch re-quote drafts functional
- Pipeline drag-and-drop with reordering + gate validation
- E-signature captures name + IP + timestamp
- `bun run build` passes

---

## 5. Track 3 — Intelligence Layer

**Goal:** Make the Deal Genome Engine visible. Build the live nervous system. Surface health scores, revenue attribution, and forecasting.
**Entry condition:** Track 1 complete (command center is the intelligence home)
**Can run in parallel with:** Track 2 (after Track 1 done), Track 4
**Estimated effort:** 18–22 engineer-days

### 3.1 — DGE Intelligence Cockpit
- 3 scenario cards on deal detail (Conservative / Balanced / Aggressive)
- Margin waterfall cascade chart (recharts)
- "Why this scenario" explanations (14 variable breakdown)
- DGE learning loop: track advisor scenario selection + deal outcome → feed accuracy back

### 3.2 — Predictive Visit List
- Morning briefing for Iron Advisors from `predictive_visit_lists`
- 10 customers ranked by: overdue follow-ups, fleet replacement, seasonal demand, competitive displacement, geographic clustering, inventory matching, incentive windows, lifecycle signals
- Map view with route optimization

### 3.3 — Live Nervous System (Customer Health)
- `cross_department_health_score` trigger network: any deal/service/parts/AR/voice change recomputes health asynchronously via `pg_notify` + `health-score-refresh` worker
- `HealthScorePill` component on every company/contact/deal card (0–100, click → breakdown drawer)
- Weighted inputs frozen, score range defined, explainability drawer non-negotiable v1
- Two-track design: rep-visible score is portfolio-adjusted; manager-visible score is absolute
- Advisory-only at first; no auto-actions

### 3.4 — AR Credit Blocking
- Auto-block new credit-extended/financed/rental-risk deals when AR aging exceeds threshold
- Cash deals pass through; "quote allowed, order progression blocked" lifecycle gate
- Override requires reason + approver + time window + accounting notification
- `ARCreditBlockBanner` on deal page

### 3.5 — Customer Lifecycle Timeline
- `customer_lifecycle_events` table: first contact, first quote, first purchase, first service, first warranty claim, NPS, churn risk, won back, lost
- Horizontal timeline view per company with revenue + service + parts spend overlay

### 3.6 — Revenue Attribution
- `revenue_attribution` table with touch-chain model (first-touch, last-touch, linear, time-decay)
- `revenue-attribution-compute` function: walks activities, voice captures, marketing events
- Attribution Dashboard: "voice-to-QRM contributed $420K of $1.2M closed in March"

### 3.7 — Ownership Intelligence Dashboard
- Extends Iron Manager dashboard: margin analytics by rep/category/month, pipeline intelligence (weighted value + velocity), 30/60/90 revenue forecast with accuracy tracking, manufacturer incentive alerts within 24 hours

### 3.8 — Forecast Confidence
- Not just forecast value but confidence bands, bias, assumption quality
- Depends on P0.3 Prediction Ledger having ≥90 days of accrued data
**Idea ID:** IDEA-053

### Track 3 Exit Gate
- DGE scenario cards visible on every deal detail page
- Health score updating within 5 seconds of any source change
- AR blocking enforceable from database trigger, not just edge function
- Revenue attribution computed for at least one month of closed-won deals
- `bun run build` passes

---

## 6. Track 4 — Field & Mobile Operations

**Goal:** Equipment intake, PDI, driver workflows, rental returns — all mobile-first.
**Entry condition:** None (independent track, can start immediately)
**Can run in parallel with:** Track 1, Track 2, Track 3
**Estimated effort:** 12–15 engineer-days

### 4.1 — Equipment Intake Kanban
8-stage board using `@dnd-kit`. Each card: stock number, equipment name, stage checklist progress, photo count. Drag-and-drop triggers `track_intake_stage_change()`. Mobile: horizontal scroll with snap-to-column. Photo requirements enforced per stage.

### 4.2 — PDI Tap-Through Checklist
Mobile-optimized checklist from `pdi_checklist` jsonb. Tap to complete + camera for photo evidence. Upload to Supabase Storage. Progress bar. Blocks stage progression until `pdi_completed = true`.

### 4.3 — Traffic Ticket + Driver Workflow
- Traffic ticket list with color-coded status (gray → yellow → orange → red)
- Auto-creation confirmed working at stage 18
- Driver mobile view: step-by-step checklist, GPS via Geolocation API, signature via Canvas, photo upload (delivery + hour meter)
- `traffic_ticket_auto_lock()` renders read-only after submission

### 4.4 — Rental Return Branching Workflow
Wizard-style mobile UI: Inspection (Iron Man) → Decision (Rental Asset Manager) → Clean path (credit + deposit refund) OR Damaged path (work order → charge calculation → balance/refund). Refund method must match `original_payment_method`.

### 4.5 — Payment Validation + GL Auto-Suggestion
- `validate_payment()` before processing with pass/fail + rule explanation
- Override for A/R role with documented reason
- GL routing from `gl_routing_rules` with suggested code + explanation
- SALEW001: prominent warning + ownership approval gate

### 4.6 — SOP Engine
- `sop-ingest` edge function: accepts pdf/docx/md → structured steps extraction
- `sop_skip_events` table: tracks every step a rep skips on real workflows
- Pipeline stage transitions auto-check active SOP → insert skip events for missing evidence
- `sop-compliance-rollup`: per-rep, per-team, per-step compliance percentages
- SOP Compliance Dashboard (admin): heatmap of (rep × step)
- `SopNudgeInline`: contextual banner on pipeline cards with skipped steps
- SOP Editor for managers
- False-positive protection: confidence score on step mapping, "not applicable" path, suppression/review queue

### Track 4 Exit Gate
- Equipment intake Kanban works on mobile with 8 stages
- PDI checklist blocks stage progression
- Driver workflow captures GPS + signature + photos from phone
- Rental return branching paths both functional
- Payment validation enforced with SOP rules
- SOP compliance dashboard shows non-zero data for at least 1 real SOP
- All surfaces pass 390px viewport test

---

## 7. Track 5 — Executive & Management Layer

**Goal:** Build the best live dealership executive command center — a leadership operating room, not a passive analytics page.
**Entry condition:** Track 1 Slice 1.8 (Executive Layer v1) + Track 3 Slices 3.1–3.4 complete
**Estimated effort:** 15–18 engineer-days

### Product Rules
1. `/executive` is the live canonical leadership route; `/exec` aliases to it
2. Every KPI shows formula context, freshness, and a drill path
3. Every alert shows the next action, not just the problem
4. Every AI-generated surface exposes confidence/freshness/source grounding
5. Every "important" view routes into a record, queue, playbook, or packet
6. No raw internal jargon on leadership surfaces
7. No future/showcase copy on the live executive route

### 5.1 — Canonical Route + Executive Front Door
- `/executive` as the live route; `/executive/vision` for showcase material
- Executive overview above the CEO / CFO / COO lenses
- "What matters now / where to act" hierarchy

### 5.2 — Leadership Pulse Layer
- Business posture band
- Cross-lens alert pressure summary
- Stale-metric confidence summary
- Lens preview cards with live KPI snippets
- Top intervention list with direct action links
- First viewport answers: what changed, what is at risk, what to do next, where to drill

### 5.3 — Deep Role Rooms

**CEO Room:** Growth posture, revenue concentration, branch comparison, customer health movers, expansion/churn watchlist, strategic packet export

**CFO Room:** Cash discipline wall, AR and deposit integrity, margin leakage explorer, payment exception recovery, policy enforcement timeline, finance risk packet

**COO Room:** Execution board, backlog recovery rail, logistics drag, readiness blockers, service throughput variance, operations packet

Each room has: live KPIs, at least one domain-specific explorer, at least one working queue, at least one direct action path.

### 5.4 — Intervention Graph
- Unified intervention queue across alerts, exceptions, and data quality
- "What solved this last time" memory links
- Branch/department responsibility grouping
- Owner-assigned follow-through state
- Action logging tied to alerts and metric drills

### 5.5 — Forecasting & Scenario Layer
- Forecast confidence bands, branch/department trajectory views
- Downside/upside scenario cards
- Quote expiration revenue risk
- Service backlog spillover forecast, cash/collections pressure forecast
- Every forecast card shows: time horizon, source inputs, confidence/freshness, suggested action

### 5.6 — Board Packet & Briefing System
- Daily briefing quality upgrade
- Weekly packet presets, role-specific templates, board-ready summary mode
- Packet run history with delivery state
- Branch packet generation
- Leadership generates role-specific packets from the live command center without leaving the module

### 5.7 — Iron Role Command Centers
Each role gets a purpose-built dashboard routed on login via `get_my_iron_role()`:

**Iron Manager:** Pipeline health (all reps), team KPI scoreboard, approval queue, inventory aging alerts, 30/60/90 revenue forecast

**Iron Advisor:** Personal 21-step pipeline, daily task queue, follow-up countdown queue, prospecting counter, morning briefing

**Iron Woman:** Order processing queue, deposit tracker, equipment intake Kanban, credit app tracker, invoice status

**Iron Man:** Equipment prep queue, PDI checklists, demo schedule, rental return inspections

Real-time dashboard updates via Supabase Realtime subscriptions.

### 5.8 — Data Quality Layer
Nightly admin audit for: equipment without owner linkage, missing make/model normalization, missing geocoords, stale telematics, duplicate equipment, missing service intervals, unclassified docs, quotes lacking tax jurisdiction.

### 5.9 — Exception Inbox
Cross-functional human work queue for: tax lookup failures, price-file unmatched rows, health-score refresh failures, AR override pending, Stripe webhook mismatches, portal reorder approvals, SOP evidence mismatches, geofence event conflicts, stale telematics, document visibility issues.

### Track 5 Exit Gate
- `/executive` is the obvious live leadership route
- Leadership sees KPI + risk + action posture in one view
- Every top-risk surface has a direct action path
- Every metric is explainable and drillable
- Packet generation works from the live command center
- Iron role dashboards route correctly on login
- Dashboards update in real-time

---

## 8. Track 6 — Customer Portal & Payments

**Goal:** Convert the full portal backend into a customer-facing experience with payments.
**Entry condition:** Track 3 Slices 3.3–3.4 (health score + AR blocking) complete
**Estimated effort:** 12–15 engineer-days

### 6.1 — Portal Auth + Fleet Dashboard
Separate login for portal customers via `portal_customers` + Supabase Auth. Fleet dashboard: customer's equipment with warranty status, service history, maintenance schedules.

### 6.2 — Service Request + Parts Ordering
Service request form with photo upload, department routing, urgency levels. Parts browsing with AI-suggested PM kits. Shopping cart → order submission. One-tap reorder from history.

### 6.3 — Invoice/Payment View + Stripe
Outstanding invoices with balance due, payment history, statement download. `portal-stripe` function: PaymentIntent creation, webhook for `payment_intent.succeeded`, automatic AR mark-paid + ledger entry. Stripe Elements integration.

### 6.4 — Quote Review + E-Signature
View proposal, accept/reject with e-signature from portal side. State machine: sent → viewed → accepted.

### 6.5 — Document Library
`customer_documents` table with type, visibility control. Portal shows only `visible_to_portal = true` documents. Download capability.

### 6.6 — Portal Fleet Mirror
Customer sees T3-grade map and per-asset service-bar view of THEIR iron. Reuses shared primitives (`MapWithSidebar`, `AssetCountdownStack`). Read-only Asset 360 with no commercial overlay. "Talk to your rep" buttons. RLS enforces customer isolation.

### 6.7 — Portal Event Consistency
Every portal-facing status reads from a single canonical state machine. ETA carries source + last-updated. Stage labels are curated translations, not raw internal jargon. Document visibility writes audit rows.

### 6.8 — Customer Notifications
Push/email when: service status changes, parts order ships, new quote available, maintenance due, new matching equipment arrives.

### Track 6 Exit Gate
- Customers log in via separate portal auth
- Fleet dashboard shows equipment + warranty + service history
- Stripe payments work end-to-end (webhook → AR mark-paid → health score recompute)
- Customers see ONLY their own data (dual RLS verified)
- Portal fleet mirror works for at least 1 real customer

---

## 9. Track 7 — Moonshot Operating Surfaces

**Goal:** Build the operating surfaces that make QEP OS a category-defining product. These are the 80+ ideas from the QRM inventory that extend the command center into a full dealership operating system.
**Entry condition:** Track 1 complete. Individual slices have additional per-slice dependencies.
**Estimated effort:** 80+ engineer-days across 3 sub-phases

### Sub-Phase 7A — Seam Layer + Operating Surfaces

Entry condition: Track 1 complete. P0.7 Time Primitive shipped ✅

**7A.1 — Handoff Trust Ledger** (NEW-005): Cross-role scoring at the seam between roles. Manager-gated.
**7A.2 — Time Bank** (NEW-001): Visible per-deal/account/rep time balance. Reuses P0.7 primitive.
**7A.3 — Account Command Center** (IDEA-025): `/qrm/accounts/:id/command` — deals, fleet, service, parts, health, AR.
**7A.4 — Branch Command Center** (IDEA-023): `/qrm/branches/:id/command` — revenue, readiness, logistics, rental, service-linked sales.
**7A.5 — Territory Command Center** (IDEA-024): Per-territory routing and visit priority.
**7A.6 — Mobile Field Command** (IDEA-043): Mobile-first field OS at `/m/qrm`. Web PWA (native decision deferred to 7A.6 planning).
**7A.7 — Visit Intelligence** (IDEA-044): Pre-visit briefing with talking points, service issues, competitor mentions, likely objections.
**7A.8 — Trade Walkaround** (IDEA-045): Guided capture: required photos, condition prompts, AI scoring, instant valuation.
**7A.9 — Machine Lifecycle** (IDEA-034): First-class machine lifecycle state model.
**7A.10 — Machine Command Page / Asset 360** (IDEA-035 + Wave 6.2): Single page joining everything QEP knows about one machine. Header + badge row + countdown stack + 24h strip + service/parts/deal/telematics/docs tabs. "Recommend Trade-Up" button.
**7A.11 — Inventory Pressure Board** (IDEA-036): Aged, hot, under-marketed, price-misaligned units.
**7A.12 — Iron in Motion Register** (NEW-007): Every machine not in yard, not yet delivered — carrying cost, decay rate, risk.
**7A.13 — Rental Command Center** (IDEA-038): Dedicated rental operations.
**7A.14 — Service-to-Sales** (IDEA-040): Recurring breakdowns/downtime → replacement/upgrade motion.
**7A.15 — Parts Intelligence** (IDEA-041): Purchasing patterns as demand signals.
**7A.16 — Deal Room** (IDEA-070): Per-opportunity operating room with notes, scenarios, approvals, tasks.
**7A.17 — Deal Autopsy** (IDEA-052): Structured post-mortem on closed-lost deals. Fed by flow bus `deal.lost` event.
**7A.18 — Exception Handling** (IDEA-051): First-class surfaces for revivals, failed deliveries, damaged demos, rental disputes, payment exceptions.
**7A.19 — Customer 360 Timeline** (IDEA-071): Cinematic operating history per relationship.
**7A.20 — Opportunity Map** (IDEA-072): Geographic overlay of open revenue, visit targets, rentals, trades.
**7A.21 — Revenue Rescue Center** (IDEA-067): Revenue saveable this week. Triage view.
**7A.22 — Competitive Displacement Center** (IDEA-068): Where competitors are weak and how to take share.
**7A.23 — Operator Intelligence** (IDEA-069): What machine operators say, need, complain about, prefer.
**7A.24 — Post-Sale Experience Center** (IDEA-073): Onboarding quality, first-90-day friction, attachment adoption.
**7A.25 — Workflow Audit** (IDEA-059): Where processes break, stall, reroute, silently fail.
**7A.26 — SOP Compliance + Folk Workflow Library** (IDEA-063 + NEW-RES-065): Compliance and folk workflow as two sides of the same surface.
**7A.27 — Rep Reality Reflection** (NEW-RES-062): Private, rep-owned mirror. Never visible to managers.

**7A Exit Gate:** All 27 slices shipped. Handoff Trust Ledger has ≥30 days of data. Account Command Center is the default drill-down target system-wide.

### Sub-Phase 7B — The Outward Turn

Entry condition: 7A complete. P0.3 Prediction Ledger has ≥90 days of accrued data.

**7B.1 — Customer Genome** (IDEA-026): Multi-dimensional customer profile.
**7B.2 — Customer Operating Profile** (IDEA-027): Work type, terrain, brand preference, budget behavior, buying style.
**7B.3 — Fleet Intelligence** (IDEA-028): Owned machines, age, hours, attachment gaps, replacement windows.
**7B.4 — Relationship Map** (IDEA-029): Who signs, influences, operates, blocks, decides.
**7B.5 — White-Space Map** (IDEA-030): Revenue the dealership should be capturing but isn't.
**7B.6 — Rental Conversion Engine** (IDEA-039): Repeat renters/usage → purchase motion. Contrarian Bet #1.
**7B.7 — AI Deal Coach** (IDEA-046): Per-opportunity coaching.
**7B.8 — AI Branch Chief** (IDEA-047): Per-branch diagnostic agent.
**7B.9 — AI Customer Strategist** (IDEA-048): 30/60/90 account plans, white-space plays.
**7B.10 — AI Operations Copilot** (IDEA-049): Incomplete deals, misrouted billing, delayed deposits.
**7B.11 — AI Owner Briefing** (IDEA-050): Morning command note — "Certain. Probable. Suspected. Don't act on this yet."
**7B.12 — Replacement Prediction** (IDEA-054): Fleet units entering replacement windows in 30/60/90/180 days.
**7B.13 — Competitive Threat Map** (IDEA-055): Deere/CAT/others gaining/losing by account, rep, branch.
**7B.14 — Seasonal Opportunity Map** (IDEA-056): Time-of-year demand shifts as routeable opportunity.
**7B.15 — Learning Layer** (IDEA-074): Wins, losses, workflows, patterns → dealership memory.
**7B.16 — Cross-Dealer Mirror** (NEW-002): Projected customer experience inside competitor's CRM.
**7B.17 — Cashflow Weather Map** (NEW-003): Customer float, payment cadence, seasonal cash.
**7B.18 — Decision Room Simulator** (NEW-004): Literal humans in the decision room.
**7B.19 — Decision Cycle Synchronizer** (NEW-010): Per-customer purchasing rhythm.
**7B.20 — Ecosystem Layer** (NEW-011): Lenders, insurers, transport, factory reps, auctioneers.
**7B.21 — Reputation Surface** (NEW-012): Reviews, forums, auctioneer commentary, mechanic gossip.
**7B.22 — Rep as SKU** (NEW-013): Every rep modeled as a packaged offering.
**7B.23 — Death and Exit Register** (NEW-014): End-of-relationship events.
**7B.24 — Unmapped Territory** (NEW-015): Map of provable absence.

**7B Exit Gate:** All 24 slices shipped. Every AI surface reads/writes P0.3 Prediction Ledger. Every AI output has visible confidence label + working trace.

### Sub-Phase 7C — Hidden Forces

Entry condition: 7B shipped. Honesty Calibration has run for a full fiscal year.
**Ethics review required before any slice opens.**

**7C.1 — Trust Thermostat** (IDEA-075): Post-hoc receipt (not real-time gauge). Contrarian Bet #3.
**7C.2 — Machine Fate Engine** (IDEA-076): Per-unit retail/rental/transfer/auction recommendation.
**7C.3 — Silence Map** (IDEA-077): Absence of expected noise as signal.
**7C.4 — Customer Gravity Field** (IDEA-078): With "Permission Slip" for formal deprioritization. Contrarian Bet #4.
**7C.5 — Rep Mythology Layer** (IDEA-079): Research-gated.
**7C.6 — Pre-Regret Simulator** (IDEA-080): Exact form of shame 30 days later.
**7C.7 — Internal Market for Attention** (IDEA-081): Unresolved issues compete for organizational focus.
**7C.8 — Ruin Prevention Mode** (IDEA-082): Throttles optimism on fragile risk concentrations.
**7C.9 — Shadow Org Chart** (IDEA-083): Who actually moves work.
**7C.10 — Ghost Buyer** (IDEA-084): Shape-only, never identity. Contrarian Bet #5.
**7C.11 — Institutional Grief Archive** (NEW-006): Deals that hurt, customers who left.
**7C.12 — Body of the Operator** (NEW-008): Research-gated.
**7C.13 — Tempo Conductor** (NEW-016): Meta-surface — hierarchy + gravity + rhythm.

**7C Exit Gate:** ≥2 slices in controlled pilots with documented ethical limits. Honesty Calibration Index still trending up after these ship.

---

## 10. Shared UI Primitives (Cross-Track)

These ship before any Track 7 surface and are consumed by Tracks 3–7:

| Primitive | Description |
|-----------|-------------|
| `<StatusChipStack>` | Multi-chip display with configurable tones. Replaces ad-hoc chips everywhere. |
| `<FilterBar>` | Universal filter bar with URL-persisted state. |
| `<CountdownBar>` | Single horizontal progress bar with "X remaining" label. |
| `<AssetCountdownStack>` | Multiple countdown bars for one equipment row. |
| `<ForwardForecastBar>` | Top-of-dashboard strip with click-through counters. |
| `<Last24hStrip>` | Mechanical + commercial activity for last 24 hours. |
| `<AssetBadgeRow>` | Open WOs, quotes, parts orders, overdue intervals, trade-up score. |
| `<AskIronAdvisorButton>` | Floating chat button with record context preloaded. On every record screen. |
| `<DashboardPivotToggle>` | Generalized Service Dashboard / Mechanic Overview toggle. |
| `<MapWithSidebar>` | Mapbox with asset list + configurable polygon overlays. |

**Acceptance:** Storybook story for each. Full prop variant test coverage. All exported from `apps/web/src/components/primitives/index.ts`.

---

## 11. Fleet Visibility & Geofences (Cross-Track)

Ships alongside Track 7A when primitives are ready:

### Unified Fleet Map
Route `/fleet`. `MapWithSidebar` with overlay toggles: Branch Territory, Customer Concentration, Open Opportunity Markers, Idle Assets (7+ days no run hours), Service Truck Routes. Sidebar with `FilterBar` (Branch / Rep / Customer / Make / Status). Role-scoped: rep → assigned customers; manager → branch; owner → workspace.

### Service Dashboard
Route `/service/dashboard`. T3-cloned layout with dealer overlay T3 cannot offer. "Maintenance Percentage Remaining" widget, "Overdue PM" counter, `ForwardForecastBar` for 30/60/90 day service intervals. Columns T3 doesn't have: open deal value, trade-up score, days since last commercial touch. Mechanic Overview pivot.

### Geofences v1
`crm_geofences` (PostGIS) + `geofence_events`. Only: customer jobsite, branch territory, competitor yard. Triggers: entered customer site → cadence step; exited customer site + rental → off-rent inspection; entered competitor yard → red alert. Defer: state-boundary compliance, custom polygons, multi-action automation.

### Knowledge Base + Ask Iron Advisor Everywhere
`service_knowledge_base` table. Extend chat function with `context_type` + `context_id`. Drop `AskIronAdvisorButton` on every record screen.

---

## 12. Cross-Cutting Requirements

### Security
- Every new table: `workspace_id text not null`, RLS enabled, `*_workspace` policy via `get_my_workspace()`
- Stripe webhooks verify signature; no plaintext PAN touches QEP
- Tax computation NEVER trusts client-supplied rates
- AR blocking enforced at database trigger level
- Geofence polygons stored as PostGIS `geography(POLYGON, 4326)`
- No secrets in frontend code or committed files

### Mobile-First
Every operator-facing page works on 390px viewport. Test on iPhone 15 Pro Max and iPhone SE 3rd gen viewports.

### Zero-Blocking Integrations
Stripe, tax jurisdiction lookups, price file imports, telematics polygon checks — every integration has a manual fallback that keeps the workflow usable when the external service is unavailable.

### AI Confidence Indicators
Required everywhere AI does work: tax/incentive resolution, SOP parsing, health score, attribution, trade-up suggestions, geofence triggers. Every AI recommendation is written to P0.3 Prediction Ledger and traceable at `/qrm/command/trace/:predictionId`.

### Playbooks Pattern
Every page that reveals risk must offer one-click action: draft email, create task, open quote, escalate, reorder, SOP remediation, manager override.

### Build Gates (Every Delivery Slice)
1. `bun run migrations:check`
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. Edge function + RLS contract tests for touched surfaces
5. Role/workspace security check on modified flows
6. Mobile-first UX verified on operator-facing surfaces

---

## 13. Kill Criteria

Every idea is subject to these. Triggered ideas move to Deferred tier and are revisited at the next phase boundary.

1. **No users in 30 days** — surface deferred. One redesign cycle before deprecation.
2. **Negative Honesty Calibration impact** — surface paused immediately. No exceptions.
3. **No fragility review** — if a slice ships without one, it ships broken.
4. **Cannot be traced** — AI recommendation not in Prediction Ledger → rolled back.
5. **Permissions leak** — cross-branch/cross-rep/finance-adjacent data leak → rolled back immediately.
6. **Slow death test** — "Would removing this cause measurable loss?" If "probably not," it's deferred.

---

## 14. Lineage

This document unifies and replaces:

| Superseded Document | Date | What It Contributed |
|---------------------|------|---------------------|
| `plans/2026-03-30-qep-master-roadmap.md` | Mar 30 | Board-level program snapshot (DGE, CRM, product modules). Absorbed into Track structure. |
| `QEP-OS-Unified-Roadmap.md` | Apr 4 | Security lockdown (now verified complete), schema hardening, Sprint 0–11 feature specs. Core business workflows absorbed into Track 2. |
| `QEP-OS-WAVE-5-6-ROADMAP.md` | Apr 6 | Deep feature specs for tax/incentives, price intelligence, SOP engine, portal+payments, fleet visibility, geofences, Asset 360, service dashboard, executive command center. Absorbed across Tracks 2–7. |
| `plans/2026-04-07-executive-intelligence-center-roadmap.md` | Apr 7 | Executive module vision and phase design. Absorbed into Track 5. |
| `plans/2026-04-08-qrm-moonshot-exhaustive-roadmap.md` | Apr 8 | 103-idea QRM inventory, Phase 0–5 structure, substrate tracks, dependency graph, day-by-day execution log. Phase 0 substrate and execution history preserved in §1. All 103 ideas mapped into Tracks 1–7. |

**Important corrections applied during unification:**
- All references to Supabase project `xbfzymdhlfhfhaqhawzs` corrected to `iciddijgonywtxoelous` (the only production project)
- Migration numbering normalized to current state (215 at time of writing)
- Security lockdown verified complete — no longer a to-do item

---

## 15. Open Decisions Register

### Meaningful Contact Definition
**Status:** Draft, awaiting owner sign-off before Phase 2 calculation engine ships.
**Definition:** A meaningful contact satisfies BOTH a TYPE condition (weighted 0.3–1.0 by quality) and a SIGNAL condition (bilateral, physical, or voice-intent-extracted). Weight decays exponentially. Accounts decay when sum of weights < 0.5.
**Owner sign-off required on:** weight table, exclusions, anti-gaming guardrails, protected account override policy.

### Honesty Calibration Political Owner
**Status:** Brian as owner; operator TBD. Default: Brian for both roles until Track 7A.

### Mobile Field Command — Native or Web?
**Status:** Deferred to Track 7A Slice 7A.6 planning. Default: Web PWA.

### Phase 5 Ethics Review
**Status:** Deferred to 7B exit gate. Process owner + documented process required before any 7C slice opens.

---

## 16. Measurement Plan

Each track has ONE question that determines whether it landed:

| Track | The Question |
|-------|-------------|
| 1 | Have reps stopped using personal spreadsheets for pipeline triage? |
| 2 | Can a rep build and send a complete quote package in under 10 minutes without typing a tax rate? |
| 3 | Can a manager walk into a meeting knowing which deals are real and which are stage theater? |
| 4 | Can a driver complete a full delivery workflow from their phone without calling the office? |
| 5 | Does ownership open `/executive` every morning before email? |
| 6 | Do customers check their portal before calling the dealership? |
| 7 | Can a rep walk into a customer meeting with a better theory of the deal than the customer's own operations team? |

---

## 17. What This Document Is Not

- **Not a capacity plan.** Does not specify headcount, designer, ML, or infra resourcing.
- **Not a contract with ownership.** Business tradeoffs (accelerate, defer, kill) belong to ownership.
- **Not immutable.** Every track ends with an exit audit. Exit audits change the roadmap.
- **Not a Paperclip ticket map.** QUA ticket references are maintained separately in the project board.

---

## 18. Where to Start

Open this file. Go to §3 Track 1, Slice 1.1. That's the next delivery.
