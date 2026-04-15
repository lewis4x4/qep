# QEP Parts Intelligence Engine — Master Plan

**Date:** 2026-04-15
**Owner:** Parts Companion / QRM Phase 1
**Status:** Planning — awaiting approval
**Supersedes:** `QEP-Parts-Intelligence-Engine-Moonshot-v2.docx` (implementation layer)

---

## 0. Mission Lock

> "Create a Moonshot Application built around equipment and parts, sales and rental, for employees, salesmen, corporate operations and management. Pressure-test transformational AI ideas that are not fully possible today but will be unlocked by superintelligence."

This plan is measured against the four mission checks on every slice:

1. **Mission Fit** — advances parts operations for field reps, counter staff, corporate ops, management.
2. **Transformation** — each phase adds a capability materially beyond commodity DMS/QRM behavior.
3. **Pressure Test** — validated under realistic volume (4,310 parts / 17k vendor SKUs / 400 contacts) before ship.
4. **Operator Utility** — every shipped slice measurably improves decision speed or execution quality for a named role.

---

## 1. The Situation (What We Have)

### Data (delivered 2026-04-15)

| File | Rows × Cols | Nature | Destination |
|---|---|---|---|
| `Parts List.xlsx` | 4,310 × 187 | Live CDK DMS PARTMAST export — full fidelity (cost, inventory, bin, 24mo sales/demands/bin-trips, ROP, EOQ, class, machine/model, 4 pricing levels, AvaTax) | `parts_catalog` + extensions + `parts_history_monthly` |
| `2026-Yanmar-Parts-Price-File.xlsx` | 17,882 × 5 | Supplier catalog — PartNum, Description, Jan 2026 List Price, Product Code, FR desc | `parts_vendor_prices` (new) |
| `Company Vendor Contacts 2026.xlsx` | 4 sheets, ~400 rows | Parts/Service/Admin contacts + ordering schedule | `vendor_profiles` + `vendor_contacts` + `vendor_order_schedules` (new) |
| `446431_...PARTMAST_04092026.pdf` | — | CDK PMREC record layout spec | Documentation (mapping reference) |

### Infrastructure (already built)

- **Tables:** `parts_catalog`, `service_parts_requirements`, `service_parts_actions`, `service_parts_staging`, `parts_reorder_profiles`, `parts_requests`, `machine_profiles`, `counter_inquiries`, `vendor_profiles`, `vendor_contacts`, `vendor_escalation_policies`.
- **Edge functions (13):** `service-parts-manager`, `process-parts-request`, `service-parts-planner`, `parts-order-manager`, `voice-to-parts-order`, `parts-auto-replenish`, `parts-reorder-compute`, `parts-demand-forecast`, `parts-identify-photo`, `ai-parts-lookup`, and more.
- **Frontend:** Parts Companion shell at `apps/web/src/features/parts-companion/` with QueuePage, LookupPage, MachinesPage, MachineProfilePage, ArrivalsPage — recently refreshed to premium dark-mode.

The foundation is already there. This dataset is the **fuel** for engines that were built to run on it.

---

## 2. Where We're Going (Architecture)

