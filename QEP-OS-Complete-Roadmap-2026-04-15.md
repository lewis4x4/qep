# QEP OS — Complete Roadmap

**Date:** 2026-04-15
**Audience:** Leadership, product, engineering, field team
**Purpose:** Single-page view of what has been built and what is left
**Source of truth:** `QEP-OS-Master-Roadmap.md` in the `lewis4x4/qep` repo
**Production Supabase project:** `iciddijgonywtxoelous`

---

## Executive Summary

QEP OS is the moonshot operating system for equipment + parts sales and
rental. The roadmap is organized into **7 Tracks**. Tracks 1 through 6 are
**code-shipped on `main`** — every slice has been built, reviewed, and pushed
to production code, and every commit has passed our build gates
(`bun run migrations:check`, `bun run build`, unit tests). Track 7 — the
moonshot operating surfaces that make QEP OS category-defining — is
**in progress**: most surfaces exist as pages in the app, with depth per
surface varying.

Code-shipped is not the same as "100% live in the business." Eight items
need a one-time observation on the production system (cron fired, ≥90 days
of data accrued, mobile viewport confirmed, Stripe webhook end-to-end) to
move the corresponding tracks from **code-shipped** to **fully closed**.
Those checks are listed at the end of this document and take about an hour
of operations time to clear.

---

## Headline Status

| Track | Description | Build status | Full closure |
|-------|-------------|:---:|:---:|
| **1** | Command Center Completion | ✅ Code shipped | ⚠️ 2 runtime gates |
| **2** | Core Business Workflows (Quote, Pipeline, Post-Sale) | ✅ Code shipped | ⚠️ 1 runtime gate |
| **3** | Intelligence Layer (DGE, Health, Forecast) | ✅ Code shipped | ⚠️ 1 runtime gate |
| **4** | Field & Mobile Operations | ✅ Code shipped | ⚠️ 2 runtime gates |
| **5** | Executive & Management | ✅ Code shipped | ⚠️ 1 runtime gate |
| **6** | Customer Portal & Payments | ✅ Code shipped | ⚠️ 1 runtime gate |
| **7A** | Moonshot — Seam Layer + Operating Surfaces | 🟡 In progress (25 / 27 pages on disk) | — |
| **7B** | Moonshot — The Outward Turn | 🟡 In progress (24 / 24 pages on disk; depth varies) | — |
| **7C** | Moonshot — Hidden Forces | 🔒 Ethics-gated; not opened | — |

Foundations (Security Lockdown, Schema Hardening, QRM Phase 0 Substrate,
Phase 1 Command Center Spine) are all ✅ complete.

---

## Part 1 — What Has Been Built

### Track 1 — Command Center Completion ✅

The live QRM Command Center at `/qrm`. Replaces the legacy hub page.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 1.1 Revenue Reality Board | Open pipeline, weighted revenue, closable 7d/30d, at-risk, margin-at-risk, stalled quotes, blocker breakdown. DGE-blended close probability. | ✅ |
| 1.2 Dealer Reality Grid | 6-tile operational radar: quotes, trades, demos, traffic/deliveries, rentals, service escalations. | ✅ |
| 1.3 Quote Velocity Center | `/qrm/command/quotes` — creation time, aging, presentation lag, conversion pressure. | ✅ |
| 1.4 Approval Center | `/qrm/command/approvals` — margin flags, deposit exceptions, trade approvals. One-click approve/deny with audit trail. | ✅ |
| 1.5 Blocker Board | `/qrm/command/blockers` grouped by blocker type with resolver CTAs. | ✅ |
| 1.6 Relationship & Opportunity Engine | Heating up, cooling off, competitor mentions rising, fleet replacement, silent key accounts. | ✅ |
| 1.7 Knowledge Gaps + Absence Engine | Per-rep knowledge-gap attribution; nightly manager-only absence scoring. | ✅ |
| 1.8 Executive Intelligence Layer v1 | Role-gated section for elevated roles. | ✅ |
| 1.9 `/qrm` route cutover | Legacy `QrmHubPage` deleted. | ✅ |

### Track 2 — Core Business Workflows ✅

