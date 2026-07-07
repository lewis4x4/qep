# QEP Rental Department — Discovery Report (§7.1)

**Date:** 2026-07-06
**Charter:** QEP Rental Department — Moonshot Build Charter
**Repo state at audit:** migration head 767, 208 edge-function dirs, `main` @ `015b5180`
**Production DB audited:** Supabase `iciddijgonywtxoelous` (live queries, not schema-file inference)

> Verdict in one line: **the rental data model is ~80% of IntelliDealer parity and far richer than
> anyone is using — but there is zero business-logic runtime (no billing engine, no state machine
> guards, no event emitters, no crons), zero production data, one narrow portal-only origination
> path, and no roadmap stream.** The build is not "add tables"; it is "give the existing skeleton
> a nervous system, fix the contract-origination anchor, and ship the department."

---

## 1. Data layer — what exists (live-verified)

### 1.1 The 12 rental relations

All are real tables (`relkind='r'`), all have **RLS enabled** with 2–3 policies each
(workspace gate + role/portal-customer gate + service_role bypass — the canonical shape).
All carry `workspace_id`, `created_at`/`updated_at` (with `set_*_updated_at` triggers), most
carry `deleted_at`. All have `trg_rch_*` row-change-history audit triggers.

| Table | Origin | What it models |
|---|---|---|
| `rental_contracts` | mig 235 → heavily extended 522/530/607/666 | Contract header (~90 cols — see 1.2) |
| `rental_contract_lines` | mig 522 | Multi-unit lines: meters, per-line rates, RPO, waiver, sub-rental, exchange chain (see 1.3) |
| `rental_contract_extensions` | mig 235/241 | Customer extension requests (submitted → reviewing → approved/declined/cancelled) + payment linkage |
| `rental_invoices` | mig 522 + 666 | Full charge decomposition + reversals + FL DR-15 county-tax fields (see 1.4) |
| `rental_billing_runs` | mig 530 | Batch cycle-billing runs: run_date, billing_cycle, status (draft/running/completed/failed/rolled_back), invoice_count, total_billed_cents, rollback |
| `rental_rate_rules` | mig 235 | Rate cards scoped by customer / equipment / branch / category / make / model / class / subclass, seasonal windows, day/week/month rates, `minimum_days`, `priority_rank` |
| `rental_returns` | mig 079 → extended 191/522 | Return inspection: checklist jsonb, condition photos, charge breakdown (fuel/cleaning/damage/labor/parts/environmental/other cents), deposit-vs-charge, refund method must match original, `aging_bucket`, WO + credit-invoice refs, `rental_contract_id` + `rental_invoice_id` FKs |
| `rental_contract_signatures` | mig 607 | Native e-sign audit: signer name/email/IP/UA, signature image, signed snapshot, `document_hash`, one-valid-per-contract unique index |
| `rental_contract_commissions` | mig 530 | Salesperson splits (`split_pct`, role) per contract |
| `rental_print_settings` | mig 530 | Per-branch print params (logo, terms template, show rate breakdown…) |
| `sub_rental_vendors` | mig 522 | Re-rent vendors: insurance/COI, `default_markup_pct`, vendor_number, links to `vendor_profile_id`/`company_id` |
| `exec_rental_return_summary_v` | mig 193 | security_invoker wrapper over `mv_exec_rental_return_summary` (owner-only) |

Typed enums (mig 522): `rental_billing_cycle` (hourly, daily, weekly, monthly, **cycle_28_day**, custom),
`rental_proration_rule` (none, hourly, daily, calendar_day, half_day, thirty_day_month),
`rental_invoice_status` (draft, open, posted, sent, partial, paid, overdue, void, reversed),
`rental_contract_line_status` (quoted, reserved, active, exchanged, returned, cancelled, lost, damaged).

### 1.2 `rental_contracts` header — strengths and the structural flaw

