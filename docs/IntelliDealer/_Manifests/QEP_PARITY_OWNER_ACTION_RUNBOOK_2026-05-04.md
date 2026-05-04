# QEP Parity Owner Action Runbook

Date: 2026-05-04
Source workbook: `QEP_Parity_Worksheet.xlsx`
Queue: `QEP_PARITY_EXTERNAL_DECISION_QUEUE_2026-05-04.md`

## Purpose

This runbook converts the remaining parity workbook blockers into owner-executable decisions and evidence requests. It does not close any workbook row by itself.

Rows may move only when the linked Linear issue has one of these artifacts:

1. Live implementation evidence, credentials, fixtures, and verification output; or
2. Source-controlled replacement/de-scope decision naming the approved QEP replacement behavior.

## Current blocker inventory

| Linear | Workbook status | Rows governed | Owner action required | Workbook target after evidence |
| --- | --- | ---: | --- | --- |
| `JAR-103` | `GAP` | 1 | Finance policy approval or external-process de-scope | `BUILT` after atomic reversal build, or `N_A` if de-scoped |
| `JAR-104` | `GAP` | 4 | JD scope/API/fixture decision or JD de-scope | `BUILT` after live JD build, or `N_A` if de-scoped |
| `JAR-105` | `PARTIAL` | 2 | Bobcat/Vermeer sample/API fixture package or de-scope | `BUILT` after parser/import build, or `N_A` if de-scoped |
| `JAR-106` | `PARTIAL` | 3 | VESign live-provider decision or native-signing replacement | `BUILT` after live VESign build, or `N_A` if replaced |
| `JAR-107` | `PARTIAL` | 3 | Tethr live-provider decision or generic-telematics replacement | `BUILT` after live Tethr build, or `N_A` if replaced |
| `JAR-108` | `PARTIAL` | 1 | Completed technician field UAT evidence | `BUILT` after passing UAT evidence |
| `JAR-109` | `PARTIAL` | 1 | IronGuides live feed decision or valuation replacement | `BUILT` after live feed, or `N_A` if replaced |

## Owner decision forms

### JAR-103 — Equipment sale reversal by stock number

Owner required: finance/accounting.

Decision required:

- Are equipment sale reversals by stock number a QEP runtime requirement?
- If yes, approve exact behavior for:
  - unpaid invoices
  - partially paid invoices
  - fully paid invoices
  - QuickBooks/GL-posted invoices
  - closed accounting periods
  - tax reversal source of truth
  - credit memo / AR document model
  - equipment status after reversal
  - rental invoice branch inclusion or exclusion
  - authorization roles, reason codes, audit payload, and idempotency
- If no, approve an external-process de-scope decision and name the replacement process.

Builder handoff after approval:

- Build atomic privileged reversal RPC and edge mutation.
- Wire confirmation UI from the existing readiness card.
- Add regression tests for each approved policy branch.

Required artifact to attach to `JAR-103`:

- Finance policy decision signed/approved by owner, or source-controlled de-scope decision.

### JAR-104 — JD Quote II / JD PO / JD Proactive Jobs

Owner required: JD business/product owner.

Decision required:

- Is this deployment a JD-affiliated dealer workflow?
- Is JD Quote II upload required?
- Is accepted JD Quote II PO intake required?
- Is JD Proactive Jobs required as API integration, deep link, credential-vault launch, or non-requirement?
- Provide authorized API/SSO/XML/PDF contract and sandbox fixtures, or approve de-scope.

Builder handoff after approval:

- Build JD upload run ledger, adapter/function, Prospect Board upload action, accepted PO intake, Proactive Jobs action, authorization, retry/error states, and fixture tests.

Required artifact to attach to `JAR-104`:

- JD contract/fixture package, or source-controlled non-requirement/replacement decision.

### JAR-105 — Bobcat / Vermeer Base & Options imports

Owner required: OEM catalog/import owner.

Decision required:

