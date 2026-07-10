# Segment Handoff — DNA-SERVICE-ROLE-AUTH

## Segment

- ID: `DNA-SERVICE-ROLE-AUTH`
- Ticket: local goal-run slice
- Engineer: Codex
- Date: 2026-07-09

## Summary

`customer-dna-update` now recognizes the canonical service-role credential paths without weakening ES256 staff authorization. Service automation must name a workspace in `x-workspace-id` or a typed request body; unsigned workspace claims inside a service bearer token are ignored. All profile/contact/company lookups are anchored to that tenant before the admin client may read or mutate DNA.

Migration 814 makes contact/profile identity creation atomic, replaces role-only customer-profile RLS with authoritative company/contact tenancy, removes authenticated profile/health mutations, makes refresh enqueue service-only, and binds claim completion to an unexpired lease token. `customer-profile` admin-client reads now reuse the same workspace resolver for staff and service callers. Scheduled health refresh discovers all distinct workspaces through one service-only JSON RPC and processes them independently.

## Acceptance Criteria Coverage

- Modern `sb_secret_` bearer callers: covered by shared-auth and endpoint tests.
- Modern `sb_secret_` `apikey` callers: covered by shared-auth and endpoint tests.
- Internal-service-secret callers: covered by shared-auth regression tests.
- Admin, manager, and owner: endpoint tests remain green.
- Rep: 403 with zero refresh mutations.
- Missing/invalid authentication: 401 with zero refresh mutations.
- Missing service workspace: 400 before mutation.
- Conflicting/cross-workspace target: 403 before mutation.
- Existing profile company anchors and legacy contact anchors are workspace-validated; cross-workspace fixture lookups fail.
- Existing non-null HubSpot/IntelliDealer identities cannot be overwritten by a conflicting refresh.
- Companyless contacts cannot adopt company-anchored profiles; ambiguous multi-workspace legacy links fail closed.
- Expired DGE jobs receive a fresh lease token; a stale worker cannot complete the reclaimed job.
- Workspace discovery preserves more than 1,000 distinct tenants without a PostgREST row cap.

## Changed Surface

- UI changed: no
- API/edge functions changed: yes — `customer-dna-update`, `customer-profile`, `dge-refresh-worker`, `health-score-refresh`, shared DGE auth/DNA modules
- Migrations changed: yes — migration 814
- Auth/credentials changed: yes — canonical service-role caller recognition
- Performance-sensitive paths changed: yes — scoped contact/company checks add indexed point lookups

## Commands Run

- Focused DNA/auth/worker/health/customer-profile Deno tests — 89 PASS, including two-workspace endpoint fixtures and >1,000 workspace discovery.
- Migration 814 contract plus ephemeral PostgreSQL behavior suite — 10 PASS, including concurrent creation, RLS isolation, identity rollback, service-only enqueue, lease expiry/reclaim, and stale-owner rejection.
- `bun run test:edge:dge` — 20 PASS.
- `deno check` for `customer-dna-update`, `customer-profile`, `health-score-refresh`, and `dge-refresh-worker` — PASS.
- `bun run audit:edges` — PASS, 208/208 functions registered.
- `git diff --check` — PASS at focused-check time.
- Final integrated gate, with chaos enabled — PASS (14 required checks passed, zero failed; the non-UI design gate was not required): `test-results/agent-gates/20260710T020738Z-dna-service-role-auth.json`.

## Production Deployment And Acceptance

- Production project: `iciddijgonywtxoelous`.
- Migrations 810–814 are current and a final dry run reported zero pending migrations.
- Migration 814 initially encountered the live schema's writable `crm_contacts` view. No partial 814 changes were committed. The migration now inspects `pg_catalog` relation kinds, indexes `crm_contacts` when it is a table, and indexes the physical `qrm_contacts` backing table when `crm_contacts` is the supported view. The production index `idx_qrm_contacts_workspace_dna_profile_active` was verified after apply.
- The post-hotfix migration contract models the production `crm_contacts` view over `qrm_contacts`; the final integrated gate above passed after this correction.
- The DNA function set (`customer-dna-update`, `customer-profile`, `dge-refresh-worker`, and `health-score-refresh`) and all transitive consumers of the shared authentication module were deployed after migration 814.
- Production acceptance — PASS: `test-results/agent-gates/dna-20260710021818-ba5bd3c4-dna-service-role-auth-production.json`.
- The production artifact records 33 PASS, zero FAIL, cleanup PASS, and one explicit SKIP. Modern `sb_secret_` bearer and `apikey` calls, manager ES256 access, assigned-rep read access, rep mutation denial, anonymous/malformed/wrong-secret denial, cross-workspace denial, RLS isolation, service workspace requirements, queue claim, stale-lease rejection, and valid completion all passed.
- The internal-service-secret live mode was SKIPPED because neither `INTERNAL_SERVICE_SECRET` nor `DGE_INTERNAL_SERVICE_SECRET` was available to the local acceptance process. Focused endpoint regressions cover that credential path. This is a disclosed coverage limitation, not a gate waiver.
- Fixture cleanup passed with no errors. The run created no authentication users and removed its companies, contacts, customer profiles, and refresh job.

## Security Verdict

- Current: PASS. Focused authorization tests, the post-hotfix integrated gate, and production-shaped acceptance are green.
- Credential comparison is not duplicated; `dge-auth` delegates to `_shared/cron-auth.ts`.
- ES256 staff tokens still use GoTrue validation. The change only short-circuits when a canonical service credential matches.
- Service credentials do not imply a default tenant. The target workspace must be supplied or derived and is reconciled before mutation.
- `customer_profiles_extended` predates a workspace column. Direct authenticated reads now require exactly one active same-workspace company/contact anchor; unanchored and ambiguously linked legacy rows are invisible.
- Direct authenticated inserts/updates/deletes and `compute_customer_health_score` execution are revoked. Service-only RPCs own those mutations.
- DGE completion requires the current, unexpired lease token. A missing, expired, reclaimed, or already-consumed lease produces a zero-row failure.

## Mission Alignment

- Verdict: PASS.
- Operator: scheduled customer-intelligence services plus admin/manager/owner users.
- Workflow/decision changed: a scheduled service can refresh the correct customer's cross-department DNA without opening a human page, while reps and cross-tenant callers remain blocked.
- Evidence exercised: modern bearer and `apikey` service credentials in production; elevated and rep ES256 roles; missing/conflicting tenants; two-workspace endpoint and RLS fixtures; more than 1,000 workspaces; concurrent identity creation; contact-link rollback; and expired/reclaimed worker ownership.
- Residual risk: the internal-service-secret mode was not exercised live because its value was unavailable locally, although focused endpoint tests cover it. Legacy unanchored or ambiguously cross-linked profiles also intentionally fail closed until repaired.

## Rollback / Reversal

- Migration 814 was deployed before the updated functions. The DNA function deployment set is `customer-dna-update`, `customer-profile`, `dge-refresh-worker`, and `health-score-refresh`.
- Rollback requires restoring the prior DGE RPC signatures and customer-profile policies/grants before redeploying old edge bundles; function-only rollback is unsafe after the lease-token contract changes.

## Release Verdict

- Current: PASS — integrated gate, deployment, production-shaped fixture acceptance, and cleanup are complete.
- Waivers: none.
