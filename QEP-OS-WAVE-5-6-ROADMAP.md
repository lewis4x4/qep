# QEP OS — Wave 5 + 6 Build Roadmap

**Status:** Build-ready handoff document
**Owner (CEO):** Brian Lewis (Speedy)
**Pipeline target:** Paperclip 15-agent build pipeline
**Last updated:** 2026-04-06
**Repo:** `/Users/brianlewis/client-projects/qep`
**Supabase project:** `iciddijgonywtxoelous`

---

## 0. Mission lock

> Build a moonshot equipment-and-parts sales+rental operating system for field reps, salesmen, corporate operations, and management. Every shipped slice must measurably improve decision speed or execution quality for at least one real dealership role and must include or enable a capability beyond commodity CRM behavior.

Every story below must pass the four mission checks (Mission Fit / Transformation / Pressure Test / Operator Utility) before merge.

---

## 1. Where we are right now

**Done in Wave 5A:**
- 5A.1 — `voice-to-qrm` extracts and wires multi-deal, equipment (with `crm_equipment` + `crm_deal_equipment` dual-write for current_fleet/trade_in mentions), budget cycle (`customer_profiles_extended.budget_cycle_month` upsert), future-dated tasks (`scheduled_follow_ups`), and audit trail (`voice_qrm_results.additional_deal_ids[]`, `extracted_equipment_ids[]`, `scheduled_follow_up_ids[]`, `budget_cycle_captured`)
- 5A.2 — `draft-email` edge function with prompt library for `budget_cycle`, `price_increase`, `tariff`, `requote`, `trade_up`, `custom`; `/draft`, `/batch`, `/list`, `/mark-sent` actions; migration `154_email_drafts.sql`
- 5A.4 — Voice routing already creates downstream `scheduled_follow_ups` for parts/service/process_improvement content types

**In flight:**
- 5A.3 — Quote builder tax/Section 179/incentive auto-apply (not started)

**Local but unpushed:**
- Commit `15dd53b` (Sprint 0 + Sprint 1) needs `git push origin main` + `supabase db push` + `supabase functions deploy` for the 7 touched functions
- New uncommitted Wave 5A work: `voice-to-qrm/index.ts`, `draft-email/index.ts`, `migrations/154_email_drafts.sql`

---

## 2. Sequencing principle

Waves are sequenced by **dependency, not by glamor**. Shared primitives ship before the screens that need them. Schema before edge functions before frontend before nudges. Each wave ends with a green build gate, a commit, and a deploy slice.

Build gate (every wave end):
1. `bun run migrations:check`
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. Edge function + RLS contract tests for touched surfaces
5. Role/workspace security check on every modified flow
6. Commit + push + supabase db push + functions deploy

---

## 3. Wave 5A.3 — Quote Builder tax & incentive intelligence

**Goal:** A quote in QEP automatically computes correct sales tax (multi-state aware), surfaces Section 179 / bonus depreciation, and auto-applies any active manufacturer incentive that matches the configured machine + customer profile. The rep does not type a tax rate, ever.

### Backend
- New table `quote_tax_breakdowns` (one row per quote_package): `quote_package_id`, `tax_jurisdiction`, `state_rate`, `county_rate`, `city_rate`, `special_district_rate`, `total_rate`, `taxable_subtotal`, `tax_amount`, `exemption_certificate_id`, `computed_at`, `computed_by_function`
- New table `manufacturer_incentives`: `id`, `workspace_id`, `manufacturer`, `program_name`, `program_code`, `eligibility_rules` jsonb, `discount_type` (`flat`, `pct`, `apr_buydown`, `cash_back`), `discount_value`, `effective_date`, `expiration_date`, `stackable` boolean, `requires_approval` boolean, `source_url`, `created_at`, `updated_at`
- New table `quote_incentive_applications`: `quote_package_id`, `incentive_id`, `applied_amount`, `applied_at`, `applied_by`, `auto_applied` boolean, `removed_at`, `removal_reason`
- New table `section_179_calculations`: `quote_package_id`, `total_purchase_price`, `section_179_eligible`, `section_179_deduction`, `bonus_depreciation_pct`, `bonus_depreciation_amount`, `effective_tax_rate`, `estimated_tax_savings`, `customer_tax_bracket_assumption`, `disclaimer_version`
- Existing `tax-calculator` edge function: extend with `getTaxJurisdiction(zip)` lookup using a `state_tax_rates` reference table; cache jurisdictions in KV
- New edge function `quote-incentive-resolver`: takes `quote_package_id`, walks the line items, queries `manufacturer_incentives` for matching programs by manufacturer/effective dates/eligibility rules, returns sorted applicable list with stackability resolution
- Extend `quote-builder-v2/index.ts` `compute` action to call `tax-calculator` and `quote-incentive-resolver` automatically on every recompute and persist results to `quote_tax_breakdowns` + `quote_incentive_applications`
- Migration: `155_quote_tax_and_incentives.sql`

