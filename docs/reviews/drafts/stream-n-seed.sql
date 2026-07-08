-- ============================================================================
-- DRAFT — Stream N seed (Seam Completion) + Stream L9 rows. DO NOT APPLY FROM docs/.
-- At approval: SPLIT INTO TWO migration files (enum ADD VALUE cannot be used
-- in the transaction that adds it, and db-push.mjs wraps each file in one
-- BEGIN..COMMIT): NNN_qep_stream_n_enum.sql (ALTER TYPE + COMMENT ON TYPE
-- only) and NNN+1_qep_stream_n_seam_completion.sql (the INSERTs incl. the
-- L9 rows, dropping the interior BEGIN/COMMIT). Then complete the sync
-- checklist in docs/reviews/drafts/README.md.
--
-- Purpose: promote the cross-module seam work from the 2026-07-08 full-codebase
--          review into a first-class qep_roadmap_tasks stream. The review's
--          systemic finding: schema + one side of a workflow ships; the
--          connecting writer, event producer, or cron never does (~40 cases).
--          Stream N owns the "between the streams" work no existing stream owns.
--          Rental-anchored seam defects are seeded as L9 rows in Stream L
--          (no enum change needed) so they stay with their owning stream.
--
-- Sources:
--   - docs/reviews/2026-07-08-full-codebase-review.md  (discovery; Parts 2-3, 5)
--   - docs/reviews/2026-07-08-findings.json            (RF-xxx finding ids)
--
-- Safety envelope: append-only; adds enum label 'N'; idempotent upserts.
-- ============================================================================

ALTER TYPE qep_roadmap_stream ADD VALUE IF NOT EXISTS 'N' AFTER 'M';

BEGIN;

INSERT INTO qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner,
   blocking_decision, evidence_link, notes, sort_order)
VALUES
-- ---------------------------------------------------------------------------
-- Stream L additions — rental-anchored seam defects (verified)
-- ---------------------------------------------------------------------------
('L9.1', 'L', 'L9', 'Check-in inspection gate + turnaround loop',
 'Close the check-in half of the m773 gate (which is check-OUT only): rental-ops code_line_return, when a line (or the last line) is coded returned, auto-creates a rental_returns row stamped with rental_contract_id + equipment_id and opens a rental_checkin inspection_runs row (mirror of the checkout template). Gate the m774 fleet-state flip to availability=''available'' on the return reaching a cleared disposition so damaged or un-inspected iron cannot be instantly re-rented. Makes /ops/returns real for counter returns (the primary channel — today its only producers are a feature-flagged Iron action and demo seed).',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-004 | docs/rental/BLUEPRINT.md §4',
 '[2026-07-08] Created from full-codebase review (RF-004 verified critical). Acceptance: a counter return of a damaged unit lands in /ops/returns, blocks re-rent until disposition clears, and opens the H10 work order.',
 9010),

('L9.2', 'L', 'L9', 'Damage/return charge persistence — bill what was assessed',
 'The billing planner reads rental_returns.fuel/cleaning/damage/environmental_charge_cents — columns nothing writes (the ops wizard writes legacy charge_amount dollars; the only rental_returns producer omits rental_contract_id so the billing join can never match). Fix: returns wizard + rental-ops dispose_damage persist assessed amounts into the *_cents columns; iron_initiate_rental_return stamps rental_contract_id; backfill charge_amount → damage_charge_cents; renter-fault service jobs get customer_id + a rental_return_id backlink, and the return advances automatically when the job closes (manual finalize stays as escape hatch). Decide the single billing path (final rental invoice vs service invoice) and guard the other against double-billing.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-005,RF-029',
 '[2026-07-08] Created from full-codebase review (RF-005 verified critical: assessed damage bills $0 on every real contract). Acceptance: an assessed $450 damage on a returned unit appears on the final invoice.',
 9011),

('L9.3', 'L', 'L9', 'RPO conversion creates the deal; Conversion Engine reads rental truth',
 'Deliver the L5.1 spec line that was dropped: the rental-rpo-threshold workflow (and a convert action on the contract) creates a qrm_deals row FK-linked to the rental contract, seeded amount = rpo_purchase_price_cents − rpo_credit_accrued_cents, unit linked via crm_deal_equipment — instead of only a generic follow-up task. Surface rpo_credit_accrued_cents on the contract card (no operator UI reads it today). Rebuild RentalConversionEnginePage''s signal board over rental_contracts/rental_invoices by qrm_company_id (contract count, trailing spend, active RPO accrual) instead of CRM deal tags + voice captures only.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-024,RF-028 | supabase/migrations/768_qep_stream_l_rental_department.sql (L5.1 spec)',
 '[2026-07-08] Created from full-codebase review (RF-024 verified: accrued credit dead-ends in a task). Acceptance: a contract crossing its RPO threshold produces a draft deal carrying the accrued credit; the conversion board ranks real renters.',
 9012),