The revenue workflow spine: Quote Builder, Pipeline, Tax & Incentives, Price
Intelligence, Post-Sale automation.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 2.1a Manual Catalog | CSV bulk-import admin UI. Catalog adapter with IntelliDealer fallback. | ✅ |
| 2.1b Three Entry Modes | Voice, AI Chat, Traditional Form. Legacy 1,628-line monolith deleted this session. | ✅ |
| 2.1c Financing Preview | 3 side-by-side scenarios from rate matrix (cash, 60-mo finance, 48-mo lease). | ✅ |
| 2.1d Trade-in Pull-through | Pre-populate trade section from `trade_valuations`. | ✅ |
| 2.1e Margin Check | Waterfall visualization at review step. "Requires Iron Manager Approval" state below 10%. | ✅ |
| 2.1f Proposal PDF | 4-page branded proposal via `@react-pdf/renderer`. | ✅ |
| 2.1g Auto-Send | Quote + photos + brochure + credit app + video in one "Send Package" action (via Resend). | ✅ |
| 2.1h E-Signature | Signature capture with name + IP + timestamp + document hash. State machine: draft → sent → viewed → signed. Guarded against short-circuits. | ✅ |
| 2.2 Tax & Incentive Intelligence | Auto-computed tax per jurisdiction. Manufacturer incentives auto-applied. Section 179. Rep never types a tax rate. | ✅ |
| 2.3 Price Intelligence | Price file import (CSV / XLSX) → impact analysis → auto-drafted re-quote emails. Yard-first sourcing. | ✅ |
| 2.4 Pipeline Board Polish | Intra-column reorder via drag + `sort_position` column + reorder RPC. Multi-select drag (Shift/Cmd click). Visual gate rejection. Analytics overlay: avg days, conversion, bottleneck, velocity. | ✅ |
| 2.5 Post-Sale Automation | 2 PM prospecting nudge (daily pg_cron → managers get notified about reps off-target). Voice → escalation pipeline: negative-sentiment voice captures auto-create escalation tickets with LTV-weighted severity. | ✅ |

### Track 3 — Intelligence Layer ✅

Makes the Deal Genome Engine visible, builds the nervous system, surfaces
health / attribution / forecasting.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 3.1 DGE Intelligence Cockpit | 3 scenario cards on every deal (Conservative / Balanced / Aggressive) + margin waterfall + 14-variable "why this scenario" breakdown + learning loop that tracks advisor picks vs. deal outcomes. | ✅ |
| 3.2 Predictive Visit List | Nightly generator. 10 customers ranked by overdue follow-ups, fleet replacement windows, seasonal demand, competitive displacement, incentive windows. | ✅ |
| 3.3 Live Nervous System | Cross-department health score. Any deal/service/parts/AR/voice change triggers async recompute. Health pill on every company/contact/deal card. | ✅ |
| 3.4 AR Credit Blocking | Database-level trigger auto-blocks credit-extended/financed/rental-risk deals when AR aging exceeds threshold. Cash deals pass through. Override requires reason + approver + time window. | ✅ |
| 3.5 Customer Lifecycle Timeline | First contact → first quote → first purchase → first service → NPS → churn signals. Horizontal timeline view per company. | ✅ |
| 3.6 Revenue Attribution | Touch-chain model (first-touch, last-touch, linear, time-decay). Nightly compute cron. Surfaces voice-to-QRM revenue contribution. | ✅ |
| 3.7 Ownership Intelligence Dashboard | Margin by rep/category/month, weighted-value + velocity pipeline intelligence, 30/60/90 forecast. | ✅ |
| 3.8 Forecast Confidence | Confidence bands, bias, assumption quality. Needs 90 days of Prediction Ledger data to fully stabilize. | ✅ (see §Runtime) |

### Track 4 — Field & Mobile Operations ✅

Equipment intake, PDI, driver workflows, rental returns, payment validation,
SOP Engine. All mobile-first.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 4.1 Equipment Intake Kanban | 8-stage board with dnd. Photo gates enforced per stage. Mobile: horizontal scroll + snap-to-column. | ✅ |
| 4.2 PDI Tap-Through Checklist | Mobile tap-through with camera for photo evidence. Uploads to Supabase Storage. Blocks stage progression until complete. | ✅ |
| 4.3 Traffic Ticket + Driver Workflow | Color-coded status, auto-creation at stage 18, driver mobile view with GPS / signature / photos. | ✅ |
| 4.4 Rental Return Branching | Wizard: Inspection → Decision → Clean path (refund) OR Damaged path (work order → charge → balance/refund). | ✅ |
| 4.5 Payment Validation + GL Auto-Suggest | `validate_payment()` before processing with pass/fail + rule. GL routing from rules with suggested code + explanation. | ✅ |
| 4.6 SOP Engine | Ingest (pdf/docx/md → structured steps). Skip events from pipeline stage transitions. Per-rep / team / step compliance rollup. Contextual nudge banner on pipeline cards. SOP editor for managers. False-positive protection. | ✅ |

