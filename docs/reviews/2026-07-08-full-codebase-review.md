# QEP OS — Full Codebase Review
**Date:** 2026-07-08
**Method:** 74-agent multi-phase review — 11 module-cluster mappers, 8 cross-module seam analyses, 5 performance auditors, 2 roadmap analysts, 48 adversarial verifiers. 203 raw findings; the 48 highest-severity were each independently re-verified against the code (all 48 confirmed, several with corrections that made them *worse*). 155 medium/low findings retained unverified.

---

## Executive summary

QEP OS's modules are individually deep — sales/QRM, quote builder, parts intelligence, service engine, and the new rental department (Stream L) are each genuinely built. **The failure mode is the seams.** The review found one systemic pattern repeated ~40 times:

> **The schema and one side of a workflow ship; the connecting writer, event producer, or cron never does.** Tables with readers but no writers (`customer_fleet`, `fleet_intelligence`, `ar_credit_blocks`, `equipment_service_intervals`, `parts_stock.qty_reserved`, `parts_invoice_lines`, damage `*_cents` columns, `qrm_equipment.intake_stage`). Flow-engine events with consumers but no producers (`parts.item.received`, `service.*`, `equipment.hours_crossed_interval`, geofence exits). Buses with producers but no consumers (`flow_events`, rental fabric → sales).

The single most consequential consequence: **order-to-cash exists for only 2 of 4 revenue streams.** Service invoices fully; rental invoices but leaks at AR/tax/GL; **equipment sales and parts orders never produce an invoice at all** — the largest revenue lines in the business have no forward billing path, no AR aging, no dunning, no GL posting.

---

## Part 1 — The money spine (critical, fix first)

These 10 confirmed-critical findings form one coherent theme: revenue is earned in the modules but never converges into finance.

### 1.1 Equipment sale invoicing does not exist
No code creates a `customer_invoices` row with `invoice_type='equipment'`. `quote-builder-v2` (8,764 lines) has zero `customer_invoices` writes on accept/sign; `crm-router`'s mark-sold path bills nothing. Yet the full **reversal** machinery exists (`reverse_equipment_sale_by_stock_number`, migrations 540/659/667) and guards invoices that no workflow can create — and it requires `in_out_state='sold'`, which nothing ever writes, so the reversal feature is dead code too.
**Fix:** on `salesOrderSigned → delivered`, generate the equipment invoice from the accepted `quote_packages` row (deposits, trade credit, tax-calculator, FET), using migration 662's branch-prefixed numbering.
*Evidence: `supabase/migrations/471_equipment_invoice_view.sql:6`, `supabase/functions/_shared/crm-router-data.ts:2510`*

### 1.2 Parts orders never become invoices
`parts-order-manager` advances orders to delivered with zero invoice logic. `parts_invoice_lines` (migration 468) has **zero insert paths in the entire repo**. Counter POS stamps only `payment_received_at` — no tender type, no amount.
*Evidence: `supabase/functions/parts-order-manager/index.ts`, `supabase/migrations/468_parts_invoice_lines_customer_invoices.sql:24`*

### 1.3 No AR cash receipts / payment application
`customer_invoices.amount_paid` is only written by the Stripe portal path. There is no staff-side receive-payment workflow for checks, wires, ACH, or counter cash — no `customer_payments` table, no `record_ar_payment` RPC (the AP side got exactly this in migration 661). Every non-Stripe payer looks delinquent to dunning (664), credit holds, and owner credit-exposure views.
**Fix:** mirror the 661 AP pattern on the AR side: payments ledger + application RPC + receive-payments desk in finance-enforcement, counter POS, and rental command center.

### 1.4 Counter/QRM-anchored rental revenue never reaches AR or QuickBooks
`rental-billing-runner` mirrors a rental invoice into `customer_invoices` **only when `portal_customer_id` is set** — and skips silently (no exception, no metadata note, despite the header comment). Counter, Iron, and voice contracts anchor on `qrm_company_id` and get nothing: invisible to aging, `evaluate_credit_holds`, dunning, portal pay.
*Evidence: `supabase/functions/rental-billing-runner/index.ts:180-201`*

