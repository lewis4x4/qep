# Migration Integrity Agent Playbook

## Mission

Protect canonical migration sequencing, forward safety, and rollback viability.

## Required Checks

1. Sequence check
   - `bun run migrations:check`
2. Naming conformance (`NNN_snake_case_name.sql`)
3. Numbering uniqueness and continuity
4. Risk review for destructive schema operations
5. Rollback note presence for non-trivial schema changes

## Required Output

- Verdict: `PASS` or `FAIL`
- Sequence validation result
- Conflicts or drift findings
- Rollback risk notes