### Frontend
- New shared component `apps/web/src/features/quotes/components/TaxBreakdown.tsx` — collapsible breakdown card showing state/county/city/special district lines with totals and the jurisdiction
- New shared component `apps/web/src/features/quotes/components/Section179Card.tsx` — purchase price, eligible amount, deduction, bonus depreciation, estimated tax savings, with a tax-pro disclaimer footer
- New shared component `apps/web/src/features/quotes/components/IncentiveStack.tsx` — list of auto-applied incentives with toggle pills (rep can deselect a stackable incentive), shows total customer savings
- Wire all three into `QuoteBuilderV2Page.tsx` between the line items table and the totals row
- Add an `IncentiveCatalogPage.tsx` under Admin for managers to add/edit/expire `manufacturer_incentives`

### Acceptance
- Configuring a Yanmar ViO 55 quote in WV automatically pulls 6.0% state + 1.0% Charleston rate for a Charleston ZIP and shows the breakdown
- Adding a Develon DX140 with an active "Spring Cash Back" incentive auto-applies $5,000 and surfaces it in the IncentiveStack
- Toggling the incentive off re-runs `compute` and removes the line; the audit row in `quote_incentive_applications` shows `removed_at`
- Section 179 card displays for any quote >$0; estimated tax savings updates live as the rep changes line items
- Service-role-only insert into `manufacturer_incentives` is blocked from a `rep` JWT but allowed from a `manager` JWT
- `bun run build` green; pipeline-enforcer cron unaffected

---

## 4. Wave 5B — Price intelligence completion

**Goal:** When a manufacturer ships a price update, QEP ingests it (xlsx, pdf, csv), ranks every open quote by **dollar impact descending**, drafts a re-quote email per affected customer using the Wave 5A.2 `draft-email` service, and triggers a **yard-first** workflow that searches the dealer's existing inventory before requesting new manufacturer stock.

### Backend
- Extend `price-file-import/index.ts` to accept `xlsx` (via `xlsx` SheetJS library), `pdf` (via `pdf-parse` for text-extractable PDFs, OCR fallback for scanned), `csv`, and a structured `json` payload from manual entry
- New table `price_file_imports`: `id`, `workspace_id`, `manufacturer`, `effective_date`, `source_format`, `source_url`, `import_status`, `parsed_row_count`, `unmatched_row_count`, `imported_by`, `imported_at`
- New table `price_change_events`: `id`, `import_id`, `catalog_entry_id`, `old_price`, `new_price`, `delta_amount`, `delta_pct`, `effective_date`
- New edge function `quote-impact-analyzer`: given a `manufacturer` + `effective_date`, find all `quote_packages` with `status in ('draft','sent','negotiating')` that include affected SKUs, compute `dollar_impact` per quote, sort descending, return top N for batch action
- New edge function `requote-batch-launcher`: takes the impact analyzer output and calls `draft-email` with `scenario='requote'` per quote, links resulting `email_drafts` to the originating quote
- Extend `parts-network-optimizer` with a `yard-first` mode: when a quote is impacted by a price increase, query all branches' inventory (`branch_assets`, `parts_inventory`) for the affected SKUs and produce a "buy from yard X before ordering from manufacturer" recommendation
- Migration: `156_price_intelligence_complete.sql`

