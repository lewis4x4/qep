# QEP Rental Department — Blueprint (§7.2)

**Date:** 2026-07-06
**Precondition:** `docs/rental/DISCOVERY.md` (read it first — this document assumes its findings)
**Governing constraints:** charter §4 (the constitution) + `docs/QEP-COMPLETE-SYSTEM-REFERENCE.md` §11 patterns

This blueprint expresses the target architecture as **contracts between layers** — behaviors,
interfaces, and invariants. File-level implementation belongs to the executing slice. Every
contract here maps to a Stream L slice (§7.3 seed migration).

---

## 0. Design stance

1. **One contract model, four front doors.** Counter, voice, Iron, and portal all originate into
   `rental_contracts` + `rental_contract_lines`. No parallel "counter contracts" table.
2. **The clock is the product.** Everything revenue-bearing keys off timestamps the state machine
   owns: `on_rent_at`, `off_rent_at`, `returned_at`. Billing, utilization, overdue logic, and haul
   scheduling all derive from them. No state without its timestamp; no timestamp without its state.
3. **Extend, never fork** (§11.1–11.2 patterns): events → `analytics_events`; triage →
   `exception_queue`; audit → `analytics_action_log`; money → `customer_invoices` + Stripe +
   AR gate; logistics → `traffic_tickets`; damage work → `service_jobs` (H10); inspections →
   `inspection_runs`; e-sign → `rental_contract_signatures`.
4. **Schema is mostly done — L-work is state, computation, and motion.** Discovery §1 shows lines,
   invoices, billing runs, rate rules, vendors, commissions all exist. The blueprint adds the
   minimum DDL (state machine, contract types, anchoring, reservations) and puts everything else
   into RPCs, triggers, workflows, crons, and surfaces.
5. **Deterministic money, agentic everything-else.** Billing/proration/tax run as deterministic
   cron + RPC (auditable, replayable, rollback-able via `rental_billing_runs`). Flow Engine
   handles reaction (off-rent → pickup ticket), never invoicing math.

---

## 1. Data model refactor (Slice L0) — the contract

### 1.1 Customer anchoring & origination

```sql
rental_contracts
  portal_customer_id     uuid NULL            -- was NOT NULL
  qrm_company_id         uuid REFERENCES qrm_companies(id)
  qrm_contact_id         uuid REFERENCES qrm_contacts(id)
  origination_channel    text NOT NULL DEFAULT 'portal'
                         CHECK (in ('counter','voice','iron','portal'))
  originated_by          uuid REFERENCES profiles(id)     -- rep/actor; null for pure portal
  CONSTRAINT rental_contracts_customer_anchor
    CHECK (portal_customer_id IS NOT NULL OR qrm_company_id IS NOT NULL)
```

Invariants:
- A portal-originated contract keeps `portal_customer_id` and derives `qrm_company_id` from
  `portal_customers.crm_company_id` when present (backfill trigger).
- Counter/voice/Iron contracts anchor on `qrm_company_id` (contact optional); a portal identity can
  be attached later without rewriting history.
- All reads join customer identity through a single view `rental_contract_customer_v`
  (security_invoker) so surfaces never re-implement the two-anchor join.

### 1.2 Contract types

```sql
contract_type text NOT NULL DEFAULT 'rental'
  CHECK (in ('reservation','rental','rpo','demo','loaner','rerent'))
```

- `reservation` is a *type* that converts to `rental` (or `rpo`) at check-out — conversion is an
  UPDATE of `contract_type` + lifecycle transition, preserving the id and audit chain (mirrors
  IntelliDealer "reservation → contract" and the gap-audit's `quote_converted_to_contract_id` hint,
  which we implement as same-row conversion + `analytics_action_log` entry instead of row cloning).
- `rpo` requires the RPO column block non-null (CHECK); `rerent` requires ≥1 line with
  `is_sub_rental=true`; `demo`/`loaner` bill $0 rental but still meter, insure, and occupy availability.

### 1.3 Lifecycle state machine (the trunk)

Replaces the booking pipeline as the contract's primary state. Portal booking statuses become the
**reservation-phase sub-flow**.

