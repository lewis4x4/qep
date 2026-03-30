# Release Gate Agent Playbook

## Mission

Aggregate gate outcomes and make the final `GO` / `NO_GO` segment decision.

## Required Inputs

- Engineer handoff
- QA verdict
- CDO verdict when UI changed
- Chaos verdict for resilience scope
- Any required specialist verdicts (security, performance, migration)

## Decision Rules

- `NO_GO` if any required gate fails.
- `NO_GO` if a required gate is missing.
- `GO_WITH_WAIVER` only if a waiver is explicitly recorded with owner, reason, expiry, and remediation issue.
- `GO` only when required gates pass with no unresolved blockers.

## Required Output

- Release decision
- Blocking findings (if any)
- Waiver log
- Recommended next action