### Frontend
- New page `apps/web/src/features/admin/PriceFileImportPage.tsx` — drag-drop xlsx/pdf/csv, preview parsed rows, confirm import; shows the row table with old vs new and delta % column
- New page `apps/web/src/features/admin/PriceImpactDashboard.tsx` — table of all open quotes affected by the most recent import, sorted by dollar impact desc; row checkbox + bulk "Generate re-quote drafts" button calling `requote-batch-launcher`
- New widget `YardFirstSourcing` on the quote builder line item drawer — when a SKU is impacted by a recent price change, show "Available from: Branch X (Q'ty 4) — save $1,240"

### Acceptance
- Uploading a Yanmar Q2 2026 price PDF parses 187 of 192 rows and creates a `price_file_imports` row; unmatched 5 rows surface with reason
- After import, `PriceImpactDashboard` shows 12 open quotes affected, sorted by dollar impact descending, top quote at $4,300 impact
- Clicking "Generate re-quote drafts" creates 12 `email_drafts` rows with `scenario='requote'`, each previewable in the drafts inbox
- Building a quote that includes an impacted SKU shows a yellow `YardFirstSourcing` banner pointing to the nearest branch with stock at the old price
- Service-role import path works from a cron, manual import path requires `manager` or `owner`

---

## 5. Wave 5C — Live nervous system

**Goal:** A single "customer health" number per company that updates live as deals, parts orders, service jobs, and AR aging change. AR aging that crosses thresholds blocks new credit-extended deals automatically (with override). Lifecycle view shows the customer's full multi-year arc on one timeline. Revenue attribution traces every closed deal back to the originating activity (voice capture, marketing campaign, walk-in, etc.).

### Backend
- Extend `cross_department_health_score` (mig 149) with a Postgres trigger network: any insert/update on `crm_deals`, `service_jobs`, `parts_orders`, `ar_invoices`, `voice_captures` recomputes the affected company's health score asynchronously via `pg_notify` + a `health-score-refresh` worker
- New table `customer_lifecycle_events`: `id`, `workspace_id`, `company_id`, `event_type` (`first_contact`, `first_quote`, `first_purchase`, `first_service`, `first_warranty_claim`, `nps_response`, `churn_risk_flag`, `won_back`, `lost`), `event_at`, `metadata`, `source_table`, `source_id`
- Trigger: any insert into `crm_deals` (won), `service_jobs`, `voice_captures` first-contact, etc., generates lifecycle events automatically
- New table `revenue_attribution`: `id`, `workspace_id`, `deal_id`, `attribution_model` (`first_touch`, `last_touch`, `linear`, `time_decay`), `touch_chain` jsonb (ordered list of touches with timestamps and touch_type), `attributed_amount`, `computed_at`
- New edge function `revenue-attribution-compute`: walks `crm_activities`, `voice_captures`, `marketing_engine` events, `crm_in_app_notifications` interaction logs to build the touch chain back from a closed-won deal
- New table `ar_credit_blocks`: `company_id`, `block_reason`, `block_threshold_days`, `current_max_aging_days`, `blocked_at`, `blocked_by`, `override_token`, `override_until`
- New trigger on `ar_invoices`: when any invoice for a company exceeds `ar_block_threshold_days` (configurable per workspace, default 60), insert into `ar_credit_blocks` and refuse new `crm_deals` insertion that includes financing for that company
- Migration: `157_live_nervous_system.sql`

### Frontend
- New component `HealthScorePill` (used on every company/contact/deal card) — colored pill 0–100, click → opens drawer with score breakdown
- New page `apps/web/src/features/customers/LifecyclePage.tsx` — horizontal timeline view of every `customer_lifecycle_events` row for one company, with revenue + service + parts spend overlay
- New page `apps/web/src/features/admin/AttributionDashboardPage.tsx` — closed-won deals grouped by attribution model, "voice-to-QRM contributed $420K of $1.2M closed in March"
- New component `ARCreditBlockBanner` — appears on the deal page if the company is blocked, with "Override" button (manager+ only) that opens a dialog to enter justification + duration

### Acceptance
- Logging a parts order or paying down an AR invoice for Acme Co updates Acme's health score within 5 seconds
- Acme's lifecycle page shows first contact (voice capture, Mar 2024), first quote (Apr 2024), first purchase (May 2024), first service job (Jun 2024) on a single timeline
- Closing a deal worth $180K with three voice captures + one cadence email + two in-app notifications in the touch chain shows the linear attribution at $36K per touch in `revenue_attribution`
- Acme's AR aging tipping past 60 days blocks creation of a new financed deal — error returned from `crm-router create_deal` action
- Manager override creates a row in `ar_credit_blocks` with `override_until` set; deal creation succeeds during the override window

