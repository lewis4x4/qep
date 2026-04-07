# Wave 5/6 Reconciliation Matrix

Last updated: 2026-04-06
Repo truth: `/Users/brianlewis/Projects/qep-knowledge-assistant`

This file is the authoritative Wave 5/6 reconciliation gate for the current repo. It exists because the roadmap handoff status text is behind the actual codebase. Treat this matrix as the finish-line tracker for Wave 5/6 work in this repo.

## Status key

- `Shipped`: schema, backend, and UI surface are materially present
- `Partial`: meaningful implementation exists, but the contract is not fully closed
- `Missing`: the roadmap item does not yet exist in a usable form
- `Deferred`: intentionally out of the current closeout lane

## Wave 5

| Area | Status | Repo evidence | Remaining closeout |
| --- | --- | --- | --- |
| 5A.3 Tax & incentives | Partial | `167_wave5_closeout_tax_incentives.sql`, `tax-calculator`, `quote-incentive-resolver`, `TaxBreakdown`, `IncentiveStack`, `IncentiveCatalogPage` | Validate estimate-only tax mode contract, disclaimer language, stale-cache behavior, and authoring guardrails end to end |
| 5B.1 Price intelligence (CSV/XLSX + impact + requote + yard-first) | Partial | `PriceIntelligencePage`, `PriceFileUpload`, `price-file-import`, `requote-drafts`, `draft-email`, `parts-network-optimizer` | Finish non-PDF import contract and verify yard-first recommendation wiring |
| 5B.2 Price intelligence (PDF/OCR + unmatched repair) | Missing | no dedicated PDF/OCR import or unmatched-row repair UI in price-intelligence flow | Ship as separate release lane only |
| 5C Nervous system | Partial | `168_wave5c_nervous_system.sql`, `NervousSystemDashboardPage`, `HealthScoreDrawer`, `ARCreditBlockBanner`, `LifecyclePage`, `account-360-api` | Confirm explainability, AR blocking sharpness, override lifecycle, and attribution visibility |
| 5D Portal/payments/library | Partial | `169_wave5d_portal_stripe_audit.sql`, `portal` pages, `portal-api`, document visibility audit | Confirm canonical state machine reads, payment/webhook trust, reorder path, and ETA/source consistency |
| 5E SOP false-positive protection | Partial | `171_wave5e_sop_false_positive_protection.sql`, `SopComplianceDashboardPage`, SOP pages, `sop-engine` | Finish suppression/review flow visibility and step-state/operator UX closure |

## Wave 6

| Area | Status | Repo evidence | Remaining closeout |
| --- | --- | --- | --- |
| 6.1 Shared primitives | Shipped | `apps/web/src/components/primitives/*` including `StatusChipStack`, `FilterBar`, `CountdownBar`, `AssetCountdownStack`, `ForwardForecastBar`, `Last24hStrip`, `AssetBadgeRow`, `AskIronAdvisorButton`, `DashboardPivotToggle`, `MapWithSidebar` | Validate adoption on target pages and fill any missing usage gaps |
| 6.2 Account / Asset 360 | Partial | `QrmCompanyDetailPage`, `Account360Tabs`, `QrmEquipmentDetailPage`, `173_account_360_and_fleet_radar_rpcs.sql` | Close commercial-action and explainability gaps instead of creating duplicate surfaces |
| 6.3 Fleet map | Shipped | `FleetMapPage`, `PortalFleetMapPage`, `MapWithSidebar` | Validate restrained v1 behavior and drill paths |
| 6.4 Service dashboard | Partial | `161_service_dashboard_and_canonical_state.sql`, service feature surfaces | Close canonical-state and operational summary contract if missing |
| 6.5 Geofences (restrained v1) | Partial | `162_geofences_postgis.sql`, geofence schema and exception routing foundations | Confirm only customer jobsite / branch territory / competitor yard ship in v1 |
| 6.6 Ask Iron Advisor everywhere | Partial | primitive exists and is wired in several pages | Finish consistent placement across target record screens |
| 6.7 Portal fleet mirror | Partial | `PortalFleetPage`, `PortalFleetMapPage` | Confirm parity and customer-safe scope |
| 6.8 Data quality layer | Partial | `164_data_quality_audit.sql`, `176_dq_expansion_and_duplicate_finder.sql`, `DataQualityPage`, later DQ migrations | Finish issue-class coverage and cross-links |
| 6.9 Exception inbox | Partial | `165_exception_inbox.sql`, `ExceptionInboxPage` | Finish action routing and real source integration coverage |
| 6.10 Executive Command Center | Partial | `166_exec_command_center.sql`, `ExecCommandCenterPage`, command-center spec | Deepen role-aware drillability and actionability |

## Out of scope for Wave 5/6 closeout

Do not bundle these into Wave 5/6 closure:

- Flare work
- knowledge-base observability and retrieval work
- unrelated parts/service drift already present in the worktree

## Current closeout order

1. 5B.1 non-PDF import contract
2. 5C nervous-system explainability + AR acceptance
3. 5D portal canonical-state validation
4. 5E SOP suppression/review UX closure
5. 6.2 / 6.6 Track A intelligence UI finish
6. 6.8 / 6.9 / 6.10 operational closeout
7. 5B.2 PDF/OCR as a separate release