```
draft ──► quoted ──► reserved ──► on_rent ──► off_rent ──► returned ──► closed
  │          │           │           │            │                        ▲
  │          │           │           └── exchange (line-level, stays on_rent)
  │          │           └──► expired (quote_expires_at / no-show)         │
  └──────────┴──► cancelled / declined            hard_close ─────────────┘
```

```sql
lifecycle_state text NOT NULL DEFAULT 'draft' CHECK (in
  ('draft','quoted','reserved','on_rent','off_rent','returned','closed',
   'cancelled','declined','expired'))
on_rent_at    timestamptz,   off_rent_at  timestamptz,
returned_at   timestamptz,   closed_at    timestamptz
```

**Transition guard** — `rental_contract_guard_transition()` BEFORE UPDATE trigger (clone the deal-SLA
trigger discipline):

| Edge | Preconditions enforced | Side effects (same transaction) |
|---|---|---|
| → quoted | ≥1 line with resolved rates | stamp quote_expires_at if null (default policy param) |
| → reserved | customer anchor; dates; availability check passes; AR gate passes (or override) | lines → `reserved`; availability hold |
| → on_rent | equipment assigned on every line; signature valid OR manager override logged; **security satisfied: deposit paid OR (deposit not demanded AND clean/overridden credit via `ar_credit_blocks` + `apply_ar_override`) OR audited manager security override** (mig 770 — deposit and credit are alternative instruments, charter §2.7); COI on file when `coi_required` | stamp `on_rent_at`; lines → `active`; outbound meters required (or explicit `meter_unavailable` reason); equipment `readiness_status='on_rent'` |
| → off_rent | from on_rent only | stamp `off_rent_at` — **billing clock stops here**; emit `rental.off_rent` |
| → returned | physical return recorded (`rental_returns` row linked, return meters in) | stamp `returned_at`; lines → `returned`; equipment → inspection-pending readiness |
| → closed | final invoice posted (`rental_invoices.status in ('posted','sent','paid')` covering through returned_at) OR hard-close trio populated | stamp `closed_at`; release availability |
| → cancelled/declined/expired | from pre-on_rent states only | release holds |

Legacy `status` column: retained during L0 as the **portal sub-state**
(submitted/reviewing/quoted/approved/awaiting_payment map into draft→reserved phase), sync-triggered
from `lifecycle_state`; portal-api and rental-ops migrate to `lifecycle_state` within L0 itself;
`status` is dropped or demoted to a generated alias at L0 closeout. Zero production rows = no
backfill risk, but the compat window keeps every deploy green mid-slice.

### 1.4 Return codes (line-level, typed)

```sql
rental_contract_lines.return_code text
  CHECK (return_code IN ('returned','off_rent','exchange','hold'))
rental_contract_lines.status  + 'on_rent','off_rent','held'   -- enum additions
```

Distinct downstream behavior (the IntelliDealer R/O/E/H semantics):
- **returned** — line clock stops; enters return inspection; billable through line off-rent/return timestamp.
- **off_rent** — clock stops; unit still in field; auto-create pickup `traffic_ticket`; idle-days counter starts (carrying-cost visibility).
- **exchange** — new line created with `exchange_parent_line_id`; old line closes at swap meter/time, new line inherits contract terms; billing is continuous across the chain (one combined period, rate-optimized per segment).
- **hold** — hour-usage lines held until hours-in recorded (IntelliDealer H); billing suspended, availability still consumed; surfaced in exception queue after N days (policy param).

Partial returns = some lines coded, contract stays `on_rent` until all lines terminal; multi-unit
asterisk semantics come free from line granularity.

### 1.5 Reservations & availability

New table (the one genuinely missing structure):

```sql
rental_reservation_holds (
  id, workspace_id, rental_contract_id, rental_contract_line_id,
  equipment_id uuid NULL,            -- exact-unit hold
  equipment_class text NULL, equipment_category text NULL,  -- category hold
  hold_start date NOT NULL, hold_end date NOT NULL,
  status CHECK (in ('active','released','converted')),
  created_at/updated_at/deleted_at, RLS canonical shape
)
```

