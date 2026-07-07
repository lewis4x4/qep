-- ============================================================================
-- Migration 768: QEP Stream L — Rental Department source of truth
-- Purpose: promote the Rental Department from schema-only parity into a
--          first-class qep_roadmap_tasks stream, closing the gap that Parts
--          (G), Service (H), and Financials (K) already went through:
--          discovery → blueprint → sliced stream.
--
-- Sources:
--   - docs/rental/DISCOVERY.md  (2026-07-06 live-DB + repo audit)
--   - docs/rental/BLUEPRINT.md  (2026-07-06 target architecture contracts)
--
-- Ground truth this stream is built on (from discovery):
--   - 12 rental tables exist with RLS; production rows: ZERO across all of them
--   - rental_contracts is portal-anchored (portal_customer_id NOT NULL) with a
--     booking-request status machine; counter origination does not exist
--   - No rental business-logic functions, no crons, no event emitters; the
--     registered rental-nearing-end workflow has no emitter feeding it
--   - No writers for rental_invoices / rental_billing_runs (cycle billing inert)
--
-- Safety envelope:
--   - Append-only; no destructive DDL
--   - Adds enum label 'L' if absent
--   - Upserts roadmap rows idempotently (ON CONFLICT task_id DO UPDATE)
-- ============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Add 'L' to the stream enum.
-- ALTER TYPE ... ADD VALUE must commit before the new value can be used, so
-- this runs first as its own statement (same pattern as migration 650 STEP 1).
-- -----------------------------------------------------------------------------

ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'L' AFTER 'K';

-- -----------------------------------------------------------------------------
-- STEP 2 — Seed Stream L slices L0–L8.
-- sort_order starts at 9001 (above Stream K's 83xx block) to keep Stream L
-- grouped at the bottom of the roadmap.
-- -----------------------------------------------------------------------------

BEGIN;

INSERT INTO qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner,
   blocking_decision, evidence_link, notes, sort_order)
VALUES
('L0.1', 'L', 'L0', 'Structural refactor + counter origination',
 'Blueprint §1. Fix the contract-origination anchor: portal_customer_id nullable, qrm_company_id/qrm_contact_id FKs, origination_channel (counter|voice|iron|portal), originated_by. contract_type enum (reservation|rental|rpo|demo|loaner|rerent). Replace the booking-request trunk with the rental lifecycle state machine (draft→quoted→reserved→on_rent→off_rent→returned→closed, + cancelled/declined/expired) with trigger-guarded transitions and owned timestamps (on_rent_at/off_rent_at/returned_at/closed_at). Typed line return codes (returned|off_rent|exchange|hold). Activate qrm_equipment.readiness_status + next_available_at via triggers (target qrm_equipment directly — crm_equipment compat view is frozen). Minimal counter origination UI. Demo seeder covering every contract type and lifecycle state (zero-row BUILT is banned).',
 'not_started', 'Architect → Engineer',
 NULL,
 'docs/rental/DISCOVERY.md §7 | docs/rental/BLUEPRINT.md §1',
 '[2026-07-06] Created from Rental Department discovery + blueprint. Acceptance: a rep originates a walk-in counter rental contract end to end (no portal account involved) on seeded data; portal booking flow still green through the compat window; migrations:check + root/apps builds green.',
 9001),

('L1.1', 'L', 'L1', 'Rate engine — resolver, optimizer, charge assembler',
 'Blueprint §2. rental_resolve_rates RPC with deterministic precedence (equipment > customer > class/subclass > category > branch > workspace default; seasonal windows filter; resolution_path mandatory). Billing-time cheapest-legal-combination optimization (day/week/month decomposition with monotonicity caps) implemented once in SQL and once in TS (shared/rental-rate-math.ts) with a shared JSON test-vector file both suites consume. Charge assembler covering base, hourly overage, damage waiver, environmental fee, delivery/pickup, fuel/cleaning/damage, sub-rental + markup — writing the existing rental_invoices decomposition columns. rental_rate_rules gains hourly/included-hours/overage/effective-dating/approval columns.',
 'not_started', 'Engineer',
 NULL,
 'docs/rental/BLUEPRINT.md §2 | docs/rental/DISCOVERY.md §6 (2.2 rows)',
 '[2026-07-06] Created from Rental blueprint. Acceptance: a 17-day rental prices as week+week+3 days (never 17×day) with the savings vs naive shown; SQL and TS optimizers agree on the shared vectors (divergence fails the build gate).',
 9002),

