# Role-Home Workflow Inference (Phase 2)

**Date:** 2026-04-23
**Source-of-truth:** Every action and check below maps to a feature documented in [role-home-feature-audit.md](role-home-feature-audit.md).
**Rule:** If a role's plausible top-5 action is **not built**, it is flagged `WORKFLOW NEEDS:` and excluded from the redesign.

The mockup has six roles. The codebase has **seven** iron_roles. This document treats Parts Counter and Parts Manager as distinct — they do fundamentally different work.

---

## Role: Sales Manager (`iron_manager`)

Reference persona: Rylee.

### What they actually do all day
A sales manager's unit of work is their team's deals in flight, and their own gate-keeping decisions on margin/pricing. They move between "approve or push back" (active) and "am I about to get surprised" (passive).

### Top 5 actions (create / update)
1. **Approve or reject a submitted quote** → `/qrm/approvals` → powered by `quote_approval_cases` + `flow_approvals`. This is THE primary daily action. Multiple per hour during peak.
2. **Override margin on a specific quote** → open quote detail from approval → Quote Builder V2 margin panel → `qb_margin_exceptions` row created. Touches compliance.
3. **Push a rep into action on a stale deal** → open rep's deal → log activity / re-assign stage → writes `qrm_activities` + `qrm_stage_transitions`. Often happens after seeing aging signal.
4. **Re-assign or split a deal** → `/qrm/deals/:id` → change `assigned_rep_id` in `qrm_deals`. Done when a rep is out or a deal is stuck.
5. **Write a one-off quote (coverage for an out rep)** → `/quote-v2` → `qb_quotes`. Lower frequency but present.

### Top 5 checks (read / monitor)
1. **Open approvals queue** with age + margin breach flags — size of today's decision load.
2. **Pipeline by advisor** — stage-breakdown across the team; this is the mockup's anchor widget and it is correct for this role ([iron.pipeline-by-rep](apps/web/src/features/floor/lib/floor-widget-registry.tsx)).
3. **Deals above $250K or at margin floor** — the escalation shortlist. Reads `qrm_deals.amount` + `qb_margin_exceptions`.
4. **Rep activity pulse** — who visited / called / emailed today; flags silent reps. Reads `touches` + `qrm_activities`.
5. **Margin this month vs target** — gross margin trend. Reads `margin_analytics_view` / `exec_margin_waterfall_v`.

### Primary input modality
**Keyboard.** Sales managers are at a desk with two monitors. They read a lot, click approval buttons, type comments. Cmd+K (OmniCommand) and approval keyboard shortcuts (not yet built) would matter here.

### Single most common "just got to my desk" action
Open approvals queue, triage by age + margin urgency.

### WORKFLOW NEEDS (gaps)
- `WORKFLOW NEEDS: team-scoped "my reps' deals" filter` — RLS helpers have no reporting-tree filter; pipeline widgets are workspace-wide (see Surprise S12). The mockup's Pipeline by Advisor table implies it, but backend does not scope.
- `WORKFLOW NEEDS: approval-action keyboard shortcuts` — approve/reject without clicking. Not built.

### Features this role uses but NOT home-screen worthy
- Deal Detail (`/qrm/deals/:id`) — deep dive, one click from approval.
- Account 360 (`/qrm/companies/:id`) — occasional reference.
- Deal Room / Decision Room — when a specific deal goes into negotiation mode.
- Flow Admin (`/admin/flow`) — rare, approval policy changes.

---

## Role: Sales Rep (`iron_advisor`)

Reference persona: Cole / David.

### What they actually do all day
Sales reps live in quotes and follow-ups. Everything else is secondary. The product brief is explicit on this.

### Top 5 actions (create / update)
1. **Start a new quote** → `/quote-v2` (direct) or `/voice-quote` (voice-to-scenarios) → `qb_quotes` / `quote_packages`. Most-used create action.
2. **Log a call or visit note** → `/voice-qrm` (voice) or activity panel in deal detail → `qrm_activities`. Reps do this 10+ times/day.
3. **Follow up on an open quote** → `/quotes` list, filter status=sent → edit → resend. Reads/writes `quote_packages`.
4. **Update deal stage / add contact** → `/qrm/deals/:id` → `qrm_deals`. Post-meeting.
5. **Send a follow-up email from a template** → email draft inbox → `email_drafts`. Not heavily used yet but wired.