Strengths (all live columns): estimate + agreed day/week/month rates; hourly rate + `included_hours_per_day` +
overage rate; deposit (required/amount/status/invoice FK); COI + insurance block (provider, policy,
expiry, min coverage, document); damage waiver (accepted/pct/amount); delivery + pickup (required,
jsonb addresses, fees, promised timestamps); RPO block (eligible, purchase price, credit pct, term,
exercise deadline); PO block (required/number/received_at); `quote_expires_at`; `salesperson_id`;
print PDF (url/generated at/by); rate-override approval trio; class/subclass; hard-close trio;
native signature trio; `contract_number` (nullable, unique per workspace); `billing_cycle` +
`proration_rule`; destination-based tax (`tax_jurisdiction_id`, `tax_sourcing_method`
destination_ship_to | branch_origin | manual_override, `ship_to_address_id`, exemption cert FK).

**The structural flaw (charter §6, live-confirmed):**

```
portal_customer_id  uuid  NOT NULL           ← contract cannot exist without a portal account
request_type        CHECK in ('booking','extension')
status              CHECK in ('submitted','reviewing','quoted','approved',
                              'awaiting_payment','active','completed','declined','cancelled')
assignment_status   CHECK in ('pending_assignment','assigned')
```

- The trunk lifecycle is a **customer-portal booking pipeline**, not a rental lifecycle. There is no
  `reservation` state distinct from a request, no `on_rent` / `off_rent` distinction, no `closed`
  vs `completed` separation, no `contract_type` (reservation/rental/RPO/demo/loaner/rerent) —
  IntelliDealer's 7 contract types have no home.
- No FK to `qrm_companies`/`qrm_contacts`: a counter rep cannot originate a contract for a CRM
  customer. (`portal_customers.crm_company_id` exists, so the bridge is one join away — but the
  NOT NULL forces every contract through a portal identity.)
- Guard constraints that DO exist and are worth keeping: equipment required + `assignment_status='assigned'`
  before approved/awaiting_payment/active/completed; `requested_end_date >= requested_start_date`.

### 1.3 `rental_contract_lines` — the sleeper asset

Mig 522 shipped a near-complete IntelliDealer RMCONTL analog that **no code writes to**:
line_number (unique per contract), quantity, equipment FK, requested category/make/model,
`return_code` (free text — **not** the typed R/O/E/H enum), rental_start/end/actual_returned_at,
**outbound/return meter hours + odometer**, per-line day/week/month/hour rates (cents), rate
override + reason, `included_hours`, overage hourly rate, **sub-rental** (is_sub_rental, vendor FK,
PO, cost), **`exchange_parent_line_id`** (exchange/substitution chains) + substitution_reason,
per-line RPO (eligible/price/credit pct), per-line damage waiver, `status`
(quoted/reserved/active/exchanged/returned/cancelled/lost/damaged).

Gap: `return_code` is untyped free text; line status lacks `on_rent`/`off_rent`/`held`; nothing
maintains header↔line consistency.

### 1.4 `rental_invoices` — a billing model with no biller

Charge decomposition: rental, hourly, overage, delivery, pickup, damage-waiver, fuel, cleaning,
damage, sub-rental, other, discount → taxable → tax → total → paid → balance (all cents).
`period_start`/`period_end` + billing_cycle + proration_rule per invoice. Reversal chain
(`reversal_of_invoice_id`/`reversed_by_invoice_id`/reason/at — used by credit_memos.rental_invoice_id
and mig 540 equipment-sale reversal work). Florida **DR-15 county surtax** fields
(dr15_reporting_period, dr15_county_name, dr15_reportable — mig 666, destination-sourced per
commit `9563daff`). `rental_billing_run_id` FK.

### 1.5 Equipment / fleet seam

- `crm_equipment` is a **compat view** (relkind `v`) over `qrm_equipment` — frozen at rename time.
  It surfaces `ownership` (enum incl. `rental_fleet`), `availability`
  (available/rented/sold/in_service/in_transit/reserved/decommissioned/on_order per frontend types),
  and day/week/month rental rates.
- `qrm_equipment` (the real table) additionally carries `rental_amount_cents`, `rental_cost_pct`,
  `rental_fleet_date`, `rental_insurable_amount_cents`, `readiness_status`, `next_available_at` —
  **invisible through the compat view** (the mig 190/191 lesson, live-confirmed: the view's column
  list is missing all post-rename additions).