Contracts:
- `rental_check_availability(p_scope jsonb, p_start date, p_end date) → jsonb` — for exact unit:
  no overlapping active hold/on-rent line AND `readiness_status` rentable; for class/category:
  `fleet_count − overlapping_demand` with substitution candidates listed. Single deterministic RPC;
  both the counter UI and portal call it — no client-side availability math.
- `qrm_equipment.next_available_at` + `readiness_status` maintained by triggers on
  `rental_contract_lines` + `rental_reservation_holds` + H10 service jobs (down-for-service).
  **Targets `qrm_equipment` directly — never the frozen `crm_equipment` view.**
- `rental_availability_calendar(p_scope, p_from, p_to) → jsonb` — per-day per-unit/class occupancy
  for the calendar surface.
- Reservations **hold** availability (status `active`); conversion at check-out flips to `converted`;
  cancellation/expiry releases. Overbooking is allowed only via explicit manager override →
  `exception_queue(source='rental_overbook_override')` + audit row.

### 1.6 Rate storage decision

**Keep `rental_rate_rules` as the single rate store** (charter allows a child table if justified —
it is not: the scoping matrix already covers unit/customer/class/category/branch/season). Additive
columns: `hourly_rate`, `included_hours_per_day`, `overage_hourly_rate`, `effective_from`,
`effective_to`, `created_by`, `approved_by`. Resolution precedence (deterministic, documented in a
`COMMENT`): exact equipment > customer-negotiated > class/subclass > category > branch > workspace
default; ties broken by `priority_rank` then newest `effective_from`. Seasonal windows filter, not
rank. Per-unit sticker rates on `qrm_equipment` (`daily/weekly/monthly_rental_rate`) are treated as
the fallback rate card of last resort and surfaced read-only in the rate admin.

---

## 2. The rate engine (Slice L1) — contract

### 2.1 Resolver

`rental_resolve_rates(p_workspace, p_equipment_id, p_company_id, p_class, p_category, p_branch_id, p_date)
→ jsonb {daily, weekly, monthly, hourly, included_hours_per_day, overage_hourly, minimum_days, source_rule_id, resolution_path[]}`

- Pure lookup + precedence; **`resolution_path` is mandatory** (AI-confidence-indicator rule: every
  computed number must explain itself — this is the rental analog of the KPI formula popover).
- Writes nothing. Counter UI, portal, quote flows, and the billing engine all call the same resolver.

### 2.2 Billing-time optimization (the pro move) — COVERAGE formulation

`rental_optimize_charge(p_billable_days, p_rate_book) → jsonb {segments[], total_cents, fired: boolean, beaten_alternative}`

**The problem is coverage, not partition** (owner pressure-test 2026-07-07):
minimize `28m·R_month + 7w·R_week + d·R_day` **subject to `28m + 7w + d ≥ D`**. The optimizer may
buy MORE time than the rental used when overshoot is cheaper — 26 days bills as one month when
`R_month < 3·R_week + 5·R_day`. Do NOT implement greedy decomposition with cap rules bolted on;
the caps fall out of the covering search for free. Search space is brute-forceable and, because
degenerate books void dominance shortcuts, the bounds must NOT assume a sane ladder: enumerate
`m ∈ [0, ⌈D/28⌉]`, `w ∈ [0, ⌈D/7⌉]`, and for each pair `d` is determined —
`d = max(0, D − 28m − 7w)` — so the search is O(⌈D/28⌉ · ⌈D/7⌉) pairs, trivially small.
`fired` is STRICT: the optimum beat the greedy largest-block exact partition by > 0 cents; a tie
never prints a savings line ("you saved $0" is worse than silence).

Contract invariants:
1. **Correct for arbitrary positive rate books — no ladder-sanity assumption.** Negotiated
   overrides can be degenerate (week > 7·day; month < week). Brute-force coverage search is
   correct for any positive rates; inverted-ladder vectors are mandatory in the test file.
2. **Deterministic tie-breaking**: ties happen constantly at ratio boundaries. Preference order:
   fewest line items, then largest blocks first. Both implementations MUST encode it.
