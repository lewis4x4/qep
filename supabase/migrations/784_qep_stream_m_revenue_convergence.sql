-- ============================================================================
-- Migration 784: QEP Stream M — Revenue Convergence source of truth
-- Seeds the qep_roadmap_tasks rows for the stream whose enum label landed in
-- the previous migration. Idempotent upserts (ON CONFLICT task_id DO UPDATE).
-- Source: docs/reviews/2026-07-08-full-codebase-review.md +
--         docs/reviews/2026-07-08-findings.json (RF ids) +
--         docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md
-- Red-lined and approved by Brian 2026-07-08 (PR #76 + follow-up session).
-- No explicit BEGIN/COMMIT: the db-push runner wraps this file in one txn.
-- ============================================================================

INSERT INTO qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner,
   blocking_decision, evidence_link, notes, sort_order)
VALUES
('M0.1', 'M', 'M0', 'Blueprint ratification + finance decisions (id-space, numbering, GL map)',
 'Blueprint §1, §3, §5, §10. Ratify the invoice spine contract: dual-anchored customer_invoices (portal_customer_id OR crm_company_id, CHECK at least one), one company id-space (qrm ids) for every financial anchor with an audit for violators. Finance working session decides: invoice number format per department (invoice_number_sequences for all four streams, retiring next_rental_invoice_number), QuickBooks account map extension (rental_revenue_account_id + equipment_revenue_account_id) + internal-GL posting/allocation basis, deposit application order + trade-credit treatment + FET handling on equipment invoices, finance-charge policy + statement cadence. Feeds and is co-scheduled with the K3.1 decision session — K3.1''s QuickBooks reduction presupposes native invoicing for all streams.',
 'not_started', 'Architect + Finance (Ryan/Tina)',
 'BLK-FIN-WORKING-SESSION',
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §10 | docs/reviews/2026-07-08-findings.json RF-003,RF-009,RF-011',
 '[2026-07-08] Created from full-codebase review. Acceptance: decision register §10 items 1-6 recorded with sign-off; K3.1 packet updated with the ratified contracts.',
 9101),

('M1.1', 'M', 'M1', 'Equipment sale invoicing — forward billing path',
 'Blueprint §2. On the salesOrderSigned→delivered deal transition, generate a customer_invoices row (invoice_type=''equipment'') from the accepted quote_packages row: apply deposits, trade credit, FET, and tax-calculator output; pull a branch-prefixed number from invoice_number_sequences; enqueue quickbooks_gl_sync_jobs; emit a deal.invoiced flow event. Write in_out_state=''sold'' + availability=''sold'' + delivery_date at sale time so the entire existing reversal foundation (find_equipment_invoice_reversal_candidate, reverse_equipment_sale_by_stock_number — currently dead code against app-written data) becomes operable. Zero-blocking: tax/GL failures degrade to exception_queue, never block the invoice.',
 'not_started', 'Engineer',
 NULL,
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §2 | docs/reviews/2026-07-08-findings.json RF-013,RF-031',
 '[2026-07-08] Created from full-codebase review (RF-013: the largest revenue line has a reversal path but no forward billing path). Acceptance: a seeded won deal produces an equipment invoice with deposit + trade credit applied and correct county tax; the reversal RPC finds it as a candidate.',
 9102),

('M2.1', 'M', 'M2', 'Parts order invoicing + counter tender capture',
 'Blueprint §2, §6. parts-order-manager''s delivered transition writes customer_invoices (invoice_type=''parts'') + parts_invoice_lines (m468 — currently zero insert paths repo-wide), branch-prefixed number, tax resolution, GL enqueue. Counter POS captures tender type + amount (today it stamps only payment_received_at with neither). Quote-originated part lines that materialize as parts orders (Stream N2.1) invoice through this same path — one parts invoice pipeline regardless of origination.',
 'not_started', 'Engineer',
 NULL,
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §2 | docs/reviews/2026-07-08-findings.json RF-009,RF-012',
 '[2026-07-08] Created from full-codebase review. Acceptance: a delivered counter order produces an invoice with lines + tax; Account 360 invoice list and AR aging show it.',
 9103),