- `fleet_intelligence` table exists (utilization_trend column) — **0 rows**.
- `branches.rental_yard_capacity` exists.
- `inspection_runs.rental_contract_id` exists (InspectionPlus separation, commit `688ce0b3`) —
  rental return inspections can already anchor to a first-class inspection engine.
- Nothing computes or maintains `readiness_status`, `next_available_at`, or any utilization number.

### 1.6 Adjacent-domain seams already in place

| Seam | Evidence | State |
|---|---|---|
| Traffic/haul | `traffic_tickets` (5 RLS policies, auto-lock trigger, status haul_pending→scheduled→being_shipped→completed, promised_delivery_at) | Built for sales moves; **nothing creates rental delivery/pickup tickets** |
| Service (H10) | `service_jobs.service_internal_work_class` incl. `rental_fleet_maintenance`; `service_internal_cost_destination` incl. `rental_unit`; **`renter_fault_billable`** exception flag; internal cost posting lifecycle (mig 691) | Shipped from the service side; rental side never opens WOs into it |
| AR / credit | `ar_aging_view.has_active_rental`; AR gate (`enforce_ar_quote_block`, mig 156) + `apply_ar_override` | AR view already knows about rentals; **no rental origination gate** |
| Deposits/payments | `rental-ops` creates deposit `customer_invoices` (`RENT-{ts}`), Stripe portal pay marks paid | Works, portal-path only |
| Tax | `qrm_companies.tax_code_rental`, `tax_exemption_certificates.covers_rental`, `tax_treatments.covers_rental`, DR-15 fields, destination sourcing | **Strong** — county-tax rental work shipped in K-stream |
| E-sign | `rental_contract_signatures` + native signing (C4.1 shipped, commit `f19537c6`, closeout mig 743) | Built and roadmap-closed |
| Iron memory | `trg_iron_memory_rental_returns` bumps `iron_memory_*` on returns | Only rental table wired to Iron memory |
| Commissions | `rental_contract_commissions` | No writer |

### 1.7 Functions / triggers / crons — the runtime void

Live catalog query for rental business logic returns **nothing but housekeeping**:
`set_*_updated_at` ×10, `trg_rch_*` audit ×10, `trg_iron_memory_rental_returns` ×1.

- **Zero** rental RPCs (no rate resolution, no billing computation, no availability maintenance,
  no state-transition guards, no context resolver).
- **Zero** rental crons (no cycle-billing tick, no nearing-end scanner, no COI-expiry watch,
  no overdue scanner).
- **Zero** rental event emitters: `rental.nearing_end` is consumed by the registered
  `rental-nearing-end` flow workflow but **nothing emits it** (grep: only the workflow definition
  and flow-synthesize catalog reference it). The system-reference §12.3 "35 unwired event types"
  backlog includes the entire `rental.*` family.

## 2. Edge-function layer

| Function | Rental behavior | Assessment |
|---|---|---|
| `rental-ops` (378 lines) | 4 actions: `approve_booking` (assign unit — requires `crm_equipment.ownership='rental_fleet'` + `availability='available'` — copy estimate→agreed rates, optional deposit invoice `RENT-{Date.now()}`, status → active/awaiting_payment), `decline_booking`, `approve_extension` (optional `EXT-{ts}` invoice or direct end-date move), `decline_extension`. JWT + operator-workspace check, then service-role writes. | Dealer-side **approval queue for portal requests only**. Cannot originate, cannot open/close/return/bill. Invoice numbers from `Date.now()` (no sequence). Copies only header rates — never writes `rental_contract_lines`. |
| `portal-api` `/rentals` route (~2494ff) | Customer-side: list contracts + extensions + rental fleet (`ownership='rental_fleet'`) + rate rules + signatures + returns; booking draft validation (exact_unit / category_first); payment-status view; finalize-after-pay+sign stage machine (`getPortalRentalContractStage`: pending_assignment → awaiting_payment → awaiting_signature → ready_to_finalize → active) | The **only** origination path in the product. Portal-anchored by design. |
| `demo-admin` / seeders (`scripts/demo/*.mjs`) | grep: **zero rental seeding** | Why every rental surface demos empty |
| Everything else (billing, invoicing) | **No function reads or writes `rental_invoices` or `rental_billing_runs`** (repo-wide grep) | Cycle billing = tables with no motor |

