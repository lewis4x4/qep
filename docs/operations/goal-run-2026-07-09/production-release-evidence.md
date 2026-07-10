# Actionable Work Goal Run — Production Release Evidence

Date: 2026-07-09

Production project: `iciddijgonywtxoelous`

Technical release verdict: **PASS**

Waivers: **none**

## Release Outcome

- Production migrations 810, 811, 812, 813, and 814 are applied; the final migration dry run reports zero pending versions.
- Migration 814 was corrected after its first atomic production attempt encountered `crm_contacts` as a writable view. The final migration safely indexes the physical `qrm_contacts` backing table, and the post-hotfix gate is green.
- Deployment verification found all 76 required Edge functions present and freshly deployed, with a maximum observed age of 4.56 minutes. The touched set included `customer-dna-update`, `customer-profile`, `decision-room-voice-chunk`, `dge-refresh-worker`, `handoff-trust-scorer`, `health-score-refresh`, `oem-price-feeds`, `publish-price-sheet`, `quote-builder-v2`, `rental-billing-runner`, and `service-parts-planner`, plus every transitive shared-auth consumer.
- Production-shaped rental/service, A7, and DNA acceptance artifacts are PASS. Rental/service cleanup completed without warnings; DNA cleanup completed without errors; A7 removed transient fixtures and retained only its required disabled/dismissed append-only provenance chain.
- A7.2 and A7.3 remain blocked. The release proves the production-shaped fixture contract and does not claim real OEM PDF/Excel ingestion.
- After gates and production acceptance passed, live roadmap rows A7.4, A7.5, A7.6, A7.7, and A7.9 moved to `shipped`; after the final evidence-link correction, their Linear mirrors reported `synced` in the 2026-07-10 02:35:58–02:35:59Z verification window. A7.2/A7.3, gated B2.5, and held N8.1 were left unchanged.

## Deterministic Gate Artifacts

| Slice | Final artifact | Verdict |
| --- | --- | --- |
| Actionable scope reconciliation | `test-results/agent-gates/20260710T012006Z-actionable-scope-reconciliation.json` | PASS |
| Rental multi-return money | `test-results/agent-gates/20260710T012258Z-rb-multi-return-money-correctness.json` | PASS |
| Service re-plan PO idempotency | `test-results/agent-gates/20260710T012530Z-sp-replan-po-idempotency.json` | PASS |
| Rental billing runner scale | `test-results/agent-gates/20260710T012815Z-rb-billing-runner-scale.json` | PASS |
| A7 true price diff | `test-results/agent-gates/20260710T013101Z-a7-true-price-diff.json` | PASS |
| A7 open-quote impact | `test-results/agent-gates/20260710T013642Z-a7-open-quote-impact-hardening.json` | PASS, UI + chaos |
| A7 rep impact UX | `test-results/agent-gates/20260710T013934Z-a7-rep-price-impact-ux.json` | PASS, UI + chaos |
| A7 atomic apply/audit/reversal | `test-results/agent-gates/20260710T014533Z-a7-reprice-apply-audit-reversal.json` | PASS, UI + chaos |
| Quote Builder decomposition | `test-results/agent-gates/20260710T014827Z-qb-orchestrator-chunk-decomposition.json` | PASS, UI + chaos |
| DNA service-role auth, pre-deploy | `test-results/agent-gates/20260710T013343Z-dna-service-role-auth.json` | PASS |
| DNA service-role auth, post-hotfix | `test-results/agent-gates/20260710T020738Z-dna-service-role-auth.json` | PASS, superseding release artifact |

The failed A7 artifact `test-results/agent-gates/20260710T014207Z-a7-reprice-apply-audit-reversal.json` is retained for transparency. Its only blocking check was an unrelated knowledge-base integration upload returning HTTP 503; the subsequent complete 15/15 rerun passed without a waiver.

## Production Acceptance Artifacts

- Rental/service: `test-results/agent-gates/rental-service-production-acceptance-2026-07-09.json` — PASS; exact $305.00 multi-return money, 501-contract bounded fleet, replay, poison isolation, service concurrency/replay/changed demand, cleanup complete.
- A7: `test-results/agent-gates/a7-production-acceptance-2026-07-09.json` — PASS; preview, publish, persisted scan, rep impact, governed approval, canonical apply, dollar-for-dollar reversal, no-send, transient cleanup, and retained immutable chain.
- DNA: `test-results/agent-gates/dna-20260710021818-ba5bd3c4-dna-service-role-auth-production.json` — PASS; 33 checks passed, zero failed, cleanup passed, and the one unavailable internal-secret live mode is explicitly marked SKIP and covered by focused endpoint tests.

## Specialist Verdicts

