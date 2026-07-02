# QEP Parts Workflow Document — Review Candidate for Domain Validation

> **Status:** REVIEW CANDIDATE — ready for red-line and sign-off by **Juan + Norman**
> **Date:** 2026-05-29; refreshed 2026-06-30 after the roadmap source-of-truth migration unblocked D3.6
> **Roadmap task:** D3.6 — "Parts workflow document" (Stream D / Wave D3, _Parts module refinement gate_; roadmap id `3306`, source ref `CLAUDE_CODE_HANDOFF §8`)
> **Closes the operator-validation loop when:** Juan + Norman validate the workflow stages, confirm/correct the assumptions, and resolve (or defer) the open decision points in §20.
> **Authoring method:** Assembled from a structured, evidence-backed read of the live QEP codebase on 2026-05-29 (file/line citations throughout), the legacy IntelliDealer Phase-3 Parts index, and the D3.6 roadmap seed. The 2026-06-30 roadmap source-of-truth migration records that the Parts Department Discovery 28-decision-point answers unblocked D3.6; the underlying discovery/blueprint artifacts are still not committed in this repository, so claims that depend on those artifacts remain marked as assumptions (§19) and questions (§20).

---

## How to read this document

This is a **capture-and-refine** document, not a build spec. The QEP Parts module is already heavily implemented. The job here is to (a) describe the end-to-end parts workflow **as it actually exists in code today**, (b) map each stage to the real surfaces (frontend pages/components, edge functions, DB tables/views/RPCs), and (c) surface the gaps, inconsistencies, and unfinished edges as **decision points for the human owners**.

Every workflow section carries a **Status line** using this legend:

| Tag | Meaning |
|---|---|
| ✅ **Implemented** | Verified in code on 2026-05-29 with file/line evidence. |
| 🔶 **Inferred** | The surface is named/typed/wired, but full behavior was not exhaustively read, or is asserted from imports/usage. |
| 🏛 **Legacy-reference** | Exists only as an IntelliDealer baseline (PDF/screenshot index); not yet a QEP behavior. |
| ❓ **Open** | A gap, inconsistency, missing artifact, or product decision the owners must resolve. |

Reviewers: please mark each section **Confirmed / Correct-as-noted / Wrong** and add operator reality where the code and the floor disagree. Where you see ❓, your answer in §20 is what promotes this review candidate to signed v1.

---

## Table of contents

1. Purpose, Scope, and Reader Contract
2. Mission Context
3. Workflow Stage Model
4. End-to-End Workflow Narratives
5. Counter / Retail Sales Workflow
6. Parts Lookup & Identification
7. Quoting Workflow
8. Ordering & Purchasing Workflow
9. Vendor Management Workflow
10. Pricing Workflow
11. Inventory & Fulfillment Workflow
12. Returns / Cores / Exceptions Workflow
13. Invoicing & Financial Handoff Workflow
14. Service Department Integration Workflow
15. AI-Native Iron Capability Layer
16. Data & System Surfaces (Source Map)
17. Security / Workspace / RLS Constraints
18. Operational Metrics & Control Points
19. Assumptions
20. Open Questions / Decision Points for Juan + Norman
21. Validation Plan & Next Revision Process

---

## 1. Purpose, Scope, and Reader Contract

**Purpose.** Establish the single authoritative description of how parts flow through QEP OS — from intake through identification, quoting, ordering, fulfillment, invoicing, and the post-sale parts loop — so that Juan + Norman can validate it against real dealership operations and close the D3.6 refinement gate.

**In scope:** the QEP Parts module (`apps/web/src/features/parts/*`), the AI-native Parts Companion (`apps/web/src/features/parts-companion/*`), service-linked parts handling (`apps/web/src/features/service/*Parts*`), customer-facing portal parts (`apps/web/src/features/portal/*Parts*`), QRM parts intelligence, the parts edge-function fleet (`supabase/functions/*parts*` and related), and the parts data model (migrations enumerated in §16).

**Out of scope (referenced, not specified here):** equipment/deal quoting and e-signature (ADR-016), rental, full CRM/QRM, and the broader financial ledger — except where parts explicitly hand off to them (quote lines, customer invoices, deposits).

**Readers:** parts counter staff, service writers/techs, parts/branch management, the QEP implementation team, and the D3.6 owners (Juan + Norman).

**Reader contract:** This document distinguishes four states — Implemented, Inferred, Legacy-reference, Open — on every workflow section. Do not read an Implemented tag as "production-blessed"; read it as "this is what the code does today." Operator desirability is exactly what this review establishes.

---

## 2. Mission Context

Per the QEP mission lock, every shipped capability must advance equipment/parts **sales + rental** operations for field reps, employees, corporate operations, and management, and must reach materially beyond commodity dealer-management behavior.

The parts workflow is mission-central because it is where QEP either beats or merely matches the legacy IntelliDealer/CDK experience. The transformational thesis embedded in the current code is:

- **Collapse identification friction** — natural-language, photo, and voice part identification (`ai-parts-lookup`, `parts-identify-photo`, `voice-to-parts-order`) instead of catalog spelunking.
- **Make the machine the unit of demand** — machine profiles, predictive kits, and 30/60/90-day post-sale playbooks turn "what part?" into "what will this fleet need next?" (`machine_profiles`, `parts-predictive-kitter`, `post-sale-parts-playbook`).
- **Automate the boring supply chain** — reorder math (Wilson EOQ), demand forecasting, vendor scoring, schedule-aware auto-replenishment, and branch-transfer optimization (`parts-reorder-compute`, `parts-demand-forecast`, `parts-auto-replenish`, `parts-network-optimizer`).
- **Govern pricing as data, not tribal knowledge** — a pricing-rules engine with drift detection, suggestions, auto-apply, and an immutable audit trail (`264_pricing_rules_engine.sql`, `parts-pricing-autocorrect`).

This document pressure-tests whether those capabilities are coherent end-to-end, where they stop short, and which decisions only the owners can make.

---

## 3. Workflow Stage Model

The code implies the following canonical stages. **❓ Open:** confirm this is the stage model QEP wants staff trained on (see §20, D-1).

1. **Intake** — counter, phone, portal, service job, voice, photo, or autonomous (replenishment/predictive) origin.
2. **Identify / Lookup** — exact, semantic, FTS, cross-reference/substitute, machine-compatibility, photo, voice.
3. **Quote / Recommend** — parts quote header+lines, PM-kit suggestion, parts-as-lines on a deal quote.
4. **Order / Purchase** — internal counter/phone order; vendor purchase order; auto-replenish-generated order.
5. **Pick / Receive / Stage** — inventory decrement on pick, receipt on vendor arrival, staging by bin.
6. **Deliver / Fulfill** — ship with tracking, deliver, or consume on a service job.
7. **Invoice / Billing handoff** — parts invoice lines against customer invoices; service consume → billing staging.
8. **Returns / Cores / Exceptions** — returns, reman cores, substitutions, lost sales, overrides.
9. **Post-sale / Predictive loop** — maintenance playbooks, predictive kits, reorder history, churn signals.
10. **Analytics / Governance** — intelligence dashboards, pricing audit, metrics, control points.

These stages are **not** a single linear state machine in code. There are **two distinct transactional spines** — the counter/retail order spine (`parts_orders`) and the service-requirement spine (`service_parts_requirements`) — plus an autonomous spine (`parts_auto_replenish_queue`). Reconciling whether these should remain separate or converge is the central operator question (§20, D-2).