('L9.4', 'L', 'L9', 'Telematics faults + interval crossings open service, not just sales signals',
 'Ship the flow workflow that L7 stopped short of: high-severity telematics_fault signals call open_internal_service_job (registered action, zero invoking workflows today) with work_class=rental_fleet_maintenance for rental_fleet units — the m774 H10 trigger then flips readiness to in_service automatically; customer-owned-machine faults route to service intake instead of only the QRM sales pulse. Emit equipment.hours_crossed_interval (consumer workflow exists, emitter does not), so PM prompts actually fire.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-030',
 '[2026-07-08] Created from full-codebase review (RF-030 verified: L7 intelligence dead-ends in sales-feed signals; an on-rent fault does not even flip readiness). Acceptance: a seeded high-severity fault on an on-rent unit opens an internal WO and flips readiness.',
 9013),

('L9.5', 'L', 'L9', 'Rental quote document path — share, e-sign, approval',
 'A rental "quote" is only a lifecycle state today: no customer-facing document, no share token, no e-signature, no approval case, no win/loss analytics. Either add a rental package type to quote_packages (lines referencing rental_contract_lines, rates via the L1 engine, share/e-sign via the existing deal-room token path) or build a minimal rental quote document reusing quote_signatures + the margin-floor gate. Pairs with the M4.1 rate floor (approval case) so quoted rates are governed the same way they will be billed.',
 'not_started', 'Engineer + Design',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-025',
 '[2026-07-08] Created from full-codebase review (RF-025 verified). Acceptance: a customer receives, views, and signs a rental quote; the signed quote becomes the reserved contract.',
 9014),

-- ---------------------------------------------------------------------------
-- Stream N — Seam Completion
-- ---------------------------------------------------------------------------
('N0.1', 'N', 'N0', 'Verified defect burn-down (P0 batch from the review)',
 'The seven verified-live defects fixed in the review''s P0 pass: equipment-vision selecting nonexistent columns with swallowed errors; Floor "All machines" links 404ing; lucide-react in the preloaded vendor-ui chunk; 5.6MB avatar PNGs (→ 225KB); portal parts_orders missing crm_company_id (+ backfill migration); realtime publication missing all 12 dashboard/approval-subscribed tables; m046 follow-up reminder cron registered with invalid schedule syntax. Plus the double-scheduling investigation (GHA is the only live service-engine scheduler; docs/SERVICE_CRON.md inverts reality — update it, and do NOT disable GHA during the secret-rotation incident).',
 'in_progress', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-full-codebase-review.md (P0 list) | PR: review/p0-and-stream-seeds',
 '[2026-07-08] Fixes staged on branch review/p0-and-stream-seeds. Mark shipped when the PR merges AND migrations 780-782 are applied AND equipment-vision/portal-api are redeployed (deployment step is part of done, per the L8.c lesson).',
 9201),

('N1.1', 'N', 'N1', 'Sales↔Service loop — make-ready, trade recon, service-to-sales persistence',
 'Four verified dead seams, one slice. (1) Make-ready: add equipment_id to the deal.stage.changed payload (trg_flow_emit_deal) and ship a workflow that opens a service_jobs row (work_class=pdi_new_prep — zero writers today) at Deposit Collected; badge/block stage 17 "Equipment Ready" until it closes. (2) Trade recon: qb_trade_ins disposition=keep_recondition approval auto-opens a reconditioning WO; H10 cost postings write actuals back to trade_valuations so the 10%/$2,500 material-change re-approval can actually fire; wire record_trade_recondition_manager_approval (zero callers) into My Approvals. (3) Service-to-sales persistence: upsell-scanner output + completion-feedback upsell_suggestions land in the m207 signals bridge; ServiceToSalesPage gets a Create Opportunity action (deal via crm-router with the machine linked). (4) fleet_intelligence writer: a deal-timing-scan-style cron computing replacement predictions from service_jobs frequency/spend, engine hours, and telematics — un-starving every replacement surface (writer-less since m013).',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-016,RF-017,RF-018,RF-019',
 '[2026-07-08] Created from full-codebase review. Acceptance: a deposit-collected deal opens a make-ready WO; a high-repair-cost machine produces a replacement opportunity that enters the pipeline with one click.',
 9202),