---

## 6. Wave 5D — Portal completion + payments + library

**Goal:** The customer portal becomes a real product. Customers see live status of their deals, service jobs, and rentals; pay invoices via Stripe; reorder parts from history with one tap; and access every document the dealer has shared (contracts, insurance certs, warranty registrations, manuals).

### Backend
- Extend `portal-api/index.ts` with:
  - `GET /portal/deals/active` — returns the customer's open deals with current pipeline stage, next action, expected close date
  - `GET /portal/service/active` — open service jobs with status, ETA, assigned tech
  - `GET /portal/rentals/active` — active rentals with end dates, hour caps remaining, off-rent button
  - `POST /portal/parts/reorder` — given a `previous_order_id`, clones the line items into a new `parts_order` (status `pending_approval`)
- New edge function `portal-stripe`: PaymentIntent creation, webhook receiver for `payment_intent.succeeded`, automatic AR invoice mark-paid + ledger entry
- New table `customer_documents`: `id`, `workspace_id`, `company_id`, `document_type` (contract, invoice, warranty, insurance_cert, manual, photo, custom), `title`, `storage_path`, `uploaded_by`, `visible_to_portal` boolean, `uploaded_at`
- Migration: `158_portal_payments_and_library.sql`

### Frontend (portal app — separate React shell at `apps/portal`)
- New page `PortalDealsPage` — list of active deals with mini pipeline progress
- New page `PortalServicePage` — service job cards with live status, tech name, photo
- New page `PortalReorderPage` — parts order history with one-tap "Reorder" button
- New page `PortalDocumentsPage` — document library filtered to `visible_to_portal = true`, with download
- New `PayInvoiceButton` component on every open invoice using Stripe Elements

### Acceptance
- Acme logs into the portal and sees three active deals, one open service job (assigned to Mike, ETA Friday), and last month's invoice with a "Pay Now" button
- Clicking "Reorder" on a Mar 2026 parts order creates a new `parts_order` row in `pending_approval` and returns the new order id; the rep sees the new order in their queue
- Paying an invoice via Stripe Elements fires the webhook, marks the invoice paid, and adds a ledger entry — health score recomputes
- Portal documents page shows only documents marked `visible_to_portal=true`; service certs not yet released to the customer remain hidden

---

## 7. Wave 5E — SOP engine completion

**Goal:** Standard operating procedures become a first-class feature. Managers ingest SOPs from documents (pdf, docx, markdown), the system tracks every step a rep skips on a real workflow, surfaces a compliance dashboard, and fires contextual nudges in-line ("you skipped the deposit step on the last 4 deals").

### Backend
- Extend the existing `sop_engine` (mig 152) with an ingestion edge function `sop-ingest`: accepts pdf/docx/md, calls GPT to extract structured steps `(step_number, title, description, required_evidence, applies_to_role, applies_to_pipeline_stage)`, persists into `sop_steps`
- New table `sop_skip_events`: `id`, `workspace_id`, `sop_id`, `step_id`, `user_id`, `skipped_at`, `context_table`, `context_id`, `skip_reason`
- Trigger network: pipeline stage transitions (`crm_deals.stage_id` change) check the active SOP for the source stage and insert a skip event for any required step that has no matching evidence row
- New edge function `sop-compliance-rollup`: produces per-rep, per-team, per-step compliance percentages over a date window
- Migration: `159_sop_engine_complete.sql`

### Frontend
- New page `SopComplianceDashboardPage` (admin) — heat map of (rep × step) compliance percentages, drill-down to specific skip events
- New shared component `SopNudgeInline` — contextual yellow banner that appears at the top of any pipeline card whose deal has skipped a required step ("You skipped the deposit collection step on this deal — collect now?")
- New page `SopEditorPage` — manager view to edit ingested SOPs, mark steps as required vs optional, set evidence requirements