---

## 4. End-to-End Workflow Narratives

Each narrative below is traceable to code. Bracketed tags show the dominant status.

- **Counter sale [✅].** Staff open `NewPartsOrderPage` → `CounterSaleForm` → `parts-api.invokeCreateInternalOrder` → `parts-order-manager` creates a `draft` `parts_orders` row (+ `parts_order_lines`). Staff submit (`submit_internal_order`) → status `submitted`, a `fulfillment_run` is created, events emitted. Pick lines (`pick_order_line`) decrements inventory and auto-advances `confirmed → processing`. Advance to `shipped` (with tracking) → `delivered`.
- **Phone sale [✅].** Identical to counter; `order_source = 'phone'`.
- **Voice machine-down order [✅ with ❓ defect].** `VoicePartsOrderButton` (Web Speech API) → `voice-to-parts-order` extracts parts (GPT-4o-mini, heuristic fallback), fuzzy-matches catalog, builds a draft order, and **auto-submits** when `auto_submit && is_machine_down && crmCompanyId` are all true. **❓ A temporal-dead-zone defect exists in this function (see §12 / §20 D-11).**
- **Photo identification → draft [✅].** `PhotoPartIdentifier` → `parts-identify-photo` (GPT-4o vision) extracts OEM markings/part type/condition and fuzzy-matches the catalog; results feed an order draft.
- **Service job parts requirement [✅].** A job creates `service_parts_requirements` (from job-code templates via `service-parts-from-job-code`, AI suggestion, or manual). Lines start `intake_line_status = suggested`; an operator must `accept_intake_line` before fulfillment actions are allowed. `service-parts-manager` runs pick/receive/stage/consume/return; `consume` stages a billing line.
- **Vendor purchase order [✅ UI / 🔶 schema].** `PurchaseOrdersPage` creates/lists vendor POs (8-status lifecycle via `purchase-order-utils`). Backend PO persistence/table specifics not fully traced here (🔶).
- **Auto-replenishment [✅].** `parts-reorder-compute` (daily) maintains reorder profiles; `parts-demand-forecast` (weekly) projects demand; `parts-auto-replenish` reads reorder status + forecasts, scores vendors, and writes `parts_auto_replenish_queue` rows (`pending` / `scheduled` / `auto_approved`). Managers approve in `ReplenishmentApprovalCard` / Companion `ReplenishPage`.
- **Post-sale maintenance playbook [✅].** On deal close (`280_post_sale_parts_playbooks.sql`), `post-sale-parts-playbook` drafts a 30/60/90-day parts plan with Claude Sonnet 4.6, grounded against the catalog via `match_parts_hybrid`.

---

## 5. Counter / Retail Sales Workflow

**Status: ✅ Implemented** (order spine), with one ❓ UI/backend inconsistency.

**Entry surfaces.** `NewPartsOrderPage.tsx` composes `CounterSaleForm.tsx` (company search, `order_source`, line items, dual save vs. save-and-submit), `VoicePartsOrderButton.tsx`, and `PhotoPartIdentifier.tsx`. All three components are confirmed to exist.

**Data path.** Frontend `parts-api.ts` (`invokeCreateInternalOrder`, `invokeSubmitInternalOrder`, `invokeAdvanceStatus`, `invokePickOrderLine`, `invokeUpdateOrderLines`) → edge function `parts-order-manager` → tables `parts_orders`, `parts_order_lines`, `parts_order_events`, `parts_fulfillment_events`. All actions require `requireServiceUser` JWT auth (`parts-order-manager/index.ts:141-143`).

**Order status state machine (verified).**

- **Status values** (`order-status-machine.ts:1-7`): `draft → submitted → confirmed → processing → shipped → delivered`, plus terminal `cancelled`.
- **Backend-enforced transitions** (`parts-order-manager/index.ts:37-43`, `VALID_TRANSITIONS`):

  | From | Allowed next (backend) |
  |---|---|
  | `draft` | `cancelled` **only** (must use `submit_internal_order` to leave draft) |
  | `submitted` | `confirmed`, `cancelled` |
  | `confirmed` | `processing`, `cancelled` |
  | `processing` | `shipped`, `cancelled` |
  | `shipped` | `delivered` |
  | `delivered` / `cancelled` | _(terminal)_ |

- **Submit** (`submit_internal_order`): requires `crm_company_id` (`index.ts:187`); creates a `fulfillment_run` (`status='submitted'`), inserts `parts_fulfillment_events` (`internal_order_submitted`), and emits `parts_order_events` (`submitted`) (`index.ts:248-289`).
- **Pick** (`pick_order_line`): if order is `confirmed`, auto-advances to `processing` (`index.ts:562-563`); writes `counter_order_picked` to `parts_fulfillment_events`; decrements stock via `adjust_parts_inventory_delta_strict` RPC.
- **Ship**: accepts `tracking_number` + `estimated_delivery`; triggers `parts-order-customer-notify` for portal customers.
- **Line edits** allowed on `draft` only ("Lines can only be updated on draft orders", `index.ts:390-392`).
- **Line-level status:** none. `parts_order_lines` has no status column; line progress is tracked only via `pick_completed` / `counter_order_picked` events.

**❓ Verified inconsistency (D-3).** The UI helper `validNextStatuses("draft")` returns `["submitted","confirmed","cancelled"]` (`order-status-machine.ts:12-13`), so the order-detail UI can offer **draft → submitted** and **draft → confirmed** buttons. But the backend `advance_status` path rejects any `draft` transition except `cancelled` and forces draft orders through `submit_internal_order` (`index.ts:381-386`). The UI therefore advertises transitions the backend refuses. Owners must declare which is canonical and align the two.

**Order source.** DB check constraint allows `portal | counter | phone | online | transfer` (`132_parts_module_schema.sql`); the internal create path enforces `counter | phone | online | transfer` (`parts-order-manager`). `portal` is reserved for portal-originated orders (§5/§13 portal path).

---

## 6. Parts Lookup & Identification

**Status: ✅ Implemented** (multi-modal), 🔶 for some companion lookup internals.

| Channel | Surface | Verified behavior |
|---|---|---|
| Manual catalog | `usePartsCatalog.ts`, Companion `LookupPage` | Fetches active `parts_catalog`; companion `/` and `cmd+k` jump to lookup. |
| Semantic + FTS | `ai-parts-lookup` | Hybrid search via `match_parts_hybrid` RPC + OpenAI embeddings (single embed reused for catalog + RAG); `match_type ∈ {exact, semantic, fts, hybrid, cross_ref, machine_compat}`; KB evidence + inquiry logging; RAG circuit-breaker. |
| Cross-reference / substitute | `138_parts_cross_references.sql`, `find_part_substitutes` RPC, `PartCrossRefPanel.tsx` | Directed graph (`interchangeable / supersedes / superseded_by / aftermarket_equivalent / oem_equivalent / kit_component / kit_parent`); RPC returns symmetric edges with stock availability + price/lead-time deltas. |
| Photo | `PhotoPartIdentifier.tsx` → `parts-identify-photo` | GPT-4o vision; extracts `part_type / oem_markings / visible_part_number / condition / wear_indicators`; fuzzy-matches catalog. |
| Voice | `VoicePartsOrderButton.tsx` → `voice-to-parts-order` | GPT-4o-mini extraction + heuristic fallback; machine-down detection. |
| Counter voice agent | `parts-voice-ops` | Claude Sonnet 4.6 agentic loop (≤4 tool turns): semantic lookup, stock check, add-to-replenish, order history. |