('N2.1', 'N', 'N2', 'Sales↔Parts loop — quote lines reach the counter, governed pricing, playbooks fire',
 'Three verified dead seams. (1) On quote acceptance, quote-builder-v2 materializes part-type line items into a draft parts_orders row (FK back to the quote package) so the counter picks/fulfills and Account 360 counts the revenue — today accepted quote parts are invisible to the parts module. (2) Quote-side part pricing routes through parts_resolve_priced_line (customer/volume pricing, margin floor, 5% cap, authority trail) instead of raw list price — same price at the counter and in the quote. (3) Schedule the m280 post-sale-parts-playbook batch cron (designed, never scheduled) and surface generated playbooks on QrmDealDetailPage + the sales Today feed with review-and-send.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-001,RF-014,RF-015',
 '[2026-07-08] Created from full-codebase review. Acceptance: an accepted quote with parts lines produces a staged counter order at the governed price; a closed deal''s 30/60/90 parts plan reaches the owning rep.',
 9203),

('N3.1', 'N', 'N3', 'Parts↔Service loop — one stock truth, reservations, vendor POs, backorder events',
 'Five verified dead seams. (1) Canonical stock ledger: DMS PARTMAST feeds parts_catalog; make picks (adjust_parts_inventory_delta_strict) and the m673 lookup CTE and service-parts-planner all read/write the same source — today three unsynced ledgers diverge from day one. (2) Reservations: planner "picking" holds stock (qty_reserved) so counter sales and service picks stop racing to INSUFFICIENT_STOCK at the shelf. (3) Vendor demand: a real parts-procurement PO record grouped by vendor (service_parts_requirement_id on lines, PO number written back) — today order actions dead-end with NULL po_reference and the escalator chases "missing PO" by design. (4) Backorder events: emit parts.item.received (flagship consumer workflow exists, zero producers) + nullable service_job_id on parts_orders; flag jobs whose expected_date exceeds scheduled_start_at for reschedule. (5) Service quote part pricing resolves parts_catalog retail (list/pricing levels) instead of unit_cost ?? 0 — stop quoting free parts.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-002,RF-020,RF-021,RF-022,RF-023',
 '[2026-07-08] Created from full-codebase review. Acceptance: a service requirement reserves the last unit and the counter sees it unavailable; a vendor order becomes a PO the parts department can track; a parts arrival advances the waiting job.',
 9204),

('N4.1', 'N', 'N4', 'Customer truth — fleet writer, Account 360 rental arm, honest scores, one anchor',
 'Five verified gaps in the single-customer picture. (1) customer_fleet writer: deal closed-won with a subject unit auto-creates/links the customer_fleet row (equipment_id, purchase_deal_id, warranty dates) — un-starving the ~12 consumers (predictive kitter/failure/AI, upsell fleet recs, portal notifications, Asset 360 parts tab) that scan zero rows today. (2) Account 360 rental arm: get_account_360 gains a rental key (contracts + invoices by qrm_company_id) and AccountCommandCenterPage renders lifetime/open rental spend next to parts and service — one live total-customer-value number. (3) Honest health scores: parts component sums real parts_orders on the coalesced anchor; rental component from rental_compute_utilization replaces the hardcoded v_rental_score := 75. (4) Customer DNA all-streams: fold parts/service/rental into computeCustomerDnaMetrics; stamp crm_company_id on auto-created profiles; refresh on lifecycle events, not just DGE page views. (5) Portal identity workflow: admin create/invite portal_customers from a qrm_contact with mandatory crm_company_id + data-quality audit for unlinked identities (only demo seeds create portal identities today).',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-006,RF-007,RF-035,RF-036,RF-037',
 '[2026-07-08] Created from full-codebase review. Acceptance: one seeded customer shows one total-value number spanning all four streams on Account 360, and the health score moves when a rental invoice ages.',
 9205),

('N5.1', 'N', 'N5', 'Event fabric completion + scheduled autonomy + cron fleet health',
 'Make the platform''s own nervous system real. (1) Producers for consumer-less events: service.* lifecycle, geofence inbound, portal actions. (2) Retire the m209 write-only flow_events dual bus (Master Roadmap §19.8, silently dropped). (3) Schedule the deployed-but-dormant engines: parts-auto-replenish, parts-demand-forecast, parts-reorder-compute, parts-predictive suite, parts-network-optimizer, evaluate_credit_holds, run_ar_dunning_cycle, flow_cleanup_idempotency. (4) Cron fleet health: finish the INTERNAL_SERVICE_SECRET remediation (~27 stale-secret jobs), decommission the never-registered legacy service pg_cron path and correct docs/SERVICE_CRON.md (GHA is authoritative today), add an atomic claim to service-customer-notify-dispatch (claim-less loop can double-send customer SMS/email under any concurrent invocation). (5) Ship-gate change: every slice close includes an edge-function deploy step (the L8.c lesson — L0-L7 functions shipped undeployed). (6) analytics_events retention/partitioning (system event spine has none).',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-047,RF-048 + unverified event-fabric set | docs/reviews/2026-07-08-full-codebase-review.md Part 3',
 '[2026-07-08] Created from full-codebase review. Acceptance: cron.job shows every intended job green in a week of service_cron_runs; a synthetic flow event traverses producer→workflow→action with no dual-write; analytics_events growth is bounded.',
 9206),

