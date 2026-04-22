# QEP Blocked Backlog Readiness Audit

**Date:** 2026-04-22  
**Scope:** active blocked rows after closing executable parity slices and resolving row `12`

## Row 2 — VitalEdge / IntelliDealer API access

**Status:** blocked by external access  
**Repo readiness already present:**

- `apps/web/src/lib/intellidealer.types.ts` defines the adapter contract
- current repo notes already expect a real adapter swap once access exists

**Still missing:**

- live VitalEdge / IntelliDealer API endpoint access
- authentication method / credentials
- any production integration contract from VitalEdge

## Row 3 — HubSpot connection credentials

**Status:** blocked by missing remote credentials  
**Remote secret audit (`supabase secrets list`) found:**

- present:
  - `HUBSPOT_REDIRECT_URI`
  - `HUBSPOT_SCOPES`
- missing:
  - `HUBSPOT_CLIENT_ID`
  - `HUBSPOT_CLIENT_SECRET`
  - `HUBSPOT_APP_ID`
  - `HUBSPOT_OAUTH_STATE_SECRET`

**Code expectation:**

- `supabase/functions/_shared/hubspot-runtime-config.ts`
- falls back to encrypted `integration_status` payload only if those credentials were stored there instead

## Row 4 — QuickBooks GL live posting

**Status:** built, but still blocked by missing live credentials  
**Remote secret audit (`supabase secrets list`) found:**

- no `QUICKBOOKS_*`-style remote secrets present

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

## Row 5 — Service technician field UAT

**Status:** repo-side built, manual acceptance pending  
**Still missing:**

- real technician validation on deployed `/m/service`
- pass/fail feedback capture from service staff

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

## Row 20 — IronGuides contract dependency

**Status:** blocked by external vendor dependency  
**Still missing:**

- confirmed IronGuides contract status
- permitted market-intelligence feed/access model

## Net Remaining True Blockers

- row `2`
- row `3`
- row `4`
- row `5`
- row `16`
- row `20`

## Removed From Blocked Set

- row `12`
  - resolved as an existing folded implementation
  - see `QEP-Cross-Cutting-Traffic-Management-Scope-Decision-20260422.md`
