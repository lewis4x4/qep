# QA-A1.1 Manual Staging QA Pass Sign-Off

Roadmap item: A1.1 / QEP-1
Source evidence: `docs/operations/IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md` §3.3 and gate `test-results/agent-gates/20260521T040155Z-A1.1-manual-staging-qa-regression.json`
Status: unsigned. Engineering regression evidence is shipped; final unblock requires human staging browser walkthrough and sign-off.

Owner: Rylee McKenzie + architect.
Required before: unblocking roadmap items that depend on A1.1 staging acceptance, including quote-builder hardening and downstream quote launch gates.

## Decision Record

Staging URL:
Staging account / role used:
Test quote / customer used:
Meeting date:
Attendees:
Signed by:
Signed at:

## Preconditions

- Regression gate artifact exists and passed: `test-results/agent-gates/20260521T040155Z-A1.1-manual-staging-qa-regression.json`.
- Quote builder is tested with staging data, not local-only fixtures.
- The reviewer has permission to create/edit quote packages, trigger approval paths, and view generated proposal/PDF surfaces.

## Required Walkthrough

Mark each item pass/fail and attach screenshot or PDF evidence where relevant.

| # | Scenario | Expected result | Evidence link / notes | Pass |
|---|---|---|---|---|
| 1 | Florida delivery quote with taxable customer | State tax equals `(subtotal - trade) * 0.06` | | |
| 2 | Columbia County delivery quote | County surtax is capped at `$5,000 * 1.5% = $75.00` | | |
| 3 | Tax-exempt customer with valid certificate | Tax amount is `$0.00` and customer-facing proposal/PDF shows Tax Exempt badge | | |
| 4 | Margin-floor approval trigger | Manager approval is required and lane/reason are visible | | |
| 5 | Trade-max approval trigger | Manager approval is required and lane/reason are visible | | |
| 6 | Rep-discount-cap approval trigger | Manager approval is required and lane/reason are visible | | |
| 7 | Flagged-line approval trigger | Manager approval is required and lane/reason are visible | | |
| 8 | Manager outcome: approve | Quote returns to sendable/accepted route without data loss | | |
| 9 | Manager outcome: approve with edits | Edits are visible and audited; quote continues through approved route | | |
| 10 | Manager outcome: reject | Quote is blocked from customer send/acceptance | | |
| 11 | Manager outcome: reject with comments | Rejection comments are visible to the rep and quote remains blocked | | |
| 12 | Payment math surfaces | TILA/disclaimer copy appears anywhere payment math is shown | | |
| 13 | Mobile browser pass | Primary quote workflow is usable at mobile width without hidden blocking controls | | |
| 14 | Desktop browser pass | Primary quote workflow is usable at desktop width without layout breakage | | |

## Sign-Off Decision

Decision: `pass` / `pass with exceptions` / `fail`

Exceptions or defects filed:

1.
2.
3.

## Completion Rule

A1.1 can move from `blocked` to `shipped` only when this file is completed with reviewer names, dated evidence, and a `pass` or explicitly accepted `pass with exceptions` decision. If the decision is `fail`, leave A1.1 blocked and link the remediation issue(s).