### Top 5 checks (read / monitor)
1. **My quotes (by status)** — drafts, sent, viewed, approved, declined, expired. Reads `quote_packages` filtered by `assigned_rep_id`. **The product brief's MUST HAVE.**
2. **My follow-up queue / today's tasks** — due-today calls, follow-ups. Reads `follow_up_touchpoints`, `qrm_activities`, `qrm_tasks`. Already backed by `qrm.follow-up-queue` widget.
3. **My deal pipeline** — stages with nudges on at-risk. Reads `qrm_deals` assigned to user.
4. **AI briefing / next best action** — morning brief from `stakeholder-morning-brief` edge fn. Exists as `sales.ai-briefing` widget.
5. **Signal inbox / moves suggested for me** — `recommend-moves` output, `moves` table, tagged to rep. Exists.

### Primary input modality
**Voice.** Reps are in trucks, on job sites, between meetings. [VoiceNoteCapture.tsx](apps/web/src/features/sales/components/VoiceNoteCapture.tsx) exists; `/voice-qrm` and `/voice-quote` exist. **This is not a gap — it's a wiring decision: make voice one tap from the Floor.**

### Single most common "just got to my desk / just got in the truck" action
Dictate a note about yesterday's customer visit OR start a quote for the lead from last night.

### WORKFLOW NEEDS (gaps)
- `WORKFLOW NEEDS: clear quote status badges` — drafts/sent/viewed/approved/declined/expired states exist as `quote_packages.status`, but there's no purpose-built Floor widget that renders them as a status-aware list. The closest is `sales.action-items`. A dedicated `My Quotes` widget is a gap in the default layout — but the data is all there.
- `WORKFLOW NEEDS: Commission MTD rules` — the widget exists but is a placeholder (Surprise S4). Product brief says remove it; this is correct.

### Features this role uses but NOT home-screen worthy
- Deal Detail — one click from any deal reference.
- Customer Detail (`/sales/customers/:id` or `/qrm/accounts/:id`) — reached via search.
- Service history on a customer's fleet — reached from deal detail.
- Decision Room / Deal Coach — for specific high-stakes deals only.

---

## Role: Parts Counter (`iron_parts_counter`) — **NEW, not in mockup**

Reference persona: Juan / Bobby.

### What they actually do all day
Parts Counter is inbound: a customer walks in or calls, speaks a serial or part number, expects an answer in under 30 seconds. Fast quote, fast draft, fast pickup tagging.

### Top 5 actions (create / update)
1. **Paste a serial → identify machine + owner + service state** → Floor widget [SerialFirstWidget](apps/web/src/features/floor/widgets/SerialFirstWidget.tsx) (already built, moonshot-spec). Reads `qrm_equipment` + `qrm_companies`. **#1 action.**
2. **Build a parts quote** → Parts Companion Lookup → add lines → save draft → `qb_packages` / `parts_orders`. The draft-first pattern is intentional (the "pile of drafts" is normal).
3. **Create a parts invoice from a quote** → convert draft → `customer_invoices` (this path partially exists; most converts happen downstream in Deal Desk / AP).
4. **Voice lookup: "I need filters for a 2019 John Deere"** → Voice Ops modal (`V` in Parts Companion) → `voice-to-parts-order` edge fn → `parts_requests`.
5. **Tag an order as "ready for pickup"** → Parts Companion Queue → status update → `parts_orders.status`.

### Top 5 checks (read / monitor)
1. **My draft quotes** — unfinished. Wired as `parts.quote-drafts` widget.
2. **Order status (today)** — wired as `parts.order-status` widget (fulfillment stages).
3. **Customer intelligence on the caller** — history, open deals, preferred parts. Wired as `parts.customer-intel`.
4. **Replenish queue for items about to be oversold** — wired as `parts.replenish-queue`.
5. **Counter inquiries not yet quoted** — `counter_inquiries` table. This is a GAP in floor widgets — no widget renders unquoted inquiries yet.