**❓ Open:** companion lookup page internals and `match_parts_hybrid` thresholds/semantics for the lookup surface were not exhaustively read (🔶). `parts-identify-photo` silently swallows a cross-ref lookup error (`catch {}`) — confirm intended.

---

## 7. Quoting Workflow

**Status: 🔶 Schema-present, ❓ major gaps.** This is one of the most consequential review areas.

**What exists (verified schema).**

- `parts_quotes` (`414_parts_quotes.sql:13-38`): `quote_number`, `customer_id → qrm_companies`, `contact_id → qrm_contacts`, `salesperson_id`, `assigned_salesperson_id`, `location_branch_id`, `is_master`, `cloned_from_quote_id`, `status` (default `pending`), `expiry_date`, `subtotal_cents / discount_cents / tax_cents / total_cents`, `pdf_url`, `sent_at`, `converted_at`, `converted_service_job_id → service_jobs` (added in `480_parts_quote_wave2_columns.sql`), soft-delete.
- `parts_quote_lines` (`415_parts_quote_lines.sql:14-25`): `parts_quote_id` (cascade), `part_catalog_id → parts_catalog`, `part_number`, `qty (>0)`, `unit_price_cents`, `discount_pct`, `extended_price_cents`.
- **Parts-as-lines on the main quote system** (verified): `564_quote_part_line_kind.sql` adds `'part'` to `quote_line_kind`; `569_quote_package_line_items_part_type.sql` allows `'part'` line_type in quote packages. So reps can already attach parts to a **deal/equipment quote**.

**What is missing (verified gaps).**

- **❓ No parts quote-builder UI.** No dedicated parts quote builder component exists in `apps/web/src`; `NewPartsOrderPage` uses `CounterSaleForm` to create **orders**, not quotes.
- **❓ No quote→invoice conversion.** No RPC or edge function converts `parts_quotes` into `customer_invoices` or `parts_invoice_lines` (content search of `supabase/functions` for `parts_quote` / `parts_invoice_lines` / `converted_service_job` returned no conversion logic). Conversion is **schema-present only**.
- **❓ No quote→service-job conversion.** `converted_service_job_id` exists but no RPC performs the conversion.
- **❓ Parts quote acceptance undefined.** ADR-016 defines an equipment-quote acceptance/e-signature state machine (`sent → viewed → accepted_signed → deposit_requested → deposit_paid`); it does **not** cover parts quotes. `parts_quotes.status` defaults to `pending` with no defined acceptance lifecycle.

**Decision (D-4):** Is there a standalone Parts Quote workflow, or do parts quotes live inside the unified deal-quote builder (the `quote_line_kind='part'` path)? If standalone, the builder UI + conversion RPCs must be built; if not, the `parts_quotes`/`parts_quote_lines` tables may be redundant.

---

## 8. Ordering & Purchasing Workflow

**Status: ✅ Implemented** (internal orders), ✅ UI / 🔶 backend (vendor POs), ✅ (auto-replenish).

**Internal orders.** See §5 (the `parts_orders` spine).

**Vendor purchase orders.** `PurchaseOrdersPage.tsx` creates/lists/filters vendor POs. `purchase-order-utils.ts` defines:

- **PO status (8):** `po_requested → waiting_authorization → authorized → on_order → back_order → completed`, plus `canceled`, `rejected` (with `nextVendorPurchaseOrderStatuses()` controlling flow).
- **PO type (4):** `miscellaneous`, `equipment`, `fixed_asset`, `equipment_replenishment`.
- 🔶 The vendor-PO persistence table(s) and server enforcement were not fully traced; confirm the PO state machine is enforced server-side, not UI-only (D-3 family).