### Track 5 — Executive & Management Layer ✅

The leadership operating room at `/executive`. Real-time, action-ready,
never a passive dashboard.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 5.1 Canonical Route + Front Door | `/executive` live; `/exec` aliases; overview above CEO / CFO / COO lenses. | ✅ |
| 5.2 Leadership Pulse | Business posture, cross-lens alert pressure, stale-metric confidence, lens previews. | ✅ |
| 5.3 Deep Role Rooms | CEO room (growth, concentration, branch, movers, expansion/churn). CFO room (cash wall, AR integrity, margin leakage, payment exceptions). COO room (execution board, backlog recovery, logistics drag). | ✅ |
| 5.4 Intervention Graph | Unified queue of alerts + exceptions + data-quality items. "What solved this last time" memory. Owner-assigned follow-through. | ✅ |
| 5.5 Forecast Scenario Layer | Confidence bands, downside/upside scenario cards, quote-expiration revenue risk. | ✅ |
| 5.6 Board Packet & Briefing | Daily briefing upgrade. Weekly packets, role-specific templates, board-ready summary mode. | ✅ |
| 5.7 Iron Role Command Centers | Iron Manager / Advisor / Woman / Man dashboards routed on login. **Now with Supabase Realtime** — dashboards update within ~300 ms when anything they care about changes. | ✅ |
| 5.8 Data Quality Nightly Audit | Equipment without owner, missing make/model, stale telematics, unclassified docs, quotes lacking tax jurisdiction. | ✅ |
| 5.9 Exception Inbox | Cross-functional human work queue for tax failures, unmatched price rows, AR overrides pending, Stripe mismatches, geofence conflicts, etc. | ✅ |

### Track 6 — Customer Portal & Payments ✅

The customer-facing operating room. Log in, see fleet, pay invoices, review
quotes, read documents — all separate from the internal operator login.

| Slice | What it does | Status |
|-------|--------------|:---:|
| 6.1 Portal Auth + Fleet Dashboard | Separate customer login. Fleet dashboard with warranty status, service history, maintenance schedules. | ✅ |
| 6.2 Service Request + Parts Ordering | Photo upload, department routing, urgency levels. Parts browsing with AI-suggested PM kits. One-tap reorder. | ✅ |
| 6.3 Invoice / Payment + Stripe | Outstanding invoices, balance due, payment history, statement download. Stripe Elements. Webhook → AR mark-paid → health score recompute. | ✅ |
| 6.4 Quote Review + E-Signature | View proposal, accept/reject with e-signature from customer side. | ✅ |
| 6.5 Document Library | `customer_documents` with per-document visibility control. Portal shows only `visible_to_portal = true`. | ✅ |
| 6.6 Portal Fleet Mirror | Customer sees their iron on a T3-grade map with per-asset service bar. RLS enforces customer isolation. | ✅ |
| 6.7 Portal Event Consistency | Every portal-facing status reads from a single canonical state machine. Stage labels are curated translations, never raw jargon. | ✅ |
| 6.8 Customer Notifications | Push / email on service status change, parts ship, new quote, maintenance due, new matching equipment. | ✅ |

---

## Part 2 — What Is Left to Build

### 2A. Runtime Verification (Tracks 1–6 closeout)

The code is live; these 8 observations confirm the live system actually
exhibits the behavior the roadmap's exit gate requires. Each is a one-time
check. Track: the corresponding slice moves from "code-shipped" to "fully
closed" once the check is signed off and recorded in
`docs/operations/runtime-verification.md`.