### Acceptance
- Uploading a "Sales Process v3.docx" SOP creates 14 `sop_steps` rows with role + stage assignments
- Advancing a deal from "Needs Assessment" to "Quote Sent" without a `needs_assessments` row inserts a skip event
- The compliance dashboard shows Rep A at 78% step compliance over the last 30 days, with the most-skipped step being "Decision-maker confirmation"
- Opening one of Rep A's deals with a skip event shows the yellow `SopNudgeInline` banner

---

## 8. Wave 6 — Fleet visibility & Asset Center (T3-inspired)

**Goal:** Take the most visceral parts of T3's UX (per-interval bars, live fleet map, asset detail with 24h activity) and **moonshot them** by joining commercial intelligence into every screen. The asset record becomes the join point between telematics, parts spend, service history, deal history, customer financials, and rep activity. Customers get a T3-grade portal view served by QEP; reps get the same view plus a commercial overlay T3 cannot match.

This wave reuses the existing `crm_equipment`, `telematics_readings`, `telematics_feeds`, `service_jobs`, `parts_orders`, `crm_deals` tables — no architecture reset.

### 6.1 — Shared UI primitives (ship FIRST, every other wave-6 task depends on them)

Build these as standalone components in `apps/web/src/components/primitives/` with full Storybook coverage.

- `<StatusChipStack>` — props: `chips: Array<{label, tone}>, max?: number`. Tones: `pink`, `orange`, `yellow`, `blue`, `green`, `red`, `purple`. Used by every list view in the app. Replaces the ad-hoc chips currently scattered across PipelineDealCard, ServiceJobRow, parts pages.
- `<FilterBar>` — props: `filters: Array<{key, label, type, options?}>, value, onChange`. Persists state in URL search params. Used at the top of every list page.
- `<CountdownBar>` — props: `label, current, target, unit, tone`. Renders a single horizontal progress bar with right-aligned "X remaining" label. The atomic unit T3 stacks for service intervals.
- `<AssetCountdownStack>` — composes multiple `CountdownBar` rows for a single `crm_equipment` row. Shows: service intervals, warranty expiration, manufacturer price-increase deadline, customer budget cycle, replacement cost crossover, lease/finance maturity, rental contract end. Pulls from a single composite RPC `get_asset_countdowns(equipment_id)`.
- `<ForwardForecastBar>` — top-of-dashboard strip with N counters ("92 service intervals due / 14 customers in budget cycle / 7 deals at SLA risk / $340K of quotes expiring / 23 trade-up windows opening"). Each counter is a click-through to a filtered list.
- `<Last24hStrip>` — props: `equipmentId`. Shows mechanical activity (run/idle/coolant/voltage from `telematics_readings`) AND commercial activity (quotes touched, parts ordered, calls logged, voice captures, portal logins) for the last 24 hours.
- `<AssetBadgeRow>` — props: `equipmentId`. Renders open work orders count, open quotes count, pending parts orders, overdue service intervals, trade-up score (0–100), lifetime parts spend pill. Each badge is tap-throughable to the underlying list.
- `<AskIronAdvisorButton>` — props: `contextType, contextId`. Floating button that opens the chat with the current record's full context preloaded. Drops onto every record screen.
- `<DashboardPivotToggle>` — props: `pivots: Array<{key, label}>, value, onChange`. The "Service Dashboard / Mechanic Overview" pattern, generalized.
- `<MapWithSidebar>` — wraps Mapbox with an asset list on the left and a configurable polygon overlay layer (branch territory, customer concentration, competitor density, opportunity markers, idle assets).

**Migration:** none (pure frontend)
**Backend:** new RPC `get_asset_countdowns(p_equipment_id uuid) returns table(label text, current numeric, target numeric, unit text, tone text, sort_order int)` lives in migration `160_asset_intelligence_rpcs.sql` (see 6.2)

**Acceptance:**
- Storybook story for each primitive renders across light/dark/mobile
- Each primitive has a `*.test.tsx` with prop variant coverage
- All primitives exported from `apps/web/src/components/primitives/index.ts`
- Existing PipelineDealCard refactored to use `StatusChipStack`; passes existing tests

### 6.2 — Asset 360 page

A single page joining everything QEP knows about one machine.