**Auto-replenish orders.** `parts-auto-replenish` writes candidate POs into `parts_auto_replenish_queue` with vendor scoring (`lead_time 0.25`, `fill_rate 0.30`, `responsiveness 0.25`, `price 0.20`) and schedule-awareness (defer to the vendor's ordering day → `status='scheduled'`). Auto-approval triggers when `estimated_total ≤ rule.auto_approve_max_dollars` and the row is not scheduled. **Verified backed by migrations 139 + 261** (the `scheduled` status and schedule-aware columns are added in `261_parts_phase2_replenish_and_machine_graph.sql:28-49`).

---

## 9. Vendor Management Workflow

**Status: ✅ Implemented** (schema + scoring), 🔶 (some UI internals).

- **Vendor master** (`095_service_parts_vendor_tables.sql`): `vendor_profiles` (`supplier_type ∈ {oem, aftermarket, general, specialty, internal}`, lead time, responsiveness, after-hours contact, machine-down escalation path), `vendor_contacts` (escalation tier), `vendor_escalation_policies`, `vendor_escalations` (step tracking; active = `resolved_at IS NULL`).
- **Vendor scoring** (`139`): `fill_rate`, `price_competitiveness`, `machine_down_priority`, `composite_score`, `score_computed_at`.
- **Vendor part catalog** (`139`): vendor ↔ part mapping with `unit_cost`, `lead_time_days`, `is_preferred` for auto-routing.
- **Vendor contact import** (`_shared/parts-import-vendor-contacts.ts`): multi-sheet workbook (Parts/Service/Admin + ordering schedule), tier-aware grouping.
- **Supplier health UI**: Companion `SupplierHealthPage`; `VendorMetricsCard.tsx` (avg lead time, fill rate, responsiveness, composite score, machine-down flag).

**❓ Open:** `vendor_escalations` has no explicit `status` field (active inferred from `resolved_at IS NULL`); `vendor_part_catalog.unit_cost`/`lead_time_days` are nullable but used in routing — confirm whether required. Which vendor contacts/escalation rules are production-ready (D-6 family)?

---

## 10. Pricing Workflow

**Status: ✅ Implemented** (engine + extraction + audit), with the D3.7 baseline ruleset now documented in [parts-pricing-ruleset.md](../architecture/parts-pricing-ruleset.md). Note: the pricing engine migration `264_pricing_rules_engine.sql` was **discovered during verification** and was not in the original D3.6 seed source list — flag for the owners as a material capability.

**D3.7 baseline ruleset.** The returned Parts Department Discovery resolves the Norman pricing gate for the Phase 3 baseline:

- Standard parts sell at list price unless a Parts Manager-set customer/volume price applies.
- Parts pricing targets 35% margin and must not go below the 25% margin floor.
- Counter staff may discount up to 5% off the parts price.
- Discounts beyond 5% require Parts Manager approval and block ticket close until approved.
- Parts pricing is not rep-negotiable; customer-specific and volume pricing are owned by the Parts Manager.
- Customer-pay service work orders use the standard parts price.
- Internal work orders use standard sell price minus 10%, never below the 25% margin floor. Controller sign-off remains required before the G11 launch.

**Ingestion.**
- `extract-price-sheet` (Claude Sonnet 4.6, 16k tokens) extracts manufacturer price documents (PDF/Excel/CSV) into `models / attachments / freight zones / programs`, writing `qb_price_sheet_items` (`item_type ∈ {model, attachment, freight, note}`, `review_status ∈ {approved, pending}`). Routes to `PRICE_BOOK_SYSTEM` vs `PROGRAMS_SYSTEM` prompt by sheet type.
- `_shared/parts-import-vendor-price.ts` parses vendor price catalogs (auto-detects part-number + price columns; bilingual descriptions) into `parts_vendor_prices`.

**Vendor price-break schema (verified).** `parts_vendor_prices` (defined `257_parts_intelligence_schema.sql`, extended `481_parts_vendor_price_wave2_columns.sql`): `vendor_id`, `vendor_code`, `part_number`, `description`/`description_fr`, `list_price`, `product_code`, `currency`, `effective_date`, `source_file`, `source_import_run_id`, **`min_qty`, `max_qty`** (the quantity price-break columns, `481:4-8`).

**Pricing rules engine** (`264_pricing_rules_engine.sql`):
- `parts_pricing_rules`: `scope_type ∈ {global, vendor, class, category, machine_code, part}`, `rule_type ∈ {min_margin_pct, target_margin_pct, markup_multiplier, markup_with_floor}`, `price_target ∈ {list_price, pricing_level_1..4, all_levels}`, `tolerance_pct`, `auto_apply`, `priority`, effective window.
- `v_parts_pricing_drift`: matches the highest-priority active rule per part, computes target sell price, flags `out_of_tolerance` when `|delta_pct| > tolerance_pct`.
- `parts_pricing_suggestions`: `status ∈ {pending, approved, applied, dismissed, expired}`; suggestions expire after 14 days.
- `parts_pricing_audit`: INSERT-only; `source ∈ {rule_auto_apply, rule_suggestion_approved, manual_edit, cdk_import, rollback}`.
- **Applying a suggestion** sets `parts_catalog.list_price_manual_override = true` so CDK re-imports do not silently overwrite a corrected price.

**Enforcement.** `parts-pricing-autocorrect` (cron or manual) calls `pricing_suggestions_generate()` (inserts suggestions only for **non-auto** rules) and, when invoked with `apply_auto_rules`, `pricing_suggestions_apply()` for `auto_apply=true` rules. **Margin signal:** `v_parts_margin_signal` correlates list/cost/avg-cost with the latest vendor list price and flags `potential_overpay` when `cost > vendor_list × 1.05`.

**Resolved / D3.7:** final pricing authority for baseline counter discounts is Parts Manager approval beyond the 5% counter cap; Parts Manager also owns customer-specific and volume pricing. The implementation gate is now schema validation: every priced line must be able to carry price source, rule/source identifier, approval state, approver metadata, cost/price/margin snapshots, and floor-applied flag. Cost and margin fields must remain policy-hidden from `sales_rep` and `parts_counter` roles.

**Remaining follow-ups:** freight, emergency-buy, vendor-direct, special-order fee markup, and core/exchange pricing are not fully specified in the returned discovery. Do not infer those markups in G8; represent them as explicit fee/manager-reviewed adjustments until separately signed. The internal work-order formula is documented but still needs Controller sign-off before G11 goes live.

---

## 11. Inventory & Fulfillment Workflow

**Status: ✅ Implemented.**

- **Reorder intelligence** (`136_parts_reorder_profiles.sql`): per-part/per-branch `consumption_velocity`, `avg_lead_time_days`, `lead_time_std_dev`, `safety_stock`, `reorder_point`, `economic_order_qty` (`computation_source ∈ {initial, cron_compute, manual_override}`); computed by `parts-reorder-compute` (Wilson EOQ, 25% holding-cost fraction, demand aggregated from order lines + service requirements + pick events).
- **Inventory health view** `parts_inventory_reorder_status` (`stock_status ∈ {no_profile, stockout, critical, reorder, healthy}`, `days_until_stockout`); surfaced in `InventoryHealthCard.tsx`.
- **Demand forecasts** (`137_parts_demand_forecasts.sql`): 90-day projections, `stockout_risk ∈ {none, low, medium, high, critical}`; computed by `parts-demand-forecast` (60% CDK 24-month history / 40% internal, seasonal decomposition). View `parts_forecast_risk_summary` (`coverage_status ∈ {no_inventory, action_required, watch, covered}`); surfaced in `DemandForecastCard.tsx`.
- **Fulfillment runs/events**: `parts_fulfillment_events` (append-only); `PartsFulfillmentPage.tsx` lists runs. 🔶 Run statuses observed in the page filter (`open, submitted, picking, ordered, shipped, closed, cancelled`) — confirm these match `fulfillment_runs.status` and its transitions (D-3 family).
- **Pick / receive / stage / consume / return**: the canonical verbs (counter spine via `pick_order_line`; service spine via `service-parts-manager` + `service_parts_apply_fulfillment_action`).
- **Branch transfers / network optimization**: `parts-network-optimizer` (weekly) recommends inter-branch transfers scored by net savings; surfaced in `TransferRecommendationsCard.tsx`. `service_parts_requirements` includes a `transferring` status supporting cross-branch hauls.
- **Predictive kits**: `parts-predictive-kitter` (24-month make+model patterns); `PredictiveKitsCard.tsx` with pre-staging.

---

## 12. Returns / Cores / Exceptions Workflow

**Status: 🔶 Schema-present, ❓ no dedicated UI.**

- **Returns:** `service-parts-manager` exposes `return_part` (→ `returned`, inventory +); `parts_orders` `cancelled` path exists but carries no reason capture / refund logic (verified: cancellation allowed from all active states but the cancellation branch is empty).
- **Cores / reman** (verified, `478_parts_catalog_wave2_columns.sql:32-34`): `is_reman` (boolean), `core_charge_cents` (bigint), `core_part_id` (uuid → parent part). Schema exists; **no dedicated cores/returns operator UI was found** (D-8).
- **Substitutions:** `PartCrossRefPanel` + `find_part_substitutes` (§6); `parts_invoice_lines.substituted_part_id` records substitution at invoice time.
- **Lost sales** (`412_parts_lost_sales.sql`): quantity, customer, reason, substitute — IntelliDealer-parity lost-sale tracking.
- **Inventory overrides:** `service_parts_inventory_overrides` audits privileged pick overrides (reason, qty after, insufficient flag, actor); override restricted to `admin|manager|owner`.

**❓ Verified code defect to route (D-11).** `voice-to-parts-order/index.ts` references `adminClient` at line 263 (`resolveProfileActiveWorkspaceId(adminClient, userId)`) **before** its `const adminClient = createClient(...)` declaration at line 270 — a JavaScript temporal-dead-zone `ReferenceError` that would throw on every call to the function. **This document records the observation only; no code was changed.** Recommend the owners route it to engineering to confirm and fix.

---

## 13. Invoicing & Financial Handoff Workflow

**Status: 🔶 Schema-present, ❓ handoff path not fully wired.**

- **Parts invoice lines** (`468_parts_invoice_lines_customer_invoices.sql`): `parts_invoice_lines` with full IntelliDealer-style quantity ladder (`qty_ordered / qty_issued / qty_shipped / qty_invoiced`), `cash_code`, `bin_location`, `ofc`, `tax_applies`, `substituted_part_id`; composite FK `(workspace_id, customer_invoice_id) → customer_invoices(workspace_id, id)`.
- **Service consume → billing staging** (`123_service_parts_override_and_billing_staging.sql`): `service_parts_apply_fulfillment_action(p_requirement_id, p_action, p_actor_id, p_override_reason default null)` — on `consume`, inserts a `service_internal_billing_line_staging` row (`line_type='parts_consume'`, `status='draft'`) as an invoice-ready queue.
- **Finance reconciliation** (`528_intellidealer_parts_finance_non_must.sql`): reconciles shipping-label runs to `customer_invoices`; adds billing-queue purge.

**❓ Verified gaps (D-4 family).**
- No traced path turns either a **counter `parts_orders`** record or the **service `service_internal_billing_line_staging`** queue into `parts_invoice_lines` on a `customer_invoices` header — the consumers of billing-staging `status` transitions (`draft → posted → void`) are not implemented in the reviewed code.
- Who is the **system of record** for parts invoices — QEP, or CDK/IntelliDealer with QEP mirroring? This determines whether the conversion is QEP's job at all.
- Deposits (`deposit-calculator`) are deal/commercial-adjacent, not a parts-workflow core.

---

## 14. Service Department Integration Workflow

**Status: ✅ Implemented.** This is the most complete cross-department spine.

**Queue.** `PartsWorkQueuePage.tsx` (`usePartsQueue.ts`) buckets active `service_parts_requirements` into **7 buckets** (`PartsWorkQueuePage.tsx:40-85`):

| Bucket | Condition (verified) |
|---|---|
| `machine-down` | machine-down flag set (any status) |
| `pull-now` | status `pending` or `picking` |
| `order-now` | status `ordering` without a PO |
| `waiting-vendor` | status `ordering` with a PO |
| `receiving-today` | `ordering` + expected date = today |
| `stage-for-tomorrow` | `received` + need-by date = today/tomorrow |
| `other` | default |

**Requirement status (verified, `095:25-27`):** `pending, picking, transferring, ordering, received, staged, consumed, returned, cancelled`. **Intake-line status (`125`):** `suggested, accepted, planned`.

**Actions.** `service-parts-manager` exposes 10 verbs: `add, update, remove, bulk_add, accept_intake_line, pick, receive, stage, consume, return_part`. Fulfillment actions are **blocked while `intake_line_status='suggested'`** (`125:145-148`) — an operator must `accept_intake_line` (role `rep|admin|manager|owner`) first. `pick` overrides require `admin|manager|owner` and audit to `service_parts_inventory_overrides`.

**Planning & seeding.** `service-parts-planner` applies a deterministic stock-first heuristic (local pick → cross-branch transfer → vendor order). `_shared/service-parts-from-job-code.ts` seeds requirements from `job_codes.parts_template`. `_shared/flow-workflows/parts-received-for-open-job.ts` notifies the service writer when parts arrive for an open job.

**Audit mirror.** `_shared/parts-fulfillment-mirror.ts` mirrors `shop_parts_action` events into `parts_fulfillment_events` when the service job carries a `fulfillment_run_id` (idempotency key; `audit_channel ∈ {shop, vendor, system}`).

---

## 15. AI-Native Iron Capability Layer

**Status: ✅ Implemented** (functions exist with real logic; several depend on RPCs to spot-check — see §16 open items).

| Capability | Function | Model / method |
|---|---|---|
| Semantic + FTS lookup | `ai-parts-lookup` | `match_parts_hybrid` + OpenAI embeddings |
| Photo identification | `parts-identify-photo` | GPT-4o vision |
| Voice order intake | `voice-to-parts-order` | GPT-4o-mini + heuristic fallback |
| Counter voice agent | `parts-voice-ops` | Claude Sonnet 4.6, ≤4 tool turns |
| Demand forecast | `parts-demand-forecast` | 60/40 CDK blend, seasonal decomposition |
| Reorder math | `parts-reorder-compute` | Wilson EOQ |
| Autonomous replenishment | `parts-auto-replenish` | vendor scoring + schedule-aware queue |
| Network optimization | `parts-network-optimizer` | transfer recs + churn/opportunity |
| Predictive failure | `parts-predictive-failure` | `predict_parts_needs` RPC |
| Predictive kits | `parts-predictive-kitter` | 24-month make+model patterns |
| Predictive AI plays | `parts-predictive-ai` | Claude Sonnet 4.6 (0.35 hybrid / 0.45 cosine grounding) |
| Post-sale playbooks | `post-sale-parts-playbook` | Claude Sonnet 4.6, 30/60/90-day windows |
| Semantic embeddings | `parts-embed-backfill` | `text-embedding-3-small` |
| Bulk import | `parts-bulk-import` | preview/commit + conflict guards (CDK PARTMAST 187-col) |

**Companion AI surface.** `PartsCompanionShell` provides an Iron AI assistant panel, a voice-ops modal, a new-request flow, and global keyboard shortcuts (`/`, `cmd+k`, `q`, `a`/`i`, `n`, `v`, `ESC`).

---

## 16. Data & System Surfaces (Source Map)

Grouped by area. **Status** column uses the §0 legend. Evidence is in the section bodies above; representative file/line anchors are cited inline.

### 16.1 Frontend — core parts operations (`apps/web/src/features/parts/`)

| Type | Path | Purpose | Stage | Status |
|---|---|---|---|---|
| Page | `pages/PartsCommandCenterPage.tsx` | Ops cockpit: pipeline, inventory health, forecast, replenishment, predictive kits, transfers | Monitor | ✅ |
| Page | `pages/NewPartsOrderPage.tsx` | Counter/phone order entry (form + voice + photo) | Intake | ✅ |
| Page | `pages/PartsOrdersPage.tsx` | Order list filtered by source | Order mgmt | ✅ |
| Page | `pages/PartsOrderDetailPage.tsx` | Status advance, submit, pick, cross-ref, timeline | Order/Fulfill | ✅ |
| Page | `pages/PartsFulfillmentPage.tsx` | Fulfillment run list | Fulfillment | ✅ |
| Page | `pages/PurchaseOrdersPage.tsx` | Vendor PO create/list | Purchasing | ✅ |
| Component | `components/CounterSaleForm.tsx` | Internal order form, dual save/submit | Intake | ✅ |
| Component | `components/VoicePartsOrderButton.tsx` | Voice order (Web Speech), machine-down + auto-submit | Intake | ✅ |
| Component | `components/PhotoPartIdentifier.tsx` | Photo ID UI → `parts-identify-photo` | Identify | ✅ |
| Component | `components/OrderStatusBadge.tsx` | Status badge | Order mgmt | ✅ |
| Component | `components/OrderTimelineCard.tsx` | Event timeline (13+ event types) | Audit | ✅ |
| Component | `components/OrderPipelineBoard.tsx` | 5-stage pipeline (draft→shipped) | Monitor | ✅ |
| Component | `components/PartCrossRefPanel.tsx` | Substitutes w/ confidence, stock, deltas | Substitute | ✅ |
| Component | `components/InventoryHealthCard.tsx` | 5 stock statuses + reorder metrics | Inventory | ✅ |
| Component | `components/VendorMetricsCard.tsx` | Vendor scorecard | Vendor | ✅ |
| Component | `components/DemandForecastCard.tsx` | 90-day forecast + risk | Forecast | ✅ |
| Component | `components/ReplenishmentApprovalCard.tsx` | Approve/reject replenish queue | Replenish | ✅ |
| Component | `components/PredictiveKitsCard.tsx` | Predictive kits + pre-stage | Predictive | ✅ |
| Component | `components/TransferRecommendationsCard.tsx` | Branch transfer recs | Inventory | ✅ |
| Lib | `lib/order-status-machine.ts` | `OrderStatus` + `validNextStatuses()` (UI) | Order mgmt | ✅ |
| Lib | `lib/purchase-order-utils.ts` | PO status (8) + type (4) + transitions | Purchasing | ✅ |
| Lib | `lib/parts-row-normalizers.ts` | Normalizers for all parts data types | Data | ✅ |
| Lib | `lib/parts-api.ts` | `parts-order-manager` invocations | Order lifecycle | ✅ |
| Hook | `hooks/usePartsOrders.ts`, `hooks/usePartsCatalog.ts` | Order/catalog fetch | Data | ✅ |
| Hook | `hooks/useOrderEvents.ts`, `useCrossReferences.ts`, `useInventoryHealth.ts`, `useDemandForecast.ts`, `useReplenishQueue.ts`, `usePredictiveKits.ts`, `useTransferRecommendations.ts` | Data hooks for the cards | Data | 🔶 |

### 16.2 Frontend — service-facing parts (`apps/web/src/features/service/`)

| Type | Path | Purpose | Status |
|---|---|---|---|
| Page | `pages/PartsWorkQueuePage.tsx` | 7-bucket service parts queue | ✅ |
| Hook | `hooks/usePartsQueue.ts` | Active requirements + relations | ✅ |
| Component | `components/PartsQueueBucket` | Bucket render + actions | 🔶 |

### 16.3 Frontend — Parts Companion (`apps/web/src/features/parts-companion/`)

| Type | Path | Purpose | Status |
|---|---|---|---|
| Routes | `PartsCompanionRoutes.tsx` | 14-route IA | ✅ |
| Shell | `PartsCompanionShell.tsx` | Two-panel shell, AI panel, voice modal, shortcuts | ✅ |
| Pages | `pages/{Queue, Lookup, Machines, MachineProfile, Arrivals, Import, ImportConflicts, Intelligence, PredictivePlays, PricingRules, Replenish, PostSalePlays, SupplierHealth}Page.tsx` | Companion screens | ✅ |
| Lib | `lib/pricing-api.ts` | Pricing rules/suggestions/drift client | ✅ |
| Components | `components/{CompanionSidebar, CompanionTopBar, AiAssistantPanel, NewRequestFlow, VoiceOpsModal}` | Shell sub-components | 🔶 |

**Companion routes (verified):** `/parts/companion/{queue, lookup, machines, machines/:machineId, arrivals, import, import/conflicts, import/conflicts/:runId, intelligence, predictive-plays, pricing, replenish, post-sale, suppliers}`.

### 16.4 Frontend — portal, QRM, dashboards

| Type | Path | Purpose | Status |
|---|---|---|---|
| Portal page | `features/portal/pages/PortalPartsPage.tsx` | Customer cart, AI PM-kit suggest, draft/submit, order tracking + ETA | ✅ |
| Portal component | `features/portal/components/PartsReorderHistory.tsx` | One-click reorder from history (fleet-scoped) | ✅ |
| QRM page | `features/qrm/pages/PartsIntelligencePage.tsx` | Manager: account demand signals, demand pressure, kit posture | ✅ |
| QRM lib | `features/qrm/lib/parts-intelligence.ts` | `buildPartsIntelligenceBoard` aggregation | ✅ |
| Dashboard | `features/dashboards/widgets/impls/parts-widgets.tsx` | Replenish-queue summary widget | ✅ |

### 16.5 Edge functions — transactional & AI

| Path | Purpose | Status |
|---|---|---|
| `parts-order-manager` | Order CRUD + state machine + pick + events | ✅ |
| `service-parts-manager` | 10-verb service requirement fulfillment | ✅ |
| `process-parts-request` | `parts_requests` lifecycle (state-validated) | ✅ |
| `ai-parts-lookup` | Hybrid semantic/FTS search + KB RAG | ✅ |
| `parts-identify-photo` | GPT-4o vision identification | ✅ |
| `voice-to-parts-order` | Voice → draft order (❓ TDZ defect, §12) | ✅ w/ ❓ |
| `parts-voice-ops` | Claude agentic counter voice ops | ✅ |
| `post-sale-parts-playbook` | 30/60/90-day playbook (Claude) | ✅ |
| `parts-auto-replenish` | Autonomous replenishment queue | ✅ |
| `parts-pricing-autocorrect` | Pricing rule enforcement | ✅ |
| `extract-price-sheet` | Claude price-doc extraction | ✅ |
| `parts-bulk-import` | CDK PARTMAST/vendor preview+commit | ✅ |
| `parts-demand-forecast` | 90-day forecast (60/40 CDK blend) | ✅ |
| `parts-reorder-compute` | Wilson EOQ reorder profiles | ✅ |
| `parts-network-optimizer` | Transfer recs + churn intel | ✅ |
| `parts-predictive-ai` / `-failure` / `-kitter` | Predictive plays / needs / kits | ✅ |
| `parts-order-customer-notify` | Ship notifications (email + portal) | ✅ |
| `parts-embed-backfill` | Embedding backfill | ✅ |
| `service-parts-planner` | Stock-first sourcing per job | ✅ |
| `deposit-calculator`, `embed-qrm` | Commercial/RAG adjacency (not parts-core) | ✅ (adjacent) |

### 16.6 Edge shared modules (`supabase/functions/_shared/`)

| Path | Purpose | Status |
|---|---|---|
| `parts-import-partmast.ts` | CDK PARTMAST 187-col parser + 24-mo history | ✅ |
| `parts-import-types.ts` | Import types + field-priority + override registry | ✅ |
| `parts-import-vendor-contacts.ts` | Multi-sheet vendor contacts parser | ✅ |
| `parts-import-vendor-price.ts` | Vendor price catalog parser | ✅ |
| `parts-fulfillment-mirror.ts` | Mirror shop actions → fulfillment events | ✅ |
| `service-parts-from-job-code.ts` | Seed requirements from job-code templates | ✅ |
| `flow-workflows/parts-received-for-open-job.ts` | Notify writer on parts receipt | ✅ |

### 16.7 Database migrations (verified filenames + purpose)

Foundational / high-confidence (read in full):

| Migration | Purpose |
|---|---|
| `095_service_parts_vendor_tables.sql` | Service parts requirements/actions/staging + vendor profiles/contacts/escalations |
| `123_service_parts_override_and_billing_staging.sql` | Override audit + consume→billing staging + fulfillment RPC |
| `132_parts_module_schema.sql` | `parts_catalog`, `parts_orders`, `parts_order_lines`, RLS |
| `136_parts_reorder_profiles.sql` | Reorder profiles + inventory reorder status view |
| `137_parts_demand_forecasts.sql` | Demand forecasts + risk summary view |
| `138_parts_cross_references.sql` | Cross-ref graph + `find_part_substitutes` RPC |
| `139_parts_autonomous_operations.sql` | Replenishment rules/queue, vendor scoring, vendor part catalog, order events |
| `245_parts_companion_foundation.sql` | Machine profiles, parts requests/activity, `v_parts_queue`, inquiries, preferences |
| `257_parts_intelligence_schema.sql` | CDK/PARTMAST catalog fields, vendor prices, imports/conflicts, margin signal |
| `264_pricing_rules_engine.sql` | **Pricing rules/suggestions/audit + drift view + RPCs** (not in D3.6 seed list) |
| `414_parts_quotes.sql` / `415_parts_quote_lines.sql` | Parts quote header + lines |
| `468_parts_invoice_lines_customer_invoices.sql` | Parts invoice lines ↔ customer invoices |
| `478_parts_catalog_wave2_columns.sql` | Reman/core, central order, labels, transit, discounts/taxes, demand fields |
| `481_parts_vendor_price_wave2_columns.sql` | Vendor price quantity-break columns (`min_qty`, `max_qty`) |
| `594_qep_roadmap_tasks_seed.sql` | Roadmap seed incl. D3.6 |

Resolved supporting set (filenames verified; purposes from headers):

| Migration | Purpose |
|---|---|
| `111_parts_inventory_adjust_rpc.sql` | Atomic inventory adjust (pick/receive/return), row-locked |
| `115_parts_fulfillment_and_profile_workspaces.sql` | Fulfillment runs + profile-workspace membership |
| `116_parts_fulfillment_staff_event_rls.sql` | RLS for staff fulfillment events / mark shipped |
| `117_parts_orders_fulfillment_status_trigger.sql` | Sync fulfillment runs on order status change |
| `118_parts_fulfillment_events_workspace_index.sql` | Workspace index on fulfillment events |
| `119_parts_order_ship_notification_dedupe.sql` | Idempotent ship emails |
| `120_search_parts_orders_for_link.sql` | Staff search portal orders |
| `121_service_parts_fulfillment_transaction_rpc.sql` | Transactional fulfillment RPC (3-arg) |
| `125_service_parts_intake_line_status.sql` | Intake line lifecycle + accept RPC + gating |
| `129/130_parts_fulfillment_events_*audit_channel*.sql` | Audit channel tagging + backfill |
| `131_parts_fulfillment_events_idempotency_key.sql` | Idempotency key for events |
| `133_parts_catalog_rls_and_orders_index.sql` | Catalog RLS split + order index |
| `134_parts_security_hardening.sql` | Tighten order RLS + strict inventory perms |
| `140_parts_field_intelligence.sql` | Voice/photo metadata + predictive failure kits |
| `141_parts_network_analytics.sql` | Transfer recs, analytics snapshots, customer intel |
| `149_cross_department_health_score.sql` | Cross-dept health score + alerts |
| `252/253_fix_parts_team_iron_role*.sql` | Parts Team routing fix |
| `258_parts_imports_storage.sql` | Import storage bucket |
| `259_parts_import_drift_view.sql` | Import drift detection view |
| `260_parts_intelligence_phase2.sql` | Velocity/stockout/dead-capital views |
| `261_parts_phase2_replenish_and_machine_graph.sql` | **Schedule-aware replenish (`scheduled` status + columns) + machine graph** |
| `262/263_predictive_parts_plays*.sql` | Predictive plays + dedup fix |
| `268/269/271_*semantic_search*/*embeddings*/*hybrid*.sql` | pgvector semantic search + hybrid RPC fixes |
| `280_post_sale_parts_playbooks.sql` | 30/60/90-day playbooks at close-won |
| `390_bu_pulse_parts_invoices_backfill.sql` | BU Pulse fixture backfill |
| `401_qrm_company_department_reps.sql` | Per-department customer reps (parts/service/…) |
| `412_parts_lost_sales.sql` | Lost-sale tracking |
| `413_parts_memos.sql` | Buyer/counter memos on Parts Profile |
| `479_parts_order_wave2_columns.sql` | `po_type`, `freight_charge_cents`, `customer_id` |
| `480_parts_quote_wave2_columns.sql` | Quote→service-job conversion columns |
| `502_wave4_customer_parts_views.sql` | Resale cert + months-supply views |
| `528_intellidealer_parts_finance_non_must.sql` | Shipping-label ↔ customer_invoices reconcile |
| `537_equipment_invoice_reversal_candidate_partial_guard.sql` | Guard partially-paid invoice reversal (equipment-adjacent) |
| `564_quote_part_line_kind.sql` / `569_quote_package_line_items_part_type.sql` | Add `'part'` to quote line kinds/types |
| `619_qep_authorize_two_party_signatures.sql` | AUTHORIZE-lane two-party signatures (governance-adjacent) |

### 16.8 Legacy IntelliDealer baseline (🏛, visual reference only)

`docs/IntelliDealer/Phase-3_Parts/INDEX.md` indexes 5 PDFs / ~30 screenshots: **Parts Invoicing; Parts Ordering** (+ Price Breaks, Purchase Details, Vendors); **Parts Profile: Listing**; **Price Matrix** (+ Price Breaks, Pricing Detail); **Purchase Orders**; **Parts Quoting** (+ Service). Parity notes per stage:

| QEP stage | Legacy screen | QEP-vs-legacy parity |
|---|---|---|
| Ordering | Parts Ordering / Purchase Details / Vendors | ✅ orders + ✅ POs implemented; map field-level parity |
| Pricing | Price Matrix / Price Breaks / Pricing Detail | ✅ engine + breaks (`min_qty`/`max_qty`) — confirm matrix parity |
| Purchasing | Purchase Orders | ✅ UI / 🔶 backend |
| Quoting | Parts Quoting / Parts Quoting (Service) | 🔶 schema only; ❓ no builder/conversion (§7) |
| Invoicing | Parts Invoicing | 🔶 schema; ❓ handoff (§13) |
| Profile | Parts Profile: Listing | ✅ catalog + memos (`413`) + lost sales (`412`) |

---

## 17. Security / Workspace / RLS Constraints

**Status: ✅ Implemented**, with two ❓ scoping items.

- **Workspace scoping** is enforced consistently via `get_my_workspace()` across parts RLS policies (`132`, `245`, `138`, etc.).
- **Role gating** via `get_my_role()`: catalog mutate requires `rep|admin|manager|owner`; machine profiles mutate `admin|owner`; service pick override `admin|manager|owner`; intake accept `rep|admin|manager|owner`.
- **Service-role bypass** policies exist on parts tables for edge-function access (`132:67-69`, `245`, `138`).
- **Auth before logic:** `parts-order-manager` and `service-parts-manager` both call `requireServiceUser` before any business logic (consistent with the project's explicit-JWT edge pattern).
- **Portal RLS** (`085_portal_rls_hardening.sql`): portal customers can SELECT + INSERT their own draft orders but cannot UPDATE status/totals.

**❓ Open (D-12).**
- `counter_inquiries` and `parts_preferences` RLS policies are reported to scope by `user_id` only (no `workspace_id` filter) — a possible cross-workspace exposure for users in multiple workspaces. Confirm and harden if real.
- `parts_orders.status` is enforced at the application layer (7 values) but a DB-level CHECK/enum was not confirmed in the reviewed migrations — confirm DB enforcement.

---

## 18. Operational Metrics & Control Points

Implied by existing views/widgets (✅ data exists; ❓ which are the canonical KPIs for the floor):

- Open orders by status; order pipeline counts (`OrderPipelineBoard`).
- Stockouts / stockout-risk; `stock_status` distribution (`parts_inventory_reorder_status`).
- Forecast coverage / `coverage_status`; `days_of_stock_remaining` (`parts_forecast_risk_summary`).
- Auto-replenish: pending vs. scheduled vs. auto-approved counts; `potential_overpay_flag` count; estimated spend (`261` summary RPC).
- Vendor fill rate / composite score / machine-down readiness (`vendor_profiles`).
- Pricing drift count; suggestions pending/applied; margin signal / overpay (`v_parts_pricing_drift`, `v_parts_margin_signal`).
- Service queue: machine-down volume; unfulfilled requirements; consume→billing staging backlog.
- Import health: conflicts unresolved; import drift (`259`).
- Cross-department health score (`149`).

---

## 19. Assumptions

These claims could **not** be verified against the repository and must be confirmed by the owners. Each maps to a question in §20.

1. **External discovery inputs are not committed in-repo.** The roadmap now records that the Parts Department Discovery **28-decision-point answers** unblocked D3.6, but the underlying discovery/blueprint artifacts (`QEP_PHASE3_PARTS_BLUEPRINT`, `CLAUDE_CODE_HANDOFF §8`) are not committed here. Any operator intent, business rule, or priority that should come from those artifacts remains **assumed** until Juan + Norman confirm it in review. (→ D-0)
2. **The 10-stage model (§3) reflects desired operator practice.** It is inferred from code, not from a validated dealership workflow. (→ D-1)
3. **Counter and service parts are intended as two coordinated spines.** The code keeps them separate; whether they should converge is assumed open. (→ D-2)
4. **Parts quoting and parts invoicing are intended QEP responsibilities.** Schema exists but the workflows are incomplete; it is assumed the owners want QEP (not solely CDK) to own these. (→ D-4)
5. **`ADR-003` (progressive customer capture, Parts) and `ADR-004` (serial-number primary entry) describe intended behavior.** **Verified: neither ADR file exists** in `docs/adr/` (only `ADR-016` is present), yet roadmap context references them as design basis. Their content is assumed from their titles only. (→ D-9)
6. **Legacy IntelliDealer screens represent the parity bar.** The PDFs/PNGs were treated as visual reference only (not OCR-parsed). Which screens are must-match is assumed open. (→ D-10)
7. **The pricing-rules engine (`264`) is sanctioned for autonomous price changes.** Its presence is verified; the governance intent is assumed. (→ D-5/D-7)
8. **Functions depending on un-spot-checked RPCs are wired correctly.** e.g. `predict_parts_needs`, `compute_seeded_forecast`, `customer_fleet_llm_context`, `match_parts_hybrid`, `recent_orders_for_part` are referenced but their definitions were not all confirmed. (→ D-13)

---

## 20. Open Questions / Decision Points for Juan + Norman

> These are the artifacts that close the D3.6 gate. Ordered roughly by impact. Please answer or defer each.

**Top decisions (highest impact):**

- **D-1 — Canonical stage model.** Is the 10-stage model in §3 the workflow QEP wants parts staff trained on? Rename/reorder as needed.
- **D-2 — One spine or two?** Should counter/retail orders (`parts_orders`) and service-job parts (`service_parts_requirements`) remain separate coordinated spines, or converge into one parts-fulfillment model? This shapes everything downstream.
- **D-3 — Order status state machine of record.** Resolve the verified UI-vs-backend inconsistency: the UI offers `draft → submitted` and `draft → confirmed`, but the backend `advance_status` allows only `draft → cancelled` and forces `submit_internal_order`. Which is canonical? (Same question applies to confirming server-side enforcement of the 8-state vendor-PO and fulfillment-run machines.)
- **D-4 — Parts quoting & invoicing ownership.** (a) Standalone Parts Quote workflow, or parts-as-lines inside the unified deal quote (`quote_line_kind='part'`)? (b) Is QEP the system of record for **parts invoices**, requiring the missing quote→invoice and consume-staging→`customer_invoices` converters, or does CDK/IntelliDealer remain the invoicing system with QEP mirroring?
- **D-5 / D-7 — Pricing authority & auto-apply guardrails.** Who owns final pricing authority, and what approval thresholds (monetary/percentage) should gate `auto_apply` price changes beyond the per-rule flag?

**Operational decisions:**

- **D-6 — Vendor escalation & contacts readiness.** Which vendor contacts/escalation policies are production-ready vs. placeholder? Should `vendor_escalations` get an explicit status field?
- **D-8 — Cores / reman returns operating model.** Schema exists (`is_reman`, `core_charge_cents`, `core_part_id`, `return_part`) but there is no dedicated cores/returns UI. How should counter staff handle core charges, core returns, and reman exchanges?
- **D-9 — ADR reconciliation.** `ADR-003` and `ADR-004` are **absent from the repo** but referenced as shipped design basis. Are progressive customer capture and serial-number-primary entry shipped, planned, or dropped? Create the ADRs or correct the roadmap.
- **D-10 — Legacy parity scope.** Which IntelliDealer screens are **must-match** (candidates: Invoicing, Price Matrix, Purchase Orders) vs. reference-only?
- **D-11 — Voice-order defect routing.** Record the verified `voice-to-parts-order` temporal-dead-zone defect (`adminClient` used line 263, declared line 270) and route to engineering. Confirm whether voice auto-submit of machine-down orders is desired behavior at all.
- **D-12 — Workspace-scoping hardening.** Confirm and, if needed, fix `counter_inquiries` / `parts_preferences` RLS (currently `user_id`-only) and add a DB-level enum/CHECK on `parts_orders.status`.

**Lower-impact / confirmations:**

- **D-13 — RPC inventory confirmation.** Confirm the predictive/forecast RPCs (`predict_parts_needs`, `compute_seeded_forecast`, `customer_fleet_llm_context`, `recent_orders_for_part`, `match_parts_hybrid`) exist and behave as the functions assume.
- **D-14 — Customer-visible statuses.** Which order statuses + ETAs should the portal expose, and what is the supported portal-draft → submitted promotion path (portal RLS allows insert only)?

---

## 21. Validation Plan & Next Revision Process

1. **Owner review pass.** Juan + Norman red-line §3–§15 (Confirmed / Correct-as-noted / Wrong) and answer §20.
2. **Supply or confirm external inputs.** Add the 28-decision-point answers, `QEP_PHASE3_PARTS_BLUEPRINT`, and `CLAUDE_CODE_HANDOFF §8` to the repo (or confirm their decisions inline) so the §19 assumptions can be promoted to facts.
3. **Reconcile ADRs.** Resolve D-9 — author `ADR-003`/`ADR-004` or correct the roadmap reference.
4. **Engineering confirmations.** Resolve D-3 (state-machine alignment), D-11 (voice defect), D-12 (RLS), and D-13 (RPC existence) with code owners; capture outcomes here.
5. **Promote to v1.** Fold answers in, remove the review-candidate banner, and record sign-off.
6. **Close the operator-validation loop.** On sign-off, append the signed v1 path and reviewer names to the roadmap/Linear record.

---

### Appendix A — Verification provenance

This draft was produced by reading the live codebase on 2026-05-29. Load-bearing claims were verified directly against source, including: the order status machine (`order-status-machine.ts:1-37`, `parts-order-manager/index.ts:37-43, 375-399`), the service queue buckets/statuses (`PartsWorkQueuePage.tsx:40-85`, `095:25-27`, `125`), the pricing path (`extract-price-sheet`, `parts-pricing-autocorrect`, `264`, `481`, `257`), the quote→invoice chain (`414`/`415`/`468`/`480`, `123`), the auto-replenish schedule-aware schema (`139` + `261:28-49`), and the `voice-to-parts-order` defect (`index.ts:263, 270`). Two automated findings were **corrected during verification** and are reflected above as non-issues: the auto-replenish `scheduled` status/columns **are** backed by migration `261`; and `voice-to-parts-order` **does** pass `workspaceId` to `fuzzyMatchCatalog`. Surfaces marked 🔶 were identified by path/import/usage but not exhaustively read and should be confirmed during owner review.