## 3. Frontend layer

| Surface | Route (App.tsx) | Reads | Writes | Grade |
|---|---|---|---|---|
| Rental Command Center (`RentalCommandCenterPage.tsx`, 825 lines) | `/qrm/rentals` (rep+ & nav-gated) | `crm_equipment` (fleet by availability), `rental_returns`, `traffic_tickets`, `rental_contracts` + extensions + `portal_customers` (approval queue), `branches` | approve/decline via `rental-ops` | Real console, but fleet board driven by `crm_equipment.availability` flags nobody sets; "utilization" = instantaneous on-rent/fleet ratio (`rental-command.ts:158`), not time- or dollar-based |
| Rental returns wizard (`RentalReturnsPage.tsx`, 514 lines) | `/ops/returns` (admin+) | `rental_returns` | `rental_returns` update (checklist, photos, decision, charges, refund) | Track 4.4 shipped; solid mobile wizard; **not linked to contract lines / return codes / invoices** (writes header charge fields only) |
| Rate admin (`RentalPricingPage.tsx`, 481 lines) | `/admin/rental-pricing` | `rental_rate_rules`, `crm_equipment`, `branches`, `portal_customers` | rate rule CRUD | Functional CRUD; no ratio validation, no rate-book concept, no effective-dating beyond seasonal window |
| Rental Conversion Engine (`RentalConversionEnginePage.tsx`) | `/qrm/accounts/:accountId/rental-conversion` | `crm_deals`, `crm_deal_equipment`, `voice_captures`, `customer_invoices`, `crm_equipment` | — | 7B.6 moonshot page; heuristic signals; **not wired to actual rental history** (no rental_contracts read) |
| Portal rentals (`PortalRentalsPage.tsx`, 758 lines) | portal route | portal-api `/rentals` | booking draft, extension request, pay, sign, finalize | The most complete rental workflow in the product |
| `RentalLabShowcase` | `/rentals` | — | — | Showcase/lab, not operational |
| Owner Home BU strip (`BuPulseStrip.tsx`) | `/floor` | `rental_contracts` (active count, monthly run-rate) | — | Rental is 1 of 4 owner BUs; reads $0 forever |

Counter origination from the dealer side: **does not exist anywhere in the UI.**

## 4. Roadmap layer

Live `qep_roadmap_tasks` (streams A–K, Linear-synced): **no rental stream; zero rental build tasks.**
Only touches: **C4.1** (native e-sign extension to rental contracts — shipped), **H10.1** (internal &
rental-fleet service — shipped), plus incidental mentions (G11.1 parts seam, B5.7 home route).
Parts (G, 14 tasks) and Service (H, 15 tasks) were born from discovery→blueprint→seed migrations
(migs 650 pattern); Financials (K) likewise. Rental skipped the process — this document closes that gap.

## 5. Production data reality (live counts, 2026-07-06)

```
rental_contracts 0 · rental_contract_lines 0 · rental_invoices 0 · rental_billing_runs 0
rental_returns 0 · rental_rate_rules 0 · rental_contract_extensions 0
rental_contract_signatures 0 · rental_contract_commissions 0 · sub_rental_vendors 0
crm_equipment: 100 units, ownership='customer_owned' ×100, rental_fleet ×0, rental rates ×0
qrm_equipment: readiness_status null ×100, next_available_at null ×100 · fleet_intelligence: 0 rows
```

Consequence: `rental-ops approve_booking` **cannot succeed in production today** (no assignable
unit passes the `rental_fleet` + `available` filter). The gap-audit's "75/76 BUILT" is column-existence
parity; zero-row "BUILT" is banned by charter §0.

## 6. Gap matrix vs charter §2 (Have / Partial / Missing)

