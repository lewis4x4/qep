# Migration Order — IntelliDealer → QEP Cutover

This document sequences the original must-fix migrations (and the higher-priority shoulds) in **dependency-respecting waves**. Within each wave, migrations are independent and can land in any order or in parallel branches. Across waves, you must complete wave N before starting wave N+1 (FK references break otherwise). The current regenerated blocker count lives in `manifest.yaml` and `_blockers.csv`.

**Convention:** every wave file follows the canonical `NNN_snake_case.sql` naming required by the QEP repo (`qep/CLAUDE.md` → Backend Conventions). The numeric range suggested per wave below leaves room for in-wave splitting and re-ordering.

**Numbering guardrail:** before creating any migration file, check `supabase/migrations` for the current max prefix and start from the next number. New migrations may land between planning and implementation, so treat the ranges below as examples. As of Wave 2 implementation, Wave 1 completed through `471_equipment_invoice_view.sql` and Wave 2 occupies `472_*`–`496_*`.

---

## Pre-flight (do once, before Wave 0)

1. **Verify the current max migration number.** Confirm the latest file in `supabase/migrations` and assign the next available prefix before creating files. (At the time of this update, max is `396_iron_manager_floor_layout_v2.sql`, so Wave 0 starts at `397_*`.)

2. **Reconcile naming overlap between Phase-5 and Phase-8.** Phase-5 (Deal Genome) introduces `qrm_gl_accounts` while Phase-8 (Financial Operations) introduces `gl_accounts`. These are the same concept under two names. Pick one (recommend `gl_accounts` — shorter, matches the rest of the GL family) and update the Phase-5 YAML before generating its DDL.

3. **Reconcile Phase-3 vs Phase-9 parts overlap.** Phase-3 extends the parts-invoice header concept and `parts_orders`; in QEP the canonical invoice header is `customer_invoices` with parts invoice compatibility columns, while `parts_invoice_lines` references `customer_invoices`. Phase-9 lists `parts_invoices` / `parts_orders` as NEW. Treat Phase-3 as authoritative, map invoice-header fields to `customer_invoices`, and skip Phase-9's CREATE TABLE for these two.

4. **Reconcile Phase-1 ship-to vs Phase-9 ship-to.** Phase-1 introduces `qrm_company_ship_to_addresses`; Phase-9 references the same need. Phase-1 is authoritative.

5. **Confirm enum extension policy.** Several migrations call `ALTER TYPE … ADD VALUE`. Postgres can't do this inside a transaction in older versions; ensure your migration runner runs each `ALTER TYPE` standalone.

6. **Snapshot prod schema before starting.** Take a `pg_dump --schema-only` snapshot. Each wave must be reversible — confirm the down-migration before pushing the up.

---

## Wave 0 — Brian's anchor (ship this immediately)

**Files:** `397_customer_ein.sql`

**Why first:** EIN is the single highest-priority gap. Standalone column on `qrm_companies` with no FK dependencies. Should ship in days, not weeks.

```sql
ALTER TABLE qrm_companies ADD COLUMN ein TEXT;
ALTER TABLE qrm_companies ADD CONSTRAINT qrm_companies_ein_format_chk
  CHECK (ein IS NULL OR ein ~ '^\d{2}-\d{7}$');
CREATE INDEX ON qrm_companies (workspace_id, ein) WHERE ein IS NOT NULL;
COMMENT ON COLUMN qrm_companies.ein IS
  'Federal EIN (NN-NNNNNNN). Required for 1099, AvaTax exemption, OFAC.';

-- RLS: EIN is sensitive PII — mask to non-finance roles.
-- Implement in policy: visible to roles 'admin','finance'; masked SUBSTRING for others.
```

Then immediately ship a UI surface in Customer Profile (Details) — Tax/Regulatory block, masked except last-4 to non-finance roles.

---

## Wave 1 — Foundation tables (independent, no inter-table FKs)

**Files:** `398_*` through `417_*` — can run in any order.
**Why first:** these are new tables that downstream waves reference. No FK dependencies on each other (only on existing tables: `qrm_companies`, `branches`, `profiles`, `qrm_equipment`).