- New route `/equipment/:id` (currently shallow)
- Page layout:
  - Header: photo, asset #, year/make/model, location, current owner (company), assigned rep
  - `<AssetBadgeRow>` directly under the header
  - `<AssetCountdownStack>` left column (full width on mobile)
  - `<Last24hStrip>` right column
  - Tabs: Service History / Parts Spend / Deal History / Telematics Trend / Documents / Photos
  - Big "Recommend Trade-Up" button bottom right that fires `draft-email` with `scenario='trade_up'` and the full asset context
- New backend tables/RPCs:
  - RPC `get_asset_countdowns(p_equipment_id)` (described above)
  - RPC `get_asset_360(p_equipment_id)` — single round-trip returning equipment row + last 90d telematics aggregates + service job count + parts spend lifetime + open deal count + replacement cost curve point
  - New table `equipment_service_intervals`: `id`, `workspace_id`, `equipment_id`, `interval_label`, `interval_hours`, `last_completed_hours`, `last_completed_at`, `next_due_hours`
  - New table `replacement_cost_curves`: `id`, `make`, `model`, `category`, `hours_bracket`, `parts_spend_pct_of_new`, `service_spend_pct_of_new`, `recommended_action` — populated from analytics on actual service spend over time

**Migration:** `160_asset_intelligence_rpcs.sql`

**Acceptance:**
- Visiting `/equipment/<a SKYJACK SJ66T id>` loads in <500 ms with a populated countdown stack, badge row, and 24h strip
- Clicking "Recommend Trade-Up" creates an `email_drafts` row with `scenario='trade_up'` referencing the equipment, contact, company, and the deal the customer would trade into
- An asset with 4 open work orders shows 4 in the work-order badge; tapping it jumps to the filtered service jobs list

### 6.3 — Unified `/fleet` map page

Single live map of every `crm_equipment` row across all customers, with telematics overlay.

- New route `/fleet`
- `<MapWithSidebar>` with the following overlays toggleable: Branch Territory, Customer Concentration Heat Map, Open Opportunity Markers, Idle Asset Markers (no run hours in 7+ days), Service Truck Routes (today)
- Sidebar list scrollable with `<FilterBar>` at the top (Branch / Rep / Customer / Make / Status)
- Each list row uses `<StatusChipStack>` and tap → `/equipment/:id` (Asset 360)
- Default scope: rep sees their assigned customers' iron; manager sees branch; owner sees workspace

**Migration:** none (uses existing tables)
**Backend:** new edge function `fleet-map-data` returns clustered marker data with viewport bounds + filter params; existing `crm_equipment` + `telematics_feeds` + `crm_geofences` (added in 6.5)

**Acceptance:**
- 271K-asset stress test: map clusters render under 800 ms; clicking a cluster zooms in
- Overlay toggles persist in URL params (shareable links)
- A rep with 12 customers sees 47 assets; switching to manager view shows 412

### 6.4 — Service Dashboard (T3-cloned + commercially augmented)

The T3 Service Dashboard layout, rebuilt as a QEP page with the dealer overlay T3 cannot offer.

- New route `/service/dashboard`
- `<FilterBar>` at top: Branch / User Assignment / Originator / Date
- `<DashboardPivotToggle>` between "Service Dashboard" and "Mechanic Overview"
- "Maintenance Percentage Remaining" widget — bar chart bucketed Overdue / 0-10% / 11-20% / 21-100%
- "Overdue PM" big number widget
- `<ForwardForecastBar>` — service intervals due in 30/60/90 days
- Overdue Work Order Inspections table — every row uses `<StatusChipStack>` with the full T3-grade tag taxonomy
- New columns T3 doesn't have:
  - **Open deal value** for the customer this WO belongs to
  - **Trade-up score** for the asset
  - **Days since last commercial touch** for the customer
- Mechanic Overview pivot: each tech card shows clocked hours today (from `service_timecards`), open WO count, average WO close time

**Backend:**
- Extend `service_job_tags` enum with full T3-grade taxonomy (Parts Ordered, Parts Are All In, Internal Bill, Warranty, Diagnose, Customer Damage, Notified Sales, PM Service, Own Program Service Bulletin, Service Bulletin, DO NOT BILL, Pending Vendor Invoice, Exchange, Repair, Partial Parts In, Outside Repair, Parts Pulled)
- New table `service_timecards`: `id`, `workspace_id`, `service_job_id`, `technician_id`, `clocked_in_at`, `clocked_out_at`, `hours`, `notes`
- New view `service_dashboard_rollup` — pre-aggregated for the bucket widgets

