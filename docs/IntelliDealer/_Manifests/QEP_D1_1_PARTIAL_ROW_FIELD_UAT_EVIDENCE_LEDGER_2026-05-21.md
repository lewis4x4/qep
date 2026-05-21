# QEP D1.1 Partial Row Field/UAT Evidence Ledger

Date: 2026-05-21  
Roadmap task: D1.1 / QEP-86  
Workbook: `docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`  
Scope: workbook rows that currently have `PARTIAL` status in the parity closeout sheets.

## Guardrail

No workbook status promotion is made by this ledger. Every row below remains `PARTIAL` until the exact closure evidence listed for that row exists. Automated tests, schema, generic adapters, or blank templates are not enough to close manual UAT, provider, credential, or contract rows.

## Current PARTIAL Row Coverage

| Workbook row | Phase | Item | Current evidence foundation | Missing closure evidence | Next owner action |
| --- | --- | --- | --- | --- | --- |
| `Field Parity Matrix!53` | Phase-2_Sales-Intelligence | VESign on Equipment Invoicing | Native QEP signing/status foundation is documented in the worksheet. | Live VESign contract/API/webhook/status proof, or source-controlled native-signing replacement decision. | Provider/legal owner must supply live VESign proof or approve replacement/de-scope. |
| `Field Parity Matrix!87` | Phase-2_Sales-Intelligence | VESign on Equipment Quoting | Native QEP signing/status foundation is documented in the worksheet. | Live VESign contract/API/webhook/status proof, or source-controlled native-signing replacement decision. | Provider/legal owner must supply live VESign proof or approve replacement/de-scope. |
| `Field Parity Matrix!256` | Phase-6_Rental | Rental Counter VESign status/reverse highlight | Native QEP signing/status foundation is documented in the worksheet. | Live VESign rental-status proof, or source-controlled native-signing replacement decision covering rental. | Provider/legal owner must supply live VESign proof or approve replacement/de-scope. |
| `Action & Button Parity!4` | Phase-2_Sales-Intelligence | Bobcat Base and Options Import | OEM/base-options foundation exists. | Bobcat source fixture/API contract plus parser/import proof, or source-controlled de-scope decision. | OEM catalog owner must provide fixture/API material or decide replacement. |
| `Action & Button Parity!6` | Phase-2_Sales-Intelligence | Vermeer Base and Options Import | OEM/base-options foundation exists. | Vermeer source fixture/API contract plus parser/import proof, or source-controlled de-scope decision. | OEM catalog owner must provide fixture/API material or decide replacement. |
| `Action & Button Parity!12` | Phase-2_Sales-Intelligence | Tethr It Now on Equipment Invoicing | Provider-neutral telematics storage/ingest foundation exists. | Live Tethr credentials/API/webhook/mapping proof, or source-controlled generic-telematics replacement decision. | Telematics/provider owner must resolve Tethr vs replacement. |
| `Action & Button Parity!24` | Phase-3_Parts | Tethr It Now on Parts Invoicing | Provider-neutral telematics storage/ingest foundation exists. | Live Tethr credentials/API/webhook/mapping proof for parts context, or source-controlled generic-telematics replacement decision. | Telematics/provider owner must resolve Tethr vs replacement. |
| `Action & Button Parity!51` | Phase-9_Advanced-Intelligence | Tethr It Now on Customer Portal | Provider-neutral telematics storage/ingest foundation exists. | Live Tethr credentials/API/webhook/mapping proof for customer portal context, or source-controlled generic-telematics replacement decision. | Telematics/provider owner must resolve Tethr vs replacement. |
| `Gap Register!5` | Phase-4_Service | Service Mobile Web UI not production-validated for technicians | `/m/service` repo-side mobile implementation and automated tests exist. Current execution packet and templates are source-controlled. | Completed field UAT result from a named technician and reviewer on actual mobile hardware, including normal and degraded-network proof and blocker disposition. | Brian + Rylee must schedule/observe the technician session and complete the result artifact. |
| `Gap Register!20` | Phase-5_Deal-Genome | IronGuides vendor contract pending | QEP can operate with fallback valuation/intelligence flows. | Live IronGuides contract/feed onboarding proof, or signed/source-controlled replacement decision retiring IronGuides as live requirement. | Valuation/business owner must decide live feed onboarding vs replacement. |

## Service Mobile UAT Evidence Packet

The field-executable package for `Gap Register!5` is source-controlled here:

- `QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md`
- `QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md`
- `QEP-Phase-4-Service-Mobile-UAT-Operator-Guide-20260422.md`
- `QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md`

D1.1 repo-side preflight status:

- Evidence ledger created and verified: `bun run parity:field-uat:evidence` PASS on 2026-05-21T05:43:28Z.
- Workbook integrity: `bun run parity:workbook:verify -- --desktop-workbook=none` PASS on 2026-05-21T05:43:28Z.
- Service mobile automated smoke: `bun test apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx` PASS on 2026-05-21; 4 tests passed.
- Field UAT: not complete; no technician/session/result artifact has been supplied in repo materials.

## Closure Instructions

1. Run `bun run parity:field-uat:evidence` before any D1.1 status claim.
2. Run `bun run parity:workbook:verify -- --desktop-workbook=none` when validating the repo workbook without the desktop copy.
3. Run the Service Mobile integration smoke before the field session: `bun test apps/web/src/features/service/pages/__tests__/ServiceTechnicianMobilePage.integration.test.tsx`.
4. During the field session, complete `QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md` with named technician, reviewer, device/browser, production account, normal/degraded network evidence, proof references, result, blocker disposition, and signoff.
5. Promote `Gap Register!5` only if the completed result says row closure is allowed and no blocking issues remain unresolved.
