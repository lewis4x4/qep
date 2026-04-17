# QEP Quote Builder Audit Report — Slices 01–04

**Date:** 2026-04-17  
**Auditor:** Claude (claude/competent-kowalevski worktree)  
**Commit:** `9962d54` — branch `claude/competent-kowalevski`  
**Scope:** Migrations 283–297, pricing engine, program engine, 5 edge functions, tests

---

## Summary

14 findings total (F1–F12 original + F13–F14 surfaced in FIX-4 verification).  
All 14 fixed in commit `9962d54`. Three edge functions redeployed.

**Test count:** 219 pass, 0 fail (scoped: pricing + programs libs)  
**Full suite:** 479 pass, 1 pre-existing fail (`home-route.test.ts` — confirmed pre-existing via `git stash` isolation, unrelated to QB work)

---

## Findings Status

### Critical

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| F1 | `qb-calculate` used wrong PostgREST column names (`is_active`, `start_date`, `end_date`) — every live pricing call returned a 500 | `supabase/functions/qb-calculate/index.ts` | **FIXED** — changed to `active`, `effective_from`, `effective_to` |
| F2 | `extract-price-sheet` hardcoded `workspace_id: "default"` on all 5 extracted program rows — all extractions silently assigned to wrong workspace | `supabase/functions/extract-price-sheet/index.ts` | **FIXED** — replaced with `sheet.workspace_id` (added to select list) |
| F3 | `publish-price-sheet` used two-step status check + flip (TOCTOU race) — concurrent publishes could corrupt status | `supabase/functions/publish-price-sheet/index.ts` | **FIXED** — atomic CAS `UPDATE ... WHERE status = 'extracted'` with 409 on collision |

### High

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| F4 | `qb-calculate` date-window query excluded open-ended programs (`effective_to IS NULL`) — future programs with no end date never matched | `supabase/functions/qb-calculate/index.ts` | **FIXED** — `.or('effective_to.is.null,effective_to.gte.${today}')` |
| F5 | Claude extraction outputs nested `details.terms[]` array; `applyProgram()` reads flat scalar fields (`term_months`, `rate_pct`) — financing programs always wrote NaN payment to DB | `supabase/functions/publish-price-sheet/index.ts` | **FIXED** — `normalizeFinancingDetails()` flattens at publish time; originals preserved in `all_terms`/`all_lenders` |

### Medium

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| F6 | Commission clamped incorrectly — `grossMarginCents * 0.15` unclamped, negative gross margin (e.g. high freight) produced negative commission payout | `apps/web/src/lib/pricing/margin.ts:66` | **FIXED** — `Math.max(0, Math.floor(...))` |
| F7 | `qb_notifications` UPDATE policy allowed authenticated users to modify any column (including `notification_type`, `payload`) — should restrict to `read_at` only | `supabase/migrations/297_qb_notifications_hardening.sql` | **FIXED** — policy dropped; `SECURITY DEFINER` function `mark_notification_read(uuid)` grants update of `read_at`/`updated_at` only |
| F8 | `qb_notifications` table missing `updated_at` column — policy trigger and audit trail broken | `supabase/migrations/297_qb_notifications_hardening.sql` | **FIXED** — `ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()` + `set_updated_at()` trigger attached |
| F9 | Migration 296 header comment said "Migration 293" — stale copy-paste from prior file | `supabase/migrations/296_qb_price_sheet_rls.sql` | **FIXED** — corrected to "Migration 296" |

### Low

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| F10 | Docstring in `programs.ts` said `Math.floor` but implementation uses `Math.round` — spec mismatch | `apps/web/src/lib/pricing/programs.ts:223` | **FIXED** — docstring updated to `Math.round` |
| F11 | `DISCOUNT_NOT_CONFIGURED` guard in `calculateQuote` had no regression test — could silently regress | `apps/web/src/lib/pricing/__tests__/calculator.test.ts` | **FIXED** — test added: `CTX4` (Bandit, `discount_configured: false`), asserts throw with code + message |
| F12 | `bun test` from repo root walked `supabase/functions/_shared/*.test.ts` which import Deno-only APIs — test runner hung indefinitely | `bunfig.toml`, `package.json` | **FIXED** — `bunfig.toml` `[test] root = "apps"` scopes discovery; `test:pricing` script added |

