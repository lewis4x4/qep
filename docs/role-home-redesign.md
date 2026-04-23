# Role-Home Redesign (Phases 3–5)

**Date:** 2026-04-23
**Upstream:** [role-home-feature-audit.md](role-home-feature-audit.md), [role-home-workflow.md](role-home-workflow.md)
**Output:** Revised role-home specs, grounded in what the codebase actually does, reconciled against the 2×3 mockup, with explicit before/after per role.
**Out of scope:** Visual mockups, component code. This pass nails the *what*.

---

## Phase 6 — Two-minute executive summary

**The biggest change from the mockup:** there are **seven** roles, not six. The mockup's "Parts Manager" screen conflates two real jobs — the counter person (Juan) who pastes serials all day, and the parts manager (Norman) who plans inventory. The codebase already has both as distinct `iron_role` values with distinct seeded layouts. The redesign honors that split.

**The second-biggest change:** Commission MTD is a placeholder, not a metric. The widget that renders it has a literal comment saying commission rules are undefined. Every instance of Commission MTD comes off every home screen in this pass. No rep is being shown a number that isn't real.

### Per-role summary — 3 actions and the hero widget each screen is organized around

| Role | Primary action | Secondary action | Tertiary action | Hero widget |
|---|---|---|---|---|
| **Sales Manager** (Rylee) | Open Approvals Queue (/qrm/approvals) | New Quote (coverage) | Search Rep or Deal (Cmd+K) | Pipeline by Advisor |
| **Sales Rep** (Cole) | New Quote | Voice Note | My Follow-Ups Today | My Quotes — by status |
| **Parts Counter** (Juan) | Serial-First Lookup (inline) | New Parts Quote | Open Drafts | Serial-First search + three-panel snapshot |
| **Parts Manager** (Norman) | Review Replenishment | Adjust Reorder Min/Max | Issue Purchase Order | Demand Forecast × Inventory Health split |
| **Owner** (Ryan) | Ask Iron | Open Pipeline | Monthly P&L | Morning Narrative + Revenue Pace ribbon |
| **Deal Desk** (Tina/Angela) | Process Credit App | Record Deposit | Convert Quote → Order | Order Processing Queue (SLA-sorted) |
| **Prep / Service** (Marcus) | Next Prep Unit | Complete PDI | Mark Parts Received | Prep Queue — status editable inline |

### The seven things this redesign unlocks that the mockup didn't

1. **Serial-first becomes an input, not a widget card.** Juan's #1 action is a paste field at the top of his screen, not a card in a grid.
2. **My Quotes with status (draft/sent/viewed/approved/declined/expired)** becomes the rep's hero widget. No more Commission MTD.
3. **Approval queue gets SLA pressure above the fold** for both Sales Manager AND Deal Desk, with different sort criteria per role.
4. **Parts Counter and Parts Manager get distinct screens** that stop pretending they're one job.
5. **Owner screen becomes ceremonial** — no transactional cards; narrative + three read-only ribbons.
6. **Prep/Service gets an editable lifecycle stage column** on the Prep Queue (one-click `current_stage` advance).
7. **Customer Search drops off every non-transactional home screen** — Cmd+K is always one keystroke away, so the slot is better spent.

---

## Phase 5 approach: reconciliation method

For each role the doc shows:
- **SURVIVE** — widgets from the earlier 2×3 mockup that still earn their place.
- **REMOVE** — widgets that were aesthetic or that duplicate another role's concern.
- **ADD** — widgets the real workflow requires that were missing.
- **RESHAPE** — widgets with the right *idea* but the wrong *form factor* (e.g. Serial Lookup → input field, not a card).

Reconciliation is done inline in each role's section.

---

## Role: Sales Manager (`iron_manager`) — Rylee

### Top bar quick actions (right side, next to JUMP TO)
1. **Approvals** → `/qrm/approvals` → kbd `g a` *(keyboard shortcut gap — not built; flag as nice-to-have, not required)*
2. **New Quote** → `/quote-v2`
3. Cmd+K OmniCommand covers search — no third top-bar button. Keep density low.

### 01 Narrative
Pull from `floor-narrative` edge fn with role=`iron_manager`. Data signals: approvals count, margin-breach count, idle reps, stalled-deal count. Example shape: *"7 approvals waiting; 2 breach 8% margin floor; 1 rep silent 2+ days."*

### 02 Actions (exactly 3 cards)
1. **Hero — OPEN APPROVALS** → `/qrm/approvals`
   - Hero number: count of pending + escalated cases (`quote_approval_cases.status IN ('submitted','assigned','escalated')`)
   - Aggregate: total $ value
   - Urgency: `{n} breach margin floor` + oldest age in days
