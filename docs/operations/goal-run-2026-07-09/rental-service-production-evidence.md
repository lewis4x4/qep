# Rental Billing And Service Parts — Production Evidence

Date: 2026-07-09

Production project: `iciddijgonywtxoelous`

Verdict: **PASS**

Evidence: `test-results/agent-gates/rental-service-production-acceptance-2026-07-09.json`

## Production Acceptance

### Rental money correctness

- The final invoice was exactly 30,500 cents ($305.00): 11,000 fuel, 3,300 cleaning, 15,000 customer-billable damage, and 1,200 other ancillary cents. Pending/non-billable damage remained excluded by the focused matrix.
- Replaying the completed run claimed zero contracts and left the invoice count at one, so no final charge was duplicated.
- The invoice retains the source-return evidence needed to explain the ancillary total.

### Rental fleet scale and recovery

- A production-shaped cohort of 501 contracts completed through 22 bounded HTTP requests and 21 resumes; no 500-contract ceiling remained.
- Three workers processed batches of 25 in 58,271 ms: 8.6 contracts/second with a 6,627 ms request p95.
- Replay claimed zero contracts and left the invoice count at 501.
- A poison contract (`clock_end_at precedes start_at`) produced one dead letter while two later contracts still invoiced. Replay added no invoices and preserved the truthful failed run state.

### Service-parts idempotency

- Two concurrent initial plans produced one purchase order/line; one caller created the action and the other returned an idempotent reuse.
- An unchanged replay created no action, purchase order, or line and reused the surviving action.
- Concurrent changed-demand planning produced one auditable replacement: the old demand was superseded, the old PO/line retired, and the surviving PO line has quantity 3 and demand version 2.
- The evidence therefore contains one active submitted vendor commitment for the requirement after both unchanged and changed-demand races.

## Gate Chain And Specialist Verdicts

- `RB-MULTI-RETURN-MONEY-CORRECTNESS` — PASS: `test-results/agent-gates/20260710T012258Z-rb-multi-return-money-correctness.json`.
- `SP-REPLAN-PO-IDEMPOTENCY` — PASS: `test-results/agent-gates/20260710T012530Z-sp-replan-po-idempotency.json`.
- `RB-BILLING-RUNNER-SCALE` — PASS: `test-results/agent-gates/20260710T012815Z-rb-billing-runner-scale.json`.
- QA: PASS; all required checks in each final artifact passed.
- Testing/Simulation: PASS; chaos ran for all three logic/state segments.
- Security: PASS; production acceptance was pinned to the verified project and workspace, and the final independent security review reported no P0, P1, or P2 finding.
- Migration: PASS; migrations 810 and 811 are applied in production and the final migration dry run has zero pending versions.
- Performance: PASS; the 501-contract fleet completed through bounded, resumable requests with measured throughput and poison isolation.
- Release: PASS; production acceptance and cleanup completed with no warnings.
- Waivers: none.

## Mission Alignment

### RB-MULTI-RETURN-MONEY-CORRECTNESS

- Verdict: PASS.
- Operator: rental and finance staff.
- Changed workflow/decision: the final invoice now uses every eligible unit return rather than allowing one selected return to understate what the customer owes.
- Evidence exercised: exact $305.00 ancillary composition, final-invoice replay, corrected/pending return rules in focused tests, workspace isolation, and retained source-return evidence.
- Residual risk: the production fixture used zero tax; jurisdiction-specific tax behavior remains governed by the existing billing/tax path rather than this return aggregation change.

### SP-REPLAN-PO-IDEMPOTENCY

- Verdict: PASS.
- Operator: service planners and parts buyers.
- Changed workflow/decision: repeated or concurrent replanning now converges on one active vendor commitment, while changed demand supersedes the prior commitment instead of duplicating it.
- Evidence exercised: simultaneous first plans, unchanged replay, simultaneous changed-demand plans, retired old PO/line, and surviving quantity/version.
- Residual risk: external vendor acknowledgement timing was outside the isolated fixture; production monitoring must still reconcile downstream acknowledgement failures.

### RB-BILLING-RUNNER-SCALE

- Verdict: PASS.
- Operator: rental billing and finance operations.
- Changed workflow/decision: fleets larger than 500 are processed through resumable bounded batches, and one malformed contract no longer hides later billable work.
- Evidence exercised: 501 contracts, 22 HTTP requests, 21 resumes, three workers, zero-add replay, one dead letter, and later-contract continuation.
- Residual risk: the recorded throughput is production-shaped acceptance evidence, not a guarantee for every future fleet or upstream latency profile; run telemetry remains the operational backstop.

## Cleanup And Reversal

- Fixture cleanup was attempted and completed with no warnings.
- Rollback must preserve existing invoice and purchase-order audit evidence. Reverting function behavior without first reconciling the new run-state/idempotency contracts would be unsafe.