### 1.5 QuickBooks GL sync is service-only, and the account map can't classify rental/equipment
The only automatic producer of `quickbooks_gl_sync_jobs` is `_shared/service-invoice.ts:182`. Rental never enqueues. The GL account map (`_shared/quickbooks-gl.ts:11-18`) has no rental or equipment revenue account — `inferRevenueAccount` silently dumps them into **misc revenue**.

### 1.6 Rental is the only stream with no margin/discount gate
Equipment quotes have `qb_margin_thresholds` + approval cases; parts have a hard 25% floor + 5% counter discount cap (`parts_resolve_priced_line`); service quotes have per-rule floors. Rental: `rental-ops` accepts any `daily_rate > 0` with no comparison to the L1 book rate (`rental_resolve_rates`). A counter employee can rent a $200k machine at $1/day.
*Evidence: `supabase/functions/rental-ops/index.ts:366,406,445`; migration 771 has no floor concept.*

### 1.7 County tax engine applies only to equipment quotes
Service invoices insert `tax: 0` (`service-invoice.ts:126`); parts orders insert `tax_cents: 0` (`parts-order-manager:573,1349`); rental billing hardcodes `tax_cents: 0` with `tax_profile: 'workspace-unresolved'` — even though migration 666 built FL county rental tax + DR-15 evidence columns specifically for this. Related (unverified): collected tax is never persisted per-jurisdiction anywhere, so there is no remittance/filing report for any stream.

### 1.8 Two disconnected credit-hold systems; equipment/parts check neither
Rental checkout gates on `ar_credit_blocks` — a table with **no automated producer anywhere** (effectively empty). Finance maintains `qrm_companies.credit_hold` via `evaluate_credit_holds` — which nothing in the rental stream reads, and which itself runs only from a manual button (no cron). `quote-builder-v2` and `parts-order-manager` check **neither**. The never-called `assert_customer_not_on_hold()` (migration 657) is direct evidence the enforcement wiring was planned and dropped. A customer 90 days past due can buy a machine, run a parts account, and (because `ar_credit_blocks` is empty) rent iron.

### 1.9 Rental damage/return charges can never bill
The billing planner reads `rental_returns.fuel/cleaning/damage/environmental_charge_cents` — columns **nothing writes** (the ops wizard writes legacy `charge_amount` dollars instead; not even the demo seed populates the cents columns). And the only production producer of `rental_returns` (`iron_initiate_rental_return`, feature-flagged) inserts without `rental_contract_id`, so the billing join can never match. Assessed damage bills $0 on every real contract.

### 1.10 Rental billing bypasses invoice-number governance
Rental mints numbers from its own global sequence (`next_rental_invoice_number`) instead of the branch-prefixed `invoice_number_sequences` (655) whose UI already offers a 'rental' department type. Branch-prefixed numbering is enforced nowhere across streams (unverified medium).

**Recommended slice — "K1.2 Revenue Convergence":** one invoice pipeline where all four streams (a) create `customer_invoices` rows dual-anchored on `portal_customer_id OR crm_company_id`, (b) resolve tax through the shared tax-calculator, (c) pull branch-prefixed numbers, (d) enqueue `quickbooks_gl_sync_jobs` with proper rental/equipment GL accounts, and (e) feed one credit-hold source checked at quote-send, parts-submit, and rental-checkout. This unblocks AR receipts (1.3), statements, and honest exec revenue in one architecture.

---

## Part 2 — Missing gaps between modules (by seam)