**Phase-1 (CRM):**
- `qrm_company_ship_to_addresses` ← critical, referenced by Phase-2/3/4
- `qrm_company_memos`
- `qrm_prospects`
- `qrm_company_department_reps`
- `customer_pricing_groups`
- `customer_loyalty_programs` + `customer_loyalty_enrollments`
- `prospect_jdquote_upload_runs` (defer to Wave 5 if no JD dealer in scope)

**Phase-2 (Sales Intelligence):**
- `equipment_base_codes`
- `equipment_options` (FK to `equipment_base_codes` — within-wave order: base_codes first)
- `equipment_selected_options` (FK to `equipment_options`)
- `equipment_meter_readings`
- `equipment_warranty_terms`
- `f_and_i_products` + `quote_f_and_i_attachments` (within-wave order)
- `equipment_base_codes_import_runs`

**Phase-3 (Parts):**
- `parts_lost_sales`
- `parts_memos`
- `parts_quotes` + `parts_quote_lines` (within-wave order)
- `parts_invoice_lines`
- `price_matrices` → `price_matrix_pricing_details` → `price_matrix_price_breaks` (within-wave order)
- `shipping_label_runs`

**Phase-4 (Service):**
- `service_shop_bays`
- `service_job_segments` ← referenced by `service_timecards` extension in Wave 2
- `labor_pricing_matrix` → `labor_pricing_matrix_audit` (within-wave order)
- `service_agreement_programs` → `service_agreements` (within-wave order)
- `warranty_claims`
- `inspection_templates` → `inspection_runs` (within-wave order; `inspection_runs` is referenced by `qb_trade_ins` extension in Wave 2)

