# QEP D1.2 Source Fixture + Vendor Contract Register

Date: 2026-05-21  
Roadmap task: D1.2 / QEP-87  
Source queue: `QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md`  
Purpose: define the exact source fixture, vendor contract, policy, or UAT package required before any queued parity row can be promoted or built further.

## Guardrail

Do not fabricate vendor, contract, UAT, or finance-policy evidence. Rows governed by this register remain blocked until the package listed below is supplied in source control or a source-controlled replacement/de-scope decision is approved. Generic schema, fallback logic, mock data, or blank templates are not closure evidence.

## Required Source Packages

| Package ID | Queue issue | Queue packet | Required source material | Current repo status | Build allowed before package? |
| --- | --- | --- | --- | --- | --- |
| `equipment-reversal-finance-policy` | `JAR-103` | `QEP_EQUIPMENT_REVERSAL_FINANCE_POLICY_PACKET_2026-05-04.md` | Signed finance/accounting policy for unpaid, partially paid, paid, posted, closed-period, tax, credit memo, equipment-state, rental-branch, authorization, reason-code, audit, and idempotency behavior. | Not supplied. Existing readiness/lookup evidence is not an approved mutation policy. | No atomic reversal mutation build. |
| `jd-provider-scope-contract-fixtures` | `JAR-104` | `QEP_JD_PROVIDER_DECISION_PACKET_2026-05-04.md` | Authorized JD Quote II, JD PO, and JD Proactive Jobs scope decision plus API/SSO/XML/PDF contract, sandbox fixtures, authorization rules, and accepted/deferred workflow policy. | Not supplied. Generic quote/PO functionality is not JD provider evidence. | No JD provider integration build. |
| `bobcat-base-options-fixture` | `JAR-105` | `QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md` | Bobcat sample file or API contract, field mapping to canonical base/options tables, effective-date/supersession/delete semantics, and expected import run counts. | Not supplied. Current OEM work covers other provider surfaces and canonical foundation only. | No Bobcat parser/import promotion. |
| `vermeer-base-options-fixture` | `JAR-105` | `QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md` | Vermeer sample file or API contract, field mapping to canonical base/options tables, effective-date/supersession/delete semantics, and expected import run counts. | Not supplied. Current OEM work covers other provider surfaces and canonical foundation only. | No Vermeer parser/import promotion. |
| `vesign-provider-contract-webhook-fixtures` | `JAR-106` | `QEP_VESIGN_PROVIDER_DECISION_PACKET_2026-05-04.md` | VESign/VitalEdge contract/API docs, sandbox credentials, sender/envelope policy, webhook secret, replay samples, and exact status vocabulary for quote, invoice, and rental rows. | Not supplied. Native signing remains foundation only unless replacement is approved. | No VESign status promotion. |
| `tethr-provider-contract-payload-fixtures` | `JAR-107` | `QEP_TETHR_PROVIDER_DECISION_PACKET_2026-05-04.md` | Tethr auth contract, webhook/API docs, sample payloads for hours/GPS/fault/device metadata, device-to-equipment mapping source, stale-data policy, and unknown-device policy. | Not supplied. Generic telematics and Smart Assist/Yanmar work are not Tethr provider evidence. | No Tethr-specific action promotion. |
| `service-mobile-field-uat-result` | `JAR-108` | `QEP_SERVICE_MOBILE_UAT_EXECUTION_PACKET_2026-05-04.md` | Completed named-technician field UAT result with device/browser/network, production account, proof location, pass/fail, and blocker disposition. | Not supplied. Automated Service Mobile tests passed but do not close field UAT. | No workbook promotion for the Service Mobile row. |
| `ironguides-contract-feed-fixtures` | `JAR-109` | `QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md` | Signed IronGuides authorization, API/feed docs, auth method, payload fixtures, freshness/cadence rules, allowed fields, retention/privacy constraints, and credential owner; or source-controlled replacement decision. | Not supplied. Fallback/blended valuation remains available but is not live IronGuides evidence. | No live IronGuides promotion. |

## Intake Rules

1. Store source-control-safe fixtures and decisions under `docs/IntelliDealer/_Manifests/` or an explicitly named secure evidence location referenced from a source-controlled decision artifact.
2. Do not commit secrets. Credentials must be represented by approved secret names, vault locations, sandbox identifiers, and signed owner metadata, not raw keys.
3. Each fixture package must include expected parser/import/output assertions so implementation agents can write fixture-backed tests without guessing business semantics.
4. If the business chooses replacement/de-scope instead of live provider integration, add a source-controlled decision naming the replacement behavior, runtime readiness change, and workbook target status before changing the workbook.
5. `bun run parity:source-fixtures:verify` must pass before claiming D1.2 repo-side evidence control is current.
6. `bun run parity:decision-queue:verify -- --expect-rows=7` must continue to pass while these rows remain queued or blocked.

## Current D1.2 Decision

Repo-side source fixture/contract controls are now explicit and verifiable. Actual vendor contracts, fixtures, finance policy, and Service Mobile field UAT result are not present in repo materials, so the external queue remains blocked for owner action rather than shipped as complete provider evidence.
