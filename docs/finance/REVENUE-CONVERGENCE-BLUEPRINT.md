# Stream M — Revenue Convergence Blueprint

**Date:** 2026-07-08
**Status:** RATIFIED 2026-07-08 (Brian red-line via PR #76 + follow-up session) — Stream M seeded as migrations 783/784. §10 decision-register items remain gated on the finance working session (BLK-FIN-WORKING-SESSION); everything else is unblocked engineering.
**Discovery:** [docs/reviews/2026-07-08-full-codebase-review.md](../reviews/2026-07-08-full-codebase-review.md) Part 1 (finding IDs cited per section from [2026-07-08-findings.json](../reviews/2026-07-08-findings.json))
**Precedent:** follows the discovery → blueprint → stream process used by Parts (G), Service (H), Financials (K), Rental (L)

---

## §0 Mission fit

The review verified that **order-to-cash exists for only 2 of 4 revenue streams** (RF-009): service invoices fully; rental invoices but leaks at AR/tax/GL; equipment sales and parts orders never produce an invoice at all. Everything downstream of an invoice — AR aging, dunning, credit holds, statements, QuickBooks parity, exec revenue truth — is therefore structurally wrong for the two largest revenue lines. Stream M makes every dollar the modules earn arrive in finance through one pipeline. This is the highest Operator-Utility work in the backlog: it makes the intelligence layer (health scores, exec KPIs, credit exposure) *true* instead of fabricated.

Stream M complements, not replaces, Stream K: K owns the QuickBooks-reduction decisions (K3.1); M builds the native invoicing/receipts machinery those decisions presuppose. §10's decision register feeds the K3.1 working session.

## §1 Invoice spine contract

One AR-facing table: `customer_invoices`, **dual-anchored** — `portal_customer_id` OR `crm_company_id`, with a CHECK that at least one is set (service invoices already insert company-anchored rows via `_shared/service-invoice.ts:116-124`, so the schema mostly permits this today; the writer code is what discriminates).

**M0 decision — id-space unification (RF-003 correction):** rental contracts anchor on `qrm_company_id` while `customer_invoices` carries `crm_company_id`. Post-migration-170 these are the same underlying `qrm_companies` ids exposed through compat views, but the review found paths that treat them as distinct spaces (rental rate rules are portal-id-space; `rental_resolve_rates` records `id_space` + mismatch exceptions). M0 ratifies: **one company id space (qrm ids) for every financial anchor**, with a lint/audit for violators.

Every invoice row carries: `invoice_type` (`equipment | parts | service | rental`), branch-prefixed `invoice_number` (§3), persisted tax breakdown (§4), GL sync state (§5).

## §2 Invoice generation points (per stream)

| Stream | Trigger | Source of lines | Findings |
|---|---|---|---|
| **Equipment** | `salesOrderSigned → delivered` deal transition | accepted `quote_packages` (+ deposit application, trade credit, FET, tax) | RF-013, RF-014 |
| **Parts** | `parts-order-manager` delivered transition | order lines → `customer_invoices` + `parts_invoice_lines` (m468, currently writer-less) | RF-009 |
| **Rental** | nightly `rental-billing-runner` (exists) | mirror **every** posted `rental_invoices` row regardless of anchor — remove the `portal_customer_id` gate; make skips loud (exception), never silent | RF-003, RF-039 |
| **Service** | already live (`generateInvoiceForServiceJob`) | **reference implementation** — new paths copy its shape | — |

Equipment invoicing also un-deadens the entire equipment-sale reversal foundation (m536/540/659/667), which guards `invoice_type='equipment'` rows that nothing can create today, and requires writing `in_out_state='sold'` at sale time (RF-031 correction).

## §3 Numbering

All four streams draw from `invoice_number_sequences` (m655/m662, branch-prefixed; the admin UI already offers a `rental` department type). Rental's private `next_rental_invoice_number` sequence (m776) is retired or demoted to internal correlation. **Decision for finance session:** ratify the number format per department before equipment/parts paths mint anything.

## §4 Tax

One resolution path — the `tax-calculator` edge fn (or an SQL port of its county/surtax-cap logic) — invoked at posting time by all four invoice writers, using ship-to/branch county sourcing. Persist the resolved breakdown on every invoice (`tax_breakdown` + `tax_code_1..4` from m477, currently writer-less — RF unverified: "sales-tax collected never persisted"). Rental uses the m666 machinery (contract `tax_sourcing_method`, DR-15 evidence columns) that already exists but is never called (RF-027). Remittance/liability reporting (DR-15) becomes a report over persisted breakdowns — M6.

## §5 GL / QuickBooks

Extend the QuickBooks credential/account map (`_shared/quickbooks-gl.ts:11-18`) with `rental_revenue_account_id` and `equipment_revenue_account_id`; extend `inferRevenueAccount` classification and **replace the silent misc-revenue fallback with an exception** (RF-011: rental invoices manually synced today post to misc revenue). Every invoice-producing path enqueues `quickbooks_gl_sync_jobs` the way `_shared/service-invoice.ts:182` does. Internal GL (`gl_journal_entries`, m441-443, currently written only by the reversal path) gets posting rules per stream — **decision for finance session** (allocation basis interacts with K3.1).

## §6 AR receipts (cash application)

Mirror the AP pattern from m661 on the AR side (RF-012): `customer_payments` table (tender type, reference number, received_by, deposit/branch) + `record_ar_payment` RPC with double-pay guard and **multi-invoice application**; updates `amount_paid`/status so dunning, credit holds, and credit-exposure views become truthful. Surfaces: finance-enforcement receive-payments desk, counter POS (parts-order-manager currently stamps only `payment_received_at` with no tender or amount), rental command center. Stripe Terminal (card-present) is a later slice; Stripe portal path keeps working unchanged.

## §7 Credit hold unification

One source of truth (RF-026, RF-038): `evaluate_credit_holds` (m657 Net-30/60 logic) runs on pg_cron and **materializes/clears `ar_credit_blocks`** so the rental checkout gate (m770/777) and the finance hold agree. Enforcement added where it's missing today: `quote-builder-v2` send/accept and `parts-order-manager` submit call `is_customer_on_credit_hold` / `assert_customer_not_on_hold` (m657 — built, zero callers) with the override-with-approver pattern rental already uses. Enqueue the `rental_credit_hold` exception (whitelisted in m772, zero producers).

## §8 Statements, dunning, finance charges

`ar_statement_runs` (m448, writer-less) gets a monthly statement run + rendered statement document + delivery; `run_ar_dunning_cycle` (m664, manual-button-only) gets a cron. Finance-charge assessment policy = **decision for finance session**.

## §9 Margin-gate parity for rental

Rental is the only stream with no pricing floor (RF-010). Contract open/rate-set compares agreed rates to the `rental_resolve_rates` book rate; discounts beyond a workspace threshold require manager approval (approval-case pattern from `qb_margin_thresholds`) or block, mirroring parts' 25%-floor/5%-cap enforcement shape.

## §10 Decision register (feeds the K3.1 working session)

1. Company id-space ratification (§1)
2. Invoice number format per department (§3)
3. GL account mapping + internal-GL posting/allocation basis (§5) — interacts with K3.1 QuickBooks reduction
4. Finance-charge policy + statement cadence (§8)
5. Deposit application order and trade-credit treatment on equipment invoices (§2)
6. FET handling on equipment invoices (§2)

Everything NOT in this register is engineering and proceeds without the working session.

## §11 Build gates

Standard slice gates (migrations:check, root + apps/web builds, contract tests, role/workspace security) **plus, per the L8.c lesson: an edge-function deployment step in every slice close** — the L0–L7 rental functions shipped undeployed once; invoice writers must never repeat that. Zero-blocking: QuickBooks/Stripe/tax lookups all degrade to exceptions + manual paths, never block invoice creation.

## §12 Slice map (mirrors the Stream M seed rows)

| Slice | Title | Gate |
|---|---|---|
| M0.1 | Blueprint ratification + id-space + numbering + GL decisions | BLK-FIN-WORKING-SESSION |
| M1.1 | Equipment sale invoicing (forward path; un-deadens reversal foundation) | after M0 decisions 1-2, 5-6 |
| M2.1 | Parts order invoicing + counter tender capture | after M0 decisions 1-2 |
| M3.1 | AR receipts desk (`customer_payments` + `record_ar_payment` + surfaces) | — |
| M4.1 | Rental financial completion (unconditional AR mirror, m666 tax, GL enqueue, shared numbering, rate floor) | — |
| M5.1 | Unified credit hold enforcement at all three checkouts | — |
| M6.1 | Statements, finance charges, dunning cron, tax remittance reporting | BLK-FIN-WORKING-SESSION (charges/cadence) |

Acceptance for the stream: one seeded customer buys a machine, orders parts, has a service job, and rents a unit — **all four invoices appear in `customer_invoices` with correct tax and branch numbering, age in AR, apply a check payment across them, sync to QuickBooks under the right accounts, and show one total-customer-value number on Account 360.**