Three layers, each building on the last:

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3 — MOONSHOT                                          │
│ Predictive failure · Cross-dealer intel · Voice-first ops   │
│ NL parts search · Visual ID · Proactive sales plays         │
├─────────────────────────────────────────────────────────────┤
│ PHASE 2 — INTELLIGENCE                                      │
│ Demand forecast (seeded) · Auto-replenish · Dead stock      │
│ Vendor arbitrage · Stockout prevention · Machine↔parts graph│
├─────────────────────────────────────────────────────────────┤
│ PHASE 1 — FOUNDATION                                        │
│ Import surface · Schema extensions · Vendor hydration       │
│ 24mo history backfill · Re-import automation                │
└─────────────────────────────────────────────────────────────┘
```

Each phase ships independently useful value. **Phase 1 alone** makes Parts Companion the single source of truth for 4,310 parts, 17k vendor prices, and 400 contacts — already a massive step up from spreadsheets-and-DMS-lookups.

---

## 3. Phase 1 — Foundation (Now)

**Goal:** Every byte of the 4 files lives in the right table, re-importable on demand, with an admin UI. Every role can find the truth in under 10 seconds.

### Slice 1.1 — Schema extensions (1 migration)

**Migration `260_parts_intelligence_schema.sql`:**

- **Extend `parts_catalog`** with CDK-native fields:
  ```
  dms_status char(1), co_code text, div_code text, branch_code text,
  machine_code text, model_code text, stocking_code text,
  source_of_supply text, vendor_code text, pkg_qty int,
  lead_time_days int, safety_stock_qty numeric, reorder_point numeric,
  eoq numeric, on_hand numeric, on_order numeric, back_ordered numeric,
  bin_location text, previous_bin_location text, class_code text,
  category_code text, movement_code text, activity_code text,
  asl_category text, weight_lbs numeric, avatax_product_code text,
  pricing_level_1 numeric, pricing_level_2 numeric,
  pricing_level_3 numeric, pricing_level_4 numeric,
  last_count_date date, last_po_number text,
  dms_last_modified timestamptz, dms_last_ordered timestamptz,
  raw_dms_row jsonb  -- full 187-col snapshot for audit/replay
  ```

- **New table `parts_history_monthly`:**
  ```
  part_id uuid references parts_catalog,
  month_offset int,  -- 1 = last month, 24 = 24mo ago
  sales_qty numeric, bin_trips int, demands int,
  period_end date,
  unique (part_id, month_offset)
  ```
  Derived from cols 113–184 of the PARTMAST export. This is the **fuel for demand forecasting**.

- **New table `parts_vendor_prices`:**
  ```
  vendor_id uuid, part_number text, description text,
  list_price numeric, product_code text, currency text default 'USD',
  description_fr text, effective_date date,
  source_file text, imported_at timestamptz,
  unique (vendor_id, part_number, effective_date)
  ```

- **New table `vendor_order_schedules`:**
  ```
  vendor_id uuid, vendor_code text, branch_code text,
  frequency text,  -- weekly|biweekly|monthly|on_demand
  day_of_week text, cutoff_time time, notes text
  ```

- **New table `parts_import_runs`:**
  ```
  id uuid, workspace_id uuid, uploaded_by uuid,
  source_file_name text, source_file_hash text,
  file_type text,  -- partmast|vendor_price|vendor_contacts
  vendor_code text,  -- for vendor_price imports
  row_count int, rows_inserted int, rows_updated int,
  rows_skipped int, rows_errored int,
  status text,  -- pending|previewing|committed|failed|rolled_back
  preview_diff jsonb, error_log jsonb,
  started_at timestamptz, completed_at timestamptz
  ```
  Gives us full audit + rollback capability across re-imports.

- RLS on all new tables using `get_my_workspace()`/`get_my_role()` helpers.
- Indexes on `parts_catalog(workspace_id, part_number)` (unique), `parts_catalog(vendor_code)`, `parts_history_monthly(part_id, month_offset)`, `parts_vendor_prices(part_number)`.

**Acceptance:** `bun run migrations:check` passes. RLS audit confirms no leakage. Seed test inserts a PARTMAST row and reads back all fields.

### Slice 1.2 — Import edge function `parts-bulk-import`

A single endpoint, file-type-detected. **Idempotent**, **previewable**, **rollback-able**.

**Flow:**
1. Client uploads xlsx to Supabase Storage bucket `parts-imports/{workspace_id}/{uuid}.xlsx`.
2. Client calls `parts-bulk-import` with `{storage_path, file_type, vendor_id?, commit: false}`.
3. Edge function streams the file, parses with SheetJS, auto-detects file type by header signature if not supplied.
4. Validates: part number format, required fields, numeric coercion, date parsing (CDK uses YYYYMMDD).
5. Produces a **preview diff** — rows to insert, rows to update (with changed fields highlighted), rows skipped (identical), rows errored (with line + reason).
6. Returns `{run_id, preview: {inserts, updates, skips, errors}, sample_rows}`.
7. Client reviews, then calls again with `{run_id, commit: true}`.
8. Commit writes in batched transactions (250 rows per txn) with progress events via Supabase Realtime.
9. On failure, `parts_import_runs.status = 'failed'` and any partial writes are rolled back by the outer transaction.

**File-type handlers:**
- `partmast` → `parts_catalog` + `parts_history_monthly` (derives from cols 113–184)
- `vendor_price` → `parts_vendor_prices` (requires `vendor_id` param)
- `vendor_contacts` → `vendor_profiles` + `vendor_contacts` + `vendor_order_schedules` (parses multi-sheet workbook)

**Acceptance:**
- Re-running the same file is a no-op (idempotent on hash).
- Price-only change on one part shows as 1 update, 4,309 skips in preview.
- Preview never mutates data.
- 4,310-row import completes in under 60 seconds.
- Full audit row in `parts_import_runs`.

### Slice 1.2b — Conflict reconciliation flow

When a re-import would overwrite a field that a parts manager has manually edited, the system **does not silently overwrite**. Instead:

**New table `parts_import_conflicts`:**
```
id uuid, run_id uuid references parts_import_runs,
part_id uuid references parts_catalog,
field_name text,  -- e.g. 'bin_location', 'reorder_point', 'list_price'
current_value jsonb,  -- what we have (often a manual edit)
current_set_by uuid,  -- user who set it (null if from a prior import)
current_set_at timestamptz,
incoming_value jsonb,  -- what the CDK drop says
incoming_source text,  -- e.g. 'PARTMAST_04092026'
resolution text,  -- null|keep_current|take_incoming|custom
resolution_value jsonb,  -- only when 'custom'
resolved_by uuid, resolved_at timestamptz,
priority text  -- high|normal|low (high = price/bin moves, low = periodic counters)
```

**Manual-edit tracking on `parts_catalog`:**
- Each important field gets a companion `{field}_manual_override boolean default false`.
- Any write via the UI (not via import) flips the flag + stamps `manual_updated_by` / `manual_updated_at`.
- Import logic checks the flag before overwrite: if set AND incoming differs AND current differs, create a conflict row.

**Review UI at `/parts/import/conflicts`:**
- Queue view: grouped by run, sortable by priority, filterable by field type.
- Each conflict shows side-by-side:
  ```
  Bin Location — part 129150-35170 (OIL FILTER)
  ┌─────────────────────────┬─────────────────────────┐
  │ Your value              │ CDK says                │
  │ A-14-3                  │ B-07-1                  │
  │ Set by Mike R.          │ PARTMAST_04092026       │
  │ Mar 12 2026, 2:41pm     │ Apr 9 2026              │
  │ [ Keep mine ]           │ [ Take CDK ]            │
  └─────────────────────────┴─────────────────────────┘
                    [ Enter new value ]
  ```
- **Bulk actions:** "Take CDK for all inventory counts", "Keep all bin locations", etc. — per-field-type bulk resolution.
- **Two operator modes:**
  - **Quick mode** — one conflict at a time, keyboard-driven (←, →, ↑ for keep/take/custom), great for counter leads with 50+ conflicts to burn through.
  - **Audit mode** — full table with filters, notes column, export-to-CSV for branch manager sign-off.

**Default policies (per field type, configurable):**
| Field class | Default conflict behavior |
|---|---|
| Price, cost, discount matrix | **Always preview** — never auto-resolve |
| Bin location, stocking code | **Always preview** — physical world state |
| ROP, EOQ, safety stock | **Always preview** — intelligence engine inputs |
| Inventory on-hand, on-order, back-ordered | **Auto-take-CDK** (DMS is authoritative) |
| Sales history, bin trips, demands (historical) | **Auto-take-CDK** (facts, not opinions) |
| Date last sale, date last ordered | **Auto-take-CDK** |
| Description, category | **Preview if manual override flag set, else auto** |

**Acceptance:**
- Manual edit followed by identical CDK value → no conflict (nothing to reconcile).
- Manual edit followed by different CDK value → conflict row, nothing written to `parts_catalog` until resolved.
- Bulk "Keep all bin locations" resolves N conflicts in one transaction with audit trail.
- Unresolved conflicts block the run from marking `committed`; it stays in `previewing` until cleared.
- Override flags persist across imports — a "keep mine" decision survives subsequent imports until the operator clears it.

### Slice 1.3 — Admin import UI `/parts/import`

A dedicated page inside Parts Companion, admin/manager-only.

**UX:**
- Drag-drop upload zone (accepts .xlsx, .xlsm, .csv).
- Auto-detects file type; user confirms or overrides.
- **Preview panel** shows diff stats: "312 new · 48 updated · 3,950 unchanged · 0 errors" with expandable drill-downs. Side-by-side before/after for updated rows, highlighting changed fields.
- **Progress bar** during commit via Realtime subscription.
- **History tab** lists prior runs, filterable by file type + status, with re-download of source and rollback button (for admin).
- Mobile-optimized (per our mobile-first rule — counter manager needs to kick off an import from the parts desk).

**Acceptance:**
- Upload → preview → commit flow is under 3 clicks.
- Preview-only path never writes data (verify via `parts_import_runs` audit).
- Realtime progress actually updates on import of 4,310 rows.
- RLS prevents non-admin roles from seeing the page or endpoint.

### Slice 1.4 — Initial hydration run

Execute the import on the 4 delivered files and verify:

- **Parts List.xlsx** → 4,310 rows in `parts_catalog`, 103,440 rows in `parts_history_monthly` (4,310 × 24), linked to machines via `machine_code`.
- **Yanmar Price File** → 17,882 rows in `parts_vendor_prices` under the Yanmar vendor.
- **Vendor Contacts** → ~25 vendor_profiles, ~400 vendor_contacts, ~30 vendor_order_schedules (from the 3 contacts sheets + schedule sheet).

**Spot checks:**
- Search `129150-35170` in Parts Companion Lookup → shows OIL FILTER, $7.11, Inv=3, bin location, last-sold date, 24-month sparkline.
- Machines page shows all models that have parts, clickable to part list.
- Vendor page shows Yanmar with full contact tree + ordering schedule ("Thursdays, cutoff 2pm").

### Slice 1.5 — Re-import guardrails

Because CDK PARTMAST drops are dated (`04092026`), we need drift-safe re-imports:

- File-hash dedup → never re-import the same file twice.
- **Drift detection:** flag parts where `on_hand` or `bin_location` changed by >50% or moved across branches; show in preview.
- **Alert threshold:** if a re-import would delete >500 parts, require a second admin confirmation.
- Scheduled cron watches a designated Supabase Storage folder for new PARTMAST drops and auto-generates a preview (but never auto-commits).

**Phase 1 exit criteria:**
- All 4 files loaded, searchable, reportable.
- Any admin can re-import in under 2 minutes.
- Full audit trail, rollbackable.
- Mobile counter rep can find any part in under 5 seconds.

---

## 4. Phase 2 — Intelligence (Next)

**Goal:** Turn the 24 months of history into forecasts, the vendor data into arbitrage, the classification codes into automated decisions.

### Slice 2.1 — Seeded demand forecast

Hook `parts-demand-forecast` edge function (already built) to `parts_history_monthly`. No cold start — day-one forecasts use real dealer data.

- Weekly cron computes 30/60/90-day projected demand per part per branch.
- Writes to `parts_demand_projections` table.
- Exposes a `/parts/forecast` view: top-20 parts by projected demand, color-coded "on track / stockout risk / overstocked."
- **Transformation test:** forecast accuracy measured vs. actual next month. Target MAPE < 25% within 90 days.

### Slice 2.2 — Intelligent auto-replenish

Hook `parts-auto-replenish` to the seeded forecast + vendor ordering schedules.

- Each morning, for each vendor with an ordering day today:
  1. Compute parts below ROP.
  2. Apply EOQ and lead-time buffer.
  3. Cross-check against Yanmar list price (flag price increases >5%).
  4. Build a draft PO.
  5. Queue for parts manager review — one-click approve, with vendor contact auto-selected from ordering schedule.
- Voice integration: "Approve the Yanmar order."

### Slice 2.3 — Dead / slow / hot stock detection

Using classification codes (movement, activity, ASL) + 24mo history:

- **Dead stock** — no sales in 12+ months, on-hand > 0. Estimated tied-up capital. Suggest return, transfer, or clearance.
- **Slow stock** — ≤ 1 sale in 6 months. Flagged for review before re-order.
- **Hot stock** — 3x velocity spike vs. trailing 12. Suggests bumping safety stock.
- Dashboard card on Parts Companion home.
- Weekly digest to parts manager.

### Slice 2.4 — Vendor price arbitrage

Now that we have supplier prices (Yanmar) alongside internal cost:

- Compute margin per part per pricing level.
- Flag parts where list price hasn't kept up with vendor price increases (margin erosion).
- Flag parts sold below cost.
- Cross-reference cross-sell opportunities: "Customers who bought X also bought Y."

### Slice 2.5 — Stockout prevention

Per-part "days until stockout" projection using seeded forecast. Push alerts to parts manager when any part < lead-time-days from empty.

### Slice 2.6 — Machine ↔ parts knowledge graph

Connect `parts_catalog.machine_code` + `model_code` → `machine_profiles`. Every machine page shows its parts with velocity. Every part page shows its machines. Enables the Phase 3 predictive plays.

**Phase 2 exit criteria:**
- Forecast MAPE < 25%.
- ≥ 60% of vendor POs auto-drafted.
- ≥ $X tied-capital identified and actioned (baseline set in Phase 1).
- Zero surprise stockouts on A-class parts over a 30-day window.

---

## 5. Phase 3 — Moonshot (Future)

This is where we earn the mission statement. Each slice here is a capability that is **hard or impossible for a competitor** without an LLM-native stack.

### Slice 3.1 — Natural-language parts search

"I need the thing that goes in the chipper drum" → returns the right SKU using description embeddings + machine knowledge graph. Already scaffolded in `ai-parts-lookup` — Phase 1 data makes it sing.

### Slice 3.2 — Voice-first counter operations

Counter rep, hands full of a greasy part:
- "Hey, price on 129150-35170?"
- "Add 10 of those Yanmar oil filters to the Thursday order."
- "Who ordered this last — the Johnson account?"

Leverages existing `voice-to-parts-order` + voice-to-qrm pipeline. Activation target: under 2 seconds per query.

### Slice 3.3 — Predictive failure → pre-position parts

With customer machine inventory (from QRM) + usage patterns + manufacturer failure curves (from `machine_profiles`):

> "Johnson Construction's 2021 Yanmar SA424 has 1,820 hours. Based on failure pattern, it will likely need a hydraulic filter (SKU 129A00-55730) within 21 days. You have 1 on hand. Order 2 more today."

Sales rep gets this as a **proactive play** in their morning briefing. This is the kind of thing that's genuinely not possible with pre-LLM DMS systems.

### Slice 3.4 — Visual parts ID

Extend `parts-identify-photo`: counter rep photographs an unknown part → LLM vision + cross-reference embedding lookup → top 3 likely SKUs with confidence scores. Already partially built.

### Slice 3.5 — Supplier health monitoring

Track lead time drift, price creep, fill rate degradation per vendor over time. Alert when any vendor trends beyond normal bands. Supports negotiation leverage.

### Slice 3.6 — Proactive sales parts plays

When a customer buys a used machine (via QRM), auto-generate a 30/60/90 parts maintenance plan with estimated revenue, priced at their tier, ready for the rep to send.

### Slice 3.7 — Competitive pricing intel

Scrape public dealer parts pricing (where legal) to benchmark our pricing levels. Flag parts where we're materially above/below market.

**Phase 3 exit criteria (per slice, not aggregate):**
- At least one Phase 3 capability delivers measurable revenue or margin lift within its first full quarter.
- Operator-utility score (survey: "would you miss this if it was gone?") > 8/10 per role.

---

## 6. Slice Sequence & Ship Cadence

Per CLAUDE.md execution cadence — ship, then continue.

| # | Slice | Depends on | Mission checks | Estimate |
|---|---|---|---|---|
| 1.1 | Schema extensions migration | — | fit, transformation, pressure-test | Day 1 |
| 1.2 | `parts-bulk-import` edge function | 1.1 | fit, pressure-test, operator-utility | Day 2–3 |
| 1.2b | Conflict reconciliation flow + review UI | 1.2 | operator-utility, pressure-test | Day 3–4 |
| 1.3 | `/parts/import` admin UI | 1.2b | operator-utility, pressure-test | Day 4 |
| 1.4 | Initial hydration + spot-check | 1.3 | pressure-test | Day 4 |
| 1.5 | Re-import guardrails | 1.4 | pressure-test | Day 5 |
| — | **Phase 1 ship** — demo-ready | | | End of week 1 |
| 2.1 | Seeded demand forecast | 1.4 | transformation | Week 2 |
| 2.2 | Auto-replenish wiring | 2.1 | transformation, operator-utility | Week 2–3 |
| 2.3 | Dead/slow/hot detection | 1.4 | operator-utility | Week 3 |
| 2.4 | Vendor price arbitrage | 1.4 | transformation | Week 3 |
| 2.5 | Stockout prevention | 2.1 | operator-utility | Week 4 |
| 2.6 | Machine ↔ parts graph | 1.4 | transformation | Week 4 |
| — | **Phase 2 ship** — intelligence layer live | | | End of week 4 |
| 3.1–3.7 | Moonshot slices | Phase 2 | all four checks per slice | Weeks 5+ |

Estimates intentionally loose. What's hard-coded: **after every green slice, continue into the next without waiting for a prompt** (per CLAUDE.md).

---

## 7. Non-Negotiables

From CLAUDE.md, applied to this plan:

- No architecture reset — we're extending `parts_catalog`, not replacing it.
- Zero-blocking: missing vendor credentials never break the catalog.
- RLS on every new table using `get_my_workspace()` / `get_my_role()`.
- Migrations follow `NNN_snake_case_name.sql` — next free prefix is **260**.
- No secrets in frontend; all vendor API keys stay in Supabase function secrets.
- Mobile-first UX on every operator surface.
- Build gates before closing a slice:
  1. `bun run migrations:check`
  2. `bun run build` (repo root)
  3. `bun run build` (apps/web)
  4. Edge function + contract tests for touched surfaces
  5. Role/workspace security check

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CDK export format drift between branches | Import breaks silently | File-type auto-detect by header signature; raw_dms_row JSONB audit; schema version column |
| 4,310 × 24 history rows = 103k inserts | Slow import, timeout | Batched 250-row transactions + Storage-triggered async processing |
| Vendor file formats vary by manufacturer | One-off import handlers | Generic `vendor_price` handler accepts column mapping JSON per vendor |
| Forecasts wrong on rare parts | Operator loses trust | Surface confidence intervals; exclude parts with < 6 months history from auto-replenish |
| Import overwrites manual corrections | Data loss | `parts_catalog.manual_override` flag per field; import respects flags |
| Role escalation via import audit data | Security | RLS on `parts_import_runs`; redact source file hash for non-admin |

---

## 9. Success Metrics

**Phase 1 (Foundation):**
- 100% of delivered parts searchable in Parts Companion within 24h of import.
- Import preview → commit in < 3 clicks.
- Any admin can re-import in < 2 minutes, zero engineer intervention.

**Phase 2 (Intelligence):**
- Demand forecast MAPE < 25% on A-class parts.
- ≥ 60% of POs originate as auto-drafts.
- Dead stock: 20% reduction in tied-up capital quarter-over-quarter.
- Zero surprise stockouts on A-class parts over 30-day windows.

**Phase 3 (Moonshot):**
- NL parts search: P95 query-to-correct-SKU under 3 seconds, > 85% accuracy.
- Predictive failure: ≥ 1 measurable win (part pre-positioned, stockout avoided) per rep per month.
- Operator-utility survey: > 8/10 per role.

---

## 10. Decisions (locked 2026-04-15)

1. **Workspace scoping → MULTI.** Schema models Co/Div/Br from day one. `parts_catalog` is keyed on `(workspace_id, co_code, div_code, branch_code, part_number)`. Inventory, bin location, ROP, EOQ, and on-hand are per-branch. `parts_history_monthly` is per-branch. Vendor ordering schedules are per-branch. Reports roll up across branches for corporate views.

2. **Vendor identity → PRE-SEED.** Import order is fixed: Vendor Contacts **first** (creates all vendor_profiles), Vendor Price Files **second** (attach to existing vendor), PARTMAST **last** (cross-references vendor_code into the pre-seeded vendor table). Orphaned vendor_codes in PARTMAST surface in the import preview as "unknown vendor — create or skip?"

3. **Manual override → REVIEW & CHOOSE flow.** New slice added: **1.2b — Conflict Reconciliation**. See §3 below. Any field with a manual edit that conflicts with an incoming CDK value lands in a review queue; the operator sees both values side-by-side with attribution and timestamps, picks keep-mine / take-CDK / enter-new. Nothing silently overwritten.

4. **CDK drop cadence → TBD; default to preview-and-approve.** Until we confirm with ops whether CDK DDS is exporting daily/weekly/on-demand, we ship the re-import surface as **manual upload + watched folder with auto-preview but never auto-commit**. Once cadence is known, we can flip the cron to auto-commit low-risk imports (inventory/on-hand only) while keeping catalog changes (new parts, price changes, bin moves) behind preview-approval. Question in §11.

5. **Phase 3 priority → Predictive Failure → Pre-Position Parts (Slice 3.3).** This is the first moonshot slice after Phase 2 lands. Phase 2 ordering is reshaped to pave the road for it: the machine↔parts knowledge graph (2.6) moves up to ship alongside the demand forecast (2.1), since 3.3 needs both.

---

## 11. One Last Question — CDK Drop Cadence

To clarify my earlier question (#4) — I'm asking: **how often does CDK give you a new PARTMAST export file?**

The file you gave me is named `446431_000001_PARTMAST_04092026_000001.pdf` — the `04092026` is the date CDK generated it (April 9, 2026). That suggests it's a periodic drop, but I don't know the schedule.

Three common CDK setups:
- **Nightly batch** — CDK drops a fresh PARTMAST to an SFTP folder every night at ~2am.
- **Weekly** — fresh export every Friday or Monday morning.
- **On-demand** — parts manager requests an export from the DMS when they need one.

**Why it matters:** if it's nightly, the re-import should be fire-and-forget (auto-detect, auto-preview, only alert on conflicts). If it's on-demand, we just need a solid manual upload path and the file watcher is overkill for now.

Your best guess is fine — we can adjust once we see the first few drops. If you don't know, I'll default to "on-demand manual upload" and we'll add automation later.

---

## 12. Kickoff

On approval of this plan I will:
1. Enter Plan Mode formally for Slice 1.1.
2. Cut migration `260_parts_intelligence_schema.sql`.
3. Stand up the `parts-bulk-import` edge function.
4. Ship the admin UI.
5. Run the hydration against your 4 files.
6. Demo in Parts Companion.

Then continue directly into Phase 2 per the execution cadence.

---

*This is the master plan. Individual slice plans will live as their own docs under `plans/` as they spin up.*