**Phase-5 (Deal Genome) — assumes Phase-5's authoritative GL naming reconciled to `gl_accounts`:**
- `qrm_branches` (if QEP doesn't already have a branches reconciliation)
- `qrm_fiscal_periods`
- `qrm_flat_rate_codes`
- `qrm_payroll_premium_codes`
- `qrm_payroll_entries`
- `qrm_saved_queries`
- `service_job_segments` (reuse Phase-4 authoritative table; do not create a duplicate Phase-5 segments table)
- `qrm_work_order_wip_snapshots`
- `qrm_ar_open_items`

**Phase-8 (Financial Ops):**
- `payment_terms` (lookup table)
- `gl_companies`, `gl_divisions`, `gl_cost_centers`, `gl_profit_centers`, `gl_periods` (the GL chart-of-accounts skeleton)
- `gl_accounts` (FK to gl_companies/divisions/centers — within-wave order)
- `gl_journal_entries` → `gl_journal_lines` (within-wave order)
- `vendor_invoices` → `ap_invoice_distributions` (within-wave order)
- `vendor_1099_ytd`
- `ar_memos`
- `ar_statement_runs`
- `ar_agencies`
- `billing_queue` → `billing_run_reports` (within-wave order)

**Phase-9 (Advanced Intelligence):**
- `collection_agencies` (lookup; check overlap with Phase-8 `ar_agencies` and reconcile)
- `customer_memos` (overlaps with Phase-1 `qrm_company_memos` — pick one)
- `customer_attachments`
- `marketing_campaigns` → `marketing_campaign_exposures` (within-wave order)
- `job_jackets`
- `equipment_invoices`

**Cross-Cutting:**
- `employee_classes` → `employees` (within-wave order)
- `shift_codes`
- `qrm_territory_zip_rules`
- `traffic_subtypes`
- `traffic_ticket_lines` (FK to `traffic_tickets` which exists)
- `traffic_ticket_comments`
- `traffic_calendar_memos`
- `record_change_history`
- `security_screens`
- `security_switches`
- `security_role_switches` → `security_user_switch_overrides` (within-wave order)
- `security_ip_allowlist`

**Wave 1 size:** ~70 new tables. Allow 2-3 weeks of engineering.

---

## Wave 2 — Column extensions (parallel-safe within tables)

**Files:** `472_*` through `496_*` — grouped by target table to keep migrations atomic. Implemented locally after Wave 1 completed through `471_*`.

**Why second:** every ALTER TABLE here adds columns to **existing** QEP tables. No new FK dependencies (only on Wave 1 tables which now exist). Group by target table so each migration is `ALTER TABLE foo ADD COLUMN ...; ADD COLUMN ...; ADD COLUMN ...;` (one file per target).

**Existing tables that get extended (with rough column count from migration_hints):**

| Phase | Target Table | Columns Added | Highlights |
|---|---|---:|---|
| 1 | `qrm_companies` | ~50 | EIN already in Wave 0; add resale_cert, tax codes, AR routing, statement controls, search_1/2, township/lot/concession, lat/lng, business_fax/cell/email, notification flags, special-handling shipping, default PO, terms, credit_limit, opt_out_sale_pi, AvaTax entity use code, DUNS, NAICS, etc. |
| 1 | `qrm_contacts` | 2 | `cell`, `portal_customer_id` |
| 2 | `qrm_equipment` | ~35 | stock_number, base_code_id, in_out_state, in_out_sub_type, class/type/group/subclass codes, home_branch_id, engine/transmission_serial, control_number, customer_fleet_number, supplier_invoice_*, current_cost, net_book_value, note/finance/settlement amounts, maintenance_expense, rental_*, sale/inventory_gl_account, avatax_product_code, last_count_*, ordered_reserved_at, rental_fleet_date, delivery_date, traded_date, assigned_salesperson_id, inventory_type, price_matrix_id |
| 2 | `qb_quotes` | ~10 | po_number, ship_via, sold_to/ship_to_address_id (FK to Wave-1 ship_to), tax_code_1-4, discount_code, estimated_close_date |
| 2 | `qb_trade_ins` | ~7 | payoff_amount_cents, payoff_good_through_date, lien_holder_*, lien_release_received_at, title_received_at, inspection_run_id (FK to Wave-1 inspection_runs), disposition enum constraint |
| 2 | `customer_invoices` | ~3 | esign_status, esign_envelope_id, esign_signed_at |
| 3 | `parts_catalog` | ~15 | requires_label, in_transit, maximum_discount_*, tax_X_applies (4), amax_apr_*, season_*, effectual_pct, protect_*, do_not_order_*, last_customer_order_*, suppress_portal_pricing, is_reman, core_charge_cents, core_part_id, central_branch_id, use_central_order, lost_sale_frequency/quantity, special_order_*, ofc_reclass_*, price_update_type |
| 3 | `customer_invoices` (canonical parts-invoice header equivalent) | ~10 | order_number, salesperson_id, po_number, ship_via, freight_terms, tax_code_1-4, discount_code, sold_to/ship_to_address_id, print_parameters |
| 3 | `parts_orders` | ~3 | po_type, freight_charge_cents, po_total_cents, customer_id |
| 3 | `parts_quotes` | 2 | converted_service_job_id, converted_at |
| 3 | `parts_vendor_prices` | 2 | min_qty, max_qty (if not present) |
| 4 | `service_jobs` | ~20 | wo_number, po_number, ship_via, machine_down, machine_down_at, sold_to/ship_to_address_id, pricing_group_override, tax_code_parts/labor_*, discount_parts/labor, pickup_required, delivery_required |
| 4 | `service_timecards` | 1 | segment_id (FK to Wave-1 service_job_segments) |
| 4 | `service_quotes` | ~5 | quote_number, status enum constraint, assigned_salesperson_id, is_master, cloned_from_quote_id |
| 4 | `technician_profiles` | ~7 | work_order_rate_per_hour_cents, work_order_cost_per_hour_cents, work_order_account, service_location, inside_outside_shift, road_technician, drag_and_stick, weekly_schedule (JSONB) |
| 4 | `job_codes` | 1 | manufacturer_code |
| 8 | `customer_invoices` | additional (per Phase-8) | tax_breakdown details, statement_run_id, etc. |
| 8 | `branches` | varies | per Phase-8 |
| 8 | `crm_companies` | varies | per Phase-8 |
| 8 | `vendor_profiles` | varies | per Phase-8 |
| 9 | `qrm_companies` | varies | per Phase-9 |
| 9 | `qrm_contacts` | varies | per Phase-9 |
| 9 | `service_jobs` | varies | per Phase-9 |
| CC | `branches`, `geofence_events`, `technician_profiles`, `traffic_tickets`, `employees` | varies | per Cross-Cutting |

**Wave 2 size:** ~200 column additions across ~25 tables. Allow 2-3 weeks of engineering.

---

## Wave 3 — Cross-table FK additions + enum constraints

**Files:** `497_*` through `516_*` (planned; next contiguous range after Wave 2).

**Why third:** these depend on **both** the new Wave-1 tables AND the columns added in Wave 2 (e.g., `service_jobs.ship_to_address_id` requires both `service_jobs` to have the column from Wave 2 AND `qrm_company_ship_to_addresses` to exist from Wave 1).

**Categories:**
- Convert free-text status columns to typed enums (e.g., `qrm_companies.status` TEXT → `customer_status` enum; `service_quotes.status` → enum; `qb_trade_ins.disposition` → enum; `customer_invoices.status` → enum).
- Extend existing enums where IntelliDealer has more values than QEP (`crm_equipment_availability` adds `invoiced`, `on_order`, `presold`, `consignment`, `transferred`).
- Apply RLS policies on new sensitive columns (EIN already in Wave 0; `credit_limit_cents` finance-only; `payoff_amount_cents` finance-only).
- Wire `gl_routing_rules` to `service_jobs.request_type` (Phase-4 financial gap).

**Wave 3 size:** ~30 migrations. 1 week.

---

## Wave 4 — Materialized views, computed views, indexes

**Files:** `517_*` through `536_*` (planned; follows Wave 3).

**Why fourth:** these read from the schema established in Waves 1-3.

**From Phase-1:**
- `v_customer_primary_resale_cert`

**From Phase-3:**
- `v_parts_months_supply`

**From Phase-4 (high value, ship asap):**
- `mv_service_jobs_wip` — base WIP value per WO (referenced by aging report)
- `mv_service_wip_aging` — depends on `mv_service_jobs_wip`; standard buckets Current/31-60/61-90/91-120/Over120
- `v_customer_open_ar`
- `v_service_jobs_last_activity`
- `v_tech_recovery_30d`
- `v_tech_daily_capacity` — IntelliTech grid

**From Phase-5:**
- `qrm_customer_profitability_mv` — customer-level margin rollup

**From Phase-8:**
- `ar_aging_view`
- `ap_aging_view`
- `customer_ar_history`

**From Phase-9:**
- `mv_customer_ar_aging`
- `mv_customer_fiscal_ytd`
- `v_customer_available_credit`

**Index additions** for the new columns from Waves 2-3 — group into one migration per target table.

**Wave 4 size:** ~15 view/MV creations + ~30 indexes. 1 week.

---

## Wave 5 — Defer / OEM-specific / phase-by-phase rollout

**Files:** `537+` (planned; follows Wave 4).

**These are MUST-but-defer-by-dealer:** ship when the first dealer needs them. Don't block cutover for any of these unless that dealer has the corresponding integration.

- `prospect_jdquote_upload_runs` — only for JD-affiliated dealers
- `equipment_base_codes_import_runs` (Bobcat / Vermeer / Yanmar / Prinoth / JD-specific imports) — ship when the dealer's primary OEM is in scope
- AvaTax wiring — requires AvaTax credentials; the column additions in Wave 2 are no-ops until AvaTax is connected
- VESign integration — requires VitalEdge eSign credentials
- UPS WorldShip Import — requires UPS credentials
- Tethr telematics integration — defer to telematics phase

**Should-tier work:** the 300 `should` fields not yet covered. Prioritize the top 50 by visit-count from rep usage logs.

---

## Critical cross-phase FK dependencies (the non-obvious ones)

| Dependency | Producer (Wave 1) | Consumer (Wave 2/3) | Impact if missed |
|---|---|---|---|
| `qrm_company_ship_to_addresses` exists | Phase-1 | `service_jobs.ship_to_address_id`, `customer_invoices.ship_to_address_id` (parts-invoice compatibility), `qb_quotes.ship_to_address_id` | Three Wave-2 ALTERs error out |
| `service_job_segments` exists | Phase-4 | `service_timecards.segment_id` | Tech-recovery view returns NULL for all segments |
| `inspection_runs` exists | Phase-4 | `qb_trade_ins.inspection_run_id` | Trade-in walk-around can't link to appraisal |
| `equipment_base_codes` exists | Phase-2 | `equipment_options.base_code_id`, `qrm_equipment.base_code_id` | OEM order portal can't resolve SKU |
| `price_matrices` exists | Phase-3 | `parts_catalog.price_matrix_id` | Parts price-matrix automation breaks |
| `customer_pricing_groups` exists | Phase-1 | `qrm_companies.pricing_group_id` | Per-customer pricing tier missing |
| `equipment_warranty_terms` exists | Phase-2 | (used by warranty_claims FK paths) | Warranty eligibility on WO breaks |
| `gl_accounts` (Phase-8) exists | Phase-8 Wave 1 | All Phase-2/3/4 GL routing columns | Posting fails |
| `payment_terms` (Phase-8) exists | Phase-8 Wave 1 | `customer_invoices` and Phase-1 customer terms FK | Payment-term FK errors |

**Tip:** if your migration runner can dry-run a wave against a clean DB, do it. The above FK list comes from a manual scan; a dry run will catch any I missed.

---

## Naming overlap watch-list (resolve in pre-flight)

| Concept | Phase-A name | Phase-B name | Recommended action |
|---|---|---|---|
| GL chart of accounts | `qrm_gl_accounts` (Phase-5) | `gl_accounts` (Phase-8) | Use `gl_accounts`. Update Phase-5 YAML before generating DDL. |
| Work-order line breakdown | `qrm_work_order_segments` (Phase-5) | `service_job_segments` (Phase-4) | Use `service_job_segments`. Update Phase-5 YAML. |
| Customer memos | `qrm_company_memos` (Phase-1) | `customer_memos` (Phase-9) | Use `qrm_company_memos`. Drop Phase-9's CREATE. |
| Customer ship-to | `qrm_company_ship_to_addresses` (Phase-1) | (referenced by Phase-9 indirectly) | Phase-1 authoritative. |
| Collection / AR agencies | `ar_agencies` (Phase-8) | `collection_agencies` (Phase-9) | Use `ar_agencies`. |
| Parts invoices/orders | (extends existing tables) (Phase-3) | (incorrectly listed as NEW) (Phase-9) | Phase-3 is right — skip Phase-9 CREATE for these. |
| Equipment invoices | (`customer_invoices` extension) (Phase-2/8) | `equipment_invoices` (NEW) (Phase-9) | Decide: is this a separate table or just a view over `customer_invoices` filtered to equipment lines? Recommend view, not new table. |

---

## Suggested sprint cadence

| Sprint | Waves | Outcome |
|---|---|---|
| Sprint 1 (1 week) | Wave 0 + pre-flight | EIN ships. Builder team aligned on naming reconciliations. |
| Sprint 2-3 (2-3 weeks) | Wave 1 | All foundation tables exist. |
| Sprint 4-5 (2-3 weeks) | Wave 2 | All column extensions land. Existing flows now have all needed fields. |
| Sprint 6 (1 week) | Wave 3 | FKs + enums tighten the schema. |
| Sprint 7 (1 week) | Wave 4 | Reports + dashboards light up. |
| Sprint 8+ (ongoing) | Wave 5 | Per-dealer rollout work. |

**Total to cutover-readiness:** ~8 sprints (~10 weeks) for the must-fix block. Plus another 4-6 sprints to clear the should-tier backlog.

---

## Status

- Wave 0: ✅ implemented and remote-push verified 2026-04-27 (migration `397_customer_ein.sql`; EIN column, format CHECK, role guard/masking, UI surface; segment gate `wave0-customer-ein` PASS was recorded at `test-results/agent-gates/20260427T024952Z-wave0-customer-ein.json`).
- Wave 1: ✅ implemented and remote-push verified 2026-04-27 (foundation migrations `398_*`–`471_*`; clean tables plus additive conflict resolutions for `parts_invoice_lines`, `service_agreements`, `marketing_campaign_exposures`, and `equipment_invoices`; segment gate `wave1-foundation` PASS was recorded at `test-results/agent-gates/20260427T040639Z-wave1-foundation.json`).
- Wave 2: ✅ implemented and remote-push verified 2026-04-27 (column-extension migrations `472_*`–`496_*`; 25 target-group migrations, 314 additive column operations, canonical `crm_companies`→`qrm_companies` and `parts_invoices`→`customer_invoices` mappings; segment gate `wave2-column-extensions` PASS was recorded at `test-results/agent-gates/20260427T042748Z-wave2-column-extensions.json`).
- Wave 3: ✅ implemented and remote-push verified 2026-04-27 (schema-hardening migrations `497_*`–`501_*`; cross-table FK guards, safe enum/status tightening, sensitive-column RLS/write guards/masking, service request-type GL routing, customer invoice payment terms FK; segment gate `wave3-schema-hardening` PASS was recorded at `test-results/agent-gates/20260427T044330Z-wave3-schema-hardening.json`).
- Wave 4: ✅ implemented and remote-push verified 2026-04-27 (reporting migrations `502_*`–`506_*`; customer/parts computed views, service WIP materialized views and aging buckets, AR/AP/customer profitability/credit/fiscal reporting surfaces, purposeful report indexes, safe SQL-only refresh function + pg_cron schedule; segment gate `wave4-reporting` PASS was recorded at `test-results/agent-gates/20260427T050848Z-wave4-reporting.json`).
- Wave 5: ⏸ deferred-by-external-dependency 2026-04-27. No Wave 5 integration migration has shipped. Note: `507_post_build_security_audit_fixes.sql` exists, but it is post-build security hardening and must not be counted as Wave 5 integration work. Dealer/OEM credentialed integrations remain gated.
  - Final cutover gate: ✅ PASS 2026-04-27 after release-blocker review + remote-push remediation (`test-results/agent-gates/20260427T054017Z-intellidealer-cutover.json`); `supabase db push --dry-run --linked` reports the remote database is up to date through `506_*`.
  - JD Quote II (`prospect_jdquote_upload_runs`): deferred pending confirmed JD-affiliated dealer scope; no secrets/portal wiring created.
  - OEM Base & Options imports (`equipment_base_codes_import_runs` for Bobcat/Vermeer/Yanmar/Prinoth/JD): deferred pending in-scope dealer OEM + import credential path; Wave 1/2 foundations already shipped (`405_*`–`407_*`, `474_*`).
  - AvaTax: schema support already shipped in prior waves (`472_*`, `474_*`, `477_*`, `478_*`, `482_*`), but live tax decision wiring remains deferred pending tenant AvaTax credentials.
  - VitalEdge eSign (VESign): schema compatibility already shipped (`477_*` `esign_*` columns + status check); provider integration remains deferred pending credentials.
  - UPS WorldShip: run ledger already shipped (`419_shipping_label_runs.sql`), but external connection remains deferred pending UPS credentials.
  - Tethr telematics: no safe Wave-5 DDL required from current audit hints; integration remains deferred to telematics phase and dealer scope.

---

## How to extend this document

When a builder closes a wave, append a `## Status` section:

```markdown
## Status
- Wave 0: ✅ shipped 2026-MM-DD (migration 397)
- Wave 1: ✅ shipped 2026-MM-DD (migrations 398-417, 70 tables)
- Wave 2: 🟡 in progress (migrations 418-457; qrm_companies extension done; parts_catalog 60% done)
- Wave 3: ⏸ blocked on Wave 2 (planned 458-477)
```

Pair with a per-migration changelog at `qep/supabase/migrations/CHANGELOG.md` so on-call engineers can trace rollback dependencies.
