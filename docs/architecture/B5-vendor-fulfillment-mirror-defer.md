# B5 — Fulfillment audit stream (status)

## Shipped in baseline

- **`parts_fulfillment_events`** is the append-only audit log per `parts_fulfillment_runs`.
- **Portal / parts_orders:** DB trigger writes `order_status_*` events with `payload.audit_channel = portal` when `fulfillment_run_id` is set (migration 129). `portal-api` sets the same on `portal_submitted`.
- **Shop (linked job):** `_shared/parts-fulfillment-mirror.ts` → `mirrorToFulfillmentRun()` inserts when `service_jobs.fulfillment_run_id` is set. Payload includes `audit_channel`: `shop` | `vendor` | `system` (defaults to `shop`).
- **Vendor-facing paths:** `service-vendor-inbound` and `service-vendor-escalator` pass `auditChannel: "vendor"` so UI and analytics can separate vendor-touched rows from shop counter work.
- **Shop planner/manager:** Explicit `auditChannel: "shop"` on plan batches and parts actions.
- **UI:** Service → Fulfillment run page shows channel badges and short titles, with raw JSON for support.
- **Historical rows:** Migration **130** backfills `payload.audit_channel` on existing `parts_fulfillment_events` where missing (portal → vendor → shop catch-all).
- **Idempotency:** Migration **131** adds optional `idempotency_key` (unique per workspace). `mirrorToFulfillmentRun()` accepts `idempotencyKey`; duplicate inserts return `duplicate: true`. **`service-vendor-inbound`** uses `Idempotency-Key` / `x-idempotency-key` / body `idempotency_key`, else derives `inbound:{workspace}:{action_id}:{po}`. **`service-vendor-escalator`** keys seeded and step events. JSON may include `fulfillment_event_deduplicated: true` on vendor inbound when the audit row was skipped as a retry.
- **Vendor structured payload (v1):** `_shared/vendor-inbound-contract.ts` validates optional fields when any are present: `edi_control_number`, `vendor_transaction_id`, `asn_reference`, `shipment_reference`, `vendor_message_type`, `line_items` (max 50 rows with `part_number`, `quantity_shipped`, `unit_of_measure`, `line_reference`). Stored on the updated **`service_parts_actions.metadata.vendor_contract`** and on fulfillment mirror payload as **`vendor_contract`** for ASN/EDI-style bridges without breaking legacy JSON.

## Remaining (optional / funded)

- **Native EDI segment maps** (X12/EDIFACT) and vendor-specific credential rotation — out of scope until a concrete integration is funded.
