# QEP OS — Builder Handoff Punch List

**Date:** April 4, 2026
**Repository:** `lewis4x4/qep` on GitHub, `main` branch
**Current State:** 85 migrations (001-085), 37 edge functions, ~130 frontend source files, build passing
**Next Migration:** 086
**Source Documents:** `QEP-OS-Build-Roadmap-LLM.md` (canonical spec), `QEP-OS-Build-Session-Handoff.md` (what was built)

---

## How to Use This Document

This is the prioritized implementation contract for the next builder. Each item includes:

- **What the roadmap specified** (with exact section references)
- **What was actually built** (from the build session handoff)
- **What is missing** (the delta)
- **Acceptance criteria** (pulled directly from the roadmap, unchecked = not met)
- **Implementation notes** (architectural guidance, gotchas, dependencies)

Work items top to bottom. Do not skip items or reorder without CEO approval.

---

## Item 1: Quote Builder V2 — Full Workflow

**Priority:** CRITICAL
**Roadmap Reference:** Section 2.5 "Quote Builder V2", Section 2.6 edge function table (`quote-builder-v2`), Section 2.7 acceptance criteria
**Estimated Complexity:** Large (new edge function + major frontend refactor + PDF generation + e-signature)

### What the Roadmap Specified

Section 2.5 defines Quote Builder V2 as a zero-blocking rewrite of the existing `QuoteBuilderPage.tsx` (1,500+ lines, currently gated behind IntelliDealer credentials). The spec calls for:

1. **Three entry modes:**
   - Voice-first: record deal description, AI populates all fields
   - AI chat: type description, AI populates
   - Traditional form: manual entry

2. **AI Equipment Recommendation:** Describe the job, get optimal machine + attachment suggestions with reasoning

3. **Trade-in integration:** Pull valuation from the Phase 2 `trade_valuations` system (migration 074, `trade-valuation` edge function)

4. **Financing preview:** 3 scenarios (cash, 60-month finance, 48-month lease) from the admin-configured `financing_rate_matrix` table (already exists in the database)

5. **Smart Proposal PDF:** 4-page branded proposal document

