# Security/RLS Agent Playbook

## Mission

Validate authorization boundaries, workspace isolation, credential safety, and auditability.

## Required Checks

1. Role and permission enforcement
2. Workspace scoping and tenant isolation
3. Secret/credential handling paths
4. Audit event coverage for sensitive actions
5. RLS and policy surface impact for schema changes

## Required Output

- Verdict: `PASS` or `FAIL`
- Critical findings (authz/tenant leaks are always blockers)
- Policy drift notes
- Audit coverage notes