('L2.1', 'L', 'L2', 'Lifecycle execution — inspections, return codes, exchange, damage seam',
 'Blueprint §4. Check-OUT condition inspection via inspection_runs (rental_contract_id FK already exists) with photos gating → on_rent. Returns wizard rewired through contract lines: per-line return coding (R/O/E/H semantics with distinct downstream behavior), return meters, rental_returns linked to contract + final invoice; charges flow through the assembler, not hand-keyed. Exchange creates a chained line (exchange_parent_line_id) with continuous billing across the chain. Damage path: renter_fault_billable → charges on final invoice AND auto-open service_jobs with H10 internal class rental_fleet_maintenance / cost destination rental_unit; disputes → exception_queue(rental_damage_dispute). Deposit refund method must match original_payment_method at the DB layer.',
 'not_started', 'Engineer',
 NULL,
 'docs/rental/BLUEPRINT.md §4 | docs/rental/DISCOVERY.md §1.3, §6 (2.5 rows)',
 '[2026-07-06] Created from Rental blueprint. Acceptance: open → exchange mid-rental → off-rent → return with damage → internal WO opened → final invoice carries fuel/cleaning/damage — one continuous audited chain on seeded data.',
 9003),

('L3.1', 'L', 'L3', 'Availability, reservations & utilization',
 'Blueprint §1.5 + §7. rental_reservation_holds table (exact-unit and class/category holds). rental_check_availability + rental_availability_calendar deterministic RPCs — counter UI and portal both call them (no client-side availability math). next_available_at / readiness_status maintained by triggers incl. H10 down-for-service. Overbooking only via manager override → exception_queue(rental_overbook_override). Utilization compute: physical (point-in-time), time (30d window, service-down days excluded), and dollar utilization (annualized rental revenue / Σ OEC with documented OEC precedence and data-quality exceptions for missing OEC) registered in analytics_metric_definitions and snapshotted by the existing runner.',
 'not_started', 'Engineer',
 NULL,
 'docs/rental/BLUEPRINT.md §1.5, §7 | docs/rental/DISCOVERY.md §6 (2.6 rows)',
 '[2026-07-06] Created from Rental blueprint. Acceptance: a reservation blocks the calendar and availability check; dollar/time/physical utilization render with formula popovers from KPI snapshots.',
 9004),

('L4.1', 'L', 'L4', 'Event taxonomy, emitters, scanner + Flow workflows',
 'Blueprint §5 (charter §5). Row triggers on rental_contracts/lines/invoices/returns emitting rental.reservation.created, rental.contract.opened, rental.contract.exchanged, rental.off_rent, rental.returned, rental.inspected, rental.damage.assessed, rental.cycle.billed, rental.rpo.threshold_reached, rental.rerent.sourced via emit_event(). rental-lifecycle-scanner cron (15-min) emitting time-based events: rental.nearing_end (feeding the already-registered workflow at last), rental.overdue, rental.coi.expiring, rental.cycle.due, rental.availability.low, rental.unit.idle_aging. New exception_queue sources (rental_overdue_return, rental_coi_expired, rental_credit_hold, rental_damage_dispute, rental_overbook_override, rental_billing_failed) + analytics_action_log action_types. Two registry actions (create_traffic_ticket, open_internal_service_job) registered in registry.ts AND the flow-synthesize catalog. Workflows-as-code: rental-contract-opened, rental-off-rent-pickup, rental-returned-inspection, rental-overdue-escalation, rental-coi-expiring, rental-rpo-threshold, rental-availability-low, rental-idle-aging.',
 'not_started', 'Engineer',
 NULL,
 'docs/rental/BLUEPRINT.md §5 | docs/QEP-FLOW-ENGINE-IMPLEMENTATION.md',
 '[2026-07-06] Created from Rental blueprint. Acceptance: marking a line off_rent stops the clock, emits rental.off_rent, and a pickup traffic_ticket exists within one runner tick — observed end to end on seeded data.',
 9005),

('L5.1', 'L', 'L5', 'Billing engine — cycle billing, final proration, RPO accrual, re-rent margin',
 'Blueprint §3. rental-billing-runner edge fn + nightly pg_cron: selects on_rent/off_rent/returned contracts with unbilled periods, assembles + rate-optimizes charges, writes rental_invoices AND mirrors customer_invoices (AR aging, portal pay, health score see rental money), per-workspace invoice number sequence replacing Date.now() numbering in rental-ops. 28-day cycles in arrears; final invoice prorates per proration_rule, folds in return charges, settles deposit (refund method matches original). Idempotent via (contract, period) natural key; failures dead-letter per contract without aborting the run; rental_billing_runs is the audit spine with rollback. RPO accrual per paid invoice with cap + threshold events; RPO conversion creates a qrm_deals row carrying accrued credit. Re-rent margin: sub-rental cost vs billed with default_markup_pct visibility.',
 'not_started', 'Engineer + Finance',
 NULL,
 'docs/rental/BLUEPRINT.md §3 | docs/rental/DISCOVERY.md §1.4, §2 (no-writers finding)',
 '[2026-07-06] Created from Rental blueprint. Acceptance: a 28-day open-ended rental auto-drafts its cycle invoice; returning it produces a prorated final invoice with return charges and deposit settlement; an RPO contract fires its threshold nudge. Billing load test (flow-load-test.mjs clone) green.',
 9006),