- Are Bobcat and Vermeer imports file-based or API-based?
- Provide sample files/API docs for both OEMs.
- Approve canonical mapping into `equipment_base_codes`, `equipment_options`, and `equipment_base_codes_import_runs`.
- Define pricing/cost/effective-date/supersession/delete/deactivate semantics.
- Approve quote-builder catalog bridge or confirm canonical tables are the source of truth.

Builder handoff after fixture package:

- Build Bobcat and Vermeer parser/adapters, import execution UI, idempotent canonical writes, run counts, error reporting, and fixture-backed tests.

Required artifact to attach to `JAR-105`:

- OEM sample/API fixture package plus mapping decision, or source-controlled de-scope decision.

### JAR-106 — VESign provider integration

Owner required: legal/provider-signature owner.

Decision required:

- Is live VESign/VitalEdge signing required, or does native QEP signing replace it?
- If live, provide contract/API docs, sandbox credentials, sender identity, legal envelope policy, webhook secret, replay samples, and status vocabulary.
- If replaced, approve source-controlled native-signing replacement decision.

Builder handoff after approval:

- Live path: build VESign send/status/webhook adapter, envelope persistence, quote/invoice/rental mapping, UI actions, and replay tests.
- Replacement path: update runtime readiness and workbook target to `N_A` / replaced.

Required artifact to attach to `JAR-106`:

- VESign provider package, or native-signing replacement decision.

### JAR-107 — Tethr It Now actions

Owner required: telematics/provider owner.

Decision required:

- Is live Tethr required, or does QEP generic telematics replace it?
- If live, provide auth contract, webhook/API docs, sample payloads for hours/GPS/faults/device metadata, device-to-equipment mapping source, stale-data policy, and unknown-device policy.
- If replaced, approve source-controlled generic-telematics replacement decision.

Builder handoff after approval:

- Live path: build Tethr adapter/webhook/mapping, row-specific actions, stale/unknown handling, and fixture tests.
- Replacement path: update runtime readiness and workbook target to `N_A` / replaced.

Required artifact to attach to `JAR-107`:

- Tethr provider package, or generic-telematics replacement decision.

### JAR-108 — Service Mobile technician UAT

Owner required: technician, reviewer, scheduler.

Decision/evidence required:

- Schedule named production technician and reviewer.
- Execute updated checklist on target mobile hardware.
- Capture device, OS, browser, network, production account, screenshots/video or controlled evidence location.
- Test normal and degraded/intermittent network.
- Confirm no duplicate stage transitions and no data loss.
- Record blocker disposition.

Builder handoff after UAT:

- If pass: update workbook row to `BUILT` with evidence.
- If defects: create bug issues, fix defects, rerun UAT evidence loop.

Required artifact to attach to `JAR-108`:

- Completed UAT result template and evidence location.

### JAR-109 — IronGuides live feed or replacement

Owner required: valuation/business owner.

Decision required:

- Is live IronGuides required, or does QEP fallback/blended valuation replace it?
- If live, provide signed authorization, API/feed docs, auth method, payload fixtures, cadence/freshness rules, allowed fields, retention/privacy constraints, and credential owner.
- If replaced, approve source-controlled replacement decision.

Builder handoff after approval:

- Live path: build IronGuides adapter/importer, source/freshness tracking, live valuation wiring, and fixture tests.
- Replacement path: set `integration_status.config.lifecycle = replaced`, `external_dependency_required = false`, name replacement surface, and workbook target `N_A` / replaced.

Required artifact to attach to `JAR-109`:

- IronGuides provider package, or fallback/blended valuation replacement decision.

## Final verification after owners respond

Run:

```bash
bun run parity:closeout:status
bun run parity:open-rows -- --expect-open=0
bun run parity:workbook:verify
bun run parity:decision-queue:verify -- --expect-rows=7
bun run migrations:check
bun run wave5:provider:verify
bun run segment:gates --segment parity-closeout --ui
```

A final 100% claim is valid only after workbook `GAP` / `PARTIAL` rows are gone or explicitly replaced/de-scoped with source-controlled evidence.