3. **Integer cents end to end.** TS uses integer math only (no floats anywhere in the pipeline);
   SQL uses `numeric`; rounding happens at exactly ONE defined point — per charge line, half-up.
   Vectors include float-hostile amounts ($33.33·3 class of trap).
4. **Duration is an input, not a concern.** A separate **duration resolver** owns the off-rent
   clock, same-day/grace cutoffs, minimum-rental-period, and any future 5-day-billing-week or
   holiday rules, and emits billable days. Pipeline, each stage with its own vector set:
   `duration resolver → rate resolver (§2.1) → optimizer → invoice assembler (§2.3)`.
   Calendar rules must never leak into the optimizer or the shared-vector guarantee stops
   covering the part that actually varies.
5. `segments[]` is the human-readable breakdown printed on every invoice and contract.

**Cycle-billing reconciliation (the hardest case, answered explicitly):** interim 28-day cycle
invoices bill their period; the **final invoice = optimize(entire billable duration) −
sum(already invoiced), floored at zero.** Reconcile to the global optimum, never optimize the
stub fragment in isolation — otherwise two customers with identical total durations pay different
totals depending on where the cycle boundary fell. Provable invariant (and the sentence Iron
states to a customer): *total billed always equals the optimum for the elapsed duration.*
**Exchanges**: same rate class → clock and optimization run continuously across the line chain;
class change → segment the duration at the exchange timestamp, optimize per segment.
Multi-invoice reconciliation and a cross-class exchange are mandatory vector cases.

**Canonical implementation: TS** (`shared/rental-rate-math.ts`) — QEP's billing writers live in
Deno edge functions and counter quoting needs zero-latency previews; **SQL is the verified
mirror** for in-DB reporting/backfill. When production disputes an amount, TS is truth. The
shared JSON vector file is **append-only with stable case IDs** — a changed expectation is a
loud diff, never a silent edit. Divergence between implementations fails the build gate.
Required vector coverage: boundary durations (7, 8, 27, 28, 29), overshoot wins, inverted
ladders, ties, stub reconciliation across cycle boundaries, cross-class exchange.

### 2.2a Savings policy (owner-approved 2026-07-07)

Store both numbers on every invoice, always: the optimized total and what the naive/beaten
alternative would have billed. **Print the decomposition itself on every invoice** ("Billed as:
1 month + 4 days @ …") — inherently transparent, never overclaims. **Print a savings line ONLY
when the coverage logic actually fired**, phrased against the specific alternative it beat:
"Best-rate applied: billed as 1 month instead of 3 weeks + 5 days — you saved $180." Never
compare against `day-rate × days` — that is an inflated reference price no rental house would
charge (fake-strikethrough pattern; fails FTC former-price logic).
Suppression rules: (a) when a negotiated rate override is active, any comparison is computed
against the customer's OWN override book — never the standard book (leaking the delta hands
national accounts a renegotiation lever); (b) the printed savings line is a **per-workspace
setting** (merchandising policy) — store always, print conditionally.

### 2.3 Ancillary charges

Single charge assembler used by quoting and billing:
`rental_assemble_charges(contract, lines, period) → charge set` covering: base (optimized), hourly
overage (`(hours_used − included) · overage_rate`, meters from lines or telematics reconciliation),
damage waiver (% of base when accepted), environmental fee (policy param), delivery/pickup fees
(from contract), fuel/cleaning/damage (from linked `rental_returns` on final invoice), sub-rental
pass-through + `default_markup_pct`. Every charge lands in its dedicated `rental_invoices.*_cents`
column — the decomposition already exists; the assembler is the missing writer.

Assembler orthogonality rules (owner pressure-test 2026-07-07):
- **Meter overage is additive on top of the optimized base — never an optimizer input.**
- **Percentage charges name their base explicitly**: damage waiver / RPP percentages apply to the
  **optimized base rental charge, excluding ancillaries** (industry standard). An undefined
  percentage base is a guaranteed invoice dispute.