| # | Capability (§2) | Status | Evidence / what's missing |
|---|---|---|---|
| 2.1 | Counter / walk-in origination | **MISSING** | `portal_customer_id NOT NULL`; no UI; no company/contact anchor |
| 2.1 | Phone / field-voice origination | **MISSING** | voice-capture + voice-to-qrm exist to clone; no rental extraction target |
| 2.1 | Iron conversational origination | **MISSING** | Iron flow registry has no rental actions |
| 2.1 | Portal self-service | **HAVE** | portal-api /rentals + PortalRentalsPage + rental-ops, end-to-end incl. Stripe + e-sign |
| 2.2 | Rate books day/week/month + minimums | **PARTIAL** | `rental_rate_rules` scoped cards + minimum_days; no ratio structure, no rate-book versioning |
| 2.2 | Billing-time cheapest-legal-combination optimization | **MISSING** | no computation anywhere |
| 2.2 | Negotiated / customer / effective-dated overrides | **PARTIAL** | customer_id scope + priority_rank + seasonal window; no effective-dating, no approval flow on rules |
| 2.2 | Ancillary revenue (waiver, env fee, fuel, delivery, cleaning, overage) | **PARTIAL** | all modeled as columns (contracts, lines, invoices, returns); nothing computes or bills them |
| 2.3 | Lifecycle quote→reservation→on-rent→off-rent→returned→closed | **MISSING** | trunk status machine is the portal booking pipeline; no on_rent/off_rent anywhere on header; line status has no off_rent/held |
| 2.3 | Off-rent ≠ returned (clock stop) | **MISSING** | concept absent (flagged in master-roadmap geofence spec as "exited customer site + rental → off-rent inspection" — never built) |
| 2.3 | Cycle billing (28-day auto-invoice, prorated final) | **MISSING (schema HAVE)** | enums + runs + invoices tables complete; zero writers, zero cron |
| 2.3 | Meter in/out capture | **PARTIAL** | line columns exist; no capture UI/flow |
| 2.4 | Contract types (reservation/rental/RPO/demo/loaner/rerent) | **MISSING** | no contract_type; RPO + sub-rental modeled as attribute blocks, not types |
| 2.5 | Return codes R/O/E/H first-class | **PARTIAL** | `rental_contract_lines.return_code` free text; returns wizard has its own status machine not linked to codes |
| 2.5 | Condition in/out photo-documented | **PARTIAL** | returns wizard has checklist+photos on return; nothing at check-OUT; `inspection_runs.rental_contract_id` ready but unused |
| 2.5 | Damage → auto service_job | **PARTIAL** | H10 gives service the internal class + renter_fault_billable; returns wizard captures work_order_number as free text — no auto-open |
| 2.6 | Availability calendar + reservation holds | **MISSING** | no reservation model; `next_available_at` never maintained |
| 2.6 | Substitution logic | **PARTIAL** | exchange_parent_line_id + substitution_reason columns; no workflow |
| 2.6 | readiness/next_available live | **MISSING** | columns null; no triggers |
| 2.6 | Time / physical / dollar utilization | **MISSING** | physical-instantaneous only (command center); no time-based, no OEC-based dollar utilization; `qrm_equipment.rental_amount_cents`/`rental_cost_pct` exist as inputs |
| 2.7 | Flow automations (off-rent, cycle-due, overdue, low-avail, RPO, COI, idle) | **MISSING** | 1 workflow registered (`rental-nearing-end`), 0 emitters, 0 rental actions in registry |
| 2.7 | Iron rental surface | **MISSING** | no drill-to-chat contextType for rental; no Iron flows |
| 2.7 | Command Center rental P&L lens | **PARTIAL** | COO KPI `rental_returns_aging_count` + `mv_exec_rental_return_summary` exist; no revenue/utilization/idle-cost KPIs |
| 2.7 | Predictive fleet intelligence | **MISSING** | `parts_demand_forecasts` pattern to clone; `fleet_intelligence` empty |
| 2.7 | Dynamic/yield pricing | **MISSING** | — |
| 2.7 | Telematics + geofence billing/theft | **MISSING** | `telematics_feeds` + PostGIS `geofences` exist; master roadmap already specced the off-rent geofence trigger |
| 2.7 | Traffic/haul auto-tickets | **MISSING** | tickets exist; no rental creator; command center already *reads* them |
| 2.7 | AR/credit gate on origination | **MISSING** | AR gate exists for quotes; `ar_aging_view.has_active_rental` ready |
| — | Commissions | **PARTIAL** | table exists, no writer |
| — | Re-rent margin management | **PARTIAL** | vendors + line cost columns; no workflow/UI |
| — | TCPA-clean customer messaging | **MISSING** | no rental messaging at all (greenfield — build clean) |

