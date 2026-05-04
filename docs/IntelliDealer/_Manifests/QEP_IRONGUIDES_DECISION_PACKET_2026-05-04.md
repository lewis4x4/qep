# QEP IronGuides Decision Packet

Date: 2026-05-04  
Roadmap slice: Slice 11 — IronGuides Decision or Feed Onboarding  
Workbook row: Gap Register — `IronGuides vendor contract pending`  
Current workbook status: `PARTIAL`

## Objective

Resolve whether QEP requires a live IronGuides feed or should formally retire IronGuides in favor of QEP's fallback/blended valuation policy.

This packet does not close the workbook row by itself. The row remains `PARTIAL` until one of the closure paths below is completed.

## Current State

- QEP valuation surfaces can operate without IronGuides through fallback/blended valuation behavior.
- Existing IronGuides decision artifact from 2026-04-22 is a question set, not a closure decision.
- The workbook cannot mark IronGuides `BUILT` from mock, fallback, registry, or demo-mode evidence.

## Decision Required

Pick exactly one path.

### Path A — Live IronGuides Feed Required

Required before implementation:

- signed IronGuides contract or written vendor authorization
- API/feed documentation
- authentication method
- sandbox or sample payloads
- feed cadence and freshness expectations
- allowed valuation fields: FMV, comparables, pricing intelligence, or full feed
- data retention and customer/privacy constraints
- owner for credential storage and rotation

Closure evidence for workbook:

- source-controlled adapter/feed ingestion code
- configured provider readiness row outside demo mode
- verification using IronGuides-sourced market valuation data
- UI/report evidence that valuations cite live IronGuides data where applicable

Workbook target if complete: `BUILT`.

### Path B — IronGuides Retired / Replaced

Required decision content:

- explicit statement that live IronGuides is not required for this QEP deployment
- replacement policy: QEP fallback/blended valuation is the standard
- owner approving the replacement decision
- effective date
- impact statement for sales, rental, trade-in, and executive reporting
- runtime/provider readiness update showing IronGuides as non-required/replaced

Closure evidence for workbook:

- source-controlled replacement/decommission decision artifact
- runtime/provider readiness state updated to non-required/replaced
- workbook evidence note cites the decision and replacement policy

Workbook target if complete: `N_A` / replaced, not `BUILT`.

## Recommended Decision

If no live IronGuides contract is already available, choose Path B and formally standardize on QEP fallback/blended valuation for this deployment. That avoids keeping the workbook artificially open for a vendor feed that is not necessary to operate QEP.

## Current Status

Queued for business decision. No workbook status promotion yet.