- **RPO accrual references invoiced amounts, never naive totals** — otherwise the optimizer
  quietly shrinks a customer's purchase credit relative to the RPO addendum.

Tax: reuse the destination-sourcing plumbing (jurisdiction id, exemption certs, DR-15 fields) —
the assembler computes `taxable_amount_cents` per treatment (`covers_rental`) and delegates rate
lookup to the existing tax machinery. **Client-supplied rates are never trusted** (§12 rule).

---

## 3. Billing engine (Slice L5) — contract

`rental-billing-runner` edge fn + pg_cron (mig 097 `net.http_post` pattern), nightly + on-demand:

1. Open a `rental_billing_runs` row (`running`).
2. Select billable contracts: `lifecycle_state in ('on_rent','off_rent','returned')` with unbilled
   period (`last invoice period_end < clock_stop_or_now`) — set-based, indexed, no table scan.
3. Per contract: period from `billing_cycle` (28-day cycles bill in arrears; monthly on calendar
   policy), charges via §2 assembler, rate-optimize per period, write `rental_invoices` row
   **and mirror an AR-facing `customer_invoices` row** (portal pay + AR aging + health score see it —
   `rental_invoices.customer_invoice_id` is the bridge, same as rental-ops deposits today).
4. Final invoice when `returned`: prorate final period per `proration_rule`, add return charges
   (fuel/cleaning/damage from `rental_returns`), reconcile deposit (apply → refund per
   `original_payment_method` match rule), then contract is closeable.
5. Idempotent by contract: invoice natural key `(rental_contract_id, period_start, period_end)`
   short-circuits replays; run failure → `rolled_back` with reason; partial failures dead-letter
   per contract into `exception_queue` without aborting the run.
5a. **L5 MUST tighten the `returned → closed` guard** to require final billing complete (final
   invoice posted covering through `returned_at`, deposit settled) — the L0 guard deliberately
   leaves that hop open pending this engine, and nothing may close unbilled once L5 lands.
5b. **Tax generalization gate:** the DR-15 county-surtax fields are Florida-specific — correct for
   the Duval-County dealership, but the billing engine must treat surtax reporting as a
   per-workspace tax-profile concern (jurisdiction plumbing already exists). No FL assumption may
   be hard-coded into the L5 assembler/runner.
6. Invoice numbers from a per-workspace sequence (`RENT-2026-00042` style) — **`Date.now()` numbering
   in rental-ops is replaced** in the same slice.
7. Every run emits `rental.cycle.billed` / `rental.cycle.failed` events; the run row is the audit spine.

RPO accrual: on each paid rental invoice for `contract_type='rpo'`, accrue
`rpo_credit_accrued_cents += rental_charge · rpo_rental_credit_pct` (capped); threshold events
(§5) drive the sales motion; conversion action creates a `qrm_deals` row with accrued credit as a
line item (the funnel wiring, not a new sales flow).

---

## 4. Returns, damage, and service seam (Slice L2)

- Check-**out** condition: `inspection_runs` row (`rental_contract_id` FK already exists) with
  photos before `→ on_rent`; the returns wizard's checklist pattern reused for out-inspection.
- Return: wizard (existing `/ops/returns`) rewired to operate **through contract lines** — coding
  each line (§1.4), capturing return meters, then writing `rental_returns` linked to contract +
  final invoice. Charge fields flow into the final invoice via the assembler, not hand-keyed.
- Damage path: `renter_fault_billable=true` → damage charges on the customer's final invoice AND
  auto-open `service_jobs` (`service_internal_work_class='rental_fleet_maintenance'`,
  cost destination `rental_unit`) via Flow action — H10 already defines both sides of the seam.
  Disputes → `exception_queue(source='rental_damage_dispute')`.
- Deposit settlement invariant (already in `rental-return-branching.ts`, promoted to a DB-level
  check at refund write): refund method must equal `original_payment_method`.

## 5. Event taxonomy & emitters (Slice L4, charter §5)

Triggers on `rental_contracts` / `rental_contract_lines` / `rental_invoices` / `rental_returns`
(clone mig 174 / Flow-Engine trigger pattern, call `emit_event()` with payloads rich enough for
context resolution without N+1):