### Sales ↔ Parts
- **Accepted quotes with parts lines never reach the parts module** (critical). Reps can add `part` line items to quotes (m569), but on acceptance no `parts_orders` row is created, no inventory decrements, and the counter is never notified. Account 360's lifetime-parts-spend and `customer_parts_intelligence` systematically undercount.
- **Quote builder prices parts at raw list price**, bypassing the m676 pricing engine (customer-specific prices, volume tiers, margin floor, 5% discount cap) that governs the counter. Same customer, two different legal prices, no per-line authority trail.
- **Deal-won parts follow-on never fires**: the m280 30/60/90-day parts playbook has a cron path that was never scheduled, and its only surface is a parts-staff page — `QrmDealDetailPage` and the rep's sales feed have zero parts references.
- (Unverified) Parts availability in the quote builder reads the legacy inventory table; parts price changes never reprice open quotes; predictive plays absent from every rep daily surface.

### Sales ↔ Service
- **A sold machine never triggers PDI/make-ready**: stage 17 "Equipment Ready" is honor-system. The `pdi_new_prep` work class (m691) has zero writers. Important nuance found in verification: `deal.stage.changed` events ARE emitted by DB trigger (m194) and the flow engine has an `open_internal_service_job` action — **the plumbing exists; no shipped workflow connects them**, and the event payload lacks `equipment_id`.
- **Trade-in `keep_recondition` (m766) never opens a recon work order**, actuals never write back to trade valuations (so the 10%/$2,500 material-change re-approval can never fire), and `record_trade_recondition_manager_approval` has no UI caller — the approval gate is inoperable from the product.
- **Service-to-sales generates zero pipeline entries**: `service-upsell-scanner` output is HTTP-response-only; technician `upsell_suggestions` are written to a column nothing reads; `ServiceToSalesPage`'s only mutation is an email draft — no deal, signal, or activity is ever created.
- **`fleet_intelligence` (replacement predictions) has had no writer since its creation in migration 013** — every replacement-opportunity surface (ServiceToSalesPage, ReplacementPredictionPage, command-center relationship engine) renders empty in production.

### Parts ↔ Service
- **Three unsynced stock ledgers** (critical): DMS PARTMAST import feeds `parts_catalog.on_hand`; picks decrement legacy `parts_inventory.qty_on_hand`; the G4.1 lookup engine reads Phase-3 `parts_stock`. No sync anywhere. The service-parts-planner plans against a table the DMS never feeds — divergent from day one.
- **Vendor-order plan actions dead-end**: no PO record is ever created (planner leaves `po_reference` NULL; the escalator then chases "missing PO" at 72h *by design*). No parts-procurement PO table exists at all — `vendor_purchase_orders` is explicitly for non-parts buys.
- **Reservations are schema-only**: `qty_reserved` is written only by inter-branch transfers; service requirements hold no stock; counter picks race service picks to `INSUFFICIENT_STOCK` at the shelf.
- **Service quotes price parts at `unit_cost ?? 0`** — CDK list price / pricing levels never consulted; blank cost quotes free parts.
- **Backorders block a stage but never reschedule the job**, and the flagship `parts-received-for-open-job` flow workflow can never fire: no event producer exists and `parts_orders` has no `service_job_id`.

### Rental ↔ everything
- **Check-in creates no return record, inspection, or work order** (critical): m773's gate is check-OUT only; the m774 trigger flips returned units straight to `available` — damaged iron is instantly re-rentable; `/ops/returns` is structurally empty for counter returns (the primary channel).
- **RPO rent-to-purchase dead-ends in a generic follow-up task** — despite the L5.1 ticket explicitly specifying "RPO conversion creates a qrm_deals row carrying accrued credit." No UI reads `rpo_credit_accrued_cents`.
- **No rental quoting path**: a rental "quote" is a lifecycle state, never a document — no customer-facing share, no e-sign, no approval case, no win/loss analytics.
- **The Rental Conversion Engine reads zero rental tables** — it scores rent-to-own candidates from CRM deal tags and voice captures while months of real `rental_contracts`/`rental_invoices` history sits unqueried.
- **Telematics fault codes never open service cases** — L7 faults become sales-feed signals only; for on-rent units a fault doesn't even flip readiness. The hours-crossed-interval workflow can never fire (no emitter).
- **Renter-fault damage WO is a billing orphan**: no customer_id, no contract backlink, and the return is never advanced when the job closes.
- (Unverified high) Rental absent from every exec/owner dashboard; portal bookings bypass both the rate resolver and the 773 checkout inspection gate; L7 disposal/demand intelligence is advisory-only.

