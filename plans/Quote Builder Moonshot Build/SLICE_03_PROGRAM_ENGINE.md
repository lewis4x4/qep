# SLICE 03 — Program Engine

**Status:** Shipped to `main` in commits `ce37978` + `6929750` on 2026-04-17.

**Source of truth:** This document reflects what actually landed in the repo and the database. Downstream slices (04–08) should read this, not the pre-discovery draft.

---

## Objective

Build the manufacturer program library — the engine that answers: "given this machine, this customer, and today's date, which programs apply and how?" Also seeds the program catalog for all three construction brands and ships the rebate deadline tracker + daily cron alert.

---

## What Shipped

### Migrations (applied to staging — `iciddijgonywtxoelous`)

| # | File | What it does |
|---|---|---|
| 291 | `291_qb_seed_asv_programs.sql` | Seeds 5 ASV Q1 2026 programs + 5 Yanmar Q1 2026 programs (both brands in one migration; unified under YCENA). All 5 types: CIL, low-rate financing, GMU rebate, aged inventory, bridge rent-to-sales. |
| 292 | `292_qb_seed_develon_programs.sql` | Seeds 5 Develon Q1 2026 programs. DX225 CIL amount ($7,500) confirmed from Slice 02 fixture; all other amounts flagged TODO(Angela/Rylee). |
| 293 | `293_qb_notifications.sql` | Creates `qb_notifications` table with RLS (service role bypass + user read-own + elevated read). Registers `qb-rebate-deadline-check` pg_cron job at 11:00 UTC daily (with availability guard — silent no-op if pg_cron not installed). |

**Seed data verified in staging:**
- 15 rows in `qb_programs` (5 programs × 3 brands: ASV, YANMAR, DEVELON)
- `qb_notifications` table live with correct columns and RLS policies

**Note — rebate trigger already existed:** `qb_compute_rebate_due_date()` was shipped in migration 286 (`warranty_registration_date + 45 days` on `qb_deals`). No new trigger migration needed.

---

### TypeScript — `apps/web/src/lib/programs/`

| File | Purpose |
|---|---|
| `types.ts` | `QuoteContext`, `EligibilityResult`, `ProgramRecommendation`, `QuoteScenario`, `RebateDeadline`, `StackingResult`, `QbProgram`, `QbProgramType` — all inlined (no `@/` path aliases; Deno-compatible) |
| `eligibility.ts` | `isEligible(program, context)` — pure function, no DB. Handles all 5 program types with human-readable `reasons[]` |
| `recommender.ts` | `recommendPrograms(context, supabase)` — fetches active programs for the brand, runs eligibility on each, sorts eligible first |
| `scenarios.ts` | `buildScenarios(input)` — generates 2–4 side-by-side deal options (Cash+CIL, 0% financing, stacked rebate, GMU, bridge, baseline cash fallback). Human-sounding copy enforced |
| `stacking-db.ts` | `validateStackingFromDB(input, supabase)` — reads `qb_program_stacking_rules` from DB (replaces Slice 02 hardcoded rules). All 10 rules enforced bidirectionally |
| `rebate-tracker.ts` | `getUpcomingRebateDeadlines(params, supabase)` + `enrichWithProgramDetails()` — queries `qb_deals` for unfiled rebates within window, computes urgency (green/yellow/red/overdue) |
| `index.ts` | Public re-exports |

**Deno compatibility corrections vs. greenfield spec:**
- No `import { createClient } from "@supabase/supabase-js"` in library modules — replaced with `SupabaseLike` duck-type interface (client always passed in from edge function)
- No `@/` path aliases — `QbProgram` and `QbProgramType` inlined in `types.ts`
- All relative imports use `.ts` extension

---

### Unit Tests — `apps/web/src/lib/programs/__tests__/`

| File | Tests |
|---|---|
| `eligibility.test.ts` | 20 tests — date window (4), CIL (2), financing (1), GMU (3), aged inventory (4), bridge (2), brand mismatch (1), other (3) |
| `stacking.test.ts` | 6 tests — single program, CIL+financing violation, CIL+aged valid, financing+aged valid, GMU+CIL violation, bridge+anything violation, empty list |
| `scenarios.test.ts` | 4 tests — no programs (baseline cash), CIL scenario, 0% financing payment math, CIL+aged stack, GMU scenario, human-copy check |

**Total: 163 tests, 0 failures** (133 Slice 02 pricing + 30 Slice 03 programs)

---

### Edge Functions