('N6.1', 'N', 'N6', 'Equipment lifecycle truth + inventory surfaces',
 'Make one machine''s story reconstructible. (1) Write the missing transitions: availability=''sold'' + in_out_state + delivery_date on closed-won (also required by M1.1), traded_date when a trade_in-role deal closes; trade-to-stock conversion (accepted trades become qrm_equipment stock units — today they vanish). (2) Intake sync: equipment_intake stage changes write qrm_equipment.intake_stage; stage 8 sets sale_ready_at + readiness — fixing the COO readiness MV that reads a permanently-NULL column (metric is silently 0 forever). (3) Ship the /qrm/equipment list page on the existing qrm-router list contract and repoint the Floor links back from /fleet. (4) Asset 360 completion: rental/intake/invoice/trade arms on get_asset_360 + a Rental tab on AssetDetailPage; writers for equipment_service_intervals (PM countdowns run on an empty table).',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-031,RF-033,RF-034 + trade-to-stock (unverified high)',
 '[2026-07-08] Created from full-codebase review. Acceptance: acquired → rented → serviced → sold reads end-to-end on one asset page; the COO intake_stalled metric shows a real number.',
 9207),

('N7.1', 'N', 'N7', 'Performance remediation — verified hot-path set',
 'The verified performance findings beyond the P0 quick wins. Server-side aggregates: parts catalog page (four whole-table pulls joined in JS — silently truncated at max_rows=1000, i.e. wrong data at scale, RF-011) → one paginated RPC; Floor pulse widgets (BuPulseStrip, ExecRevenuePace) → analytics_quick_kpi-style aggregates; Iron Manager dashboard (14 queries/60s, four unbounded + waterfall) → one summary RPC or realtime invalidation (now that the publication carries the tables). Bounded queries: listCrmWeightedOpenDeals (feeds six pages), pipeline hydration (fetch stages once, batch approval enrichment once, parallel pages). Index pack: inspection_runs.rental_contract_id, rental_reservation_holds.rental_contract_line_id, ownership=rental_fleet partial, crm_deals.margin_check_status, analytics_events dedup-probe index for the rental scanners. Bundle: cap route chunks in the CI guard (only index-*.js is measured today), split the 185KB Floor widget bundle per role, evaluate QuoteBuilderV2Page''s 131KB gzip route chunk.',
 'not_started', 'Engineer',
 NULL,
 'docs/reviews/2026-07-08-findings.json RF-041..RF-048 + unverified performance set',
 '[2026-07-08] Created from full-codebase review. Acceptance: parts catalog and pipeline board render from bounded server queries at 10x seeded data volume; CI bundle guard covers the full startup payload.',
 9208),

('N8.1', 'N', 'N8', 'Governance resurrection — runtime verification + 7A depth audit',
 'Execute the Master Roadmap §19 Runtime Verification Checklist R1-R8 (silently dropped when planning moved to Streams A-L; two of its gates — §19.7 realtime, §19.8 dual-write — turned out to be real defects this review confirmed) and record results in docs/operations/runtime-verification.md. Run the Track 7A/7B per-slice depth audit ("shell vs full") the Complete Roadmap called for — the review found several lens pages running on writer-less tables; classify each of the ~60 QRM pages as real / needs-writer / retire, and fold needs-writer pages into N1/N4/N6 scope or kill them per the roadmap''s slow-death test.',
 'not_started', 'Engineer + Brian',
 NULL,
 'QEP-OS-Master-Roadmap.md §19 | docs/reviews/2026-07-08-full-codebase-review.md Part 6',
 '[2026-07-08] Created from full-codebase review. Acceptance: runtime-verification.md exists with all 8 gates recorded; every 7A/7B page has a verdict and an owner or a kill date.',
 9209)

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

COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity · G=Parts Department · H=Service Department · I=Grapple-Truck Production · J=Workforce · K=Financials Re-architecture · L=Rental Department · M=Revenue Convergence · N=Seam Completion';
