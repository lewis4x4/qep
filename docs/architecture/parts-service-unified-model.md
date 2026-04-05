# Parts & Service — Unified Fulfillment Model (ADR)

## Purpose

Align **portal parts demand** (`parts_orders`) with **internal service parts execution** (`service_parts_requirements`, `service_parts_actions`, inventory) under one auditable fulfillment lifecycle without replacing the existing service engine.

## Decision (Phase 1)

**Option A — Canonical fulfillment record:** Introduce `parts_fulfillment_runs` as the parent record for cross-surface parts fulfillment. Portal orders attach at submit time; service jobs may attach in a later phase when the same run should coordinate shop picks and portal shipments.

## Current state (truth model)

| Surface | Tables | Role |
|--------|--------|------|
| Portal | `parts_orders`, line_items JSON | Customer demand, statuses draft → shipped |
| Service engine | `service_jobs`, `service_parts_requirements`, `service_parts_actions` | Internal job-based parts orchestration |
| Bridge (existing) | `service_requests.service_job_id`, `portal_quote_reviews.service_quote_id` | Portal ↔ internal links for service quotes |

**Gap:** `parts_orders` did not link to a shared fulfillment parent before migration `115_parts_fulfillment_and_profile_workspaces.sql`.

## Target relationships

```mermaid
flowchart LR
  subgraph portal [Portal]
    PO[parts_orders]
  end
  subgraph fulfillment [Fulfillment]
    FR[parts_fulfillment_runs]
    EV[parts_fulfillment_events]
  end
  subgraph service [Service engine]
    SJ[service_jobs]
    SPR[service_parts_requirements]
  end
  PO -->|fulfillment_run_id| FR
  FR --> EV
  SJ -->|fulfillment_run_id optional| FR
  SPR --> SJ
```

- **Phase 1:** Create `parts_fulfillment_runs` on portal submit; set `parts_orders.fulfillment_run_id`; append `parts_fulfillment_events` (`portal_submitted`, …).
- **Phase 2 (shipped):** Migration `116` allows JWT staff to append events / update runs from edge code when needed.
- **Phase 3 (status sync):** Migration `117` — trigger `parts_orders_fulfillment_on_status_trg` records `order_status_*` events and updates `parts_fulfillment_runs` (shipped → run `shipped`, delivered → run `closed`, cancelled → run `cancelled`) whenever `parts_orders.status` changes with a linked run. Skips `draft`→`submitted` (portal-api keeps `portal_submitted`). Shipment email stays in `parts-order-customer-notify` only.
- **Shop ↔ run:** `service_jobs.fulfillment_run_id` (migration 115) is set by staff via `service-job-router` action `link_fulfillment_run` (same workspace as `parts_fulfillment_runs`). Appends `service_job_linked` / `service_job_unlinked` on `parts_fulfillment_events` and timeline events on the job. UI: Service job drawer — paste UUID from portal parts order detail (`fulfillment_run`).

## Staff notifications

**Problem:** In-app staff bells must respect **workspace**, not every `rep`/`admin` globally.

**Mechanism:** `profile_workspaces (profile_id, workspace_id)` — backfilled from all profiles (`default`) and `technician_profiles` (per-workspace tech rows). Portal `portal-api` resolves recipients by joining eligible roles to `profile_workspaces` for `portalWorkspaceId`.

## Boundaries

- No removal of `service_parts_*` tables; fulfillment runs are an overlay for traceability and future convergence.
- RLS: new tables follow `workspace_id = get_my_workspace()` for authenticated staff; `service_role` for edge functions.
- API: portal continues to use `portal-api` only for customer mutations.

## References

- Migration: `supabase/migrations/115_parts_fulfillment_and_profile_workspaces.sql`
- Portal bridge: `supabase/migrations/100_service_portal_bridge.sql`
- Parts intelligence: `supabase/migrations/095_service_parts_vendor_tables.sql`