### Canonical equipment record
- **Sold equipment never becomes `customer_fleet`** (critical): the table no production workflow writes — yet ~12+ modules read it (predictive kitter/failure/AI, service-upsell fleet recs, portal notifications, Asset 360 parts tab, trade exposure, deal timing, health score, predictive plays). Most of the predictive stack scans zero rows in production.
- **No surface shows a machine's full lifecycle**: Asset 360 has no rental/intake/invoice/trade data; `availability='sold'` and `traded_date` are never written; `equipment_service_intervals` and `replacement_cost_curves` have no writers (PM countdowns run on empty tables).
- **Intake is severed from the asset record**: stage 8 "Sale Ready" never updates `qrm_equipment`; the COO readiness MV counts `intake_stage < 5` on a permanently-NULL column — the metric reads 0 forever (and its ready/in_prep/blocked buckets filter on values no writer produces).
- **`/qrm/equipment` 404s**: Floor "All machines" links point at a route that doesn't exist; the qrm-router list contract is built but has no fleet-wide consumer.
- **`equipment-vision` cross-reference selects three nonexistent columns** (`status`, `list_price`, `rental_rate_daily`) — PostgREST errors on every call, swallowed by `?? []`; field reps never learn the dealership already stocks the machine they photographed.
- (Unverified) Equipment identity fragmented across five entities (`qrm_equipment`, `customer_fleet`, `equipment_intake`, `machine_profiles`, `replacement_cost_curves`).