6. **Margin check:** Deals under 10% margin auto-route to Iron Manager for approval (the database trigger `enforce_margin_check` exists in migration 070, but the Quote Builder UI doesn't surface it)

7. **Quote package auto-send:** Photos + brochure + credit application + video link per SOP

8. **E-signature:** For sales order at pipeline step 13

9. **Zero-blocking architecture:**
   ```
   IF IntelliDealer API connected:
     → Pull live inventory, pricing, stock status
   ELSE:
     → Use manual equipment catalog entry
     → Admin can bulk-import inventory via CSV
     → Quote Builder fully functional with manual data
   ```

### What Was Built

- The existing `QuoteBuilderPage.tsx` (1,500+ lines) was NOT refactored
- The handoff says it "still needs the zero-blocking architecture treatment"
- No `quote-builder-v2` edge function was created (the roadmap section 2.6 lists it as a required function; it is absent from the 11 new edge functions in the handoff)
- The `financing_rate_matrix` table exists but is not wired to any quoting UI
- The margin check trigger (`enforce_margin_check`) exists at the database level (migration 070) but has no corresponding UI flow in Quote Builder
- No PDF generation capability was built
- No e-signature flow was built for the quoting context (portal quote reviews exist in Phase 5 but are customer-facing, not sales-order signing)

### What Is Missing

| Component | Status |
|-----------|--------|
| `quote-builder-v2` edge function | Not built |
| Voice entry mode | Not built |
| AI chat entry mode | Not built |
| AI equipment recommendation | Not built |
| Trade-in pull-through from `trade_valuations` | Not built |
| Financing preview (3 scenarios from `financing_rate_matrix`) | Not built |
| 4-page branded proposal PDF | Not built |
| Quote package auto-send | Not built |
| E-signature at step 13 | Not built |
| Zero-blocking manual catalog mode | Not built (still gated behind IntelliDealer) |
| CSV bulk-import for manual inventory | Not built |
| Margin check UI surfacing | Not built (trigger exists, no UI) |

### Acceptance Criteria (from Roadmap Section 2.7)

- [ ] Quote Builder works without IntelliDealer (manual inventory mode)
- [ ] Margin check blocks quotes under 10% without manager approval

Additional criteria implied by Section 2.5:

- [ ] Voice-first entry populates all quote fields from audio
- [ ] AI chat entry populates all quote fields from text
- [ ] Traditional form entry available as fallback
- [ ] AI equipment recommendation returns machine + attachments + reasoning for a described job
- [ ] Financing preview shows cash, 60-month finance, 48-month lease scenarios using `financing_rate_matrix` rates
- [ ] Trade-in valuation from Phase 2 system pulls through to quote
- [ ] 4-page branded proposal PDF generated from quote data
- [ ] Quote package includes: quote + photos + brochure + credit app + video link
- [ ] E-signature captures signer name, IP, timestamp at pipeline step 13

### Implementation Notes

- The `quote-builder-v2` edge function should follow the same auth pattern as other user-token functions: validate via `supabase.auth.getUser()`, enforce workspace via `get_my_workspace()`
- Voice entry can reuse the `voice-to-qrm` transcription + extraction pipeline — the extraction schema already includes `machine_interest`, `budget_amount`, `financing_preference`, `trade_in_details`, and `attachments_needed`
- The `financing_rate_matrix` table already exists. Query it for current rates to populate the 3 financing scenarios
- For PDF generation, consider `@react-pdf/renderer` or a server-side PDF library in the edge function. The edge function should accept quote data and return a PDF buffer
- The margin check trigger fires at stage 13. The UI should show the margin waterfall and block progression with a clear "Requires Iron Manager approval" state when margin < 10%
- Zero-blocking: create a `manual_catalog` table or use a `catalog_entries` table with `source` column (`intellidealer` | `manual` | `csv_import`). The Quote Builder should query this unified catalog regardless of IntelliDealer connection status
- The existing `QuoteBuilderPage.tsx` at 1,500+ lines should be decomposed as part of this work — extract entry mode components, financing preview, trade-in section, and proposal preview into separate files

### Dependencies

- `financing_rate_matrix` table (exists)
- `trade_valuations` table + `trade-valuation` edge function (exists, migration 074)
- `enforce_margin_check` trigger (exists, migration 070)
- `voice-to-qrm` extraction pipeline (exists, can be reused for voice entry mode)

---

## Item 2: Technical Unblock Sprint

**Priority:** CRITICAL (blocks items 3, 4, 6, 8)
**Roadmap Reference:** Build Session Handoff "Short-Term (1-2 weeks)" section
**Estimated Complexity:** Medium (refactoring + query optimization, no new features)

### Why This Exists

Three technical debt items from the build session directly block subsequent punch list items. Attempting items 3 (role dashboards), 6 (DGE cockpit), or 8 (pipeline UX) without resolving these first will result in fighting the codebase instead of building features.

### 2A: Extract CrmPipelinePage Components

**Source:** Build handoff "Short-Term" item 3
**Current state:** `apps/web/src/features/crm/pages/CrmPipelinePage.tsx` is a single 60KB file
**Problem:** Items 3 (role dashboards) and 8 (pipeline UX) both need to modify pipeline components. A 60KB monolith makes this impractical.

**What to do:**
- Extract `DraggableDealCard` into its own file (already wrapped in `React.memo` per audit round 2)
- Extract `DroppableStageColumn` into its own file (already wrapped in `React.memo`)
- Extract swim lane logic (Pre-Sale stages 1-12, Close stages 13-16, Post-Sale stages 17-21) into a `PipelineSwimLanes` component
- Extract stage filtering/grouping logic into a `usePipelineStages` hook
- Extract drag-and-drop handler logic (optimistic update + error rollback) into a `useDealDragDrop` hook
- Keep `CrmPipelinePage.tsx` as a thin orchestrator importing these components

**Acceptance criteria:**
- [ ] `CrmPipelinePage.tsx` is under 200 lines
- [ ] All extracted components have explicit TypeScript props interfaces
- [ ] Existing pipeline behavior is unchanged (drag-and-drop, SLA countdown, deposit gate badges all still work)
- [ ] `bun run build` in `apps/web` passes

### 2B: Consolidate Deal Detail Page Queries

**Source:** Build handoff "Short-Term" item 2
**Current state:** Deal detail page fires 8 separate queries
**Problem:** Item 6 (DGE cockpit) adds margin waterfall, 3 scenario cards, and explanation panels to the deal detail page. Adding 3-4 more queries on top of 8 unoptimized ones creates a visible performance problem.

**What to do:**
- Create a `deal-detail` composite edge function (or a single RPC) that returns: deal data, contact, company, needs assessment, cadence + touchpoints, deposits, DGE scenarios, and activities in one round trip
- Use JOINs or lateral queries server-side
- Return a typed composite response
- Update the deal detail page to call the single endpoint

**Acceptance criteria:**
- [ ] Deal detail page makes 1-2 network requests instead of 8
- [ ] Page load time measurably faster (target: < 500ms on reasonable connection)
- [ ] All existing deal detail functionality preserved
- [ ] Edge function returns typed JSON matching a documented interface

### 2C: Fix Follow-Up Engine N+1 Queries

**Source:** Build handoff "Short-Term" item 1, Audit Round 2 item "N+1 manager lookups"
**Current state:** `follow-up-engine` edge function makes ~250 queries per hourly cron run — per-touchpoint lookups for deal, assessment, and contact data
**Problem:** This will get worse as deal volume grows. It also sets a bad pattern for the post-sale automation wiring in item 4.

**What to do:**
- Batch-fetch all pending touchpoints with their associated deals, contacts, and assessments in a single query using JOINs
- Pre-fetch all workspace Iron Managers once (the audit already fixed this for `pipeline-enforcer` but `follow-up-engine` still has the problem)
- Process touchpoints from the pre-fetched dataset
- The AI content generation calls to OpenAI should be batched or pre-generated (see item 4 notes)

**Acceptance criteria:**
- [ ] `follow-up-engine` makes < 10 database queries per cron run regardless of touchpoint count
- [ ] Cron execution time < 5 seconds for 100 pending touchpoints
- [ ] AI content still generated for each touchpoint (quality unchanged)
- [ ] Service role auth validation unchanged

### 2D: Lazy-Load react-markdown

**Source:** Build handoff "Short-Term" item 4
**Current state:** `react-markdown` (153KB) is bundled in the main chunk but only used in `ChatPage.tsx`

**What to do:**
- Code-split `react-markdown` using `React.lazy()` and `Suspense`
- Only load when ChatPage is rendered

**Acceptance criteria:**
- [ ] Main bundle size reduced by ~150KB
- [ ] ChatPage still renders markdown correctly
- [ ] `bun run build` passes

---

## Item 3: Role-Specific Command Centers

**Priority:** HIGH
**Roadmap Reference:** Section 1.2 "Iron Role System" → "Role-Specific Dashboard Views" table
**Estimated Complexity:** Large (4 distinct dashboard layouts, each with multiple data-fetching components)

### What the Roadmap Specified

Section 1.2 defines a specific dashboard experience for each Iron role. The table is explicit:

| Iron Role | Dashboard Components |
|-----------|---------------------|
| Iron Manager | Pipeline health (all reps), team KPI scoreboard, approval queue (demos, trades, margin exceptions), inventory aging alerts, wholesale/auction suggestions |
| Iron Advisor | Personal pipeline (21-step board), daily task queue, follow-up queue with countdown timers, prospecting visit counter, morning briefing |
| Iron Woman | Order processing queue, deposit tracker, equipment intake pipeline (Kanban), invoice status, credit application tracker, warranty filing queue |
| Iron Man | Equipment prep queue, PDI checklists, demo schedule with prep tasks, rental return inspection queue, attachment install tasks |

### What Was Built

- Iron role system fully implemented (migration 067): `iron_role`, `iron_role_display`, `is_support` columns on `profiles`
- `sync_iron_role()` trigger auto-syncs Iron role from system role
- `get_my_iron_role()` SECURITY DEFINER helper
- `iron-roles.ts` frontend utility with display names and descriptions
- Iron role badge displayed on QRM Hub page header
- **No role-specific dashboard views were built** — the handoff explicitly states this: "The role mapping and badge are implemented, but dedicated dashboard layouts per role need frontend pages"

### What Is Missing

Every dashboard listed in the roadmap table above. This is the single clearest Phase 1 acceptance gap.

### Acceptance Criteria (from Roadmap Section 1.8)

- [ ] Iron role labels visible throughout UI with role-appropriate dashboard views

### Implementation Notes

**Iron Manager Dashboard:**
- Pipeline health: query all deals grouped by `assigned_to`, show per-rep stage distribution and velocity
- Team KPI scoreboard: query `prospecting_kpis` for all reps in workspace, show daily/weekly/monthly targets
- Approval queue: query `demos` where `status = 'requested'`, `trade_valuations` where `status = 'manager_review'`, `crm_deals` where `margin_check_status = 'flagged'`
- Inventory aging: query `crm_equipment` with `created_at` age calculation, flag items > 90 days
- These queries should use a composite endpoint (similar pattern to item 2B)

**Iron Advisor Dashboard:**
- Personal pipeline: filtered version of the existing pipeline board (`assigned_to = auth.uid()`)
- Daily task queue: merge pending touchpoints + overdue follow-ups + prospecting visits needed
- Follow-up queue: query `follow_up_touchpoints` where `status = 'pending'` and `scheduled_date <= today + 3 days`, show countdown
- Prospecting counter: use existing `ProspectingKpiCounter` component
- Morning briefing: this is the foundation for the predictive visit list from Phase 4 (item 6). For now, show: overdue touchpoints, today's scheduled touchpoints, deals with SLA warnings, new leads

**Iron Woman Dashboard:**
- Order processing: deals in stages 13-16 (Sales Order Signed through Deposit Collected)
- Deposit tracker: query `deposits` table grouped by status
- Equipment intake Kanban: query `equipment_intake` table, render as Kanban board by `current_stage` (8 stages)
- Invoice status: query `customer_invoices` (if linking internal invoicing) or show deals in stage 20
- Credit app tracker: deals in stage 14 (Credit Submitted)

**Iron Man Dashboard:**
- Equipment prep queue: `equipment_intake` items in stages 2-4 (Arrival, PDI, Labeling)
- PDI checklists: `equipment_intake` items where `pdi_completed = false`, render checklist from `pdi_checklist` jsonb
- Demo schedule: `demos` where `status IN ('approved', 'scheduled')`, show prep tasks
- Rental return inspection: `rental_returns` where `status = 'inspection_pending'`

### Dependencies

- Item 2A (CrmPipelinePage extraction) — the Iron Advisor dashboard reuses pipeline components
- All Phase 1-3 tables already exist (demos, deposits, equipment_intake, prospecting_kpis, follow_up_touchpoints, rental_returns)
- `get_my_iron_role()` helper (exists)

---

## Item 4: Post-Sale Automation Wiring

**Priority:** HIGH
**Roadmap Reference:** Section 2.4 "Post-Sale Follow-Up Automation" (the voice→escalation example), Section 2.6 (`post-sale-engine`), Section 2.7 acceptance criteria
**Estimated Complexity:** Medium (new edge function + wiring existing components)

### What the Roadmap Specified

Section 2.4 gives an explicit owner example of the target behavior:

> "Today I spoke with John Smith on our 90 Day follow up post sale. He mentioned that the timeliness of the parts for his Yanmar machine has put him in a bind. Please write an email to Norman Udstad Lake City Parts Manager about the problems he is having. Please note for him to make a courtesy call to Mr. John Smith. Make a follow up task for me to check with Norman tomorrow."

From a single voice command, the system must:
1. Log the post-sale touchpoint as completed with issue noted
2. Auto-draft email to the relevant department manager (identified from org data)
3. Create follow-up task for the Iron Advisor for the next day
4. Create escalation ticket linking customer, issue, department, and status

Section 2.6 specifies a `post-sale-engine` edge function (cron): "Auto-schedule post-sale touchpoints, generate AI content, handle escalation ticket creation."

### What Was Built

- `follow-up-engine` (hourly cron): processes due touchpoints, generates AI content, creates notifications, marks overdue. Handles both sales and post-sale cadences.
- `escalation-router` edge function: creates escalation tickets, but requires manual invocation — it is not wired to voice capture context
- Post-sale cadence schedule is defined in the `create_post_sale_cadence()` SQL function (migration 069)
- `escalation_tickets` table exists (migration 076)

### What Is Missing

| Component | Status |
|-----------|--------|
| `post-sale-engine` dedicated cron function | Not built (folded into follow-up-engine, which is acceptable, but the escalation-from-voice flow is missing) |
| Voice command → escalation pipeline | Not wired (voice-to-qrm extracts deal data but doesn't trigger escalation-router) |
| Email draft generation from escalation | Schema field exists (`email_drafted` boolean) but no actual email draft generation |
| 2 PM prospecting nudge | Not built (roadmap section 2.3: "Automated nudge notification at 2 PM if advisor is under 50% of daily target") |
| Pre-generation of AI follow-up content | Not built (content generated at cron execution time, not ahead of time) |

### Acceptance Criteria (from Roadmap Section 2.7)

- [ ] Post-sale cadence auto-scheduled at delivery (deal reaches stage 19)
- [ ] Voice command creates complete escalation (email + task + ticket)
- [ ] Manager alert at 2 PM for advisors under 50% of daily target

### Implementation Notes

**Voice → Escalation Pipeline:**
- Extend `voice-to-qrm` extraction schema to detect escalation intent (keywords: "problem", "issue", "complaint", "bind", department references like "parts", "service")
- When escalation intent detected: after creating/updating the deal and completing the touchpoint, call `escalation-router` internally
- `escalation-router` should accept a `source: 'voice' | 'manual'` parameter and auto-populate fields from voice context

**Email Draft Generation:**
- The escalation ticket has `email_drafted` boolean but no actual draft storage
- Add `email_draft_subject text` and `email_draft_body text` columns to `escalation_tickets` (migration 086 or later)
- Use OpenAI to generate email draft from: issue description + customer name + department manager name + context from the touchpoint
- The owner's example shows a specific tone and format — include the example in the prompt as a few-shot template

**2 PM Prospecting Nudge:**
- Add a conditional branch to `pipeline-enforcer` (runs every 5 minutes): at 2 PM local time, check `prospecting_kpis` for each Iron Advisor. If `positive_visits < 5`, create notification
- Or: create a separate cron schedule in `pg_net.http_post()` for a `prospecting-nudge` function that runs once daily at 2 PM

**Pre-generating Follow-Up Content:**
- When a cadence is created (via `create_sales_cadence()` or `create_post_sale_cadence()`), pre-generate `suggested_message` for the first 3-4 touchpoints immediately
- When a touchpoint enters a 48-hour window, regenerate its `suggested_message` with fresher deal context
- This reduces the per-cron-run OpenAI call volume and makes the follow-up engine faster and more reliable

### Dependencies

- Item 2C (follow-up engine N+1 fix) — must be done first or the wiring will inherit the performance problem
- `voice-to-qrm` edge function (exists)
- `escalation-router` edge function (exists)
- `escalation_tickets` table (exists, migration 076)

---

## Item 5: Phase 3 Mobile Ops Surfaces

**Priority:** HIGH
**Roadmap Reference:** Section 3.1-3.5 (Equipment Intake, Traffic & Logistics, Rental Returns, Payment Validation, GL Routing), Section 3.6 acceptance criteria
**Estimated Complexity:** Large (multiple mobile-first frontend workflows)

### What the Roadmap Specified

Phase 3 acceptance criteria (section 3.6) are experience-driven, not just data-driven:

- Equipment intake Kanban board with 8 stages, drag-and-drop, photo requirements per stage
- PDI as tap-through mobile checklist with required photo evidence
- Traffic ticket auto-created at deal step 18 with pre-filled data
- Driver mobile workflow: checklist, GPS, signature capture, photos
- Rental return branching workflow: clean vs. damaged paths
- Check acceptance rules enforced at invoice creation
- GL account auto-suggested on work orders with 95%+ accuracy
- Good Faith (SALEW001) requires ownership approval gate

### What Was Built

All Phase 3 schema is complete:
- `equipment_intake` table with 8 stages + stage history trigger (migration 077)
- `traffic_tickets` table with 12 types + auto-lock trigger + auto-creation at stage 18 (migration 078)
- `rental_returns` table with branching workflow states (migration 079)
- `payment_validations` table + `validate_payment()` function with exact SOP rules (migration 079)
- `gl_routing_rules` table seeded with 8 GL codes including SALEW001 ownership gate (migration 079)

### What Is Missing

All frontend surfaces. The schema and business logic exist in the database, but there are no user-facing pages or mobile workflows.

| Component | Status |
|-----------|--------|
| Equipment intake Kanban board | Not built |
| PDI tap-through mobile checklist | Not built |
| Traffic ticket creation/management UI | Not built |
| Driver mobile workflow (checklist, GPS, signature, photos) | Not built |
| Rental return branching workflow UI | Not built |
| Payment validation UI at invoice creation | Not built |
| GL auto-suggestion UI on work orders | Not built |
| SALEW001 ownership approval gate UI | Not built |

### Acceptance Criteria (from Roadmap Section 3.6)

- [ ] Equipment intake Kanban board with 8 stages, drag-and-drop, photo requirements per stage
- [ ] PDI as tap-through mobile checklist with required photo evidence
- [ ] Traffic ticket auto-created at deal step 18 with pre-filled data
- [ ] Driver mobile workflow: checklist, GPS, signature capture, photos
- [ ] Rental return branching workflow: clean vs. damaged paths
- [ ] Check acceptance rules enforced at invoice creation
- [ ] GL account auto-suggested on work orders with 95%+ accuracy
- [ ] Good Faith (SALEW001) requires ownership approval gate

### Implementation Notes

**Equipment Intake Kanban:**
- Reuse the `@dnd-kit` setup from the pipeline board (already installed)
- 8 columns matching the `current_stage` values
- Each card shows: stock number, equipment name, current stage checklist progress, photo count
- Stage progression should call `track_intake_stage_change()` trigger automatically on update
- Mobile: horizontal scroll with snap-to-column

**PDI Checklist:**
- Render `pdi_checklist` jsonb as a mobile-friendly tap-through list
- Each checklist item: tap to mark complete, camera icon to attach photo evidence
- Photo upload to Supabase Storage, store URL in checklist item's `photo_url` field
- Progress bar at top showing completion percentage
- Block progression to stage 4 until `pdi_completed = true`

**Traffic Ticket / Driver Workflow:**
- This is the most mobile-critical surface
- Traffic ticket detail page with color-coded status (gray/yellow/orange/red per SOP)
- Driver view: step-by-step checklist from `driver_checklist` jsonb
- GPS: use browser Geolocation API, store lat/lng on `delivery_lat`/`delivery_lng`
- Signature: HTML5 Canvas signature pad, save as image to Supabase Storage, store URL in `delivery_signature_url`
- Photo upload: delivery photos array, hour meter photo
- The `traffic_ticket_auto_lock()` trigger already prevents requestor modification after submission — the UI should reflect this (read-only view for requestors once `locked = true`)

**Rental Return Branching:**
- Wizard-style UI:
  1. Inspection step (Iron Man): checklist + photos
  2. Decision step (Rental Asset Manager): clean or damaged?
  3a. Clean path: credit invoice generation, deposit refund processing
  3b. Damaged path: work order creation → charge calculation → deposit comparison → balance due or refund
- Refund method must match `original_payment_method` per SOP — enforce in UI

**Payment Validation:**
- Hook into any invoice/payment creation flow
- Call `validate_payment()` function before processing
- Show clear pass/fail with rule explanation ("Business check limit: $2,500/day/customer — current total: $1,800 — this payment of $900 would exceed limit")
- Override option visible only to A/R role with reason field

**GL Auto-Suggestion:**
- Query `gl_routing_rules` based on work order context (equipment status, ticket type, customer damage, LDW, truck number, event flag)
- Show suggested GL code with explanation
- SALEW001: show prominent warning + ownership approval gate (require explicit approval from profiles with `iron_role = 'iron_manager'` AND ownership flag)

### Dependencies

- Item 2A (CrmPipelinePage extraction) — the intake Kanban reuses dnd-kit patterns
- All Phase 3 tables exist (migrations 077-079)
- Supabase Storage for photo/signature uploads (verify bucket exists or create one)
- `@dnd-kit` packages already installed

---

## Item 6: Visible DGE Cockpit

**Priority:** HIGH
**Roadmap Reference:** Section 4.1-4.3 (14-Variable Optimization, Predictive Prospecting, Phase 4 Acceptance Criteria)
**Estimated Complexity:** Large (visualization-heavy, requires deal detail page integration)

### What the Roadmap Specified

Section 4.3 acceptance criteria:

- DGE produces 3 optimized deal scenarios per active opportunity
- Margin waterfall visualization per deal
- Manufacturer incentive alerts within 24 hours of availability
- Ownership dashboard: margin analytics, pipeline intelligence, revenue forecasting, KPI scoreboard
- Predictive prospecting generates daily 10-visit lists with route optimization
- Fleet replacement cycle predictions at 30/60/90 day horizons
- Revenue forecasting within 15% of actuals over 90-day window

### What Was Built

- `dge-optimizer` edge function: produces 3 scenarios (conservative, balanced, aggressive) per deal using 14 variables, falls back to rule-based when OpenAI unavailable
- `predictive_visit_lists` table (migration 080)
- `dge_score`, `dge_scenario_count`, `dge_last_scored_at` columns on `crm_deals`
- 13 existing DGE tables: `customer_profiles_extended`, `market_valuations`, `auction_results`, `competitor_listings`, `fleet_intelligence`, `manufacturer_incentives`, `financing_rate_matrix`, `deal_scenarios`, `deal_feedback`, `margin_waterfalls`, `pricing_persona_models`, `outreach_queue`, `customer_deal_history`

### What Is Missing

The engine exists. The visible intelligence layer does not.

| Component | Status |
|-----------|--------|
| Deal-level DGE panel with 3 scenario cards | Not built |
| Margin waterfall visualization | Not built (table exists: `margin_waterfalls`) |
| "Why this scenario" explanation tied to 14 variables | Not built |
| Manufacturer incentive alerts | Not built (table exists: `manufacturer_incentives`) |
| Ownership dashboard (margin analytics, forecasting, KPI scoreboard) | Not built |
| Predictive visit list UI (daily 10-visit list per Iron Advisor) | Not built (table exists: `predictive_visit_lists`) |
| Route optimization for visit lists | Not built |
| Fleet replacement cycle prediction UI | Not built |
| Revenue forecasting visualization | Not built |

### Acceptance Criteria (from Roadmap Section 4.3)

- [ ] DGE produces 3 optimized deal scenarios per active opportunity
- [ ] Margin waterfall visualization per deal
- [ ] Manufacturer incentive alerts within 24 hours of availability
- [ ] Ownership dashboard: margin analytics, pipeline intelligence, revenue forecasting, KPI scoreboard
- [ ] Predictive prospecting generates daily 10-visit lists with route optimization
- [ ] Fleet replacement cycle predictions at 30/60/90 day horizons
- [ ] Revenue forecasting within 15% of actuals over 90-day window

### Implementation Notes

**DGE Panel on Deal Detail:**
- Add to the deal detail page (after item 2B consolidates the queries)
- 3 cards side-by-side: Conservative / Balanced / Aggressive
- Each card shows: equipment price, trade allowance, attachment recommendations, financing terms, service contract pricing, total margin
- Highlight the "Balanced" card as recommended (best expected value)
- "Why this scenario" expandable section: show which of the 14 variables most influenced each scenario, with natural-language explanation generated by the `dge-optimizer`

**Margin Waterfall:**
- Visualization component showing: Base Price → Trade Allowance → Attachments → Financing Impact → Incentives → Service Contract → Net Margin
- Use a waterfall/cascade chart (recharts `BarChart` with stacked positive/negative segments, or a custom component)
- Color-code: green for margin-positive steps, red for margin-negative
- Show target margin band (10% minimum, 20-25% ideal)

**Ownership Dashboard (Iron Manager++):**
- This extends the Iron Manager dashboard from item 3
- Add tabs or sections for: margin analytics (avg margin by rep, by equipment category, by month), pipeline intelligence (weighted pipeline value, velocity by stage), revenue forecast (predicted vs actual with accuracy tracking)
- Revenue forecasting: aggregate `dge_score × deal_value` across pipeline, show 30/60/90-day projections
- The 15% accuracy target means tracking: what was forecasted 90 days ago vs what actually closed

**Predictive Visit List:**
- Integrate into Iron Advisor morning briefing (from item 3)
- Query `predictive_visit_lists` for today's list
- Show 10 customers ranked by the 8 criteria from section 4.2 (overdue follow-ups, fleet replacement cycle, seasonal demand, competitive displacement, geographic clustering, inventory matching, incentive windows, lifecycle signals)
- Map view with route (Google Maps embed or Mapbox) showing optimized visit order
- Each customer card: name, reason for visit, last contact date, relevant deal context

### Dependencies

- Item 2B (deal detail query consolidation) — MUST be done first
- Item 3 (role dashboards) — the ownership dashboard extends Iron Manager's dashboard
- `dge-optimizer` edge function (exists)
- All 13 DGE tables (exist)
- `predictive_visit_lists` table (exists, migration 080)

---

## Item 7: Customer Portal Frontend

**Priority:** MEDIUM
**Roadmap Reference:** Section 5.1 "Customer Self-Service Portal"
**Estimated Complexity:** Large (separate auth flow + 6 frontend workflows)

### What the Roadmap Specified

Section 5.1:
- Equipment fleet view, service history, warranty status, maintenance schedules
- Quote review and e-signature for repeat purchases
- Rental self-service: availability, booking, deposit, return scheduling
- Parts ordering for consumables with AI-suggested PM kits
- Service requests with photo upload
- Payment portal: invoices, online payment, statements
- Separate auth flow from internal users

### What Was Built

Full backend:
- `portal_customers` table with separate auth flow (migration 082)
- `customer_fleet` table with warranty tracking and service schedules (migration 082)
- `service_requests` table with photo upload and department routing (migration 082)
- `parts_orders` table with AI-suggested PM kits and line items (migration 082)
- `customer_invoices` table with payment portal and overpayment constraint (migration 082)
- `portal_quote_reviews` table with e-signature (signer name, IP, timestamp) and enforced state machine (migration 082, hardened in 085)
- `portal-api` edge function with unified routes: /fleet, /service-requests, /parts, /invoices, /quotes, /subscriptions
- Dual RLS: internal staff see full workspace, portal customers see only their own data (hardened in audit round 2, migration 085)
- Field whitelisting on all mutation endpoints (audit round 2)
- Quote review state machine: sent → viewed → accepted (audit round 2)

### What Is Missing

All customer-facing React pages. The handoff explicitly states: "the customer-facing React pages need to be created (separate app or route group with portal auth flow)."

| Component | Status |
|-----------|--------|
| Portal auth flow (login/register for customers) | Not built |
| Fleet dashboard | Not built |
| Service request submission with photo upload | Not built |
| Parts ordering flow with AI PM kit suggestions | Not built |
| Invoice/payment view | Not built |
| Quote review/e-signature frontend | Not built |
| Rental self-service (availability, booking) | Not built |

### Acceptance Criteria (implied by Section 5.1)

- [ ] Customers can log in via separate auth flow (not internal user login)
- [ ] Fleet dashboard shows customer's equipment with warranty status and service schedules
- [ ] Service request form with photo upload submits to `service_requests` table
- [ ] Parts ordering flow shows AI-suggested PM kits, allows ordering, tracks shipping
- [ ] Invoice view shows outstanding balances with payment capability
- [ ] Quote review shows proposal with accept/reject and e-signature capture
- [ ] Portal uses `portal-api` edge function exclusively (no direct table access)
- [ ] Customer can only see their own data (dual RLS verified)

### Implementation Notes

- **Routing decision:** Either a separate app in the monorepo (`apps/portal/`) or a route group in `apps/web/` with portal-specific layout and auth guard. Separate app is cleaner but adds build complexity. Route group is simpler to deploy (single Netlify site).
- **Auth flow:** `portal_customers` has `auth_user_id` linking to Supabase Auth. Use Supabase Auth `signUp`/`signIn` with a portal-specific flag or metadata to distinguish portal users from internal users.
- **All data access through `portal-api`** — the RLS is set up for this, and the field whitelisting prevents customers from modifying unsafe fields. Do NOT create direct Supabase client queries from the portal frontend.
- **Photo upload for service requests:** Use Supabase Storage with a portal-specific bucket. The `portal-api` should return signed upload URLs.

### Dependencies

- `portal-api` edge function (exists)
- All portal tables (exist, migrations 082, hardened in 085)
- Dual RLS policies (exist, hardened in audit round 2)

---

## Item 8: Advanced Pipeline Board UX

**Priority:** MEDIUM
**Roadmap Reference:** Section 1.8 acceptance criteria (drag-and-drop), Build Session Handoff "Medium-Term" item 1
**Estimated Complexity:** Medium

### What the Roadmap Specified

Section 1.8: "21-step pipeline visible in deal board with drag-and-drop stage transitions"

### What Was Built

- Pipeline board with 3 swim lanes (Pre-Sale, Close, Post-Sale)
- `@dnd-kit` installed with `DndContext`, `DraggableDealCard`, `DroppableStageColumn`
- Basic drag between columns with optimistic update + error rollback
- SLA countdown and deposit gate badges on deal cards
- `React.memo` on card and column components (audit round 2)

### What Is Missing

The handoff explicitly states: "Current implementation uses basic drag between columns. Adding card reordering within columns and multi-select drag would complete the Kanban experience."

| Component | Status |
|-----------|--------|
| Card reordering within columns (`@dnd-kit/sortable`) | Not built |
| Multi-select drag (select multiple deals, drag together) | Not built |
| Stage transition validation in drag UI (e.g., deposit gate visual blocking) | Partial (badge exists, but drag doesn't visually prevent invalid transitions) |

### Acceptance Criteria

- [ ] Cards can be reordered within a column (priority/sort order)
- [ ] Multiple cards can be selected and dragged together
- [ ] Dragging to a gated stage (e.g., stage 17+ without deposit) shows visual rejection with explanation
- [ ] Performance: no jank with 50+ visible deal cards (memoization already in place)

### Implementation Notes

- Import `SortableContext` and `useSortable` from `@dnd-kit/sortable` (package already installed)
- Card reordering within columns requires a `sort_position` or `priority` column on `crm_deals` — add in migration 086+
- Multi-select: maintain a `Set<dealId>` state, render selected cards with highlight, on drag start with a selected card, move all selected cards
- Gate validation: in `handleDragEnd`, check if target stage has prerequisites (deposit verified, margin check passed). If not, show toast with specific missing requirement and rollback to original position.

### Dependencies

- Item 2A (CrmPipelinePage extraction) — MUST be done first
- `@dnd-kit/sortable` (already installed)
- May need migration for `sort_position` column on `crm_deals`

---

## Item 9: Social / Telematics / Deeper Autonomy

**Priority:** LOW (second-wave after visible owner/demo wins)
**Roadmap Reference:** Section 5.2, 5.3, Build Session Handoff "Medium-Term" items 5-6
**Estimated Complexity:** Variable per sub-item

### What Was Built

- `social_media_posts` table with Facebook Marketplace fields and engagement metrics (migration 083)
- `marketing_campaigns` + `campaign_recipients` + `inventory_event_triggers` tables (migration 083)
- `marketing-engine` edge function (cron + manual invocation)
- `eaas_subscriptions` table with 4 plan types (migration 084)
- `eaas_usage_records` table with telematics-ready `device_id` fields (migration 084)
- `maintenance_schedules` table with predictive maintenance and confidence scoring (migration 084)

### What Is Missing

| Component | Status |
|-----------|--------|
| Facebook/Meta API integration for auto-posting | Not built (schema ready) |
| Machinery Trader VIP integration for market comps | Not built (trade valuation uses manual comps) |
| Telematics device API integration (hour tracking, GPS) | Not built (schema ready with `device_id` fields) |
| Inventory event trigger → campaign auto-creation flow | Schema exists, automation not fully wired |
| Needs assessment 90%+ accuracy validation loop | Not built (no measurement mechanism) |

### Implementation Notes

**Meta API Integration:**
- Requires Facebook App approval for Marketplace posting
- The `social_media_posts` table has all needed fields (`platform`, `external_post_id`, `engagement_metrics`)
- `marketing-engine` edge function should be extended to call Meta Graph API for post creation
- Start with manual-triggered posting, then automate via inventory event triggers

**Telematics Integration:**
- Depends on which telematics provider QEP uses (John Deere JDLink, Caterpillar Product Link, generic OEM APIs)
- `eaas_usage_records` table is ready with `device_id`, `reading_type`, `reading_value`
- Build an adapter pattern: `telematics-sync` edge function with provider-specific adapters
- Start with manual hour entry, add device sync as credentials become available

**Needs Assessment Accuracy Validation:**
- Add a `verified_by` and `verified_at` column to `needs_assessments`
- After voice-to-QRM creates an assessment, Iron Advisor reviews and corrects any fields
- Track correction rate: `fields_corrected / total_fields` per voice capture
- Aggregate to measure actual accuracy against the 90% target
- This is a measurement/feedback loop, not a blocking feature

---

## Appendix: Unmet Acceptance Criteria by Phase

### Phase 1 (Section 1.8)

| Criterion | Status |
|-----------|--------|
| 21-step pipeline visible with drag-and-drop | PARTIAL — basic drag works, no reorder within columns |
| Voice capture creates fully populated deal + contact + company in <10 seconds | BUILT — `voice-to-qrm` |
| Needs assessment auto-populated from voice with 90%+ field accuracy | BUILT (extraction) / NOT VERIFIED (accuracy measurement) |
| Follow-up cadence auto-set on every new deal | BUILT |
| AI-generated value content for each follow-up touchpoint | BUILT |
| Deposit calculator auto-fires at Step 16 | BUILT |
| Stage progression blocked past Step 16 without verified deposit | BUILT (database trigger) |
| Iron role labels visible with role-appropriate dashboard views | PARTIAL — labels visible, dashboards NOT built |
| 15-minute SLA alert on inbound leads | BUILT |
| 1-hour SLA alert on quote creation | BUILT |
| QRM narrative generated for every voice capture | BUILT |

### Phase 2 (Section 2.7)

| Criterion | Status |
|-----------|--------|
| Demo lifecycle: request → qualification → approval → prep → execution → follow-up → inspection | BUILT |
| Hour tracking with alerts at 80% and 100% of SOP limits | BUILT |
| Trade valuation: photo upload to preliminary price in <60 seconds | BUILT |
| 3 market comps auto-pulled | PARTIAL — schema exists, no Machinery Trader VIP integration |
| Prospecting KPI dashboard with real-time positive visit counter | BUILT (component exists) |
| Manager alert at 2 PM for advisors under 50% of daily target | NOT BUILT |
| Post-sale cadence auto-scheduled at delivery | BUILT (via `create_post_sale_cadence()`) |
| Voice command creates complete escalation (email + task + ticket) | NOT BUILT (escalation-router exists but not wired to voice) |
| Quote Builder works without IntelliDealer | NOT BUILT |
| Margin check blocks quotes under 10% without manager approval | PARTIAL — trigger exists, no UI |

### Phase 3 (Section 3.6)

| Criterion | Status |
|-----------|--------|
| Equipment intake Kanban with 8 stages | NOT BUILT (schema exists) |
| PDI as tap-through mobile checklist with photo evidence | NOT BUILT (schema exists) |
| Traffic ticket auto-created at deal step 18 | BUILT (trigger exists) |
| Driver mobile workflow: checklist, GPS, signature, photos | NOT BUILT (schema exists) |
| Rental return branching workflow | NOT BUILT (schema exists) |
| Check acceptance rules enforced at invoice creation | NOT BUILT (function exists, no UI) |
| GL account auto-suggested with 95%+ accuracy | NOT BUILT (rules table exists, no UI) |
| SALEW001 requires ownership approval gate | BUILT (schema level) / NOT BUILT (UI) |

### Phase 4 (Section 4.3)

| Criterion | Status |
|-----------|--------|
| DGE produces 3 scenarios per active opportunity | BUILT (engine) |
| Margin waterfall visualization | NOT BUILT |
| Manufacturer incentive alerts within 24 hours | NOT BUILT |
| Ownership dashboard: margin analytics, forecasting, KPI scoreboard | NOT BUILT |
| Predictive prospecting daily 10-visit lists with route optimization | NOT BUILT (table exists) |
| Fleet replacement cycle predictions at 30/60/90 day horizons | NOT BUILT |
| Revenue forecasting within 15% of actuals over 90-day window | NOT BUILT |

### Phase 5 (Section 5.1-5.3)

| Criterion | Status |
|-----------|--------|
| Customer portal frontend (fleet, service, parts, invoices, quotes) | NOT BUILT (backend complete) |
| Autonomous marketing with Meta integration | NOT BUILT (schema + engine exist) |
| EaaS with telematics integration | NOT BUILT (schema exists) |

---

## Migration Planning

Next migration number: **086**

Suggested migration sequence for this punch list:

| Migration | Item | Purpose |
|-----------|------|---------|
| 086 | 1 | `manual_catalog` table for zero-blocking inventory, or `catalog_entries` with source column |
| 087 | 1 | Quote Builder V2 supporting tables (quote packages, proposal PDFs, e-signature records for step 13) |
| 088 | 4 | Add `email_draft_subject`, `email_draft_body` to `escalation_tickets` |
| 089 | 4 | 2 PM prospecting nudge cron schedule |
| 090 | 8 | Add `sort_position` to `crm_deals` for within-column reordering |
| 091 | 9 | Add `verified_by`, `verified_at` to `needs_assessments` for accuracy tracking |

---

## Build Gates (Apply to Every Delivery)

From CLAUDE.md and the roadmap's Architecture Constraints:

1. `bun run migrations:check` — verify migration sequence
2. `bun run build` from repo root — must pass
3. `bun run build` in `apps/web` — must pass
4. `deno check` on all touched edge functions — must pass
5. RLS verification on all new/modified tables
6. Role/workspace security checks on all modified flows
7. Mobile-first UX quality verified on all operator-facing surfaces