### Primary input modality
**Keyboard + voice.** Paste-friendly. [PartsCompanionShell.tsx](apps/web/src/features/parts-companion/components/PartsCompanionShell.tsx)'s keyboard shortcuts (`/`, `N`, `V`) are the right pattern — they should extend to the Floor.

### Single most common "just got to my desk" action
Paste the serial the customer just read over the phone.

### WORKFLOW NEEDS (gaps)
- `WORKFLOW NEEDS: unquoted counter inquiries widget` — `counter_inquiries` table exists but no Floor widget renders it.
- `WORKFLOW NEEDS: one-click convert draft → invoice` — currently requires handoff to Deal Desk.

### Features this role uses but NOT home-screen worthy
- Machine Profiles (`/parts/companion/machines`) — reached from serial lookup.
- Pricing Rules — reference.
- Arrivals (`/parts/companion/arrivals`) — inbound-dock work, not counter-facing.

---

## Role: Parts Manager (`iron_parts_manager`) — **distinct from Counter**

Reference persona: Norman.

### What they actually do all day
Norman does **not** run the counter. He runs the stockroom and the supplier relationships. His day is about deciding what to reorder, seeing what's overdue, and catching forecast risk early.

### Top 5 actions (create / update)
1. **Approve / trigger replenishment** → `/parts/companion/replenish` → `parts_auto_replenish_queue.status = 'triggered'` → `parts_orders` (PO).
2. **Issue a purchase order to a vendor** → `/parts/purchase-orders` → `parts_orders`.
3. **Adjust reorder min/max on a SKU** → `/parts/companion/pricing` or `parts_replenishment_rules` edit.
4. **Move stock between locations (transfer)** → `parts_transfer_recommendations` → accept → (transfer flow; partially built).
5. **Override a supplier price or flag a submission** → `vendor_price_submissions` review.

### Top 5 checks (read / monitor)
1. **Demand forecast (next 7/30/90 days)** — wired as `parts.demand-forecast`.
2. **Inventory health (stock-outs imminent, dead stock)** — wired as `parts.inventory-health`.
3. **Supplier health scorecard** — wired as `parts.supplier-health`. On-time %, defect rate, leadtime trend.
4. **Lost sales signal** — wired as `parts.lost-sales`. What customers asked for that we didn't stock.
5. **Today's order status** — `parts.order-status` (same widget counter uses; different lens).

### Primary input modality
**Keyboard + spreadsheet.** Norman lives in tables. Lots of sorting, filtering, exporting. The Floor's role is summary; the actual work is in the sub-pages.

### Single most common "just got to my desk" action
Look at today's low-stock alerts and decide what to reorder.

### WORKFLOW NEEDS (gaps)
- None material. The default layout for this role is already tight and built on real data.

### Features this role uses but NOT home-screen worthy
- Catalog Import — rare, admin-adjacent.
- Vendor Profiles — reference.
- Parts Analytics — monthly deep-dive, not daily.

---

## Role: Owner (`iron_owner`)

Reference persona: Ryan.

### What they actually do all day
Less frequent visits. Ceremonial tone. An owner opens the home screen to see if anything is *surprising*, not to do transactional work.