`rental.reservation.created`, `rental.contract.opened` (→ on_rent), `rental.contract.exchanged`,
`rental.off_rent`, `rental.returned`, `rental.inspected`, `rental.damage.assessed`,
`rental.cycle.billed`, `rental.rpo.threshold_reached`, `rental.rerent.sourced`.

Scanner cron (`rental-lifecycle-scanner`, 15-min tick — time-based events can't come from row
triggers): `rental.nearing_end` (**finally emitting the event the shipped workflow has waited
for**), `rental.overdue`, `rental.coi.expiring`, `rental.cycle.due`, `rental.availability.low`,
`rental.unit.idle_aging`.

New `exception_queue.source` values: `rental_overdue_return`, `rental_coi_expired`,
`rental_credit_hold`, `rental_damage_dispute`, `rental_overbook_override`, `rental_billing_failed`.
New `analytics_action_log.action_type` values for open/exchange/off-rent/return/close/hard-close/
rate-override/billing-run lifecycle.

### Flow actions (registry additions — wrap existing helpers, idempotency by contract)

| Action | Wraps | Idempotency template |
|---|---|---|
| `create_traffic_ticket` | `traffic_tickets` insert (delivery or pickup, promised_at from contract) | `traffic:${params.rental_contract_id}:${params.direction}:${params.due_date}` |
| `open_internal_service_job` | `service_jobs` insert with H10 fields | `svc:${params.equipment_id}:${params.trigger_event_id}` |

Both registered in `registry.ts` **and** the `flow-synthesize` catalog (§9 runbook rule).

### Flagship workflows-as-code (`_shared/flow-workflows/`)

| Slug | Trigger | Behavior |
|---|---|---|
| `rental-contract-opened` | `rental.contract.opened` | delivery ticket when `delivery_required`; welcome notification (TCPA-gated) |
| `rental-off-rent-pickup` | `rental.off_rent` | pickup `traffic_ticket`; stop-clock audit row; idle-aging watch task |
| `rental-returned-inspection` | `rental.returned` | inspection task (Iron Man role); damage → `open_internal_service_job` (approval-gated when renter-fault billable) |
| `rental-overdue-escalation` | `rental.overdue` | rep task + customer notice draft + exception at T+N days |
| `rental-coi-expiring` | `rental.coi.expiring` | customer COI request draft; block-new-extensions exception at expiry |
| `rental-rpo-threshold` | `rental.rpo.threshold_reached` | rep nudge + draft deal task (conversion motion) |
| `rental-availability-low` | `rental.availability.low` | manager alert + re-rent sourcing task listing `sub_rental_vendors` |
| `rental-idle-aging` | `rental.unit.idle_aging` | pickup escalation / discount suggestion task |
| `rental-nearing-end` | `rental.nearing_end` | **exists** — now fed by the scanner |

## 6. Context resolver & Iron (Slice L6)

- `rental_resolve_context(p_contract_id) → jsonb` — one RPC: contract + lines + customer (both
  anchors) + rates resolution path + meters + open invoices/balance + AR posture + haul tickets +
  return/inspection state + RPO accrual + recent events. Frozen into flow runs; powers drill-to-chat.
- Chat fn preload branch `rentalContractId` (`context_type=rental_contract`) — clone of `flowRunId`
  branch; `<AskIronAdvisorButton contextType="rental_contract" contextId={id}/>` on every rental surface.
- Iron flows (approval-gated where they write): `draft_rental_quote` (sentence → draft contract via
  the same extraction pipeline as voice), `open_rental_contract` (manager-approval-gated),
  `answer_rental_kpis` (reads KPI snapshots — "what's my dollar utilization on skid steers").
- Voice: `voice-to-qrm` extraction extended with a rental intent target (equipment class, dates,
  customer, delivery) → draft contract (`origination_channel='voice'`, lifecycle `draft`).

## 7. KPIs & Command Center rental lens (Slice L3 compute, L6 surface)

Registered in `analytics_metric_definitions`, computed by the existing snapshot runner, snapshotted
immutably, drillable, formula-visible:

