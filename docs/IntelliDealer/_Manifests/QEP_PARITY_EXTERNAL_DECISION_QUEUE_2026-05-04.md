# QEP Parity External Decision Queue

Date: 2026-05-04  
Source roadmap: `QEP_PARITY_REMAINING_IMPLEMENTATION_SLICES_2026-05-04.md`  
Workbook: `QEP_Parity_Worksheet.xlsx`

## Purpose

This queue captures the remaining workbook rows that cannot be honestly promoted from `PARTIAL` or `GAP` by code alone. Each item needs field UAT evidence, vendor contract/feed proof, source fixtures/contracts, or a source-controlled product decision.

No row is closed by this queue document. Rows remain `PARTIAL` / `GAP` until the named closure evidence exists.

## Queue

| Slice | Workbook row | Current status | Packet | Closure evidence required | Assigned to | Target | Status | Linear issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Slice 6 | Reverse the sales of a stock number | `GAP` | `QEP_EQUIPMENT_REVERSAL_FINANCE_POLICY_PACKET_2026-05-04.md` | Approved paid/posted/closed-period, credit memo, GL reversal, tax, equipment state, rental-branch, authorization, and idempotency policy before build, or source-controlled external-process decision. | Unassigned — finance/accounting owner required | TBD before mutation build | Queued | [JAR-103](https://linear.app/jarvislewis/issue/JAR-103/qep-parity-approve-or-de-scope-equipment-sale-reversal-policy) |
| Slices 1–4 | JD Quote II / JD PO / JD Proactive Jobs rows | `GAP` | `QEP_JD_PROVIDER_DECISION_PACKET_2026-05-04.md` | Live JD scope/contract/fixtures/authorization evidence before build, or source-controlled de-scope/replacement decision. | Unassigned — JD business/product owner required | TBD before JD build | Queued | [JAR-104](https://linear.app/jarvislewis/issue/JAR-104/qep-parity-resolve-jd-quote-ii-jd-po-proactive-jobs-scope) |
| Slice 5 | Bobcat and Vermeer Base & Options imports | `PARTIAL` | `QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md` | OEM sample file/API contracts and canonical table mapping before build, or source-controlled de-scope/replacement decision. | Unassigned — OEM catalog/import owner required | TBD after sample/API availability | Queued | [JAR-105](https://linear.app/jarvislewis/issue/JAR-105/qep-parity-provide-bobcatvermeer-base-options-import-fixtures-or-de) |
| Slice 8 | VESign fields across invoicing, quoting, and rental | `PARTIAL` | `QEP_VESIGN_PROVIDER_DECISION_PACKET_2026-05-04.md` | Live VESign contract/API/webhook/status evidence before build, or source-controlled native-signing replacement decision. | Unassigned — legal/provider-signature owner required | TBD after contract/API decision | Queued | [JAR-106](https://linear.app/jarvislewis/issue/JAR-106/qep-parity-resolve-vesign-provider-integration-or-native-signing) |
| Slice 9 | Tethr It Now actions | `PARTIAL` | `QEP_TETHR_PROVIDER_DECISION_PACKET_2026-05-04.md` | Live Tethr credentials/API/webhook/mapping evidence before build, or source-controlled generic-telematics replacement decision. | Unassigned — telematics/provider owner required | TBD after provider/replacement decision | Queued | [JAR-107](https://linear.app/jarvislewis/issue/JAR-107/qep-parity-resolve-tethr-it-now-provider-actions-or-replacement) |
| Slice 10 | Gap Register: Service Mobile Web UI not production-validated for technicians | `PARTIAL` | `QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md` | Completed technician UAT result with device/browser/network, pass/fail, screenshots/video or equivalent proof, and blocking issue disposition. | Unassigned — technician, reviewer, scheduler required | TBD after session assignment | Queued | [JAR-108](https://linear.app/jarvislewis/issue/JAR-108/qep-parity-complete-service-mobile-technician-uat-evidence) |
| Slice 11 | Gap Register: IronGuides vendor contract pending | `PARTIAL` | `QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md` | Either live contract/feed onboarding evidence or a signed/source-controlled replacement decision that retires IronGuides as a live requirement. | Unassigned — valuation/business owner required | TBD for feed/replacement decision | Queued | [JAR-109](https://linear.app/jarvislewis/issue/JAR-109/qep-parity-decide-ironguides-live-feed-onboarding-or-replacement) |

## Execution Order

1. Resolve equipment reversal finance policy before building the mutation; foundation/readiness lookup is already in place.
2. Resolve JD provider scope because four `GAP` rows depend on it.
3. Collect OEM Bobcat/Vermeer file/API fixtures before parser/UI implementation.
4. Resolve VESign and Tethr as live provider integrations or source-controlled replacements before status promotion.
5. Run Service Mobile UAT with a named technician on production mobile hardware and record the completed result template.
6. Hold IronGuides business decision: live feed onboarding vs replacement/de-scope.
7. If a provider or workflow is retired, add a decommission/replacement decision and update runtime/provider readiness rows before moving the workbook row to `N_A`.

## Guardrails

- Do not mark equipment reversal `BUILT` from lookup/readiness evidence; it needs atomic credit memo, GL reversal, equipment status, idempotency, and authorization behavior.
- Do not mark JD rows `BUILT` from generic quote/PO evidence; JD Quote II/JD PO/JD Proactive Jobs need provider-specific proof.
- Do not mark OEM import rows `BUILT` from canonical tables alone; Bobcat/Vermeer fixture/API-backed import behavior must exist.
- Do not mark VESign rows `BUILT` from native QEP signing alone; VESign requires provider proof unless replaced/de-scoped.
- Do not mark Tethr rows `BUILT` from generic telematics alone; Tethr requires provider action proof unless replaced/de-scoped.
- Do not mark Service Mobile `BUILT` from automated tests alone; the worksheet row explicitly requires production technician validation.
- Do not mark IronGuides `BUILT` from fallback/blended/mock valuation evidence; a live IronGuides feed must exist.
- Do not mark any provider row `N_A` without a source-controlled business decision naming the replacement policy.