## 7. Structural refactor targets (§6, evidence-anchored)

1. `portal_customer_id` → nullable; add `qrm_company_id`/`qrm_contact_id` FKs, `origination_channel`
   (counter|voice|iron|portal), `originated_by`; CHECK: exactly one customer anchor present.
2. Trunk state machine → rental lifecycle (draft/quoted → reserved → on_rent → off_rent → returned →
   closed, + cancelled/declined/expired), trigger-guarded (clone `crm_deal_sla_on_stage_change`
   discipline); keep the portal booking statuses as the reservation sub-flow.
3. `contract_type` enum: reservation | rental | rpo | demo | loaner | rerent.
4. Type `return_code` (returned | off_rent | exchange | hold) on lines AND thread the returns wizard
   through lines (today it writes only the `rental_returns` header).
5. Activate fleet fields: maintain `qrm_equipment.readiness_status` + `next_available_at` via
   contract-line triggers (target `qrm_equipment` directly — compat view is frozen).
6. Rate storage: keep `rental_rate_rules` as the card store; add ratio/rounding/optimization as a
   resolver RPC contract rather than new tables (decision for blueprint).
7. Demo seeder covering every type + state (charter §0 zero-row ban).

## 8. Reuse map (what Stream L leans on instead of building)

- **Events/audit/triage:** `emit_event()` + `analytics_events` flow columns; `exception_queue`
  new sources (`rental_overdue_return`, `rental_coi_expired`, `rental_credit_hold`,
  `rental_damage_dispute`); `analytics_action_log` new action_types.
- **Automation:** Flow Engine registry + workflows-as-code + `flow_resolve_context` pattern for a
  `rental_resolve_context` composite RPC; pg_cron + `net.http_post` (mig 097 pattern) for the
  billing tick and nearing-end scanner.
- **Money:** `customer_invoices` + Stripe portal pay + deposit machinery + AR gate + county-tax
  DR-15 plumbing (already rental-aware) + credit_memos reversal chain.
- **Logistics:** `traffic_tickets` + driver workflow + auto-lock.
- **Service:** H10 internal WO classes + renter_fault_billable + `inspection_runs.rental_contract_id`.
- **E-sign:** `rental_contract_signatures` + native signing flow (C4.1).
- **AI:** voice-to-qrm extraction pattern; Iron flow definitions; drill-to-chat preload branch
  pattern (`flowRunId` clone → `rentalContractId`); `parts_demand_forecasts` forecasting pattern.
- **UI:** primitives (`StatusChipStack`, `FilterBar`, `CountdownBar`, `ForwardForecastBar`,
  `AskIronAdvisorButton`), returns wizard, command center shell, rate admin, portal pages.

## 9. Corrections to prior claims

- Charter §1.2 says "~90 columns … but every table zero rows" — confirmed, and *understated*:
  lines/invoices/billing-runs are near-complete IntelliDealer analogs (RMCONTL/RMINV), not just the header.
- The three-agent code-mapping runs referenced by the charter were cancelled by a session interrupt;
  their scope was re-executed inline (this document supersedes them).
- Charter reference date (mig 202 / ~105 fns) describes the April snapshot in
  `docs/QEP-COMPLETE-SYSTEM-REFERENCE.md`; the repo is at mig 767 / 208 fn dirs. All patterns in
  that reference were re-verified live where they matter (compat views, universal stores, RLS shape,
  Flow Engine files).

**Next:** `docs/rental/BLUEPRINT.md` (§7.2) — target architecture as inter-layer contracts, then the
Stream L seed migration (§7.3). Build starts at L0 (§6 refactor) only after both exist.
