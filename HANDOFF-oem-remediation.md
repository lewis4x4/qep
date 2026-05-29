# HANDOFF — QEP OEM Price-Feed Code-Review Remediation (Phase 1)

**Status:** Code complete, on `main`, **awaiting deploy.** 7 commits. Verified against repo state on **2026-05-29**; not yet live on the remote Supabase project (`iciddijgonywtxoelous`).

**TL;DR for the deploy-capable operator:** `git push ≠ deploy`. Nothing in this wave is live yet. Apply migrations **623–628**, then deploy **3 edge functions** with `--no-verify-jwt`. Details below.

---

## Repo state (verified 2026-05-29)

| Claim | Verified? | Notes |
|---|---|---|
| 7 remediation commits on `main`, in sync with `origin/main` | ✅ | `aa8188e3 → cdf6b79a → 78c835da → 47b8b211 → bc99e5d2 → 7224c1d2 → f7c12b96`. Committed directly to `main` per repo convention (no PR/branch). |
| Migrations 623–628 present & committed | ✅ | `627_qep_oem_price_feed_wave.sql` is the OEM wave; `628_qb_quote_reprice_drafts_unique_active.sql` is the one-active-draft partial unique index. |
| 3 deployable edge functions present in committed main tree | ✅ | `supabase/functions/{oem-price-feeds, sync-roadmap-linear, sync-linear-to-roadmap}`. |
| `verify_jwt = false` for all 3 functions | ✅ | Confirmed in `supabase/config.toml`. They self-authenticate; deploy with `--no-verify-jwt`. |

### ⚠️ Uncommitted working-tree contents — DO NOT deploy

The working tree is **dirty** with two efforts that are **not** part of this remediation:

1. **Quote send-path / Rylee-pilot work** (the QRM Send Audit) — modified `supabase/functions/quote-builder-v2/index.ts`, `apps/web/.../quote-builder/{steps/ReviewStep.tsx, steps/SendStep.tsx, components/ReviewSendDialog.tsx, components/SendQuoteSection.tsx}` + their tests, and untracked `_shared/{m365-send-mail.ts, quote-email-template.ts, quote-send-pilot-policy.ts}`, `quote-builder-v2/quote-outlook-send.test.ts`, `ReviewStep.pilot-copy.test.ts`, and `docs/Service Department Docs/`. **Not committed. Track under its own Linear issue. Do not deploy.**
2. **`roadmap-linear-sync/`** — a separate, **untracked standalone tooling project** (its own `package.json`, `.github/workflows`, `scripts/`, and timestamp-named migrations). This is a parallel artifact and is **NOT** the deploy target. The functions to deploy are the ones in the **main** `supabase/functions/` tree.

Also untracked and irrelevant to deploy: `CODEBASE_MAP.md`, `prompt-exports/*`, `scratch/worktrees/*`.

---

## PART 1 — Deploy handoff

> Run **migrations first**, then deploy functions.

### 1. Migrations

| Migrations | State | Action |
|---|---|---|
| **623–628** | New this wave. `623` was also **edited in place** (security_invoker on `cc_safe_*` views + anchored owner-role regex). `628` is a new partial unique index. | **Apply.** First verify whether 623–627 were already hand-run in the SQL editor (their headers say so). If `schema_migrations` already lists `623`, the push will **skip it** and the in-place `623` edits won't land — in that case re-run 623's statements or fold them into a corrective migration. `628` applies cleanly. |
| **593, 595, 600, 601, 605, 607, 610, 612, 618, 621, 622** | Pre-existing, applied long ago; **edited in place** (the rls-initplan auth-wrapping in commit `47b8b211`). | ⚠️ **Editing applied files does NOT re-apply them.** The optimization is green in repo + CI but **not live** on remote. To make it live, apply the corrective migration **`629_rls_initplan_corrective_reapply.sql`** (now generated; `migrations:check` green — 29 idempotent `DROP`+`CREATE POLICY` statements reproducing the final wrapped form). **Validate on staging before prod.** No functional harm until then (policies are correct, just unoptimized). |