('M3.1', 'M', 'M3', 'AR receipts desk — cash application for checks/ACH/counter tender',
 'Blueprint §6. customer_payments table + record_ar_payment RPC mirroring the m661 AP double-pay guard: tender type, reference number, multi-invoice application, updates amount_paid/status atomically. Surfaces: finance-enforcement receive-payments desk, counter POS, rental command center. Dunning (run_ar_dunning_cycle), credit holds (evaluate_credit_holds), and owner credit-exposure views become truthful for non-Stripe payers. Stripe portal path unchanged; Stripe Terminal (card-present) deferred to a later slice.',
 'not_started', 'Engineer',
 NULL,
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §6 | docs/reviews/2026-07-08-findings.json RF-012',
 '[2026-07-08] Created from full-codebase review (RF-012 verified: only the Stripe portal path writes amount_paid). Acceptance: one check applied across three open invoices from the receipts desk; dunning stops chasing the customer.',
 9104),

('M4.1', 'M', 'M4', 'Rental financial completion — AR mirror, tax, GL, numbering, rate floor',
 'Blueprint §2, §4, §5, §9. rental-billing-runner mirrors EVERY posted rental_invoices row into customer_invoices regardless of anchor (crm_company_id from the contract''s qrm_company_id when portal identity is absent), with loud skips (exception_queue) never silent ones; backfill previously-skipped invoices. Resolve tax through the m666 machinery (contract tax_sourcing_method, county surtax, DR-15 evidence) instead of hardcoding tax_cents=0. Enqueue quickbooks_gl_sync_jobs per mirrored invoice under the new rental revenue account. Pull numbers from invoice_number_sequences (department type ''rental'' already exists in the UI). Rate floor: contract open/rate-set compares agreed rates to the rental_resolve_rates book rate; discounts beyond workspace threshold require manager approval (approval-case pattern) — closes the only ungated revenue stream.',
 'not_started', 'Engineer',
 NULL,
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §2,§4,§5,§9 | docs/reviews/2026-07-08-findings.json RF-003,RF-010,RF-011,RF-027,RF-039',
 '[2026-07-08] Created from full-codebase review. Acceptance: a counter walk-in rental bills nightly, appears in AR aging with county tax, syncs to QuickBooks under rental revenue; a below-book rate requires manager approval.',
 9105),

('M5.1', 'M', 'M5', 'Unified credit hold enforced at all three checkouts',
 'Blueprint §7. One hold source: evaluate_credit_holds runs on pg_cron and materializes/clears ar_credit_blocks so the rental checkout gate (m770/777) and the finance hold (qrm_companies.credit_hold) agree. Add enforcement where missing: quote-builder-v2 send/accept and parts-order-manager submit call the m657 hold check (assert_customer_not_on_hold — built, zero callers today) with the override-with-approver pattern rental already uses; enqueue the rental_credit_hold exception (whitelisted in m772, zero producers).',
 'not_started', 'Engineer',
 NULL,
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §7 | docs/reviews/2026-07-08-findings.json RF-026,RF-038',
 '[2026-07-08] Created from full-codebase review (RF-038 verified: a customer 90 days past due can buy a machine, run a parts account, and rent iron). Acceptance: an aged-AR customer is blocked at all three checkouts and unblocked by one recorded override.',
 9106),

('M6.1', 'M', 'M6', 'Statements, finance charges, dunning cron, tax remittance reporting',
 'Blueprint §4, §8. ar_statement_runs (m448, writer-less) gets a monthly statement run + rendered document + delivery; run_ar_dunning_cycle gets a pg_cron schedule (manual-button-only today); finance-charge assessment per the ratified policy. Persist resolved tax breakdowns on every invoice (m477 columns, writer-less today) and ship the DR-15/remittance liability report over them.',
 'not_started', 'Engineer',
 'BLK-FIN-WORKING-SESSION',
 'docs/finance/REVENUE-CONVERGENCE-BLUEPRINT.md §8 | docs/reviews/2026-07-08-findings.json RF-012,RF-040',
 '[2026-07-08] Created from full-codebase review. Acceptance: a monthly statement renders for a seeded customer with an aged balance and a finance charge; the remittance report totals match the persisted per-invoice breakdowns.',
 9107)

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
