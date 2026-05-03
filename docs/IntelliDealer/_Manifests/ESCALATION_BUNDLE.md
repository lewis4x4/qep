# Escalation Bundle

Current status note, 2026-05-03: this bundle is historical escalation context. The current IntelliDealer handoff closeout authority is `docs/IntelliDealer/INTELLIDEALER_HANDOFF_CLOSEOUT_CONTROL.md`. The core customer import is production-proven; Wave 5 external integrations are registered separately in `docs/IntelliDealer/WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md`.

## 2026-04-22 — Phase-4 Service — Technician field UAT

- What I was doing: closing workbook row `5` for service mobile technician validation.
- What I tried: verified the IntelliDealer service evidence set, built a dedicated `/m/service` technician workspace over the existing service router, added repo-native tests, and passed the full segment gate for `phase4-service-mobile`.
- Blocker: the final acceptance step in the worksheet is real in-field UAT with an actual service technician on a production/mobile workflow. That cannot be executed from the workspace alone.
- What unblocks it: run technician field validation on the deployed `/m/service` flow and record pass/fail feedback from service staff.
- Estimated impact: the repo-side mobile slice is built and merged, but row `5` should not be considered fully retired until technician UAT is completed.

## 2026-04-22 — Phase-9 Advanced Intelligence — OEM portal configuration

- What I was doing: closing workbook row `16` for the OEM portal dashboard.
- What I tried: built and deployed `oem_portal_profiles`, seeded repo-verified OEM/manufacturer rows, added an internal dashboard at `/oem-portals`, and passed the full segment gate for `phase9-oem-portal-sso`.
- Blocker: the repo has no verified OEM launch URLs, shared credential details, or dealer-specific login workflows to preload into the dashboard.
- What unblocks it: populate real manufacturer portal URLs, credential ownership, and access-mode details in the deployed dashboard for each OEM the dealership actively uses.
- Estimated impact: the repo-side dashboard is built and deployed, but operators still need to complete per-OEM configuration before it functions as a live launch board.

## 2026-04-22 — Phase-8 Financial Operations — QuickBooks credentials and account mapping

- What I was doing: confirming the remaining non-code blockers after closing the executable parity backlog.
- What I tried: built and deployed the QuickBooks GL sync queue, verified the segment gate, pushed the slice to production with migration `352`, backfilled the missing `integration_status` row via migration `357`, and shipped the operator-grade configuration command center at `/admin/quickbooks-gl` with encrypted save/clear, readiness cards, mapping coverage, live company handshake, and retry queue controls.
- Blocker: the runtime row now exists, but remote state still has no encrypted credentials configured for integration key `quickbooks`. The sync still needs `client_id`, `client_secret`, `refresh_token`, `realm_id`, `ar_account_id`, `service_revenue_account_id`, `parts_revenue_account_id`, `haul_revenue_account_id`, `shop_supplies_account_id`, `misc_revenue_account_id`, and `tax_liability_account_id`.
- What unblocks it: enter the QuickBooks OAuth credentials and account mappings in the deployed `/admin/quickbooks-gl` command center for workspace `default`.
- Estimated impact: row `4` is now reduced to a pure operator data-entry blocker; code, UI, queueing, and deployment path are complete.

## 2026-04-22 — Phase-5 Deal Genome — IronGuides contract dependency

- What I was doing: verifying the remaining workbook rows after closing row `18`.
- What I tried: re-read the verified worksheet row and checked the current repo for an IronGuides market-intelligence feed implementation target.
- Blocker: the worksheet marks this slice as dependent on external IronGuides vendor contract status. There is no confirmed feed access or live contract artifact in the workspace.
- What unblocks it: confirm IronGuides contract status and the permitted feed/access pattern for QEP.
- Estimated impact: row `20` cannot move from backlog to implementation until the vendor dependency is resolved.

## 2026-04-21 — Phase-3 Parts — VitalEdge / IntelliDealer API access

- What I was doing: starting the verified parity execution loop and selecting the highest-priority work units from the Gap Register.
- What I tried: verified the worksheet row, confirmed the IntelliDealer evidence set exists locally, and checked the committed repo for parts module surfaces to confirm this is not a missing-code issue.
- Blocker: no VitalEdge / IntelliDealer API access is available from the workspace, so data migration and parity validation against live legacy data cannot begin.
- What unblocks it: QEP needs to provide the VitalEdge account rep introduction and working API access.
- Estimated impact: all Phase-3 data migration work stays blocked; parts retirement and any parity work that depends on live IntelliDealer data remains blocked.

## 2026-04-21 — Cross-Cutting — HubSpot API key

- What I was doing: ranking the first executable parity gaps after the opening assessment.
- What I tried: verified that `crm-hubspot-import` and `qrm-hubspot-import` already exist in committed `HEAD`, so the gap is not absence of import code.
- Blocker: the HubSpot API key is not available in the current execution environment, so Phase-1 migration/cutover work that depends on HubSpot cannot run end-to-end.
- What unblocks it: Rylee or the operator needs to provide the HubSpot API key in the project environment.
- Estimated impact: HubSpot retirement and CRM migration validation remain blocked even though the import surface exists.