Apply via `bun run db:push:apply` (or `.github/workflows/apply-migrations.yml`, `confirm=APPLY`).

**Migration `629`** (rls-initplan corrective) is generated and passes `migrations:check` (sequence 001..629, no gaps). Apply it **after staging validation** — it `DROP`+`CREATE`s 29 policies to their init-plan-optimized form; behavior is identical (perf-only), but validate on staging first per the original commit's guidance.

### 2. Edge functions

Deploy all 3 with `--no-verify-jwt` (config has `verify_jwt = false`; they self-authenticate):

| Function | Notes | Required env / secrets |
|---|---|---|
| `oem-price-feeds` | Staged-publish + rep-impacts API (P0–P4 + freight). | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `sync-roadmap-linear` | ⚠️ **Now requires auth** (F1 fix). The Supabase DB webhook targeting it must send `Authorization: Bearer <SERVICE_ROLE_KEY>`, and the fn needs `SUPABASE_SERVICE_ROLE_KEY` (or `INTERNAL_SERVICE_SECRET`) set or it 401s. | `LINEAR_API_KEY`, `LINEAR_TEAM_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `sync-linear-to-roadmap` | New; HMAC-verified. | `LINEAR_WEBHOOK_SECRET`, `LINEAR_SYNC_USER_ID` |

```
supabase functions deploy oem-price-feeds        --no-verify-jwt
supabase functions deploy sync-roadmap-linear     --no-verify-jwt
supabase functions deploy sync-linear-to-roadmap  --no-verify-jwt
```

(Or the `deploy_edge_function` MCP with `verify_jwt: false`.)

> **Deploy-time footgun (project memory):** `verify_jwt` must be correct **at deploy time** — `config.toml` changes don't propagate to prod without a redeploy, and an `edge-auth-allowlist.json` can hide functions from the build. Confirm each function deployed with `verify_jwt=false`.

### 3. Post-deploy smoke checks

- `sync-roadmap-linear` → returns **401 without** the bearer; works from the configured webhook (with bearer).
- Publish a staged sheet → `/rep-impacts` shows **only active-event** impacts.
- A freight change appears in the review card.

### 4. CI gate not yet run

`bun run build` (full Vite bundle + `floor:validate-layouts`) was **not** run as a full bundle this wave — run it in CI before/with deploy. Constituent gates were verified individually (see Verification). Note: a local full build currently also compiles the uncommitted quote-send work above, so run the clean gate in CI against committed code.

---

## PART 2 — Linear handoff

**Epic:** QEP OEM Price-Feed — code-review remediation (Phase 1)
**Status:** Code complete, on `main`, awaiting deploy. 7 commits. Not yet live on remote.

### ✅ Done (issue → commit)

**Security (P0)**
- `sync-roadmap-linear` was an unauthenticated public write endpoint → added `isServiceRoleCaller` gate. — `aa8188e3`
- `cc_safe_*` views missing `security_invoker` (re-introduced advisor finding) → added. — migration `623`, `aa8188e3`

**Data integrity (P1) — `oem-price-feeds`**
- Rep-impact reads / draft / dismiss now inner-join the event and require `status='active'`; supersede now includes `'approved'` → stale/failed-event impacts no longer leak. — `aa8188e3`
- `requires_requote` clear no longer strips a flag another active event still owns. — `aa8188e3`

**Correctness (P2)**
- Skip null-old-price lines (no phantom full-price delta); materiality from non-stock-locked lines only (DP8); cost basis trusted only if every line has a cost; `parseStoredPercent` (a 1% margin floor no longer scales to 100%); `handleDraft`/`handleDismiss` state guards; one-active-draft-per-impact partial unique index. — migration `628`, `aa8188e3`

**Command Center (P2c)**
- Unanchored owner-role regex misrouting operator decisions → word-boundary match. — migration `623`, `aa8188e3`

**Idempotency / display (P3)**
- Truthful `itemsApplied`; idempotent re-publish excludes dismissed + counts changed-only; superseded re-publish → honest 409; full-precision materiality; preview quote cap 10→100; edge-function error bodies unwrapped (`lib/edge-error.ts`). — `aa8188e3`
- Preview-error Retry/Reject actions + "show N of M" + headline counts all change types. — `bc99e5d2`, `7224c1d2`
- Unified rep-impacts React Query key across 3 views (`lib/queryKeys.ts`) → no cross-view staleness / triple-poll. — `78c835da`

**Scale / perf (P4)**
- Paginated quote/model/line + rep-impacts scans (removed silent `.limit()` truncation); batched `persistEvent` writes; parallel `buildPreview`. — `cdf6b79a`

**RLS perf (pre-existing debt)**
- Wrapped 31 raw `auth.uid()`/`get_my_*()` calls across 11 policy migrations (`audit:rls-initplan` gate now green). — `47b8b211` — **but see To-do #2: not live on remote.**

**Cleanup (P5)**
- Retired legacy price-file client lane (deleted `PriceFileUpload` + deprecated `price-intelligence-api` exports). — `bc99e5d2`
- Removed dead publish wrappers (`retryPublish`, `publishSheetAndCreateImpacts`). — `f7c12b96`

**Feature (P2b)**
- OEM freight changes now visible in the publish preview (catalog-level). — `7224c1d2`

### 🧭 Decisions recorded

- **P2b per-quote scope:** per-quote auto-impact stays **list-price only** (aligns with OEM-DP1 one-tap). Freight/rebate/incentive → catalog visibility + manager review (OEM-DP9), **not** fabricated per-quote dollar deltas.
- **No auto-sync** `qb_programs` → `manufacturer_incentives` (deliberately separate systems; avoids unvalidated money-math + surprising business behavior).
- **`623` edited in place** (verify remote applied-state at deploy).

### 📋 To-do (new issues)

1. **DEPLOY** migrations 623–628 + the 3 edge functions (Part 1). **Blocks everything taking effect.** *(External dependency — requires Supabase access; prod deploy is irreversible and human-authorized.)*
2. **rls-initplan corrective migration** — ✅ **generated** as `629_rls_initplan_corrective_reapply.sql` (29 policies; `migrations:check` green). Still **needs staging validation + deploy** before the optimization is live on remote. Verified this session: covers every policy changed in `47b8b211` across all 11 files (line math reconciles to +50/−50; `601` re-hardens the same `593`/`595` policies and is covered).
3. *(Optional)* Give rebate/incentive the same catalog-visibility display freight now has.
4. *(Optional, low priority)* Delete the dead client diff engine in `sheet-diff-api.ts` (`generateSheetDiff`/`getInFlightImpact` + its test file) + consolidate duplicated formatters. Pure hygiene.
5. **Per-quote freight/rebate/incentive impact** — only if the linkage decision changes (currently deferred by design per DP9).

### 🔀 Separate effort (own Linear issue, NOT this epic)

- **Quote send-path hardening** + `docs/Service Department Docs/` — the QRM Send Audit / Rylee-pilot work, uncommitted in the tree. Not part of this remediation. See "Uncommitted working-tree contents" above.

---

## Verification performed (at source)

- ✅ `migrations:check`, `audit:edges`, `audit:secrets`, `audit:rls-initplan` (now passing)
- ✅ `deno check`, `deno test` (impact-logic 9/9)
- ✅ web `tsc --noEmit` (0 errors)
- ✅ admin + price-intelligence test suites
- ❌ Not done: live-DB integration test (no DB access), full `bun run build` bundle, manual E2E

**This session (2026-05-29) additionally confirmed:** commit set on `main` synced with origin; migrations 623–628 committed; all 3 functions present in committed main tree with `verify_jwt=false`; dirty-tree contents are the separate Rylee/standalone efforts.

---

## Frontend handoff

No new tables/columns/RPCs from this work — migration `628` adds an **index only**; no type regen needed. Frontend changes (query-key unification, `WatchdogApprovalCard`, `price-intelligence-api` export removal) are already in the committed code.