### New — Surfaced in FIX-4 Verification

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| F13 | `recommender.ts:36` used `.gte("effective_to", dealIso)` — excluded open-ended programs (`effective_to IS NULL`); mirror of F4 in the TS recommender layer | `apps/web/src/lib/programs/recommender.ts` | **FIXED** — `.or('effective_to.is.null,effective_to.gte.${dealIso}')` |
| F14 | `eligibility.ts:44–46` called `new Date(program.effective_to)` with null → epoch (1970-01-01) → `context.dealDate > to` always true → all open-ended programs rejected as expired | `apps/web/src/lib/programs/eligibility.ts` | **FIXED** — guards `if (program.effective_to !== null)` before end-date comparison |

---

## Edge Function Deploys

All three affected functions redeployed to project `iciddijgonywtxoelous` on 2026-04-17.

| Function | Fixes Deployed | Deploy Status |
|----------|---------------|---------------|
| `qb-calculate` | F1, F4 | DEPLOYED — Supabase CLI confirmed |
| `extract-price-sheet` | F2 | DEPLOYED — Supabase CLI confirmed |
| `publish-price-sheet` | F3, F5 | DEPLOYED — Supabase CLI confirmed |

**Not redeployed (no changes):**
- `qb-recommend-programs` — F13 is in the TS lib layer, not the edge fn itself; recommender edge fn passes through the lib call unchanged
- `qb-rebate-deadlines-cron` — no findings touched this function

### Smoke Tests

> **Note:** Smoke test curl results were lost to session context compaction mid-execution. All three functions confirmed deployed by CLI. To verify manually:

```bash
BASE=https://iciddijgonywtxoelous.supabase.co/functions/v1
curl -i -X POST $BASE/qb-calculate        # expect 401 + {"error":"..."}
curl -i -X POST $BASE/extract-price-sheet # expect 401 + {"error":"..."}
curl -i -X POST $BASE/publish-price-sheet # expect 401 + {"error":"..."}
curl -i -X POST $BASE/qb-recommend-programs   # expect 401
curl -i -X POST $BASE/qb-rebate-deadlines-cron # expect 401
```

PASS criterion: HTTP 401 + valid JSON body (no stack trace, no HTML).

### Results (2026-04-17)

| Function | HTTP | Body | Result |
|----------|------|------|--------|
| `qb-calculate` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `qb-recommend-programs` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `qb-rebate-deadlines-cron` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `extract-price-sheet` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `publish-price-sheet` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |

---

## FIX-4 Verification Results

1. **DB schema diff** — Migration 297 applied to staging; `updated_at` column confirmed present on `qb_notifications`; `mark_notification_read` SECURITY DEFINER function confirmed installed; old UPDATE policy confirmed dropped.

2. **RLS simulation** — User B (owner, same `default` workspace) can read `qb_notifications` for user A. Confirmed intentional: the "elevated read" policy is by design so managers/owners see all workspace rebate alerts. Not a defect.

3. **Edge function inventory** — All 5 QB functions ACTIVE v1 as of 2026-04-17 in Supabase Dashboard.

4. **Plan doc filenames** — Present: `SLICE_01_SCHEMA_FOUNDATION.md`, `SLICE_03_PROGRAM_ENGINE.md`, `SLICE_04_PRICE_SHEET_INGESTION.md`. Missing: `SLICE_02_PRICING_ENGINE.md` (never written). `00_MASTER_INDEX.md` referenced in code comments but not present in plans directory. Minor stale references — no code impact.

5. **Eligibility/recommender audit** — Found F13 and F14 (null `effective_to` handling). Fixed and tested.

---

## Updated TODO — Later Slices

### Immediate (before Slice 05)

