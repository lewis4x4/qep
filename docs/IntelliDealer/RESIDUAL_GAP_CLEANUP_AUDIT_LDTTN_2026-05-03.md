# Residual Gap Cleanup: Audit Created By + Parts LDTTN

Date: 2026-05-03
Worker: C

## Scope

- Owned audit rows: `audit.created_by`, `parts_invoice.adjust_ldttn`.
- Schema migration used: `supabase/migrations/533_intellidealer_audit_ldttn_cleanup.sql`.
- Raw files and `COL/` were not touched.

## Findings

`audit.created_by` remains `PARTIAL`. The repo already has mixed actor columns (`created_by`, `created_by_user_id`, `requested_by`, `actor_user_id`) plus `record_change_history`. A universal `created_by not null default auth.uid()` rewrite across every workspace table would be high-risk and outside this cleanup. Migration 533 instead adds two compatibility views:

- `public.v_audit_record_changes`: exposes `record_change_history.actor_user_id` as `created_by`.
- `public.v_record_created_by`: rolls up the first insert audit event per workspace/table/record as record-level `created_by`.

Migration 533 also wires `record_change_history_capture()` triggers onto `customer_invoices` and `parts_invoice_lines` so the canonical parts invoice header/detail model participates in the central audit stream.

`parts_invoice.adjust_ldttn` is clear from OCR. The IntelliDealer help text says Adjust LDTTN opens the Tax, Discount & Level screen and changes tax codes, discounts, pricing level, or non-stock codes for only the selected part lines. This is not an inventory adjustment.

## Implementation

Migration 533 adds LDTTN support to `public.parts_invoice_lines`:

- `ldttn_selected`
- `tax_code_1` through `tax_code_4`
- `price_level_code`
- `non_stock_code`
- `ldttn_adjusted_by`
- `ldttn_adjusted_at`

It also adds `public.adjust_parts_invoice_ldttn(...)`, a security-invoker helper that updates either explicit line ids or currently selected lines for one canonical `customer_invoice_id`. Existing `parts_invoice_lines` RLS remains authoritative.

## Deferrals

- `audit.created_by`: no universal table rewrite; status remains `PARTIAL`.
- `parts_invoice.adjust_ldttn`: schema/RPC support is complete, but UI wiring is not part of this slice.
