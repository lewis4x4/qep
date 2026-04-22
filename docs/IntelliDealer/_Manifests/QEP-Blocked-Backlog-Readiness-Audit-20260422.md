# QEP Blocked Backlog Readiness Audit

**Date:** 2026-04-22  
**Scope:** active blocked rows after closing executable parity slices and resolving row `12`

## Row 2 — VitalEdge / IntelliDealer API access

**Status:** closed by decommission decision  

- live product decision: IntelliDealer will not be connected
- remote `integration_status` now marks `intellidealer` as:
  - `status = demo_mode`
  - `config.lifecycle = replaced`
  - `replacement_surface = QEP Catalog + QRM`

## Row 3 — HubSpot connection credentials

**Status:** closed by decommission decision  

- live product decision: HubSpot will not be connected
- remote `integration_status` now marks `hubspot` as:
  - `status = demo_mode`
  - `config.lifecycle = replaced`
  - `replacement_surface = QRM`

## Row 4 — QuickBooks GL live posting

**Status:** built, but still blocked by missing live credentials  
**Runtime state now verified:**

- `integration_status` row exists for `quickbooks`
- `status = pending_credentials`
- `auth_type = oauth_app`
- encrypted credentials are still absent
- operator-grade configuration UI is live at `/admin/quickbooks-gl`
- `quickbooks-gl-sync` is deployed at remote version `2`

**Code expectation:**

- `supabase/functions/_shared/quickbooks-gl.ts`
- expects encrypted `integration_status` payload for integration key `quickbooks`

**Required credential fields:**

- `client_id`
- `client_secret`
- `refresh_token`
- `realm_id`
- `ar_account_id`
- `service_revenue_account_id`
- `parts_revenue_account_id`
- `haul_revenue_account_id`
- `shop_supplies_account_id`
- `misc_revenue_account_id`
- `tax_liability_account_id`

**What is no longer missing:**

- configuration UI
- encrypted save/clear path
- readiness summary / mapping coverage
- live QuickBooks company handshake action
- invoice queue retry surface

## Row 5 — Service technician field UAT

**Status:** repo-side built, manual acceptance pending  
**Still missing:**

- real technician validation on deployed `/m/service`
- pass/fail feedback capture from service staff
- manual execution pack prepared:
  - `QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md`

## Row 16 — OEM portal dashboard configuration

**Status:** repo-side built, operational config pending  
**Still missing:**

- real OEM launch URLs
- credential ownership per OEM
- actual access mode confirmation per OEM:
  - bookmark-only
  - shared login
  - individual login
  - OAuth-ready
  - API-only
- operator checklist prepared:
  - `QEP-Phase-9-OEM-Portal-Configuration-Checklist-20260422.md`

## Row 20 — IronGuides contract dependency

**Status:** blocked by external vendor dependency  
**Still missing:**

- confirmed IronGuides contract status
- permitted market-intelligence feed/access model
- decision brief prepared:
  - `QEP-Phase-5-IronGuides-Dependency-Decision-20260422.md`

## Net Remaining True Blockers

- row `4`
- row `5`
- row `16`
- row `20`

## Removed From Blocked Set

- row `2`
  - resolved by decommission / native replacement
- row `3`
  - resolved by decommission / native replacement
- row `12`
  - resolved as an existing folded implementation
  - see `QEP-Cross-Cutting-Traffic-Management-Scope-Decision-20260422.md`