- [ ] **Smoke test verification** — Run the 5 curl commands above and record actual HTTP status + body for each function
- [ ] **`SLICE_02_PRICING_ENGINE.md`** — Write the missing plan doc for the pricing engine (margin, commission, discount, payment calc)
- [ ] **`00_MASTER_INDEX.md`** — Create or remove the reference; `margin.ts` docstring points to it
- [ ] **`qb-rebate-deadlines-cron` URL wiring** — Currently registered with `pg_cron` pointing to NULL URL (intentional no-op). Wire the actual edge function URL once the cron schedule is confirmed with Angela
- [ ] **programs.test.ts nested-array path** — Test 2 degrades to NaN rather than throwing; consider whether a hard error is preferable to a silent NaN in the DB

### Slice 05+ Roadmap

- [ ] **Quote PDF generation** — Dealer-facing quote output (line items, program discounts, payment options)
- [ ] **Angela chat integration** — Conversational interface over `qb-calculate` + `qb-recommend-programs`
- [ ] **Multi-program stacking UI** — `stacking-db.ts` is wired but no operator UI surfaces stacking rules yet
- [ ] **`qb-rebate-deadlines-cron` full test** — Currently zero test coverage on the cron edge function
- [ ] **Aged inventory / bridge rent-to-sales seeding** — No test fixture data in staging for these program types; eligibility branches are logic-tested but not integration-tested against real DB rows
- [ ] **`extract-price-sheet` file type coverage** — Extraction tested for PDF; Excel path (`.xlsx`) untested end-to-end
- [ ] **Workspace isolation hardening** — All QB tables have RLS, but workspace-scoped admin token rotation for multi-tenant deployments is not yet implemented

---

## Files Changed in This Audit

| File | Change |
|------|--------|
| `supabase/functions/qb-calculate/index.ts` | F1 column names, F4 null effective_to filter |
| `supabase/functions/extract-price-sheet/index.ts` | F2 workspace_id |
| `supabase/functions/publish-price-sheet/index.ts` | F3 atomic CAS, F5 normalizeFinancingDetails |
| `apps/web/src/lib/pricing/margin.ts` | F6 commission floor |
| `apps/web/src/lib/pricing/programs.ts` | F10 docstring |
| `apps/web/src/lib/pricing/__tests__/calculator.test.ts` | F6 regression, F11 DISCOUNT_NOT_CONFIGURED test |
| `apps/web/src/lib/pricing/__tests__/programs.test.ts` | F5 normalizer coverage (new file) |
| `apps/web/src/lib/programs/eligibility.ts` | F14 null effective_to guard |
| `apps/web/src/lib/programs/recommender.ts` | F13 null effective_to query |
| `supabase/migrations/296_qb_price_sheet_rls.sql` | F9 header comment |
| `supabase/migrations/297_qb_notifications_hardening.sql` | F7 SECURITY DEFINER fn, F8 updated_at (new file) |
| `bunfig.toml` | F12 bun test root scoping (new file) |
| `package.json` | F12 test scripts |

---

## Smoke Test Results

**Run date:** 2026-04-17  
**Runner:** claude/keen-clarke worktree (separate scoped session)  
**Commit under test:** `9962d54`  
**Criterion:** PASS = HTTP 401 + valid JSON body. Anything else = FAIL.

### Raw Output

```
=== qb-calculate ===
HTTP 401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

=== qb-recommend-programs ===
HTTP 401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

=== qb-rebate-deadlines-cron ===
HTTP 401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

=== extract-price-sheet ===
HTTP 401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

=== publish-price-sheet ===
HTTP 401
{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

### Verdict

| Function | HTTP Status | Body | Result |
|---|---|---|---|
| `qb-calculate` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `qb-recommend-programs` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `qb-rebate-deadlines-cron` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `extract-price-sheet` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |
| `publish-price-sheet` | 401 | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` | **PASS** |

All 5 functions are live, auth-gated, and returning structured error JSON. Smoke tests: **5/5 PASS**.
