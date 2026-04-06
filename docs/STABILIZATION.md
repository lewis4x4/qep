# QEP OS — Stabilization Punch List

**Created:** 2026-04-06 (Wave 5/6 v2 Phase 1 stabilization gate)
**Owner:** Brian Lewis (Speedy)
**Scope:** Lock down everything migrations 150–159 + Wave 6 frontend shipped before stacking Phase 2+ on top.

This is the live punch list for the v2 roadmap stabilization gate. Items are graded P0/P1/P2 with assigned phase for resolution.

## Build gate snapshot

| Check | Status |
|-------|--------|
| `bun run migrations:check` | ✅ 159 files, sequence 001..159 |
| `bun run build` (root) | ✅ green |
| `bun run build` (apps/web) | ✅ green |
| Latest commits pushed | ✅ `9bbc62d` (sop workspace hardening) on main |

## Workspace-isolation audit (continuation of mig 159 work)

Migration 159 closed the SOP workspace leaks. The same hardcode pattern (`workspace_id: "default"`) exists in 9 more edge functions, 14+ insert/RPC sites. Most are dormant in single-tenant production but become active leaks the moment a second workspace exists.

| File | Sites | Severity | Resolution phase |
|------|-------|----------|------------------|
| `supabase/functions/pipeline-enforcer/index.ts` | L88, L110, L164, L217 | **P1** — notification inserts ignore deal's actual workspace | Phase 2C (Wave 5C closeout) |
| `supabase/functions/deal-timing-scan/index.ts` | L64 (RPC), L78 (RPC), L111 (notification) | **P1** — cron RPC parameter is hardcoded; non-default workspaces never get scanned | Phase 2C |
| `supabase/functions/health-score-refresh/index.ts` | L100 (RPC) | **P1** — cron RPC parameter hardcoded; non-default workspaces never get health refresh | Phase 2C |
| `supabase/functions/portal-api/index.ts` | L703 (notification) | **P2** — staff notification on portal action; default workspace only | Phase 2D |
| `supabase/functions/price-file-import/index.ts` | L118 | **P1** — catalog import hardcodes workspace | Phase 2B (Wave 5B.1 closeout) |
| `supabase/functions/anomaly-scan/index.ts` | L162 | **P2** — alert insert hardcoded | Phase 2C |
| `supabase/functions/deposit-calculator/index.ts` | L150 | **P2** — Iron Woman notification hardcoded | Phase 2C |
| `supabase/functions/chat/index.ts` | L2316 | **P2** — `knowledge_gaps` insert hardcoded | Phase 6 cross-cutting |
| `supabase/functions/demo-manager/index.ts` | L149 | **P2 → P3** — demo seeding only | n/a (demo only) |

**Standard fix pattern** (apply per file):
1. After auth, fetch `profiles.workspace_id` for the caller (`supabaseAdmin.from('profiles').select('workspace_id').eq('id', userId).single()`).
2. Use the fetched workspace in every insert / RPC call, fall back to `'default'` only if profile lookup fails.
3. For cron-only paths (no caller user), iterate distinct workspaces: `select distinct workspace_id from profiles where workspace_id is not null` and run the operation per workspace.

## Edge function consistency

| File | Issue | Severity | Resolution |
|------|-------|----------|------------|
| `supabase/functions/anomaly-scan/index.ts` L15-26 | Custom `corsHeaders()` instead of `_shared/safe-cors.ts` `safeCorsHeaders` | P2 | Phase 6 cross-cutting consistency pass |

All other recently-touched edge functions use the shared CORS helper correctly.

## Frontend post-Wave-6 (already addressed)

Items resolved during the post-build audits in commits `d62d8b3` and `9bbc62d`:
- ✅ Role gates added to `/sop/templates`, `/sop/templates/:id`, `/sop/executions/:id`, `/email-drafts`, `/dge/cockpit`
- ✅ Dead code removed from `fetchExecutionContext` skips re-query
- ✅ `EmailDraftInboxPage` mutation `onError` handlers + visible error banner
- ✅ `sop_compliance_summary` view set to `security_invoker = true`
- ✅ SOP table workspace defaults switched to `public.get_my_workspace()`
- ✅ `sop-ingest` workspace hardcodes replaced with profile-fetched value

## RLS contract test gaps

No automated RLS contract tests exist for the recently-added tables. Add light-weight tests in Phase 2 alongside the closeout work, since each closeout phase touches the corresponding tables anyway.

| Table | Required test | Phase to add |
|-------|---------------|--------------|
| `sop_compliance_summary` view | tenant_a row hidden from tenant_b user | Phase 2E |
| `email_drafts` | tenant_a draft hidden from tenant_b | Phase 2D |
| `equipment_documents` | portal customer A cannot see customer B's docs | Phase 2D |
| `ar_credit_blocks` | non-manager cannot insert override row | Phase 2C |
| `cross_department_alerts` | workspace isolation enforced | Phase 2C |
| `manufacturer_incentives` | rep cannot insert/update; manager can | Phase 2A |

## Phase 4 prerequisites

| Prereq | Status | Action |
|--------|--------|--------|
| PostGIS extension enabled | ❌ NOT enabled (no `create extension postgis` in any migration) | Add `create extension if not exists postgis with schema extensions;` at top of migration 163. Verify `select extname from pg_extension where extname = 'postgis';` returns a row before applying 163. |
| Mapbox API token in env | ⚠️ Unverified | Confirm `VITE_MAPBOX_TOKEN` set in Netlify before Phase 4 frontend work |

## Tax-mode contract — blocking Phase 2A

Phase 2A cannot start until Brian confirms the five tax-mode contract points (see plan §"Open decisions blocking start"). Default assumptions if no input by Phase 2 start:
1. Mode = **estimate**
2. Source precedence = **branch > delivery > customer billing**
3. Override = rep reason + audit; manager approval required for ±2% deviation
4. Stale-cache window = **30 days** per jurisdiction
5. Disclaimer = standard "estimates only — consult tax professional for filing" footer, version `v1`

These defaults ship UNLESS Brian explicitly overrides.

## Phase 1 exit criterion

✅ All P0 issues resolved (none open from this audit)
⬜ All P1 issues triaged with assigned resolution phase (above table)
✅ Build gate green
✅ This punch list exists and is maintained

**Phase 1 status: COMPLETE.** Phase 2A blocked on tax-mode contract decision; Phases 1 → 3+ can proceed in parallel since Phase 3 (Track A) has no Phase 2 dependency for primitives + Asset 360 + AskIronAdvisor button drops.
