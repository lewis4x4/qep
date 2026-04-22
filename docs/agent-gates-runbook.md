# Agent Gates Runbook

## Purpose

Run deterministic post-segment quality gates with predefined role intent.

## Command

```bash
bun run segment:gates --segment "<segment-id>" [--ui] [--no-chaos] [--design-advisory]
```

## Options

- `--segment` (required practical use): segment identifier in report artifacts
- `--ui`: enable CDO design review gate
- `--no-chaos`: skip the stress/chaos gate
- `--design-advisory`: run design gate as non-blocking

## Outputs

- Machine-readable report in `test-results/agent-gates/*.json`
- Includes per-check command, status, duration, and captured output
- Streams each check live and prints a heartbeat while quiet commands are still running

## Default Checks

1. migration sequence validation
2. parts/service pressure matrix
3. edge-function auth audit
4. web production build
5. service-engine + vendor contract Deno tests
6. knowledge-base eval + integration + workspace isolation
7. chaos suite (unless disabled)
8. design review (only when `--ui`)

## Failure Semantics

- Required check failure => report verdict `FAIL` and non-zero exit.
- Skipped checks are recorded in report output.