| # | What to verify | Tracks it closes |
|---|---------------|:---:|
| R1 | Absence Engine has produced ≥7 consecutive nightly rows with non-zero events; a manager can open the review surface and see the data | 1.7 |
| R2 | The 2 PM prospecting-nudge cron fires and writes to `crm_in_app_notifications`; a voice note with a complaint produces an `escalation_tickets` row with LTV-weighted severity | 2.5 |
| R3 | `min(predicted_at) from qrm_predictions` is ≥90 days before today (forecast confidence bands stabilize at that point) | 3.8, 5.5 |
| R4 | All `/ops/*` surfaces pass a 390 px viewport sweep on iPhone SE and iPhone 15 Pro Max | 4.1–4.4 |
| R5 | ≥1 real published SOP has `sop_skip_events` tied to real pipeline activity (not seed data) | 4.6 |
| R6 | A test Stripe payment runs end-to-end: `stripe_events` → `portal_payments` → invoice balance = 0 → health score recomputes within 5 seconds | 6.3 |
| R7 | Open the Iron Manager dashboard; in a second window move a deal stage; confirm the manager dashboard invalidates + re-renders within ~300 ms | 5.7 |
| R8 | Confirm Flow Bus dual-write side-effects are retired — no code path writes to both the legacy Flow Engine table and `flow_bus_events` | Track 1 exit gate |

### 2B. Track 7A — Seam Layer + Operating Surfaces 🟡

The operating surfaces that extend the command center into a full operating
system. Pages exist on disk for 25 of 27 slices (the other 2 live inside
other features). Content depth per page varies — an audit before calling
this sub-phase "done" is needed.

| Slice | Surface | On disk |
|-------|---------|:---:|
| 7A.1 Handoff Trust Ledger | Cross-role scoring at the seam between roles (manager-gated) | ✅ `/executive/handoffs` |
| 7A.2 Time Bank | Visible per-deal/account/rep time balance | ✅ |
| 7A.3 Account Command Center | `/qrm/accounts/:id/command` — deals, fleet, service, parts, health, AR | ✅ |
| 7A.4 Branch Command Center | `/qrm/branches/:id/command` — revenue, readiness, logistics, rental, service-linked sales | ✅ |
| 7A.5 Territory Command Center | Per-territory routing and visit priority | ✅ |
| 7A.6 Mobile Field Command | Mobile-first field OS at `/m/qrm` | ✅ |
| 7A.7 Visit Intelligence | Pre-visit briefing: talking points, service issues, competitor mentions, likely objections | ✅ |
| 7A.8 Trade Walkaround | Guided capture — required photos, condition prompts, AI scoring, instant valuation | ✅ |
| 7A.9 Machine Lifecycle | First-class lifecycle state model | ✅ |
| 7A.10 Machine Command Page / Asset 360 | Single page joining everything QEP knows about one machine (service, parts, deals, telematics, docs, trade-up recommendation) | ✅ |
| 7A.11 Inventory Pressure Board | Aged, hot, under-marketed, price-misaligned units | ✅ |
| 7A.12 Iron in Motion Register | Every machine not in yard, not yet delivered — carrying cost, decay rate, risk | ✅ |
| 7A.13 Rental Command Center | Dedicated rental operations | ✅ |
| 7A.14 Service-to-Sales | Recurring breakdowns → replacement/upgrade motion | ✅ |
| 7A.15 Parts Intelligence | Purchasing patterns as demand signals | ✅ |
| 7A.16 Deal Room | Per-opportunity operating room (notes, scenarios, approvals, tasks) | ✅ built into deal detail |
| 7A.17 Deal Autopsy | Structured post-mortem on closed-lost deals | ✅ |
| 7A.18 Exception Handling | First-class surfaces for revivals, failed deliveries, damaged demos, rental disputes, payment exceptions | ✅ |
| 7A.19 Customer 360 Timeline | Cinematic operating history per relationship | ✅ built into company/account detail |
| 7A.20 Opportunity Map | Geographic overlay of open revenue, visit targets, rentals, trades | ✅ |
| 7A.21 Revenue Rescue Center | Revenue saveable this week. Triage view | ✅ |
| 7A.22 Competitive Displacement Center | Where competitors are weak, how to take share | ✅ |
| 7A.23 Operator Intelligence | What machine operators say, need, complain about, prefer | ✅ |
| 7A.24 Post-Sale Experience Center | Onboarding quality, first-90-day friction, attachment adoption | ✅ |
| 7A.25 Workflow Audit | Where processes break, stall, reroute, silently fail | ✅ |
| 7A.26 SOP Compliance + Folk Workflow Library | Compliance and folk workflow as two sides of the same surface | ✅ |
| 7A.27 Rep Reality Reflection | Private, rep-owned mirror. Never visible to managers | ✅ |

**7A exit condition the roadmap specifies:** Handoff Trust Ledger has ≥30
days of data, Account Command Center is the default drill-down target
system-wide. Depth audit per-slice is the remaining work.

### 2C. Track 7B — The Outward Turn 🟡

