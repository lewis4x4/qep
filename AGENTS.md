# QEP Agent Operating System

This file is the source of truth for post-segment gate execution and agent role boundaries.

## Mission Statement (Hard Gate)

Every agent decision is subordinate to this mission statement:

> "Create a Moonshot Application That is built around an equipment and parts, sales and rental For the employees, salesman, company corporate operations and management. Your sole function is to identify, design, and pressure-test transformational AI application ideas that are not fully possible today but will be unlocked by superintelligence."

Operational rule: any gate may block a segment if mission alignment is weak, even if technical checks pass.

## Goal

After each engineering segment is completed, run a deterministic multi-agent quality chain so no segment advances without spec, UX, and resilience validation.

## Required Gate Chain

1. `Engineer` completes the segment and produces a handoff artifact.
2. `QA Agent` runs acceptance, edge-case, regression, and cross-device checks.
3. `Chief Design Officer Agent` runs for any externally visible UI/design changes.
4. `Testing/Simulation Agent` runs stress and chaos scenarios.
5. Optional specialist gates (security, performance, migration) run based on changed surface and risk.

No segment is marked complete until required gates pass or an explicit waiver is recorded.

Each gate report must include a `mission_alignment` verdict with concrete evidence.

## Agent Registry

Machine-readable role definitions live at:

- `agents/registry.yaml`

Human playbooks live at:

- `agents/playbooks/*.md`

Standard output contract:

- `agents/schemas/gate-report.schema.json`

## Trigger Rules

- `QA Agent`: required for every segment.
- `Chief Design Officer Agent`: required when UI/UX-facing files changed.
- `Testing/Simulation Agent`: required for every segment touching app logic, API handlers, state machines, or integration behavior.
- `Security Agent`: required when auth, RLS, credentials, or workspace scoping changed.
- `Migration Agent`: required when `supabase/migrations/*` changed.
- `Performance Agent`: required when bundle shape, expensive queries, or rendering-critical surfaces changed.

## Execution

Run the gate orchestrator:

```bash
bun run segment:gates --segment "<segment-id>" [--ui] [--no-chaos] [--strict-design]
```

Examples:

```bash
bun run segment:gates --segment wave1-integration-hardening --ui
bun run segment:gates --segment wave2-crm-contacts --ui --strict-design
bun run segment:gates --segment wave3-crm-pipeline --no-chaos
```

Artifacts are written to:

- `test-results/agent-gates/<timestamp>-<segment>.json`

## Policy

- Required gates failing means the segment is blocked.
- A waived gate must include:
  - owner
  - reason
  - expiration date
  - linked remediation issue
- Gate outputs must be attached to the segment ticket before status moves to done.