### Top 5 actions (create / update)
1. **Make a final-call approval on a high-$ / low-margin deal** → `/qrm/approvals` with owner-only escalated cases → `flow_approvals` decision. Low frequency, high stakes.
2. **Acknowledge a health-score drop on a key account** → open Account 360 → log strategic context. Lower frequency.
3. **Request a monthly P&L pull** → `/admin/deal-economics` or `/executive/summary`. Usually an external accountant's artifact.
4. **Post a decision or comment** → `hub_decisions` — if the workspace is using Hub for strategic memos.
5. (there is no real "create" action 5 — owner's day is dominated by checks)

### Top 5 checks (read / monitor)
1. **Morning brief (narrative)** — `morning_briefings` + `floor-narrative` edge fn. Already the `exec.morning-brief` / `exec.owner-brief` widget.
2. **Revenue pace MTD vs target** — `analytics_kpi_snapshots`. Wired as `exec.revenue-pace`.
3. **Margin health by product line** — `margin_analytics_view`. Not currently a widget but derivable.
4. **Customer health movers** — accounts whose health score changed significantly. Wired as `nervous.customer-health` / `exec_health_movers`.
5. **Deal velocity / big deals closing this week** — wired as `exec.deal-velocity`.

### Primary input modality
**Reading.** Owners don't type. They read and click through to details.

### Single most common "just got to my desk" action
Read the morning brief. If something stands out, click through.

### WORKFLOW NEEDS (gaps)
- None. Owner view is well-served. Product brief explicitly says no transactional actions.

### Features this role uses but NOT home-screen worthy
- Everything transactional. The owner *can* jump into any role's view via JUMP TO; home screen stays ceremonial.

---

## Role: Deal Desk (`iron_woman`)

Reference persona: Tina / Angela.

### What they actually do all day
Deal Desk is the transaction conveyor: credit applications, deposits, order processing, invoicing. The queue is the work. Unlike approvals which are yes/no, deal desk is about moving things through a staged pipeline.

### Top 5 actions (create / update)
1. **Process a credit application** → `/credit/new` → `qb_deals` credit fields + integration sync. Wired as `iron.credit-applications` widget (queue).
2. **Record a deposit against a deal** → `/deposits/new` → `deposits` table + payment validation flow.
3. **Convert an approved quote to a sales order** → `quote_packages.status = 'released'` → downstream order creation. Wired as `iron.order-processing`.
4. **Resolve a pending invoice (issue / correct / hold)** → `customer_invoices` + `ar_credit_blocks`. Wired as `iron-woman.pending-invoices`.
5. **Intake a new equipment record** → `/ops/intake` → `equipment_intake`. Wired as `iron.intake-progress`.

### Top 5 checks (read / monitor)
1. **Order processing queue (by SLA age)** — wired as `iron.order-processing`. The heart of the role.
2. **Credit applications awaiting underwriting / bureau** — wired as `iron.credit-applications` with credit bureau status.
3. **Deposits pending / insufficient** — wired as `iron.deposit-tracker`.
4. **Pending invoices / AR aging** — wired as `iron-woman.pending-invoices`.
5. **Intake progress (new equipment data completeness)** — wired as `iron.intake-progress`.

### Primary input modality
**Keyboard (lots of forms).** Deal Desk enters a lot of data from faxes/emails/PDFs. Tab through fields. No special voice / scan needs.

### Single most common "just got to my desk" action
Open order processing queue, triage by SLA.

### WORKFLOW NEEDS (gaps)
- `WORKFLOW NEEDS: integrated ticket view` — when an order is blocked by a parts shortage or credit issue, the deal desk has to pivot to another tool. A unified "blocked items" widget could be valuable; the data exists (`service_job_blockers`, `ar_credit_blocks`) but no single widget today.

### Features this role uses but NOT home-screen worthy
- Accounts Payable (`/admin/accounts-payable`) — upstream of their work, admin-adjacent.
- QuickBooks GL Sync — periodic monitoring.

---

## Role: Prep / Service (`iron_man`)

Reference persona: Marcus / Webb.

### What they actually do all day
Unit-centric. Prep/Service tracks specific machines through today's work, tomorrow's work, and blockers. Every asset has a status: ready, in-progress, blocked, done.

### Top 5 actions (create / update)
1. **Update prep stage on a unit** (in-progress / blocked / ready) → Prep Queue → write `service_jobs.current_stage` (enum `public.service_stage`; values `in_progress`, `blocked_waiting`, `ready_for_pickup`) + INSERT a `service_job_blockers` row when transitioning to blocked_waiting + write a `service_job_events` entry for the transition. **Product brief says MUST HAVE.** There is no `service_jobs.status` column — `current_stage` is the canonical lifecycle field ([094_service_core_tables.sql:72](supabase/migrations/094_service_core_tables.sql)).
2. **Complete a PDI checklist** → `/service/inspections` → `demo_inspections` row. Per-unit.
3. **Mark parts received for a staged job** → `service_parts_staging` / `service_parts_actions` → resolves `service_job_blockers` where reason='parts_shortage'.
4. **Schedule or re-schedule a demo** — `demos` table.
5. **Start / pause / complete a service job** — `/service/wip` → `service_jobs.current_stage` transitions + `service_job_events` log.

### Top 5 checks (read / monitor)
1. **Prep queue (today's readiness by unit)** — wired as `iron.prep-queue`. Reads `service_jobs.current_stage` + `status_flags`; joins `service_job_blockers` for blocked-reason detail.
2. **PDI checklists in progress (per unit)** — wired as `iron.pdi-checklists`. Shows bottleneck stages.
3. **Today's demos (schedule + prepped state)** — wired as `iron.demo-schedule`.
4. **Parts Hub (what's waiting on parts?)** — wired as `service.parts-hub-strip`.
5. **Return inspections due** — wired as `iron.return-inspections`.

### Primary input modality
**Touch / mobile.** Prep/Service techs are on the floor, phone or tablet in hand. The mobile technician variant exists ([ServiceTechnicianMobilePage.tsx](apps/web/src/features/service/pages/ServiceTechnicianMobilePage.tsx)).

### Single most common "just got to my desk / shop floor" action
Look at prep queue, identify the next unit ready to work.

### WORKFLOW NEEDS (gaps)
- `WORKFLOW NEEDS: one-click current_stage update from Floor` — currently the Floor widget `iron.prep-queue` is read-only; updating lifecycle stage requires click-through to the Service WIP page. Product brief says this should be one click.
- `WORKFLOW NEEDS: crew capacity widget` — mockup shows "Crew capacity 73%" but no widget exists that computes it; would need to read `service_technician_assignments` + `service_jobs.scheduled_for`.

### Features this role uses but NOT home-screen worthy
- Service Agreements — reference, billing-driven, not prep.
- Inspection+ (deep form) — reached from an inspection row.
- Labor Pricing — admin-adjacent.

---

## Cross-role observations

### Every role benefits from these three things, regardless of job
1. **Cmd+K OmniCommand** — global customer/contact/document search is always one keystroke. This means **"Search Customer" does not need to be a home-screen quick action for most roles.** Demoting it frees a slot.
2. **Morning narrative** — [floor-narrative](supabase/functions/floor-narrative/) edge fn already returns a role-tuned one-sentence summary with deterministic fallback. Keep it on every role.
3. **JUMP TO menu** — every role can pivot to QRM / Sales / Parts / Service / Rentals from the top bar. Not home-screen real estate.

### Shared widgets justified across multiple roles
| Widget | Roles that genuinely check it daily | Roles where it's aesthetic |
|---|---|---|
| Morning brief / narrative | All | — |
| Open approvals count | Manager, Owner | Advisor (no), Deal Desk (no) |
| Pipeline-by-rep | Manager | Owner (if at all, as a drill-in, not hero) |
| Customer search | — | All (demote to Cmd+K) |
| Revenue pace / margin health | Owner | Manager (only if team-scoped; currently not) |

### Widgets that looked nice but fail the "multiple times per day" test
- **Aging Fleet** on Sales Rep or Parts Manager screens (mockup) — sales rep doesn't plan inventory; parts manager has better data in `parts.inventory-health`.
- **Commission MTD** on Sales Rep / Sales Manager — placeholder, not a real number (Surprise S4).
- **Leaderboard (#3 of 8)** on Sales Rep — no commission/leaderboard table exists. Gamification without truth.
- **Credit Bureau Status table** on Deal Desk (mockup) — it's a status indicator, belongs inline in the credit-applications widget, not a standalone card.

---

## Phase 2 completion checklist

- [x] Six roles covered + the 7th (Parts Counter) called out as distinct from Parts Manager.
- [x] Top 5 actions per role mapped to real routes/tables/edge fns.
- [x] Top 5 checks per role mapped to existing Floor widgets where possible.
- [x] Primary input modality called out per role.
- [x] WORKFLOW NEEDS explicitly flagged where a plausible top-5 item isn't built.
- [x] Non-home-screen features noted per role.
- [x] Cross-role observations captured (Cmd+K, JUMP TO, narrative are shared).

**Next:** Phase 3 — redesign each role's home layout grounded in the above, then reconcile with the 2×3 mockup in Phase 5.
