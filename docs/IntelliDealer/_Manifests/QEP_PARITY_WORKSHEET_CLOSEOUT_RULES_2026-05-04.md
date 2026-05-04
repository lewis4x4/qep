# QEP Parity Worksheet Closeout Rules

Date: 2026-05-04  
Workbook: `docs/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`  
Desktop copy: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`

## Purpose

This manifest freezes the rules for promoting remaining QEP parity worksheet rows after the 2026-05-04 evidence review.

The goal is to prevent false completion claims. A row may only move to a stronger status when the worksheet cites evidence that proves that specific behavior, provider, credential path, or business decision.

## Status Promotion Rules

| Status | Allowed meaning | Evidence required |
| --- | --- | --- |
| `BUILT` | The repo contains the implemented workflow, schema, UI/action path, and verification evidence for the row as written. | Source-controlled code or SQL, plus migration/test/gate/smoke evidence. Provider rows also require live adapter/config/webhook or equivalent provider verification evidence. |
| `PARTIAL` | Foundation exists, but a provider, credential, UAT, contract, live workflow, or end-to-end proof is missing. | Repo evidence for the completed foundation and explicit note of the missing proof. |
| `GAP` | No repo evidence proves the required workflow/action/field behavior. | Current worksheet row remains open until implementation or de-scope evidence exists. |
| `N_A` | The OCR item is not a product requirement, is UI chrome/navigation rather than a tab/action, or has been formally decommissioned/replaced. | Worksheet note must cite why the item is not required. Decommissioned/replaced rows require a signed/source-controlled decision artifact. |

`REVIEW` is not an allowed parity status after the 2026-05-04 review. New uncertainty must be represented as `PARTIAL` or `GAP` with the missing evidence stated plainly.

## Provider-Gated Completion Rule

Provider-gated rows must not be marked `BUILT` from schema, registry, mock, or demo-mode evidence alone.

The following remain provider-gated until live or explicitly de-scoped evidence exists:

- JD Quote II / JD PO workflows
- JD Proactive Jobs
- VESign provider integration and status sync
- Tethr provider actions
- Bobcat Base & Options import
- Vermeer Base & Options import
- OEM portal/provider imports
- AvaTax live wiring
- UPS WorldShip live wiring
- IronGuides live feed, unless formally retired in favor of fallback valuation

Provider-gated rows can close in one of two ways:

1. **Live implementation path** — adapter, credentials/config, fixtures or sandbox proof, webhook/poller where applicable, UI/action integration, and verification evidence exist.
2. **Product decision path** — a source-controlled decision artifact says the live provider workflow is no longer a QEP requirement and names the replacement surface or fallback behavior.

## Manual / External Proof Rule

Rows blocked by credentials, contracts, vendor access, or field UAT remain `PARTIAL` until there is explicit evidence.

Examples:

- VitalEdge/IntelliDealer API access: close only with live access proof or a decommission/replacement decision.
- HubSpot API key: close only with credentialed import/cutover proof or a decommission/replacement decision.
- Service Mobile technician UAT: close only with signed field UAT evidence on target devices.
- IronGuides contract: close only with contract/feed proof or a decommission/replacement decision.

## Current 2026-05-04 Residual Buckets

### GAP

- Prospect Board JD Quote II / JD PO workflows
- Equipment sale reversal by stock number

### PARTIAL

- VESign provider integration
- Tethr provider integration
- OEM Base & Options provider import workflows
- External/manual credentials, UAT, and contract items

## Verification Requirements Before Final 100% Claim

Run and archive evidence for:

```bash
bun run parity:open-rows -- --expect-open=0
bun run migrations:check
bun run wave5:provider:verify
bun run segment:gates --segment parity-closeout --ui
python3 .omx/tmp/parity-review/update_parity_workbook.py
bun run parity:workbook:verify
```

A final 100% claim is valid only when the worksheet has no remaining `GAP` or `PARTIAL` rows, except rows explicitly changed to `N_A` or closed-by-replacement with source-controlled decision evidence.