The intelligence surfaces that think about the customer more than the
internal operation. Pages exist on disk for all 24 slices; depth per page
varies.

| Slice | Surface | On disk |
|-------|---------|:---:|
| 7B.1 Customer Genome | Multi-dimensional customer profile | ✅ |
| 7B.2 Customer Operating Profile | Work type, terrain, brand preference, budget behavior, buying style | ✅ |
| 7B.3 Fleet Intelligence | Owned machines, age, hours, attachment gaps, replacement windows | ✅ |
| 7B.4 Relationship Map | Who signs, influences, operates, blocks, decides | ✅ |
| 7B.5 White-Space Map | Revenue the dealership should be capturing but isn't | ✅ |
| 7B.6 Rental Conversion Engine | Repeat renters → purchase motion. **Contrarian Bet #1.** | ✅ |
| 7B.7 AI Deal Coach | Per-opportunity coaching | ✅ |
| 7B.8 AI Branch Chief | Per-branch diagnostic agent | ✅ |
| 7B.9 AI Customer Strategist | 30/60/90 account plans, white-space plays | ✅ |
| 7B.10 AI Operations Copilot | Incomplete deals, misrouted billing, delayed deposits | ✅ |
| 7B.11 AI Owner Briefing | Morning command note — "Certain. Probable. Suspected. Don't act on this yet." | ✅ `/executive/owner-briefing` |
| 7B.12 Replacement Prediction | Fleet units entering replacement windows in 30/60/90/180 days | ✅ |
| 7B.13 Competitive Threat Map | Deere/CAT/others gaining/losing by account, rep, branch | ✅ |
| 7B.14 Seasonal Opportunity Map | Time-of-year demand shifts as routeable opportunity | ✅ |
| 7B.15 Learning Layer | Wins, losses, workflows, patterns → dealership memory | ✅ |
| 7B.16 Cross-Dealer Mirror | Projected customer experience inside competitor's CRM | ✅ |
| 7B.17 Cashflow Weather Map | Customer float, payment cadence, seasonal cash | ✅ |
| 7B.18 Decision Room Simulator | Literal humans in the decision room | ✅ |
| 7B.19 Decision Cycle Synchronizer | Per-customer purchasing rhythm | ✅ |
| 7B.20 Ecosystem Layer | Lenders, insurers, transport, factory reps, auctioneers | ✅ |
| 7B.21 Reputation Surface | Reviews, forums, auctioneer commentary, mechanic gossip | ✅ |
| 7B.22 Rep as SKU | Every rep modeled as a packaged offering | ✅ |
| 7B.23 Death and Exit Register | End-of-relationship events | ✅ |
| 7B.24 Unmapped Territory | Map of provable absence | ✅ |

**7B entry condition:** 7A complete + Prediction Ledger ≥90 days (see R3
above).

**7B exit condition the roadmap specifies:** every AI surface reads/writes
the Prediction Ledger, every AI output has a visible confidence label and
a working trace.

### 2D. Track 7C — Hidden Forces 🔒

The most ambitious and ethically sensitive slices. **Ethics review required
before any 7C slice opens.** Currently none opened — this is intentional,
not a gap.

| Slice | Surface | Notes |
|-------|---------|------|
| 7C.1 Trust Thermostat | Post-hoc receipt (not real-time gauge) | **Contrarian Bet #3.** Currently marked `blocked` pending entry-check |
| 7C.2 Machine Fate Engine | Per-unit retail / rental / transfer / auction recommendation | |
| 7C.3 Silence Map | Absence of expected noise as signal | |
| 7C.4 Customer Gravity Field | With "Permission Slip" for formal deprioritization | **Contrarian Bet #4** |
| 7C.5 Rep Mythology Layer | Research-gated | |
| 7C.6 Pre-Regret Simulator | Exact form of shame 30 days later | |
| 7C.7 Internal Market for Attention | Unresolved issues compete for organizational focus | |
| 7C.8 Ruin Prevention Mode | Throttles optimism on fragile risk concentrations | |
| 7C.9 Shadow Org Chart | Who actually moves work | |
| 7C.10 Ghost Buyer | Shape-only, never identity | **Contrarian Bet #5** |
| 7C.11 Institutional Grief Archive | Deals that hurt, customers who left | |
| 7C.12 Body of the Operator | Research-gated | |
| 7C.13 Tempo Conductor | Meta-surface — hierarchy + gravity + rhythm | |

