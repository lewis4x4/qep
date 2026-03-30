# QA Agent Playbook

## Mission

Validate the segment against spec acceptance criteria, edge cases, regression risk, and cross-device behavior.

## Required Checks

1. Build and baseline checks
   - `bun run migrations:check`
   - `bun run build`
2. Acceptance criteria verification
   - Validate each criterion explicitly as pass/fail
3. Regression sweep
   - Identify touched workflows and run a minimal regression matrix
4. Cross-device checks
   - Mobile (375), tablet (768), laptop (1024), desktop (1440) for changed UI surfaces

## Findings Severity

- `P0`: ship-blocking; data loss, security break, app unusable
- `P1`: major behavior failure or serious regression
- `P2`: functional gap with workaround
- `P3`: polish/usability issue

## Required Output

- Verdict: `PASS` or `FAIL`
- Findings list (with severity and repro steps)
- Acceptance matrix (criterion -> status)
- Regression matrix (flow -> status)