### Customer 360
- **No live total-customer-value view; rental entirely absent from Account 360** (critical): `get_account_360` has no rental key; the only cross-department revenue picture is a stale manual IntelliDealer XLSX import.
- **Parts spend is split-brain** (critical): portal orders anchor on `portal_customer_id`, counter orders on `crm_company_id`; Account 360 reads only the portal side, `customer_parts_intelligence` only the counter side — two different wrong numbers for the same company. One-line fix: stamp `crm_company_id` on portal inserts (it's already loaded in the same request).
- **Customer DNA is sales-only**: `lifetime_value` is really lifetime *deal* value; no parts/service/rental input; auto-created profiles lack `crm_company_id` so company-keyed consumers silently miss them.
- **Health scores fabricate departments**: the parts component derives from attachment_rate + deal LTV (zero parts data); ownership health **hardcodes `v_rental_score := 75`** at 15% weight while live utilization RPCs exist.
- **Portal identity is an orphan**: only demo seeds ever create `portal_customers`; no invite/linking workflow exists, so everything hanging off portal identity degrades when `crm_company_id` is null.

---

## Part 3 — Connection architecture: what to build

The good news: **the connective tissue mostly exists — it's just unwired.** Highest-leverage moves, in order:

1. **Finish the event fabric** (the pattern m775 proved for rental):
   - Deal lifecycle events already emit (`trg_flow_emit_deal`); add `equipment_id` to the payload and ship the 4 missing consumers: make-ready WO on deposit-collected, parts playbook on closed-won, trade-recon WO on trade approval, RPO deal on threshold.
   - Add the missing **producers**: `parts.item.received`, service lifecycle events, geofence exits, portal actions. The consumers are already written and waiting.
   - Retire the second, write-only `flow_events` bus (m209 dual-write was never retired — Master Roadmap §19.8 flagged this and it was dropped).
2. **Schedule the deployed-but-unscheduled engines**: `post-sale-parts-playbook`, `parts-auto-replenish`, `parts-demand-forecast`, `parts-reorder-compute`, `parts-predictive-*`, `parts-network-optimizer`, `evaluate_credit_holds`, `run_ar_dunning_cycle`, `flow_cleanup_idempotency` — a whole autonomy layer exists behind manual buttons or nothing.
3. **Pick canonical entities and converge**: one stock ledger (feed `parts_catalog` from DMS, make picks hit it); one customer anchor (coalesced `crm_company_id` everywhere); one equipment lifecycle written by real transitions; `customer_fleet` auto-created on closed-won.
4. **Route all pricing through the governed engines**: quote builder → `parts_resolve_priced_line`; service quotes → parts_catalog retail matrix; rental → L1 book-rate floor with approval-case escape hatch.

---

## Part 4 — Missing features (in neither code nor any roadmap)

Verified critical: **AR cash receipts** (1.3) and **equipment sale invoicing** (1.1). High-confidence unverified, all DMS table stakes for the mission:

| Feature | Why it matters | Evidence of absence |
|---|---|---|
| **Commission engine** | The rep's daily scoreboard; Floor widget self-describes as placeholder "once QA-R2 defines rules" | `floor-widget-registry.tsx:366-372` |
| **Whole-goods procurement / unit cost ledger / floor-plan tracking** | Equipment enters inventory with no PO, landed cost, or flooring interest; margin reporting has no cost basis | AP 3-way match (m665) is parts-scoped only |
| **Trade-to-stock conversion** | Accepted trades vanish — no path from `qb_trade_ins` to a `qrm_equipment` stock unit | m766 records disposition intent, stops there |
| **Customer statements + finance charges** | How dealer customers actually pay; `ar_statement_runs` (m448) has zero writers | no statement run/doc/late-charge computation |
| **Payroll bridge** | Timecards + pay-ladder tiers exist; nothing aggregates to a pay run or export | `qrm_payroll_entries` explicitly dormant |
| **Barcode/scan at parts counter + bins** | Scan-driven counter ops are DMS baseline; bin schema shipped, no scanner input anywhere | no scan handler in parts/parts-companion |
| **Tax remittance reporting** | Collected tax never persisted per-jurisdiction; DR-15 filing impossible | `customer_invoices.tax_breakdown` has zero writers |

---

## Part 5 — Performance

### Verified (8)
1. **Parts catalog page pulls four whole tables and joins in JS** (critical) — with PostgREST `max_rows=1000`, at real scale this becomes *silent data corruption*: arbitrary SKUs missing, understated stock, broken joins. `usePartsCatalog.ts:11`, `PartsCatalogPage.tsx:52-65`.
2. **QRM pipeline hydration: 3 sequential round-trips per 500-row page** (redundant stages fetch + page + approval enrichment), every open deal held in memory + localStorage. `useOpenDealsHydration.ts:64`.
3. **`listCrmWeightedOpenDeals` unbounded** and feeding **six** pages with distinct query keys (no cache sharing).
4. **Floor pulse widgets aggregate whole tables client-side** on the owner's default landing screen (`BuPulseStrip`, `ExecRevenuePaceFloorWidget`) — sums silently wrong at >1000 rows.
5. **Iron Manager dashboard: 14 queries every 60s**, four unbounded, plus a sequential profile lookup waterfall.
6. **5.6MB of PNGs for a 72px avatar** — four Iron states ship ~1.4MB each; the idle state was already fixed to a 1.8KB webp (750× smaller); apply the same treatment. ~5-minute fix, biggest mobile win available.
7. **`vendor-ui` chunk (111KB gzip) preloads before first paint** and concatenates every lucide icon from all 32 lazy feature modules into the critical path. One-line `vite.config.ts` fix.
8. **`analytics_events` has zero retention/partitioning** — it's the flow-runner poll source and rental-scanner dedup source; unbounded growth in storage + full-table btree indexes.

### Notable unverified (spot-check these — several look like live incidents)
- **Realtime subscriptions are dead weight**: only `parts_requests`/`parts_request_activity` were ever added to the `supabase_realtime` publication (m245) — the Track 5.7 dashboard and quote-approval subscriptions listen to tables that never publish. (This is also runtime gate §19.7, never verified.)
- **Follow-up reminder dispatcher cron never registered**: m046 uses `'10 minutes'`, which is not valid pg_cron syntax.
- **Service workers double-scheduled**: pg_cron AND GitHub Actions both fire the same functions every 5 minutes.
- m773 per-row rollup trigger cascade on every rental line write; unindexed FKs (`inspection_runs.rental_contract_id`, `rental_reservation_holds.rental_contract_line_id`, no index for `ownership='rental_fleet'`); rental scanner dedup anti-joins on `analytics_events` with no usable index.
- Chat: 4 retrieval stages strictly sequential; up to 500 full `raw_text` documents loaded per message; TTFT blocked on telemetry writes. `crm-router` universal search: 5 sequential queries.
- `QuoteBuilderV2Page` is a 131KB-gzip single-route chunk; Floor home eagerly bundles every role's widgets (185KB); the CI bundle guard only measures `index-*.js` (~30% of startup payload).

---

## Part 6 — Roadmap reality check

Streams I (Grapple), J (Workforce) complete; F (Decision Velocity) 21/22; H (Service) 14/15; L (Rental) 8/9 (only L8.1 hardening remains). A 39/53; E 25/37; B 15/21; G 9/14; C 10/20; D 5/24 (the external-dependency parking lot: NDA, HubSpot key, exports, TILA docs). K (Financials) is the active decision gate — K1.1 AR/AP SoR shipped, K2.1/K3.1 await the finance working session.

**Silently dropped items worth resurrecting:**
- The Master Roadmap §19 **Runtime Verification Checklist (R1–R8) was never executed** — `docs/operations/runtime-verification.md` doesn't exist. By the roadmap's own rule, Tracks 1–6 remain "code-shipped but not fully closed." At least two of those gates (§19.7 realtime, §19.8 flow-bus dual-write) correspond to *real defects this review confirmed*.
- Track 7A/7B per-slice **depth audit** ("shell vs full") — never done; ~60 QRM lens pages exist whose content depth is unaudited, and this review found several running on writer-less tables (`fleet_intelligence`, `replacement_cost_curves`).
- Audit-roadmap P3.1 `formatCurrency` consolidation regressed: 49 local implementations now vs the 12 originally cited.
- `implementation_plan.md` at repo root is a stale unrelated doc (Haven/COL) — delete or archive.

**Where the roadmap should grow** (this review's synthesis): a **Stream M — Revenue Convergence** (Part 1 above: invoicing for all 4 streams, AR receipts, unified tax/GL/credit-hold, statements, commission) and a **Stream N — Seam Completion** (Part 3: event producers/consumers, scheduled autonomy, canonical entities). Both score higher on the Mission Lock's "Operator Utility" gate than most remaining Track 7B/7C surfaces: they make the moonshot intelligence layer *true* — today the health scores, predictive plays, and exec KPIs visibly run on fabricated or empty inputs.

---

## Suggested execution order

1. **Quick wins (days):** avatar webp variants; lucide out of vendor-ui; `crm_company_id` on portal parts orders; fix `equipment-vision` column names; register the `/qrm/equipment` route or repoint Floor links to `/fleet`; fix the m046 cron syntax; add tables to the realtime publication or remove dead subscriptions.
2. **Money spine (K-stream continuation):** equipment + parts invoicing → AR receipts desk → rental AR mirror for company anchors + GL accounts + tax on all streams → one credit-hold source enforced at all three checkouts.
3. **Seam completion:** deal-event consumers (make-ready, parts playbook, trade-recon, RPO deal); parts/service event producers; schedule the dormant engines; rental check-in inspection gate.
4. **Canonical entities:** one stock ledger; `customer_fleet` writer; equipment lifecycle transitions; Account 360 rental arm + honest health scores.
5. **Performance pass:** server-side aggregates for Floor/parts-catalog/dashboards; bounded queries; `analytics_events` retention; index the rental FKs.

---

*Full machine-readable findings (48 verified with per-finding adversarial verdicts + 155 unverified) are in the workflow output: `docs/reviews/2026-07-08-findings.json (stable IDs RF-001..RF-203; roadmap rows should cite RF IDs in evidence_link)`.*
