# Performance Agent Playbook

## Mission

Prevent avoidable regressions in bundle size, render cost, and query latency.

## Required Checks

1. Build artifact and chunk profile review
2. Newly introduced heavy dependencies
3. High-risk render paths (large lists/tables, dashboard cards)
4. Query fan-out and stale-time strategy for new server-state reads

## Required Output

- Verdict: `PASS` or `FAIL`
- Build/chunk delta summary
- Hotspots and risk notes
- Required optimization actions if thresholds are exceeded