| Key | Formula contract |
|---|---|
| `rental_physical_utilization_pct` | on-rent units / rentable fleet (point-in-time) |
| `rental_time_utilization_pct_30d` | Σ on-rent days / Σ fleet-available days, trailing 30d (service-down days excluded from denominator, documented) |
| `rental_dollar_utilization_pct` | annualized trailing rental revenue / Σ OEC of rentable fleet. OEC precedence: acquisition cost → `rental_insurable_amount_cents` → `rental_amount_cents`; missing OEC → data-quality exception, unit excluded and count surfaced |
| `rental_on_rent_revenue_run_rate` | Σ active contract monthly-equivalent (already approximated in BuPulseStrip — moves server-side) |
| `rental_idle_carrying_cost` | idle fleet Σ (OEC · carrying-rate policy param / 365) · idle days |
| `rental_ar_exposure` | open rental `customer_invoices` balance |
| `rental_overdue_returns_count` / `rental_returns_aging_count` | scanner counts (latter exists — COO KPI) |
| `rental_rpo_conversion_rate` | RPO contracts converted to deals / RPO contracts closed, trailing 12m |

Surfaces: owner Command Center rental lens (P&L framing: revenue run-rate, dollar/time/physical
utilization, idle cost, AR exposure); Owner Home BU strip keeps its live query; Rental Command
Center gets the utilization tiles with formula popovers.

## 8. Predictive + pricing moonshot layer (Slice L7)

- **Demand forecasting**: clone `parts_demand_forecasts` shape → `rental_demand_forecasts`
  (class/category × horizon), fed by reservation lead times, seasonal history, lost-availability
  events (`rental.availability.low` frequency). Output: "short 3 mini-ex in April — acquire or
  pre-source re-rent," written as tasks + Command Center cards with confidence labels.
- **Disposal timing**: per-unit signal joining H10 internal service cost trend (cost posting to
  `rental_unit` destination), dollar utilization, and age → "sell before the maintenance curve eats
  the margin" recommendation (feeds the 7C.2 Machine Fate ambition; ships as advisory card only).
- **Dynamic/yield pricing** (feature-flagged, opt-in, advisory-first): utilization-conditioned rate
  suggestions (high class utilization → premium suggestion; idle-aging → discount suggestion) written
  as **draft rate rules requiring approval** — never silent price changes. Every suggestion carries
  the driving signal (utilization %, idle days) per the AI-confidence rule.
- **Telematics/geofence**: reconcile telematics hours vs billed included hours → overage suggestions;
  on-rent unit exits jobsite geofence outside contract terms → `exception_queue` theft/unauthorized-move
  alert; geofence exit + rental → off-rent inspection prompt (the master-roadmap trigger, finally built).

## 9. Portal channel (existing, retargeted)

Portal keeps its flow but rides the new trunk: booking request creates `contract_type='reservation'`,
`origination_channel='portal'`, lifecycle `draft→quoted→reserved`; pay+sign gates the `→ on_rent`
transition exactly as the guard requires (deposit satisfied + signature valid). `rental-ops`
approval queue keeps working through the compat window, then reads `lifecycle_state`. Portal
self-service additions later ride availability RPCs (`rental_check_availability`) instead of raw
fleet reads.

## 10. Cross-cutting requirements

- **TCPA**: no rental code sends directly. All customer-facing notices (return reminders, off-rent
  confirmations, cycle-bill notices, COI requests) enqueue through the consent-checked notify
  dispatch (service-customer-notify pattern); preference/consent check is the dispatcher's contract,
  and every send records evidence.
- **AR/credit**: `→ reserved` and `→ on_rent` guarded by the AR gate (reuse `enforce_ar_quote_block`
  logic against `ar_aging_view.has_active_rental` context); override via `apply_ar_override` +
  `exception_queue(source='rental_credit_hold')`. Deposit tiers reuse `calculate_deposit_tier`.
- **Feature flags**: master `RENTAL_DEPARTMENT_V1` env flag gating edge-fn behavior +
  `VITE_RENTAL_*` route/surface flags (house convention §6.3); every L-slice independently
  flag-collapsible.
