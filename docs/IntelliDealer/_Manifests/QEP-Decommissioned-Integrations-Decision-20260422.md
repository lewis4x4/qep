# QEP Decommissioned Integrations Decision

**Date:** 2026-04-22  
**Decision scope:** IntelliDealer and HubSpot

## Product Decision

IntelliDealer and HubSpot are not pending future dependencies for QEP.

They are **decommissioned as live runtime requirements**.

QEP will operate through native internal surfaces instead:

- **HubSpot → QRM**
- **IntelliDealer → QEP Catalog + QRM + native parts/service/quote workflows**

## Why This Decision Matters

The parity backlog still carried both systems as credential/access blockers. That was no longer true once the product decision became explicit:

- no IntelliDealer API will be provided
- no HubSpot API will be provided

So the correct action was not to keep waiting for credentials. It was to remove the live dependency assumption from the app and integration model.

## Runtime Changes Applied

- `integration_status` rows for `hubspot` and `intellidealer` were updated with:
  - `status = demo_mode`
  - `config.lifecycle = replaced`
  - `external_dependency_required = false`
- quote-builder access no longer depends on IntelliDealer availability checks
- Integration Hub / Integration Panel now render both systems as replaced-by-native
- HubSpot connect route now renders retirement guidance instead of starting OAuth

## Verification Evidence

- Remote `integration_status` query confirms:
  - `hubspot` → `demo_mode`, `lifecycle = replaced`, `replacement_surface = QRM`
  - `intellidealer` → `demo_mode`, `lifecycle = replaced`, `replacement_surface = QEP Catalog + QRM`
- `bun test apps/web/src/lib/replaced-integrations.test.ts`
- `deno check supabase/functions/integration-availability/index.ts supabase/functions/integration-test-connection/index.ts`
- `bun run build`

## Outcome

These backlog rows are no longer blockers:

- row `2`
- row `3`

They should be treated as:

- **closed by decommission decision**
- **replaced by native QEP surfaces**
