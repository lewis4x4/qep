# Parts Service — Schema & API Surface (Deliverable 2)

Companion: [parts-service-unified-spec.md](./parts-service-unified-spec.md), [parts-service-unified-model.md](./parts-service-unified-model.md).

## Tables (PK / FK)

- **`parts_fulfillment_runs`** — PK `id`; `workspace_id`; RLS in migration `115_parts_fulfillment_and_profile_workspaces.sql`.
- **`parts_fulfillment_events`** — PK `id`; FK `fulfillment_run_id` → `parts_fulfillment_runs(id)` ON DELETE CASCADE; `workspace_id`, `event_type`, `payload` JSONB; optional **`idempotency_key`** (unique per `workspace_id` when set, migration **131**) for vendor retry dedupe; indexes in `115`, `118`. Portal paths tag **`payload.audit_channel`** (migration **129** trigger + `portal-api`; historical backfill migration **130**).
- **`profile_workspaces`** — PK `(profile_id, workspace_id)`; migration `115`.
- **`parts_orders.fulfillment_run_id`** — optional FK → `parts_fulfillment_runs`; migration `115`.
- **`service_jobs.fulfillment_run_id`** — optional FK → `parts_fulfillment_runs`; migration `115`.
- **`service_parts_requirements` / `service_parts_actions`** — core service parts model; `095_service_parts_vendor_tables.sql` and follow-ons; planner uses `plan_batch_id` on `service_parts_actions` metadata/column per implementation.
- **Triggers:** `117_parts_orders_fulfillment_status_trigger.sql` — syncs `parts_orders.status` changes into run status and `order_status_*` events.
- **`parts_order_notification_sends`** — unique `(parts_order_id, event_type)` for idempotent staff shipment emails; migration `119_parts_order_ship_notification_dedupe.sql`.

## Event / audit model

### `parts_fulfillment_events.event_type` (conventions)

Reserved prefixes (documented contract; not all enforced in DB CHECK):

| Prefix | Source | Examples |
|--------|--------|----------|
| `portal_*` | Portal API | `portal_submitted`, customer-facing submit flow |
| `order_status_*` | DB trigger on `parts_orders` | Shipped, delivered, cancelled alignment |
| `service_job_*` | `service-job-router` | `service_job_linked`, `service_job_unlinked` |
| `shop_*` | Shop bridge | `shop_parts_action`, `shop_parts_plan_batch`, `shop_vendor_inbound`, `shop_vendor_escalation_seeded`, `shop_vendor_escalation_step` (`parts-fulfillment-mirror` + `service-parts-*`, `service-vendor-*`) |

**Payload conventions:** `payload.audit_channel` is `portal` | `shop` | `vendor` | `system` where writers set it (UI/analytics). Vendor mirror events may include **`vendor_contract`** (ASN/EDI-shaped object from `service-vendor-inbound` / `_shared/vendor-inbound-contract.ts`).

### `service_job_events`

Job-scoped timeline (`event_type` e.g. `parts_action`); separate from fulfillment-run audit.

## API surface (by mechanism)

| Area | Mechanism | Key routes / actions |
|------|-----------|----------------------|
| Portal customer | Edge | `portal-api`: `/parts`, `/parts/submit`, `/parts/suggest-pm-kit` |
| Staff ship email | Edge | `parts-order-customer-notify` |
| Service job ↔ run link | Edge | `service-job-router`: `link_fulfillment_run` |
| Portal request ↔ job bridge | Edge | `service-job-router`: `link_portal_request`, `unlink_portal_request` |
| Portal order search (staff) | DB + Edge | `search_parts_orders_for_link` (migration `120`) via `service-job-router`: `search_portal_orders` |
| Parts CRUD / fulfillment | Edge | `service-parts-manager`: `add`, `pick`, `receive`, `stage`, `consume`, … |
| Planning | Edge | `service-parts-planner`: `job_id` |
| Vendor inbound / escalation | Edge | `service-vendor-inbound` (optional structured `vendor_contract`, idempotency headers/body, migration **131** keys on mirror rows), `service-vendor-escalator` (cron); mirror to run when `service_jobs.fulfillment_run_id` set |
| Staff fulfillment audit UI | Web (staff JWT) | Route **`/service/fulfillment/:runId`** — links from portal parts orders detail, job drawer fulfillment bridge, parts work queue (`usePartsQueue` embeds `fulfillment_run_id`), command-center Parts hub strip |

## Permissions (summary)

- **Staff JWT:** `get_my_workspace()`-scoped SELECT/INSERT where policies allow (e.g. `parts_fulfillment_events_insert_staff` in `116_parts_fulfillment_staff_event_rls.sql`).
- **`service_role`:** Full access policies on fulfillment tables for edge functions that use the service key.
- **Portal:** Anonymous/customer paths via `portal-api` only; no direct table access from the browser.

See migration files above for authoritative SQL rather than duplicating policies here.
