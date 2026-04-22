# QEP Cross-Cutting Traffic Management Scope Decision

**Date:** 2026-04-22  
**Gap Register row:** `12`  
**Worksheet note:** Traffic Management (equipment movement) not in QEP roadmap. IntelliDealer has a dedicated module. Decide whether to fold into Service/Rental/Parts or build a separate module.

## Decision

Close the gap as **already folded into QEP operations/logistics surfaces**.

QEP does not need a brand-new standalone Traffic Management module to achieve parity. The committed system already implements the operating lane through:

- a dedicated `traffic_tickets` schema
- a first-class `/ops/traffic` route
- proof-of-delivery capture
- GPS delivery confirmation
- driver checklist / lock workflow
- rental and branch drill-throughs
- COO traffic summary metrics and at-risk movement rollups

## Primary IntelliDealer Evidence

- `/Users/brianlewis/Desktop/IntelliDealer/Cross-Cutting/Traffic Management.pdf`
- `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Cross-Cutting/Traffic Management.txt`

Verified IntelliDealer behavior from the help export:

- listing/search/add traffic tickets
- receipt type filtering
- stock/customer/location/status search
- customer/equipment drill paths
- monthly / weekly / dispatch / shipping views
- equipment, service, and rental entry paths

## Matching QEP Surface Evidence

- Schema foundation:
  - `supabase/migrations/078_traffic_logistics.sql`
  - `supabase/migrations/191_command_center_operations.sql`
- UI route:
  - `apps/web/src/features/ops/pages/TrafficTicketsPage.tsx`
  - `apps/web/src/App.tsx`
- Cross-module fold-in:
  - rental command center links into traffic
  - branch chief / branch command / ecosystem surfaces consume traffic tickets
  - COO execution board and exec traffic summary consume traffic ticket data

## Why This Resolves The Scope Decision

The worksheet uncertainty was whether QEP should:

1. build a dedicated standalone Traffic Management module, or
2. fold the behavior into existing operational surfaces.

Committed QEP code already implements option `2`, and it does so with a dedicated route plus shared ops integrations. That is a valid and stronger parity choice than keeping traffic isolated in a separate legacy-style menu lane.

## Verification

- IntelliDealer help export reviewed against QEP traffic implementation
- file-level TypeScript diagnostics on:
  - `apps/web/src/features/ops/pages/TrafficTicketsPage.tsx`
  - `apps/web/src/App.tsx`

## Outcome

`Gap Register` row `12` should be treated as:

- **scope resolved**
- **built via folded implementation**
- **not an active blocker**