('L6.1', 'L', 'L6', 'Iron + drill-to-chat + Command Center rental lens + portal retarget',
 'Blueprint §6, §7, §9. rental_resolve_context composite RPC (contract + lines + both customer anchors + rates path + meters + invoices/balance + AR + haul + inspection + RPO + recent events), frozen into flow runs. Chat fn rentalContractId preload branch + AskIronAdvisorButton contextType=rental_contract on every rental surface. Iron flows: draft_rental_quote (sentence → draft contract), open_rental_contract (manager-approval-gated), answer_rental_kpis from snapshots. Voice-to-rental extraction target (origination_channel=voice). Command Center rental P&L lens: revenue run-rate, dollar/time/physical utilization, idle carrying cost, rental AR exposure, RPO conversion rate — all formula-visible and drillable. Portal flow retargeted onto the lifecycle trunk (reservation sub-flow) and availability RPCs.',
 'not_started', 'Engineer + Design',
 NULL,
 'docs/rental/BLUEPRINT.md §6, §7, §9',
 '[2026-07-06] Created from Rental blueprint. Acceptance: Iron drafts a contract from "put a 320 on rent to Acme for two weeks, deliver Tuesday" pending one approval; owner sees dollar utilization on the Command Center rental lens; portal booking rides the new trunk.',
 9007),

('L7.1', 'L', 'L7', 'Predictive fleet intelligence, yield pricing, telematics/geofence',
 'Blueprint §8. rental_demand_forecasts (parts_demand_forecasts clone) fed by reservation lead times, seasonality, and availability-miss events → acquire / pre-source re-rent recommendations with confidence labels. Disposal-timing signal joining H10 internal cost trend + dollar utilization + age (advisory cards only; feeds the 7C.2 Machine Fate ambition). Dynamic/yield pricing feature-flagged and advisory-first: utilization-conditioned suggestions written as draft rate rules requiring approval — never silent price changes. Telematics reconciliation (billed hours vs telematics_feeds → overage suggestions); geofence: on-rent unit leaving jobsite outside terms → theft/unauthorized-move exception; geofence exit + rental → off-rent inspection prompt.',
 'not_started', 'Engineer',
 NULL,
 'docs/rental/BLUEPRINT.md §8',
 '[2026-07-06] Created from Rental blueprint. Acceptance: a "short N units of class X in <month>" card surfaces with its driving signal; a geofence breach on an on-rent unit lands in the exception queue.',
 9008),

('L8.1', 'L', 'L8', 'Hardening — load, chaos, leak audit, TCPA, shadow cutover',
 'Blueprint §10 + charter L8. Billing-runner load test at scale; chaos/fail-open verification (Stripe/Resend/telematics absent → skipped, counter path never blocks); cross-workspace leak probe on every new RPC/view/table; TCPA audit on all rental customer messaging (everything routes through the consent-checked notify dispatch — no direct sends from rental code); demo-fleet shadow cutover rehearsal with every lifecycle path exercised; feature-flag collapse test (each L-slice independently disable-able).',
 'not_started', 'Engineer + Security',
 NULL,
 'docs/rental/BLUEPRINT.md §10 | docs/rental/BLUEPRINT.md §12',
 '[2026-07-06] Created from Rental blueprint. Acceptance: all charter §9 definition-of-done clauses demonstrated on the seeded demo fleet with every build gate green.',
 9009)
ON CONFLICT (task_id) DO UPDATE SET
  stream = EXCLUDED.stream,
  wave = EXCLUDED.wave,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ship_state = EXCLUDED.ship_state,
  owner = EXCLUDED.owner,
  blocking_decision = EXCLUDED.blocking_decision,
  evidence_link = EXCLUDED.evidence_link,
  notes = EXCLUDED.notes,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;

-- Final stream map after Stream L promotion.
COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity · G=Parts Department · H=Service Department · I=Grapple-Truck Production · J=Workforce · K=Financials Re-architecture · L=Rental Department';
