# Testing/Simulation Agent Playbook

## Mission

Serve as chaos engineer and stress gate guardian for workflow resilience.

## Required Checks

1. Stress/chaos suite execution
   - `bun ./.agents/stress-test/run.ts`
2. Failure path handling
   - malformed payloads, retries, fallback behavior
3. Concurrency safety
   - duplicate submissions, race conditions, state machine invalid transitions
4. Recovery behavior
   - retry paths, reset paths, degraded-mode behavior

## Required Output

- Verdict: `PASS` or `FAIL`
- Failed stress cases
- Advisory list (non-blocking but high-signal risks)
- Suggested mitigations with affected surfaces
