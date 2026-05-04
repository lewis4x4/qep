# QEP JAR-103 Equipment Sale Reversal Blocking Report

Date: 2026-05-04
Linear: JAR-103
Workbook row: Action & Button Parity / Phase-2_Sales-Intelligence / Equipment Invoicing (Sales Support Portal) / Reverse the sales of a stock number

## Repo Closeout Verdict

JAR-103 cannot be honestly closed as `BUILT` from the repo on 2026-05-04.

The repo now has read-only readiness evidence for stock-number triage, but it intentionally does not execute a reversal. No workbook row should be promoted from `GAP` until finance/accounting policy is approved and an atomic mutation implementation is added and verified.

## Safe Repo Work Completed

- Added a read-only Equipment Detail readiness card for elevated QRM users.
- The card consumes the existing `GET /qrm/equipment/reversal-candidate?stock_number=...` route and displays candidate status, invoice/GL/equipment fields, and blocker explanations.
- The card explicitly labels the surface as diagnostic/read-only and states that JAR-103 remains policy-blocked.
- Added integration coverage proving the card renders blockers, does not call the elevated guard for non-elevated users, and does not leak cached elevated candidate data after access is removed.

No mutation, workbook, global queue, provider-slice, invoice, equipment-state, credit memo, GL journal, tax, or rental reversal behavior was added.

## Current Repo Evidence

Foundation already present before this closeout pass:

- `supabase/migrations/536_equipment_invoice_reversal_foundation.sql`
  - Adds direct `customer_invoices.qrm_equipment_id` linkage.
  - Adds reversal-chain/audit columns on `customer_invoices`.
  - Adds `reversed` invoice status support.
  - Replaces `equipment_invoices` with a stock-number-aware view over equipment invoices.
  - Adds read-only `find_equipment_invoice_reversal_candidate(stock_number)`.
- `supabase/migrations/537_equipment_invoice_reversal_candidate_partial_guard.sql`
  - Blocks `partial`, `paid`, `void`, and `reversed` invoices from readiness while finance policy is unresolved.
- `supabase/functions/crm-router/index.ts`
  - Exposes the read-only elevated route `GET /qrm/equipment/reversal-candidate?stock_number=...`.
- `supabase/functions/_shared/crm-router-data.ts`
  - Maps the RPC result into a typed candidate payload.
- `apps/web/src/features/qrm/lib/qrm-router-api.ts`
  - Provides `fetchEquipmentInvoiceReversalCandidate` for typed frontend reads.

## Exact Policy Decisions Required Before Mutation Build

Finance/accounting ownership must decide all items below before a mutation RPC, edge route, or UI action can reverse a sale:

1. **Paid and partially paid invoices**
   - Block reversal, require refund workflow, create unapplied credit, or allow manager/finance override?
   - If override is allowed, which roles and evidence are required?

2. **QuickBooks / GL-posted invoices**
   - Should QEP block posted invoices, create a linked credit memo, or require accounting-system reversal first?
   - What is the source of truth after QuickBooks posts?

3. **Closed accounting periods**
   - Hard-closed periods appear blocked by foundation; confirm this remains absolute.
   - For soft-closed periods, should reversal post in the original period, next open period, require override, or be blocked?
   - Define invoice-to-GL-company mapping before mutation because current readiness is workspace-scoped and `gl_periods` is company-scoped.

4. **Credit memo / AR document model**
   - Should reversal create a negative `customer_invoices` row, a dedicated credit memo table, or another AR document type?
   - If negative invoices are used, confirm constraints such as `amount_paid <= total` and invoice totals/taxes are compatible.

5. **GL reversal journal rules**
   - Should reversal journal lines mirror the original posted journal or recalculate from current sale/equipment/tax fields?
   - Confirm sale, inventory, receivable, tax, COGS, variance, and clearing accounts.

6. **Tax treatment**
   - Reverse original invoice tax amount, line-level tax detail, or provider/AvaTax credit transaction?
   - Define behavior when the original tax provider transaction is missing or already credited.

7. **Equipment state after reversal**
   - Set equipment to available, in-stock, prior availability, or manual-review hold?
   - Decide whether the same stock number can be sold/reversed multiple times and how stale/concurrent state is detected.

8. **Rental branch**
   - Confirm whether “reverse the sale of a stock number” also covers rental invoice reversal workflows or if rental reversal remains separate.

9. **Authorization, reason codes, audit, and idempotency**
   - Allowed roles for readiness vs execution.
   - Override roles and dual-control requirements.
   - Required reason-code taxonomy and free-text requirements.
   - Idempotency-key format, duplicate handling, and audit payload.

## Required Build After Approval

After policy approval, implement and test an atomic privileged reversal path that includes:

- `reverse_equipment_invoice_by_stock_number` or equivalent RPC.
- Row locks for stock equipment, source invoice, reversal chain, GL period/company mapping, and idempotency record.
- Credit memo/reversal AR document creation per approved model.
- GL reversal journal header and lines per approved rules.
- Equipment state update in the same transaction.
- Audit record with actor, stock number, source invoice, reversal document, GL journal, reason, policy branch, and idempotency key.
- Elevated/finance-only edge mutation route.
- UI confirmation flow that shows readiness blockers before allowing execution.
- Tests for ready, blocked, duplicate/idempotent, hard-closed, posted, paid/partial, rental-branch, authorization, and stale-concurrency cases.

## Closure Position

- Current workbook status should remain: `GAP`.
- Current queue status should remain: queued / finance-owner required.
- Valid next closeout evidence is either:
  1. Approved finance policy plus verified mutation implementation, or
  2. Source-controlled external-process/de-scope decision that moves the row to `N_A` / external process rather than `BUILT`.