- QA — PASS: the independent focused release matrix passed 236/236 non-DNA tests; DNA passed 89/89; migration 814 passed 10/10 behavior tests (81 assertions); DGE passed 20/20; the Edge registry audit passed 208/208.
- Chief Design Officer — PASS: every required A7 and Quote Builder UI gate passed blocking desktop/mobile/accessibility review with zero console errors. Local browser QA covered 375, 768, 1024, and 1440 px.
- Testing/Simulation — PASS: every logic/API/state slice ran chaos. The documentation-only scope reconciliation gate intentionally omitted chaos and required no waiver.
- Security — PASS: modern service bearer/`apikey`, ES256 role boundaries, cross-workspace failure, RLS, lease ownership, no-send, assignment, and server-authoritative price checks passed. Independent review reported no P0, P1, or P2 findings.
- Migration — PASS: migration ordering was validated across 812 files ending at version 814; the migration/RLS audits passed; the production-view hotfix received an independent review with no P0, P1, or P2 findings; production has zero pending migrations.
- Performance — PASS: the 501-contract rental cohort completed through bounded resumes; the web production build completed over 4,582 modules; and all 615 non-exempt route chunks passed the 150,000-byte cap.
- Release — PASS: required final artifacts are green, touched functions are fresh, production-shaped fixtures passed, and cleanup is explicit. No waiver is active.
- Roadmap/ticket alignment — PASS: the five fixture-developed A7 rows are shipped and synced; protected blocked/gated/held rows were not promoted.

## Bundle Evidence

- Quote Builder baseline: 495,224 raw / 131,858 gzip bytes.
- Quote Builder release: 144,319 raw / 45,827 gzip bytes.
- Reduction: 350,905 raw bytes (70.86%).
- The Quote Builder route exemption was removed without a replacement. Its 144,319-byte route is below the 150,000-byte normal cap.
- The main index bundle is 214,257 bytes against a 306,942-byte cap; 615 non-exempt chunks pass, with 10 unrelated existing exemptions.

## Mission Alignment By Slice

| Slice | Verdict and concrete mission evidence | Residual risk |
| --- | --- | --- |
| Scope reconciliation | PASS — roadmap owners and autonomous agents received an honest fixture-versus-real-ingestion boundary, preventing blocked OEM/Omi work from being falsely promoted. Live rows, Linear mirror state, and the roadmap audit were exercised. | Explanatory notes can drift; final closure must re-query live state. |
| Rental multi-return money | PASS — rental/finance operators received an exact final invoice from all eligible unit returns; the $305.00 fixture and zero-add replay protect current revenue. | Fixture tax was zero; jurisdiction tax remains in the established tax path. |
| Service PO idempotency | PASS — service/parts operators received one active vendor commitment under concurrent and repeated plans; changed demand retired and superseded the prior PO. | External vendor acknowledgement timing remains an operational integration risk. |
| Rental runner scale | PASS — rental billing can move beyond 500 contracts through bounded resumes; 501 contracts completed and one poison record did not stop later invoices. | Throughput varies with future fleet and dependency latency; run telemetry remains required. |
| A7 true diff | PASS — pricing operators received canonical, brand-safe equipment price-change classification and deterministic replay. | Real OEM samples/parser work remains blocked under A7.2/A7.3. |
| A7 quote impact | PASS — sales reps/managers received material, brand-correct exposure while active locks, yard stock, and quiet boundaries protected deals and margin. | Production proof is fixture-driven until real ingestion is available. |
| A7 rep UX | PASS — assigned reps can move from Today impact to the governed quote review without implying auto-send or final commission truth; four responsive sizes and accessibility were checked. | Local browser latency is not production RUM; commission remains projected. |
| A7 apply/audit/reversal | PASS — reps submit and managers authorize a server-calculated price change; apply/reversal were idempotent, dollar-exact, immutable, and sent nothing to the customer. | The retained disabled/dismissed audit chain is intentional production evidence. |
| Quote Builder decomposition | PASS — mobile field reps receive a 70.86% smaller initial route while desktop/mobile workflow state remains intact. | Interaction timings are local smoke evidence; production RUM remains the latency authority. |
| DNA service auth | PASS — scheduled customer intelligence can refresh an explicit tenant without a human page while rep, invalid-secret, cross-workspace, RLS, and stale-lease paths fail safely. | Internal-service-secret was not live-tested because its value was unavailable; focused endpoint tests cover it. Legacy ambiguous profiles fail closed. |

## Known Remaining Boundaries

- A7.2 and A7.3 remain blocked on NDA/sample sheets; D3.13 and D3.14 remain blocked. No real OEM file-parser claim is included.
- B2.5 remains gated on B3.1, and N8.1 remains on its explicit `NEEDS BRIAN` hold.
- Production's pre-existing new-user profile provisioning cycle can leave a newly created auth user without an application profile. Acceptance used existing scoped principals where needed; this release did not broaden into that unrelated defect.
- The DNA internal-service-secret value was unavailable locally, so that live credential mode is a disclosed SKIP, not a waiver.
