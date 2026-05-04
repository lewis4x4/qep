# QEP Equipment Reversal Finance Policy Packet

Date: 2026-05-04
Roadmap slice: Slice 6 in `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`
Workbook source: `QEP_Parity_Worksheet.xlsx`

## Row Governed

- Action & Button Parity: Phase-2_Sales-Intelligence / Equipment Invoicing (Sales Support Portal) / Reverse the sales of a stock number

## Current Workbook Position

This row remains `GAP`.

Current repo evidence now includes foundation only:

- Direct `customer_invoices.qrm_equipment_id` linkage.
- Customer invoice reversal-chain fields.
- `reversed` customer invoice status support.
- `equipment_invoices` view exposes equipment and stock-number evidence.
- Read-only readiness guard: `find_equipment_invoice_reversal_candidate(stock_number)`.
- Follow-up guardrail: migration `537_equipment_invoice_reversal_candidate_partial_guard.sql` blocks `partial` invoice status until partially paid reversal policy is approved.
- Elevated QRM route: `GET /qrm/equipment/reversal-candidate?stock_number=...`.

This foundation does not reverse invoices and must not be used to promote the workbook row.

## Finance Decisions Required Before Build

The reversal mutation must not be implemented until these policies are approved:

1. **Paid or partially paid invoices**
   - Decide whether reversal is blocked, requires refund workflow, creates unapplied credit, or requires manager/finance override.
   - Current readiness guard blocks both `partial` and `paid` statuses until this policy is approved.

2. **QuickBooks/GL posted invoices**
   - Decide whether posted invoices are blocked in QEP, reversed through a linked credit memo, or routed to the accounting system first.

3. **Closed accounting periods**
   - Confirm hard-closed periods are blocked.
   - Decide whether soft-closed periods require override, next-period reversal, or are blocked.
   - Resolve whether `gl_periods.company_id` must be scoped through a new invoice-to-GL-company mapping before the mutation RPC is built; current readiness lookup is workspace-scoped only because no direct invoice GL-company FK exists.

4. **Credit memo model**
   - Decide whether QEP creates a negative `customer_invoices` row, a dedicated credit memo table, or another AR document type.
   - Confirm how `amount_paid <= total` constraints interact with negative totals if negative invoices are used.

5. **GL reversal journal rules**
   - Confirm source of sale, inventory, tax, receivable, COGS, and variance accounts.
   - Confirm whether reversal journal lines mirror the original posted journal or recalculate from current equipment fields.

6. **Tax treatment**
   - Confirm whether tax is reversed from the original invoice tax amount, line-level tax detail, or provider/AvaTax credit transaction.

7. **Equipment status and availability**
   - Confirm target equipment state after reversal: available, in-stock, previous availability, or manual review.
   - Confirm whether stock number can be sold/reversed more than once.

8. **Rental invoice branch**
   - Confirm whether "reverse the sale of a stock number" also invokes rental invoice reversal for rental stock workflows, or whether rental reversal remains a separate action.

9. **Authorization and audit**
   - Confirm allowed roles, override roles, reason-code requirements, audit payload, and idempotency-key policy.

## Build Path After Policy Approval

Once policy is approved, implementation should add:

- Atomic privileged RPC, e.g. `reverse_equipment_invoice_by_stock_number`.
- Strict row locks on equipment, source invoice, reversal chain, and GL period records.
- Idempotency table or unique operation key.
- Credit memo / reversal document creation per approved model.
- GL reversal journal header and lines.
- Equipment state update in the same transaction.
- Audit history record with actor, stock number, source invoice, reversal document, GL journal, reason, and policy branch.
- QRM edge mutation route with elevated/finance authorization.
- UI action that first shows readiness blockers, then requires approved reason/confirmation.
- Tests for ready, blocked, duplicate/idempotent, hard-closed, posted, paid, and stale-concurrency cases.

Workbook target after verified implementation: `BUILT`.

## De-Scope Path

If QEP should not reverse equipment sales directly:

- Add source-controlled decision that reversal is handled outside QEP, naming the system/process of record.
- Keep the readiness lookup if useful for operator triage, but label it as diagnostic only.
- Workbook target after evidence: `N_A` / external process, not `BUILT`.

## Stop Conditions

Stop and ask if any of these remain unresolved:

1. Paid/posted invoice reversal behavior is undefined.
2. Credit memo document model is undefined.
3. Tax reversal source is undefined.
4. Closed-period behavior beyond hard-closed blocking is undefined.
5. Rental branch inclusion is undefined.

## Current Queue Status

Status: Queued
Assigned To: Unassigned — finance/accounting owner required before build
Target Date: TBD before any reversal mutation implementation

No workbook status should change from this packet alone.
