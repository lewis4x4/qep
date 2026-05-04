# QEP Parity External Decision Queue

Date: 2026-05-04  
Source roadmap: `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`  
Workbook: `QEP_Parity_Worksheet.xlsx`

## Purpose

This queue captures the remaining workbook rows that cannot be honestly promoted from `PARTIAL` by code alone. Each item needs field UAT evidence, vendor contract/feed proof, or a source-controlled product decision.

No row is closed by this queue document. Rows remain `PARTIAL` until the named closure evidence exists.

## Queue

| Slice | Workbook row | Current status | Packet | Closure evidence required | Status |
| --- | --- | --- | --- | --- | --- |
| Slice 10 | Gap Register: Service Mobile Web UI not production-validated for technicians | `PARTIAL` | `QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md` | Completed technician UAT result with device/browser/network, pass/fail, screenshots/video or equivalent proof, and blocking issue disposition. | Queued |
| Slice 11 | Gap Register: IronGuides vendor contract pending | `PARTIAL` | `QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md` | Either live contract/feed onboarding evidence or a signed/source-controlled replacement decision that retires IronGuides as a live requirement. | Queued |

## Execution Order

1. Run Service Mobile UAT with a named technician on production mobile hardware.
2. Record the completed UAT result using the existing result template.
3. Hold IronGuides business decision: live feed onboarding vs replacement/de-scope.
4. If IronGuides remains required, collect contract/feed/API credentials before implementation.
5. If IronGuides is retired, add a decommission/replacement decision and update runtime/provider readiness rows before moving the workbook row to `N_A`.

## Guardrails

- Do not mark Service Mobile `BUILT` from automated tests alone; the worksheet row explicitly requires production technician validation.
- Do not mark IronGuides `BUILT` from fallback/blended/mock valuation evidence; a live IronGuides feed must exist.
- Do not mark IronGuides `N_A` without a source-controlled business decision naming the replacement valuation policy.
