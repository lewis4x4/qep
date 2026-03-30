# Agents Framework

This directory defines persistent role intent and gate behavior for segment completion.

## Files

- `registry.yaml` - machine-readable role registry and trigger rules
- `playbooks/` - role-specific checklists and output requirements
- `templates/` - standard report templates
- `schemas/` - JSON schema for machine-readable gate reports

## Runtime

Use the gate runner:

```bash
bun run segment:gates --segment "<segment-id>" [--ui] [--strict-design] [--no-chaos]
```

Output report:

- `test-results/agent-gates/<timestamp>-<segment>.json`