**Migration:** `161_service_dashboard.sql`

**Acceptance:**
- Filtering by Branch=Charleston shows only Charleston WOs and the bucket widget recomputes
- An overdue PM WO whose customer also has an open $180K quote shows that $180K in the new "Open Deal Value" column
- Switching to Mechanic Overview shows each tech's clocked hours today

### 6.5 — Geofences and check-in/check-out triggers

Geofences as first-class objects that fire commercial triggers when assets enter or leave.

- New table `crm_geofences`: `id`, `workspace_id`, `name`, `geofence_type` (`branch_territory`, `customer_jobsite`, `competitor_yard`, `state_boundary`, `custom`), `polygon` (PostGIS `geography`), `linked_company_id`, `linked_deal_id`, `metadata`, `created_at`
- New table `geofence_events`: `id`, `equipment_id`, `geofence_id`, `event_type` (`entered`, `exited`), `event_at`, `triggered_action_id`
- Cron `geofence-evaluator` runs every 5 minutes against `telematics_readings` lat/lon; inserts geofence_events for crossings; fires triggers based on geofence_type
- Triggers:
  - `entered customer_jobsite` → cadence step "Customer received delivery" + notify rep
  - `exited customer_jobsite` → if rental, schedule off-rent inspection
  - `entered competitor_yard` → red alert to rep + manager (the asset is at a competitor for service?)
  - `exited state_boundary` → tax/permit compliance check

**Migration:** `162_geofences.sql` (requires PostGIS extension — verify enabled)

**Acceptance:**
- Drawing a polygon around a customer job site and assigning it to a deal fires a cadence step when the delivered machine enters the polygon
- An asset crossing into a Cat dealer's polygon raises a red alert in the rep's morning briefing

### 6.6 — Knowledge Base + Ask Iron Advisor everywhere

T3 has a single Knowledge Base button on the WO. We put `<AskIronAdvisorButton>` on **every** record screen.

- New table `service_knowledge_base`: `id`, `workspace_id`, `make`, `model`, `fault_code`, `symptom`, `solution`, `parts_used` jsonb, `contributed_by`, `verified` boolean, `verified_by`, `created_at`
- Extend the existing `chat` edge function to accept `context_type` + `context_id` and pre-load that record's full state into the system prompt
- Drop `<AskIronAdvisorButton>` on Asset 360, Deal page, Quote page, Service Job page, Parts Order page, Voice Capture page, Customer page

**Migration:** `163_service_knowledge_base.sql`

**Acceptance:**
- Tapping the button on a SKYJACK SJ66T WO opens chat with the asset, recent service history, and any matching `service_knowledge_base` entries already in the prompt
- A technician adds an entry "SJ66T low voltage at 4500 hrs → battery harness chafing → use kit P/N 12345"; the next WO on a 4500-hr SJ66T surfaces this in the prompt

### 6.7 — Customer portal fleet mirror

Give every customer the T3-grade map and per-asset service-bar view of *their* iron, served from QEP, branded as QEP, free.

- New portal route `/portal/fleet`
- Reuses `<MapWithSidebar>` and `<AssetCountdownStack>` (shared primitives — no duplication)
- Filtered automatically to `crm_equipment.company_id = current_customer_company_id`
- New portal route `/portal/equipment/:id` — read-only Asset 360 (no commercial overlay; instead surfaces "Talk to your rep" buttons that open chat with the assigned advisor)
- Portal-side hides cost columns, internal tags, deal value — RLS enforces this

**Migration:** none (RLS already covers it)
**Backend:** extend `portal-api` with `GET /portal/fleet` and `GET /portal/equipment/:id`

**Acceptance:**
- Acme logs in and sees their 12 machines on a map with service-interval countdown bars
- Clicking on a machine shows Acme-side Asset 360 with no internal cost data
- Acme cannot see any other customer's iron — verified by switching JWT in test

---

## 9. Cross-cutting concerns

### 9.1 — Branch + role enforcement