2. **NEW QUOTE** → `/quote-v2`
   - No hero number (pure-action card)
   - Aggregate: "Coverage for out reps"
3. **NUDGE REP** → opens rep-picker → deep link to rep's deals filtered by stalled
   - Hero number: count of reps with no activity in 2+ days (from `touches` table)
   - Aggregate: total deal $ at risk across those reps

### 03 The Floor — body

**Hero widget (largest area, ~60% width):**
- **Pipeline by Advisor** (`iron.pipeline-by-rep`) — stage-breakdown table with rep column, total, w/l rate, 7d trend sparkline, "Open Pipeline" action per row.
- **Note:** currently workspace-wide (Surprise S12). Add a "My Team" toggle chip that filters by reporting tree **once the app-layer filter is built**. Until then, leave it workspace-wide and document the limitation in the widget.

**Right rail (≤ 2 supporting widgets):**
1. **Open Approvals Queue** (`iron.approval-queue`) — top 5 pending, sortable by age × margin × value. Row-level Approve/Reject/Open buttons.
2. **Margin Trend** (NEW — derive from `margin_analytics_view`) — sparkline of gross margin % MTD vs trailing 30d. Replaces the mockup's Commission MTD card which was cross-role noise.

**Below the fold (≤ 1 full-width table):**
- **Aging Deals Across Team** — `qrm_deals` filtered by `stage_changed_at < now() - interval '5 days'`. Columns: deal, customer, advisor, value, GM%, stage, days in stage, next step, Actions (Approve / Call / Reassign).

### Sidebar nav (ordered by frequency)
1. Approvals — `/qrm/approvals`
2. QRM Pipeline — `/qrm`
3. Deal Economics — `/admin/deal-economics`
4. Flow Admin — `/admin/flow`
5. Team Activity — `/qrm/activities`

### Features this role uses that are NOT on the home screen
- Deal Detail (reached via approval row or pipeline row)
- Account 360 / Customer Detail
- Deal Room / Decision Room
- Flow Admin (approval policy tuning)
- Reports / Flare artifacts

### Gaps
- **GAP:** No team-scoped "my reps' deals" filter in RLS helpers (Surprise S12). Pipeline widget is workspace-wide. Needs app-layer logic before the "My Team" chip can ship.
- **GAP:** No keyboard shortcut to approve/reject from the queue row. Nice-to-have.

### Phase 5 — reconciliation with 2×3 mockup