- **Fail-open**: Stripe/Resend/telematics absent → `{status:'skipped', reason:'missing_credentials'}`;
  counter contract creation NEVER blocks on an integration.
- **RLS**: canonical shape on new tables (`rental_reservation_holds`); rep read scope on contracts
  follows the equipment/deal precedent (`crm_rep_can_access_*` family); portal customers see only
  their own rows (existing pattern).
- **Build gates**: every slice — `bun run migrations:check`, root + apps/web `bun run build`,
  contract tests for new RPCs (migration `.test.ts` convention, e.g. 691's), rate-math shared
  test vectors green in both SQL and TS, load test for the billing runner (clone
  `flow-load-test.mjs` shape), cross-workspace leak probe on every new RPC/view.

## 11. Why this beats IntelliDealer *and* United Rentals

**vs IntelliDealer** (parity floor): same contract/line/rate/return-code model (RMCONT/RMCONTL
analogs live in Discovery §1) — plus native e-sign without VESign's 120-day OneSpan cliff, portal
self-service IntelliDealer doesn't have, destination-based county tax already wired, and none of the
green-screen hard-close foot-guns (hard close here requires reason + audit and never deletes rows).

**vs United Rentals / Sunbelt-grade ops** (the real bar): they have counter speed, availability
discipline, and utilization religion — QEP matches those (L0–L5) and then plays cards a rental
pure-play cannot hold:
1. **The nervous system**: off-rent detection → clock stop → pickup ticket → inspection → damage WO →
   final invoice as one auditable event chain, not four departments' phone calls.
2. **The dealership seam**: rental history, service history, parts spend, and sales pipeline on one
   customer spine — the RPO conversion motion and rental→purchase signals (7B.6) have data United
   Rentals structurally lacks about the *ownership* side of a customer's fleet.
3. **Iron at the counter**: "put a 320 on rent to Acme for two weeks, deliver Tuesday" → drafted
   contract with resolved rates, availability-checked, one approval from open. Nobody in the
   category has conversational origination.
4. **Machine-fate economics**: internal service cost (H10) + dollar utilization + age per unit in
   one place → disposal timing and fleet-mix recommendations grounded in the dealer's own wrench data.
5. **Honest billing**: cheapest-legal-combination optimization with the savings printed on the
   invoice — a trust wedge against an industry notorious for rate opacity.

## 12. Slice map (feeds §7.3 seed)

| Slice | Contract (one line) | Demo path |
|---|---|---|
| **L0** | §1 refactor + demo seeder + counter origination path (minimal UI) | walk-in counter contract end-to-end |
| **L1** | §2 rate engine (resolver + optimizer + assembler + shared vectors) | 17-day rental bills week+week+days; savings shown |
| **L2** | §4 lifecycle execution: check-out/return inspections, line return codes, exchange, damage→WO | open→exchange→off-rent→return→final invoice |
| **L3** | §1.5 availability + reservations + §7 utilization compute | reservation blocks calendar; dollar-util renders with formula |
| **L4** | §5 events + emitters + scanner + workflows + 2 registry actions | off-rent fires → clock stops → pickup ticket exists |
| **L5** | §3 billing engine + RPO accrual/conversion + re-rent margin | 28-day cycle invoice auto-drafts; RPO nudge fires |
| **L6** | §6 Iron + drill-to-chat + §7 Command Center lens + portal retarget | Iron opens a contract from a sentence; owner sees dollar utilization |
| **L7** | §8 predictive + yield (flagged) + telematics/geofence | "short 3 mini-ex in April" card; geofence breach alert |
| **L8** | Hardening: billing load test, chaos/fail-open, leak audit, TCPA audit, shadow cutover | all gates green on demo fleet at load |

Anti-rejection self-check (§8 of the charter) is satisfied by design: no parallel stores, no
naïve day-rate billing, off-rent ≠ returned, counter origination first-class, flags everywhere,
`qrm_*` targeted directly, TCPA via consent-checked dispatch, seeded data proving every path.