| Function | URL | Auth |
|---|---|---|
| `qb-recommend-programs` | `https://iciddijgonywtxoelous.supabase.co/functions/v1/qb-recommend-programs` | `requireServiceUser()` — valid user JWT, all roles |
| `qb-rebate-deadlines-cron` | `https://iciddijgonywtxoelous.supabase.co/functions/v1/qb-rebate-deadlines-cron` | `isServiceRoleCaller()` — service role key or INTERNAL_SERVICE_SECRET |

**`qb-recommend-programs` — POST body:**
```json
{
  "brandId": "uuid",
  "equipmentModelId": "uuid",
  "modelCode": "RT-135",
  "modelYear": 2025,
  "customerType": "standard",
  "dealDate": "2026-02-15",
  "listPriceCents": 10000000,
  "equipmentCostCents": 8200000,
  "baselineSalesPriceCents": 9200000,
  "markupPct": 0.12
}
```

**Response:**
```json
{
  "recommendations": [...],
  "scenarios": [...],
  "stackingWarnings": [],
  "stackingViolations": []
}
```

**`qb-rebate-deadlines-cron`** — no body required. Queries all `qb_deals` with unfiled rebates due within 14 days, inserts `qb_notifications` rows for all admin/manager/owner users, returns summary JSON.

---

## Acceptance Criteria — Verified at Ship

- [x] 5 ASV programs seeded with correct rebate amounts per model (from spec PDF)
- [x] 5 Yanmar programs seeded (same structure, unified YCENA financing terms)
- [x] 5 Develon programs seeded — DX225 CIL confirmed; all other amounts flagged TODO(Angela/Rylee)
- [x] Stacking rules correctly enforced from DB — CIL+GMU violation, CIL+aged valid, bridge+anything violation
- [x] Rebate due date auto-calculated (already in migration 286 — trigger verified)
- [x] `qb_notifications` table live with RLS
- [x] pg_cron job registered (with guard for environments without pg_cron)
- [x] `qb-recommend-programs` deploys and boots (401 smoke test PASS)
- [x] `qb-rebate-deadlines-cron` deploys and boots (401 smoke test PASS)
- [x] Unit tests: GMU no pre-approval → ineligible with requirement string
- [x] Unit tests: CIL + financing → stacking violation
- [x] Unit tests: aged inventory for MY2025 unit → ineligible
- [x] Unit tests: bridge for non-rental → ineligible
- [x] Unit tests: date window edge cases (day before / day after)
- [x] Human-sounding copy on all `reasons[]`, `pros[]`, `cons[]` strings

---

## Corrections vs. Pre-Discovery Spec

1. **Rebate trigger not needed** — already in migration 286. `009_rebate_triggers.sql` skipped.
2. **All IDs are UUIDs** — spec used `number` / `bigserial`. Actual schema is `uuid` throughout.
3. **Table names are `qb_*`** — spec referred to bare `programs`/`program_stacking_rules`.
4. **`qb_notifications` not bare `notifications`** — follows `qb_*` prefix convention.
5. **Programs module at `apps/web/src/lib/programs/`** — not `src/lib/programs/`.
6. **Deno import discipline** — no bare npm specifiers in library modules; SupabaseLike duck-type pattern used throughout.
7. **Develon amounts flagged** — no official bulletin available. All non-DX225 amounts are estimates marked TODO(Angela/Rylee).

---

## Open Items for Downstream Slices

1. **Yanmar model codes** — `VIO17`, `VIO25`, `VIO35`, `VIO55`, `VIO80`, `VIO100`, `SV17`, `SV26` are best-guess codes. Confirm against official Yanmar price sheet in Slice 04 ingestion.
2. **Develon rebate amounts** — all except DX225 CIL are placeholders. Angela/Rylee must verify from official Develon Q1 2026 bulletin before quoting.
3. **Q2 2026 programs** — all seeded programs have `effective_to = 2026-03-31`. New quarter programs must be added when ASV/Yanmar/Develon release the next bulletin (admin UI in Slice 04, or a follow-up seed migration).
4. **Salesman notification in cron** — `qb-rebate-deadlines-cron` currently notifies admin/manager/owner users only. Salesman-level notification requires `salesman_id` on `RebateDeadline` — tracked for Slice 07.
5. **`stacking.ts` in pricing module** — still uses hardcoded rules for Slice 02 test fixtures. That module is not called at runtime (edge functions use `stacking-db.ts`). No action needed unless a future refactor unifies them.

---

## Commit References

| Commit | Repo | Description |
|---|---|---|
| `ce37978` | outer (`lewis4x4/qep`) | Programs library + edge functions (initial) |
| `6929750` | outer (`lewis4x4/qep`) | Deno import compat fix (SupabaseLike + inlined types) |
| _(this doc)_ | nested (`qep/`) | Plan doc sync to match shipped state |