| Mockup widget | Verdict | Reason |
|---|---|---|
| Pipeline by Advisor | **SURVIVE** | Correct hero for this role per product brief. |
| Open Approvals | **SURVIVE** | Primary daily action. |
| New Quote | **SURVIVE** (promoted to top bar + action card) | Frequent coverage action. |
| Search Customer | **REMOVE** | Cmd+K is one keystroke; don't spend a slot on it. |
| Aging Fleet | **REMOVE** | Owner concern, not manager concern. Surprise S6. |
| Commission MTD / Leaderboard (#3 of 8) | **REMOVE** | Placeholder (Surprise S4). No commission table. |
| Morning Brief narrative | **SURVIVE** (as 01 Narrative) | Universal. |
| — | **ADD** Margin Trend | Real manager concern, not rep-level noise. |
| — | **ADD** Aging Deals Across Team (full-width) | Direct feeder for "nudge a rep" action. |

---

## Role: Sales Rep (`iron_advisor`) — Cole / David

### Top bar quick actions
1. **New Quote** → `/quote-v2` (MUST HAVE per product brief)
2. **Voice Note** → `/voice-qrm` (MUST HAVE per product brief; already built)
3. Cmd+K covers search.

### 01 Narrative
Role=`iron_advisor`. Signals: quotes awaiting reply, follow-ups due today, recent viewed quotes (buying signal). Example: *"3 follow-ups due today, 1 quote viewed by Jensen Ranch at 4pm, 1 overdue from Monday."*

### 02 Actions (exactly 3 cards)
1. **Hero — TODAY'S FOLLOW-UPS** → `/sales/today` or `/qrm/my/reality`
   - Hero number: count of due-today follow-ups (`follow_up_touchpoints.due_at::date = today`)
   - Aggregate: tied-up deal $ value
   - Urgency: `{n} overdue · {n} due today`
2. **NEW QUOTE** → `/quote-v2`
   - Hero number: blank (pure action)
   - Aggregate: "Start from voice or scenario"
   - Sub-route chip: "Dictate instead →" links `/voice-quote`
3. **MY PIPELINE** → `/qrm/deals?assigned_to=me`
   - Hero number: count of active deals assigned to me
   - Aggregate: total $ value
   - Urgency: `{n} at decision stage`

### 03 The Floor — body

**Hero widget (largest area):**
- **My Quotes — by status** (NEW — reshape of existing `sales.action-items`) — grouped rows: Draft | Sent | Viewed | Approved | Declined | Expired. Each row: customer, product summary, value, days since sent, action. **This is the MUST HAVE from the product brief.**

**Right rail (≤ 2 supporting widgets):**
1. **AI Briefing** (`sales.ai-briefing`) — morning brief + next best actions.
2. **Recent Activity** — last 5 touches this rep logged (`qrm_activities` filtered to me). Keeps "what was I doing" visible. Also shows quote-viewed signals when a customer opens a sent quote.

**Below the fold (≤ 1 full-width table):**
- **My Deal Pipeline** (`iron.pipeline-by-rep` scoped to me OR `qrm.follow-up-queue` expanded) — deals assigned to this rep with stage, next step, days in stage, action column. Sortable.

### Sidebar nav
1. Today — `/sales/today`
2. My Quotes — `/quotes?assigned=me`
3. My Pipeline — `/qrm/deals?assigned=me`
4. Customers — `/sales/customers`
5. Voice History — `/voice/history`
6. My Reality — `/qrm/my/reality` (rep reflection surface)

### Features NOT on the home screen
- Deal Detail / Deal Room / Deal Coach
- Account 360
- Decision Room (rare)
- Customer Strategist / Account Genome / Ecosystem map (deep-dive surfaces)

### Gaps
- **GAP:** No dedicated `My Quotes` Floor widget that groups by status today. The data is in `quote_packages.status` — needs a new widget (Phase 2 flagged this). **This is the most important widget to build for this role.**
- **GAP:** Commission MTD rules don't exist (Surprise S4). Not designing around it.

### Phase 5 — reconciliation

| Mockup widget | Verdict | Reason |
|---|---|---|
| Today's Follow-Ups | **SURVIVE** (promoted to Action card) | Primary daily anchor. |
| New Quote | **SURVIVE** (top bar + action card) | MUST HAVE. |
| My Pipeline | **SURVIVE** | Rep's own deals. |
| My Deals table | **SURVIVE** (below fold) | Supports stage transitions. |
| Commission MTD | **REMOVE** | Product brief explicit; data fake. |
| Leaderboard (#3 of 8) | **REMOVE** | No commission/leaderboard table. |
| Aging Fleet | **REMOVE** | Not a rep concern. |
| Search Customer | **REMOVE** | Cmd+K. |
| Quotes Awaiting Response | **SURVIVE but RESHAPE** | Roll into the new "My Quotes by status" hero widget as the Sent/Viewed row. |
| My Demos This Week | **REMOVE from home** | Move to sidebar; not daily. |
| — | **ADD** My Quotes — by status (hero) | The critical rep widget. |
| — | **ADD** Voice Note top-bar quick action | MUST HAVE. |

---

## Role: Parts Counter (`iron_parts_counter`) — Juan / Bobby

**Not in mockup as a distinct role.** The mockup's "Parts Manager" screen is reshaped here as two screens.

### Top bar quick actions
1. **New Parts Quote** → `/parts/orders/new`
2. **Voice Lookup** → opens Voice Ops modal (keybind `V` already wired in Parts Companion)
3. Cmd+K covers customer search.

### 01 Narrative
Role=`iron_parts_counter`. Signals: unquoted counter inquiries, open drafts, orders ready for pickup. Example: *"4 drafts from yesterday, 3 orders ready for pickup, 2 inquiries unquoted."*

### 02 Actions (exactly 3 cards)

Replace the traditional Action cards pattern for this role: the **primary action is the serial-first input**, which is a different form factor than a card.

1. **PRIMARY — SERIAL-FIRST INPUT** (inline, oversized, not a card)
   - This is **RESHAPED** from a widget card into a wide input field that sits in the 02 ACTIONS band.
   - Paste a serial → 3-panel snapshot rendered below (Machine · Owner · Service state).
   - Implementation already exists at [SerialFirstWidget.tsx](apps/web/src/features/floor/widgets/SerialFirstWidget.tsx) — promote from `size: "wide"` widget to the hero band.
2. **NEW PARTS QUOTE** card → `/parts/orders/new`
   - Hero number: my drafts count
   - Aggregate: total draft value
3. **OPEN DRAFTS** card → `/parts/orders?status=draft&assigned=me`
   - Hero number: drafts older than 24h
   - Aggregate: "pending customer callback"

### 03 The Floor — body

Given the Serial-First input occupies the hero band, The Floor section below it is simpler:

**Hero widget (largest):**
- **Today's Order Status** (`parts.order-status`) — parts_orders grouped by status: Ordered / Shipped / Received / Ready for Pickup. Row-level "Tag Ready" button.

**Right rail (≤ 2):**
1. **Customer Intel on recent paste** (`parts.customer-intel`) — if a serial was just pasted, this panel deepens into that customer's parts history, open deals, preferred parts. Contextual.
2. **My Drafts** (`parts.quote-drafts`) — 5 most-recent unfinished quotes, quick edit.

**Below the fold:**
- **Counter Inquiries Awaiting Quote** — `counter_inquiries` table rendered as a simple table. **WORKFLOW NEEDS per Phase 2: this widget does not exist yet.** Flag as a build-needs, not a design assumption. Leave a placeholder slot in the layout until shipped.

### Sidebar nav
1. Lookup — `/parts/companion/lookup`
2. Queue — `/parts/companion/queue`
3. My Drafts — `/parts/orders?status=draft&assigned=me`
4. Machine Profiles — `/parts/companion/machines`
5. Arrivals — `/parts/companion/arrivals`

### Features NOT on the home screen
- Replenish queue, Demand forecast, Supplier health (Parts Manager's world)
- Pricing Rules (admin-adjacent)
- Post-Sale / Predictive Plays (marketing-adjacent)

### Gaps
- **GAP:** `counter_inquiries` has no Floor widget yet — placeholder. Flag to product.
- **GAP:** One-click "convert draft → invoice" flow not built end-to-end on Floor. Current path requires Deal Desk handoff.

### Phase 5 — reconciliation

| Mockup "Parts Manager" widget | Verdict here (Counter) | Reason |
|---|---|---|
| Reorder Alerts | **REMOVE** from Counter | That's Parts Manager's job. |
| Open Work Orders | **REMOVE** from Counter | Service's world. |
| Aging Inventory | **REMOVE** from Counter | Parts Manager's concern. |
| Top Movers | **REMOVE** from Counter | Analytics, not transactional. |
| Service Parts Hub | **REMOVE** from Counter | Overlaps `iron_man`. |
| Supplier Status | **REMOVE** from Counter | Parts Manager's concern. |
| — | **ADD** Serial-First input (hero band) | #1 counter action per product brief. |
| — | **ADD** Today's Order Status | Transactional anchor. |
| — | **ADD** Customer Intel (contextual) | Uses SerialFirstWidget result. |
| — | **ADD** My Drafts | Counter's "pile." |

---

## Role: Parts Manager (`iron_parts_manager`) — Norman

### Top bar quick actions
1. **Review Replenishment** → `/parts/companion/replenish`
2. **Inventory** → `/parts/companion/intelligence` or `/parts/inventory`
3. **Suppliers** → `/parts/companion/supplier-health`

### 01 Narrative
Role=`iron_parts_manager`. Signals: low-stock count, forecast-risk count, supplier on-time %, lost-sales count. Example: *"12 SKUs below reorder point, 4 at high forecast risk, 1 supplier under 85% on-time."*

### 02 Actions (exactly 3 cards)
1. **Hero — REVIEW REPLEN** → `/parts/companion/replenish`
   - Hero number: `parts_auto_replenish_queue.status = 'triggered'` count
   - Aggregate: total reorder $ estimated
   - Urgency: `{n} critical (stockout < 7d)`
2. **STOCK VARIANCE** → `/parts/companion/intelligence?view=variance`
   - Hero number: SKUs with variance > threshold
   - Aggregate: $ impact
3. **SUPPLIER STATUS** → `/parts/companion/supplier-health`
   - Hero number: suppliers under target on-time
   - Aggregate: count of affected POs

### 03 The Floor — body

**Hero — split two-column (both are daily, both matter):**
- **Demand Forecast** (`parts.demand-forecast`) — next-30-day demand by top SKUs.
- **Inventory Health** (`parts.inventory-health`) — stockout-imminent, dead-stock, days-of-cover.

**Right rail (≤ 2):**
1. **Replenish Queue** (`parts.replenish-queue`) — triggered reorders awaiting approval.
2. **Supplier Health** (`parts.supplier-health`) — top 5 suppliers with on-time %, defect rate, leadtime trend.

**Below the fold:**
- **Lost Sales** (`parts.lost-sales`) — table of customer-requested parts we couldn't fulfill this month, ordered by $ value. Feeds replenishment decisions.

### Sidebar nav
1. Replenish — `/parts/companion/replenish`
2. Inventory Intelligence — `/parts/companion/intelligence`
3. Supplier Health — `/parts/companion/supplier-health`
4. Purchase Orders — `/parts/purchase-orders`
5. Forecasts — `/parts/forecast`
6. Analytics — `/parts/analytics`

### Features NOT on the home screen
- Counter-facing features (that's iron_parts_counter)
- Catalog import (admin)
- Vendor profiles (reference)

### Gaps
- None material. Default layout is tight. Current `iron_parts_manager` default layout in [default-layouts.ts](apps/web/src/features/floor/lib/default-layouts.ts) is very close to this spec.

### Phase 5 — reconciliation (vs mockup's "Parts Manager")

| Mockup widget | Verdict here | Reason |
|---|---|---|
| Reorder Alerts (12 below reorder point) | **SURVIVE as** Replenish Queue | Right concept. |
| Open Work Orders | **REMOVE** | Service's world. |
| Top Movers This Week | **SURVIVE as** part of Inventory Health | Keep as a sub-section, not standalone. |
| Aging Inventory | **SURVIVE as** part of Inventory Health (dead-stock segment) | Keep as sub-section. |
| Service Parts Hub | **REMOVE** | iron_man's concern. |
| Supplier Status | **SURVIVE** | Core to Norman's day. |
| Open Work Orders by Tech | **REMOVE** | iron_man. |
| — | **ADD** Demand Forecast (hero half) | Driver of reorder decisions. |
| — | **ADD** Lost Sales (below fold) | Feeds assortment decisions. |

---

## Role: Owner (`iron_owner`) — Ryan

### Top bar quick actions
1. **Ask Iron** → `/iron` (AI chief-of-staff chat)
2. **Open Pipeline** → `/qrm`
3. (No third — keep density low; owner doesn't live here)

### 01 Narrative
Role=`iron_owner`. Signals: revenue pace vs target, health-score movers (sharp drops), margin compression signals, big-deal moves this week. Example: *"Revenue pace +4% vs target; 2 key accounts dropped 10+ health points; 3 deals >$250K closed this week."*

### 02 Actions (exactly 3 cards — ceremonial, not transactional)
1. **Hero — EXECUTIVE BRIEF** → `/brief/dashboard` (or inline expand of narrative)
   - Hero number: — (pure ceremonial)
   - Aggregate: "Morning overview, 2 min read"
   - Urgency: freshness indicator
2. **APPROVALS AT RISK** → `/qrm/approvals?escalated=true` (owner-only escalation queue)
   - Hero number: cases escalated to owner
   - Aggregate: total $ value
   - Urgency: `{n} breach SLA today`
   - This is the **only transactional action** on this screen, gated to the approval threshold only owner can resolve.
3. **MONTHLY REPORT** → `/admin/deal-economics`
   - Hero number: MTD $ revenue
   - Aggregate: % vs target
   - Urgency: `{n} days remaining`

### 03 The Floor — body

**Hero widget (largest):**
- **Owner Morning Brief** (`exec.owner-brief` or `exec.morning-brief`) — narrative + rolled-up KPIs. Rendered generous, read-first.

**Right rail (≤ 2):**
1. **Revenue Pace** (`exec.revenue-pace`) — MTD/QTD with target line + trend.
2. **Customer Health Movers** (`nervous.customer-health`) — accounts whose score dropped most this week.

**Below the fold:**
- **Deals >$250K** — `qrm_deals` filtered by amount ≥ 250k with advisor, value, GM%, stage, close-date risk. Single scannable table.

### Sidebar nav
1. Brief — `/brief/dashboard`
2. Revenue — `/executive/summary`
3. Approvals (owner-only escalated) — `/qrm/approvals?escalated=true`
4. Margin Health — `/executive/vision`
5. Data Miner — `/executive/data-miner`
6. Handoffs — `/executive/handoffs`

### Features NOT on the home screen
- Anything transactional — owner pivots into another role's view via JUMP TO if they need to do work.
- Deal Detail / Account 360 — reached from a signal, not home-screen.

### Gaps
- None. Product brief: ceremonial tone. This delivers it.

### Phase 5 — reconciliation

| Mockup widget | Verdict | Reason |
|---|---|---|
| Executive Brief / Morning Brief | **SURVIVE** | Hero. |
| Revenue Pace | **SURVIVE** | Daily glance. |
| Margin Health (by product line) | **SURVIVE** (as sub-widget inside Revenue Pace or Deals >$250K) | Could be its own widget but collapses cleanly. |
| Deals >$250K table | **SURVIVE** | Below fold; specific to high-value. |
| Aging Fleet | **SURVIVE but RESHAPE** | Only if tied-up $ is explicitly a cash-flow signal for owner. Otherwise move to operations copilot view. Weak case — consider REMOVE. Decision: remove from Owner home; owner can JUMP TO Operations Copilot if needed. |
| Cash Position | **SURVIVE as** part of Revenue Pace / Monthly Report action | Don't need a standalone widget. |
| Commission Exposure | **REMOVE** | No commission table (Surprise S4). |
| Key Advisors (with commission column) | **REMOVE** | Cross-role noise. If owner wants advisor performance, they JUMP TO Sales Manager view. |
| — | **ADD** Customer Health Movers | Highest-signal owner alert. |

---

## Role: Deal Desk (`iron_woman`) — Tina / Angela

### Top bar quick actions
1. **Credit App** → `/credit/new`
2. **Deposit** → `/deposits/new`
3. **Convert Quote** → `/quotes?status=approved` (triage released quotes awaiting order creation)

### 01 Narrative
Role=`iron_woman`. Signals: order-processing queue depth, credit apps waiting on bureau, SLA breach count, blocked items. Example: *"7 orders in queue (3 over SLA), 3 credit apps awaiting bureau, 2 deposits under minimum."*

### 02 Actions (exactly 3 cards)
1. **Hero — APPROVAL QUEUE** → `/qrm/approvals?role=deal_desk`
   - Hero number: `quote_approval_cases.status IN ('submitted', 'assigned')` assigned to deal desk OR `flow_approvals` with role=deal_desk.
   - Aggregate: total $
   - Urgency: `{n} over SLA (>2h avg target)` — **SLA pressure must be visible above the fold per product brief**.
2. **CREDIT APPLICATIONS** → `/qrm/credit?status=pending`
   - Hero number: apps awaiting underwriting
   - Aggregate: total $ tied up
   - Urgency: `{n} stalled with bureau`
3. **MARGIN REVIEWS** → `/qrm/approvals?filter=margin_exception`
   - Hero number: `qb_margin_exceptions` pending
   - Aggregate: total $
   - Urgency: `{n} below 8%`

### 03 The Floor — body

**Hero widget (largest):**
- **Approval Queue** (`iron.approval-queue` + inline SLA column) — sorted by SLA-remaining ascending. Columns: deal, rep, customer, value, GM%, age, SLA remaining, flags (SLA/Margin/Missing info), Approve/Return/Escalate buttons.

**Right rail (≤ 2):**
1. **Credit Bureau Status** (inline with `iron.credit-applications`) — Experian / Equifax / TransUnion online indicators. This was a standalone card in the mockup but belongs inline as a status strip inside Credit Applications.
2. **SLA Performance** (NEW) — avg decision time today vs 2h target. Derived from `flow_approvals.requested_at` → `flow_approvals.decided_at` delta.

**Below the fold:**
- **Recent Decisions** — last 10 decisions by this workspace's deal desk. Columns: quote, decision (Approved/Returned), by, GM%, decided-at, notes. Writes to `quote_approval_cases` / `flow_approvals`. Transparent audit of the day's output.

### Sidebar nav
1. Approvals — `/qrm/approvals`
2. Credit — `/qrm/credit`
3. Deposits — `/deposits`
4. Orders — `/parts/orders` (unsure — may be `/orders` if it exists; check)
5. Intake — `/ops/intake`
6. AP / GL — `/admin/accounts-payable`

### Features NOT on the home screen
- Deal Detail (reached via queue row)
- Margin exception override (reached via row)
- AP / QB Sync (admin-adjacent)
- Intake Kanban (tab away)

### Gaps
- **GAP:** No unified "blocked items" widget. Data exists (`service_job_blockers`, `ar_credit_blocks`) but no rollup for Deal Desk. Optional add if product wants it.
- **GAP:** "Return Reasons" pie chart in mockup implies a categorization of returns; the schema exists (`quote_approval_cases.decision_reason`) but no widget today. Would be a nice-to-have deep-dive, not daily.

### Phase 5 — reconciliation

| Mockup widget | Verdict | Reason |
|---|---|---|
| Approval Queue | **SURVIVE** | Hero. |
| Credit Applications | **SURVIVE** (right rail) | Daily action. |
| Margin Reviews | **SURVIVE** (action card) | Daily action. |
| SLA Performance | **SURVIVE as** right-rail add | Product brief: "SLA pressure must be visible above the fold." |
| Credit Bureau Status (standalone card) | **RESHAPE** into inline status strip on Credit Applications | Not standalone — it's a status indicator. |
| Recent Decisions | **SURVIVE** (below fold) | Transparent audit. |
| Commission Exposure | **REMOVE** | No commission table. |
| Key Advisors | **REMOVE** | Not deal desk's concern. |
| Return Reasons pie | **REMOVE** from home | Deep-dive, not daily glance. Keep in sidebar or Flow Admin. |

---

## Role: Prep / Service (`iron_man`) — Marcus / Webb

### Top bar quick actions
1. **Next Job** → `/service/wip`
2. **PDI Checklist** → `/service/inspections` (or a deep link to the next overdue inspection)
3. **Parts Pickup** → `/parts/orders?status=ready`

### 01 Narrative
Role=`iron_man`. Signals: units prepped today, PDIs overdue, demos scheduled, parts-blocked units, crew capacity. Example: *"8 units in prep (3 PDIs overdue), 2 demos at 2PM, crew at 73%."*

### 02 Actions (exactly 3 cards)
1. **Hero — PREP QUEUE** → `/service/wip`
   - Hero number: count of units in prep queue today
   - Aggregate: `{n} behind schedule`
   - Urgency: `{n} parts-blocked`
2. **PDI CHECKLISTS** → `/service/inspections`
   - Hero number: in-progress PDIs
   - Aggregate: `{n} blocked (parts)`
3. **TODAY'S DEMOS** → `/service/demos` (or `/qrm/demos`)
   - Hero number: demos scheduled today
   - Aggregate: readiness state

### 03 The Floor — body

**Hero widget (largest):**
- **Prep Queue — inline stage editable** (`iron.prep-queue`, RESHAPED to be click-to-update) — table of units with customer, ready %, due date, stage (In Prep / Blocked / Ready). **Stage cell is one-click editable**: click cycles `in_progress` → `blocked_waiting` → `ready_for_pickup` (with confirmation on blocked_waiting to pick a blocker_type + description). Writes `service_jobs.current_stage` (enum `public.service_stage`) + inserts a `service_job_blockers` row on blocked transitions + writes `service_job_events` for the audit trail. **There is no `service_jobs.status` column** — `current_stage` is canonical ([094_service_core_tables.sql:72](supabase/migrations/094_service_core_tables.sql)). **Product brief: MUST HAVE one-click status update.**

**Right rail (≤ 2):**
1. **PDI Checklists in Flight** (`iron.pdi-checklists`) — per-unit progress bars, blockers.
2. **Parts Hub Strip** (`service.parts-hub-strip`) — units waiting on parts, top WO parts needed, days waiting.

**Below the fold:**
- **Delivery Schedule — next 5 days** — `service_jobs` where status=ready ordered by delivery-date. Columns: deal, customer, delivery date, driver, status. Keeps dispatch visible.

### Sidebar nav
1. Prep Queue — `/service/wip`
2. PDI — `/service/inspections`
3. Demos — `/service/demos`
4. Service Queue — `/service/queue`
5. Deliveries — `/service` (schedule view)
6. Parts Work Queue — `/service/parts-queue`
7. Return Inspections — `/ops/rental-returns`

### Features NOT on the home screen
- Service agreement detail
- Labor pricing
- Service invoice generation (downstream)
- Vendor escalations

### Gaps
- **GAP (shippable):** The current `iron.prep-queue` Floor widget is read-only (Phase 2 finding). The redesign requires it to be editable. Mutation shape: `UPDATE service_jobs SET current_stage = $1 WHERE id = $2` (+ `service_job_blockers` INSERT on blocked transition, + `service_job_events` INSERT for every transition). RLS on `service_jobs` already exists; use the same workspace + role guard as the Service WIP page. Do NOT add a `status` column — use the existing `current_stage` enum.
- **GAP:** No crew-capacity widget. Mockup shows 73%; computed from `service_technician_assignments` + `service_jobs.scheduled_for`. Nice-to-have; not critical. Could derive from existing data.

### Phase 5 — reconciliation

| Mockup widget | Verdict | Reason |
|---|---|---|
| Prep Queue | **SURVIVE** (RESHAPED to editable) | Hero; status-editable is the key change. |
| PDI Checklists | **SURVIVE** | Daily check. |
| Today's Demos | **SURVIVE** (action card) | Daily. |
| Delivery Schedule | **SURVIVE** (below fold) | Dispatch visibility. |
| Return Inspections | **SURVIVE** in sidebar, **REMOVE** from home | Not daily for most prep leads. |
| Parts Hub Strip | **SURVIVE** | Blocker visibility. |
| Crew Capacity (73%) | **FLAG** — derive if cheap, remove if not | Decorative if not actionable. |
| Open Service Tickets | **REMOVE** from Prep/Service home | That's more service manager. Overlaps with Prep Queue. |

---

## Common themes across all seven roles

### Patterns that survived the audit
1. **Morning Narrative (01)** — every role keeps it.
2. **Three action cards (02)** — every role honors the cap.
3. **Hero + right rail + below fold (03)** — every role respects the hierarchy.
4. **Orange primary-action affordance** — unchanged.
5. **Dark mode** — unchanged (forced, per FloorPage.tsx).

### Patterns that got removed across the board
1. **Commission MTD** — gone from every screen (placeholder).
2. **Standalone "Search Customer" card** — gone; Cmd+K covers it.
3. **Leaderboard** — gone (no commission/rank data).
4. **Cross-role widget duplication** — if it's an owner concern, it lives on owner's screen only.

### Patterns that got introduced
1. **Serial-First as an input, not a card** — hero band for Parts Counter.
2. **My Quotes with status** — new hero for Sales Rep.
3. **Editable Prep Queue** — one-click status for Prep/Service.
4. **SLA-visibility in Deal Desk approval queue** — above the fold per brief.
5. **Owner screen has approvals but only owner-escalated** — filtered queue, not duplicated manager screen.

### What stayed deliberately asymmetric
- **Owner has 2 below-fold items (Deals >$250K + nothing else).** Owner screen is smaller on purpose. Empty space > filler.
- **Parts Counter's 02 band is dominated by an input field instead of 3 cards.** The #1 action doesn't fit the card pattern. Asymmetry serves the user.
- **Parts Manager's hero is split two-column (Demand Forecast + Inventory Health).** Both are daily and equally weighted. The grid doesn't force a single hero when two are genuinely co-equal.

---

## Route aliasing — how spec routes map to App.tsx

The spec uses short operator-friendly routes (e.g. `/qrm/approvals`). Several do not match App.tsx canonical routes verbatim. The repo already uses Navigate aliases for this pattern ([App.tsx:1983](apps/web/src/App.tsx#L1983) → `<Route path="/crm" element={<Navigate to="/qrm" replace />} />`). When implementing, **add aliases — do not rewrite the spec to canonical paths**. The operator-friendly form is the spec.

| Spec route | Canonical in App.tsx | Action |
|---|---|---|
| `/qrm/approvals` | `/qrm/command/approvals` | Add Navigate alias |
| `/iron` (ASK IRON) | `/chat` | Add Navigate alias |
| `/sales/today`, `/sales/board`, `/sales/customers` | resolve under `/sales/*` wildcard (`SalesRoutes`) | Already work — no alias needed |
| `/qrm/my/reality` | exists as written (line 2539) | No alias needed |
| `/parts/companion/*` (lookup, queue, machines, replenish, etc.) | resolve under parts wildcard | Already work |
| `?filter=…`, `?status=…`, `?assigned=me` params | base route exists | Handle in page via `useSearchParams` |
| `/credit/new`, `/deposits/new`, `/service/demos` | NO canonical | GAP — use existing Deal Desk / Demo flows if present; else flag to product before building |

Filter-param URLs (e.g. `/qrm/approvals?escalated=true`, `/parts/orders?status=ready`) are not missing routes — they are wiring. The target page reads the query string and applies the filter. Do not build new pages for filter variants.

---

## Cross-cutting recommendations that apply beyond this redesign pass

1. **Ship a keyboard-shortcut layer for the Floor.** Parts Companion proves the pattern works. At minimum: `g a` = approvals, `g q` = quotes, `g p` = pipeline, `n` = new quote, `v` = voice. Not required for this redesign to ship, but it changes the feel of the whole app.
2. **Promote voice everywhere it's relevant.** [VoiceNoteCapture.tsx](apps/web/src/features/sales/components/VoiceNoteCapture.tsx) is already a shared component — it should be accessible from the top bar on Sales Rep and Parts Counter screens, not just one deep flow.
3. **Build a team-scoped RLS helper** (`get_my_direct_reports()` or similar). Without it, the Sales Manager pipeline widget stays workspace-wide. This is the one genuine missing piece in the data model.
4. **Rename "COMPOSE" in the top bar.** It opens the Floor layout editor, but "Compose" universally reads as "create a thing." For non-admins it's hidden already; for admins, "Edit Layout" or "Compose Layout" removes ambiguity.
5. **Do NOT invest in commission/leaderboard UX until rules are defined.** Schema, widget, policy — all undefined. The brief is correct to cut them; don't let them creep back in.

---

## What a reader should take away

For each role, the home screen now organizes around **the 3 things the person actually does multiple times a day** and **the 1 thing they look at most** — and no more. Owner's screen intentionally shows less. Parts got split into two because the codebase already treats them as two jobs. Commission MTD is gone from every role because the number isn't real yet.

Every widget, every action card, and every route in this doc maps to a file in [role-home-feature-audit.md](role-home-feature-audit.md) section A or a table/RPC in section D. Nothing invented. Gaps are flagged as `WORKFLOW NEEDS` or `GAP`, not designed around.
