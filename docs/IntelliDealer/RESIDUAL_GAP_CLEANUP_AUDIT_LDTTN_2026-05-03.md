# Residual Gap Cleanup: Audit Created By + Parts LDTTN

Date: 2026-05-03
Worker: C

## Scope

- Owned audit rows: `audit.created_by`, `parts_invoice.adjust_ldttn`.
- Schema migrations used: `supabase/migrations/533_intellidealer_audit_ldttn_cleanup.sql`, followed by `supabase/migrations/534_intellidealer_universal_created_by_audit.sql`.
- Raw files and `COL/` were not touched.

## Findings

`audit.created_by` was originally kept `PARTIAL` because a universal `created_by not null default auth.uid()` rewrite across every workspace table would be high-risk. The repo uses a compatibility model instead: mixed actor columns (`created_by`, `created_by_user_id`, `requested_by`, `actor_user_id`) plus `record_change_history`.

Migration 533 adds two compatibility views:

- `public.v_audit_record_changes`: exposes `record_change_history.actor_user_id` as `created_by`.
- `public.v_record_created_by`: rolls up the first insert audit event per workspace/table/record as record-level `created_by`.

Migration 533 also wires `record_change_history_capture()` triggers onto `customer_invoices` and `parts_invoice_lines` so the canonical parts invoice header/detail model participates in the central audit stream.

Follow-on migration 534 moves this row to `BUILT` by installing `record_change_history_capture()` broadly on public workspace-scoped operational tables with `uuid id` columns, while excluding audit/history/event/log/run/snapshot tables to prevent recursion and telemetry bloat. The admin Audit Log now reads the central `v_audit_record_changes` stream.

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

- `parts_invoice.adjust_ldttn`: schema/RPC support is complete, but UI wiring is not part of this slice.