Every new table introduced above MUST have:
- `workspace_id text not null default 'default'`
- RLS enabled
- `*_workspace` policy using `get_my_workspace()`
- `*_service` policy for service role
- Where applicable, an additional policy that scopes by `branch_id` for branch-restricted users

### 9.2 — Mobile-first

Every new page must work on a 390px viewport. Service Dashboard and Asset 360 should be tested on iPhone 15 Pro Max and iPhone SE 3rd gen viewport sizes.

### 9.3 — Zero-blocking integrations

Stripe (Wave 5D), tax jurisdiction lookups (Wave 5A.3), price file imports (Wave 5B), telematics polygon checks (Wave 6.5) — every integration must have a manual fallback that keeps the workflow usable even if the external service is unavailable.

### 9.4 — Security gates

- Wave 5A.3: tax breakdown computation must NEVER trust client-supplied tax rates
- Wave 5C: AR credit blocks must be enforceable from the database trigger, not just the edge function
- Wave 5D: Stripe webhook must verify signature; no plaintext PAN ever touches QEP
- Wave 6.5: Geofence polygons stored as PostGIS `geography(POLYGON, 4326)` to prevent injection

### 9.5 — Test coverage minimums

- Edge functions: 80% line coverage
- New shared components: 100% prop variant coverage in tests + Storybook stories
- New RPCs: at least one positive + one negative test per security boundary

---

## 10. Pipeline handoff sequence

Recommended Paperclip pipeline order so blockers don't pile up:

1. **Architect** drafts blueprint per wave using `blueprint-template`
2. **Engineer** ships migrations + edge functions (backend first)
3. **QA** runs schema + RLS contract tests
4. **Engineer** ships frontend
5. **Security** audits any flow touching tax, AR, payments, RLS
6. **Quality Review** runs the build gate
7. **DevOps** deploys to staging
8. **Data & Integration** seeds demo data + verifies external integrations
9. **DevOps** deploys to production after staging green
10. **CEO (Speedy)** signs off, next wave kicks off automatically per CLAUDE.md execution cadence

---

## 11. Estimated effort

Rough order-of-magnitude (not commitments):

| Wave | Engineer-days | Notes |
|---|---|---|
| 5A.3 | 4 | Tax + Section 179 + incentives — well-defined |
| 5B | 6 | xlsx/pdf parsing is the variable |
| 5C | 5 | Triggers + attribution logic |
| 5D | 7 | Stripe + portal screens + library |
| 5E | 4 | SOP ingestion + dashboards |
| 6.1 | 3 | Pure frontend primitives — fastest wave |
| 6.2 | 4 | Asset 360 + RPCs |
| 6.3 | 3 | Fleet map (depends on 6.1) |
| 6.4 | 4 | Service Dashboard (depends on 6.1) |
| 6.5 | 5 | PostGIS work + cron evaluator |
| 6.6 | 3 | KB + chat context plumbing |
| 6.7 | 3 | Portal mirror (depends on 6.1, 6.2, 6.3) |
| **Total** | **~51 engineer-days** | One engineer ~10 weeks; with the Paperclip pipeline parallelizing across agents, ~3-4 weeks elapsed |

---

## 12. What's NOT in this roadmap (deliberately)

- Mobile native app — the responsive web is the mobile story for now
- Voice cloning for outbound calls — separate moonshot
- AI-generated SOWs / proposals beyond the existing quote builder
- Manufacturer EDI integrations beyond the existing Yanmar/Develon connectors
- Multi-language portal — single language for v1
- Offline-first PWA — staged for Wave 7

---

## 13. Definition of done for the whole roadmap

All of the following must be true before this roadmap is closed:

1. Every wave's migrations applied to production via `supabase db push`
2. Every wave's edge functions deployed via `supabase functions deploy`
3. Every wave's frontend live on production Netlify
4. Every shared primitive in 6.1 referenced in at least 2 production pages
5. The Asset 360 page exists and renders for at least 1 real production asset
6. The customer portal fleet mirror works for at least 1 real customer
7. The compliance dashboard shows non-zero data for at least 1 real SOP
8. A real price file has been imported, a real impact analysis computed, and at least one real `email_drafts` row generated and sent via Gmail
9. CLAUDE.md mission lock checks pass for every merged PR
10. No `as any` casts introduced in new TypeScript code