**7C entry condition:** 7B shipped + Honesty Calibration run for a full
fiscal year + ethics review signed.
**Process owner:** Brian Lewis.

### 2E. Cross-Cutting Items (still on the list)

- **Slice 2.1a admin CSV is direct-insert.** The catalog import page writes
  directly to `catalog_entries` rather than routing through the richer
  `price-file-import` edge function. That means CSV-ingested catalog
  updates don't fire the price-intelligence impact pipeline (price change
  events, affected quote analysis). Functional but not ideal.
- **Mobile viewport sign-off** (see R4). Design-led pass across the four
  `/ops/*` surfaces on two phone viewports.
- **Track 7A per-surface depth audit.** The pages exist but the roadmap
  specifies deeper behavior per slice (e.g. Machine Command Page should
  include trade-up recommendation, Iron in Motion should track decay rate).
  A slice-by-slice pass would tell us which 7A pages are "shell vs. full."
- **Runtime Verification Checklist** (the 8 items above). One-hour
  operations task; closes Tracks 1–6 completely.

---

## Part 3 — Principles That Apply to Everything

These are not deliverables — they are the standards every slice must meet.
Pulled directly from the Master Roadmap cross-cutting requirements.

- **Mobile-first.** Every operator-facing page works at 390 px (iPhone SE).
- **Zero-blocking integrations.** Stripe, tax lookups, price files,
  telematics — every one has a manual fallback that keeps the workflow
  usable when the external service is unavailable.
- **AI confidence indicators.** Every AI recommendation is written to the
  Prediction Ledger, carries a visible confidence, and is traceable at
  `/qrm/command/trace/:predictionId`.
- **Playbooks pattern.** Every page that reveals risk offers a one-click
  action: draft email, create task, open quote, escalate, reorder, SOP
  remediation, manager override.
- **Kill criteria.** Surfaces with no users in 30 days are deferred.
  Surfaces that degrade the Honesty Calibration Index are paused
  immediately — no exceptions.

---

## Part 4 — How Success Is Measured

The Master Roadmap names one question per track that determines whether
it landed. Answering these in the field is how we know a track is "done
for the operator," not just "done in the code."

| Track | The question |
|-------|--------------|
| 1 | Have reps stopped using personal spreadsheets for pipeline triage? |
| 2 | Can a rep build and send a complete quote package in under 10 minutes without typing a tax rate? |
| 3 | Can a manager walk into a meeting knowing which deals are real and which are stage theater? |
| 4 | Can a driver complete a full delivery workflow from their phone without calling the office? |
| 5 | Does ownership open `/executive` every morning before email? |
| 6 | Do customers check their portal before calling the dealership? |
| 7 | Can a rep walk into a customer meeting with a better theory of the deal than the customer's own operations team? |

---

## Part 5 — How to Read This Document

- **✅ Code shipped** — the feature has a commit on `main`, the edge
  function or page is wired, and the build gates (`bun run migrations:check`,
  `bun run build`, unit tests) all pass.
- **⚠️ Runtime gate** — the code is live, but the roadmap's exit gate
  requires observing the live system (cron fired, ≥90 days of data,
  viewport check, end-to-end flow). See §2A.
- **🟡 In progress** — files exist on disk but depth per surface has not
  been audited against the spec.
- **🔒 Gated** — cannot start until an external condition is met (ethics
  review, prerequisite data accrual).

**Source of truth:** Every claim in this document is checkable. Commit
SHAs for each slice are in the main roadmap
(`QEP-OS-Master-Roadmap.md §1`). Runtime gates are defined with exact
queries / interactions in `QEP-OS-Master-Roadmap.md §19`.

---

## Part 6 — Open Decisions

These are product calls that haven't been made yet and will affect the
roadmap once decided.

- **Meaningful Contact Definition.** Draft exists; awaiting owner sign-off
  on weight table, exclusions, anti-gaming guardrails, and protected
  account override policy before Phase 2 calculation engine ships.
- **Mobile Field Command — native or web?** Deferred to 7A.6 planning.
  Default is Web PWA.
- **Phase 5 Ethics Review.** Process owner is Brian Lewis. Documented at
  `docs/operations/phase-5-ethics-review.md`. Required before any 7C slice
  opens.

---

*Prepared for team review on 2026-04-15. When this document and
`QEP-OS-Master-Roadmap.md` disagree, the master roadmap is the source of
truth.*
