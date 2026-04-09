# Jarvis Frontend Handoff — Phase 0 Catchup (2026-04-09)

> **Audience:** the `jarvis-os` repo team. This handoff bundles every backend change from 2026-04-08 (Day 8) onward into a single doc so jarvis-os can pull the schema/contract updates in one pass instead of chasing 11 separate commits.
>
> **Why this is one consolidated doc:** the CORE skill mandates a Jarvis Frontend Handoff after every backend change. The Day 8 commit had its own handoff inline in the response, but Days 9 → Wave 5 (10 subsequent commits) did not. This catchup closes that gap.

## Commits covered

| Commit | Wave / Day | Summary |
|---|---|---|
| `0406275` | Day 8 | profile_role_blend table + view + trigger extension |
| `8e93d69` | Day 9 | Frontend adopts profile role blend (useIronRoleBlend hook + 3 caller migrations) |
| `a55c025` | Day 9 audit | Edge function ranker reads blend (P1 fix) |
| `b59192e` | Post-deploy audit | 2 P1 frontend perf fixes (resolveIronRoleAndBlend + EMPTY_BLEND sentinel) |
| `0c45b9a` | P2 Wave 1 | Frontend cleanup (export isIronRole, dominant weight badge, coerceBlendRowsFromView extract) |
| `e635d23` | P2 Wave 2 | Edge function cleanup (5 audit follow-ups: parallel reads, shared isIronRole, role_blend ledger, parallel OpenAI, team scope ≥ 0.5) |
| `2bf3a17` | P2 Wave 3 | Migration 211 (weight check tighten + role_blend column + deal-timing cron attempt) |
| `d4643ae` | Wave 4a | Cron auth parity — 4 publishers accept x-internal-service-secret |
| `6a7faef` | Wave 4b | Migration 212 schedules 4 publishers via modern cron pattern |
| `44c9370` | Wave 4c | config.toml verify_jwt entries unblock publisher gateway |
| `c7ee908` | Wave 5a | Migration 213 schedules qrm-prediction-scorer + adopts shared cron-auth |

---

## 1. Tables / columns added or modified

### `public.profile_role_blend` — **NEW** (migration 210, Day 8)

Stores weighted, time-bounded role assignments per profile. Replaces the single `profiles.iron_role` column over Phase 0 Day 9 + Phase 4 (eventually).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `profile_id` | `uuid not null references profiles(id) on delete cascade` | |
| `iron_role` | `text not null check (iron_role in ('iron_manager','iron_advisor','iron_woman','iron_man'))` | |
| `weight` | `numeric not null check (weight > 0 and weight <= 1)` | **Tightened from `[0,1]` to `(0,1]`** in migration 211 — weight=0 tombstones are forbidden |
| `effective_from` | `timestamptz not null default now()` | |
| `effective_to` | `timestamptz` | NULL = currently active |
| `reason` | `text` | Free-text audit reason |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | |

**RLS policies:**
- `profile_role_blend_select_self` — user reads own rows
- `profile_role_blend_select_elevated` — manager/owner/admin reads all
- `profile_role_blend_service_all` — service role full access

**Indexes:**
- `idx_profile_role_blend_profile_time` — `(profile_id, effective_from desc)`
- `idx_profile_role_blend_profile_active` — partial on `effective_to is null`
- `idx_profile_role_blend_role_active` — partial on `(iron_role) where effective_to is null`

**Backfill:** every existing `profiles` row with non-null `iron_role` got a single `weight=1.0` open-ended row. As of 2026-04-09: 7 profiles → 7 active blend rows (3 advisor, 3 manager, 1 woman, 0 man).

### `public.qrm_predictions.role_blend` — **NEW jsonb column** (migration 211, P2 Wave 2 W2-3)

| Column | Type | Notes |
|---|---|---|
| `role_blend` | `jsonb not null default '[]'::jsonb` | Active role blend the ranker used at issue time |

- **Shape:** `[{"role": "iron_manager", "weight": 0.6}, {"role": "iron_advisor", "weight": 0.4}]`
- **For single-role-1.0 users** (everyone post-migration-210 backfill): `[{"role": "<ironRole>", "weight": 1.0}]`
- **GIN index:** `idx_qrm_predictions_role_blend_gin` using `jsonb_path_ops` (cheapest variant — supports `@>` containment)
- **Populated by:** `qrm-command-center` edge function on every prediction insert (via `_shared/qrm-command-center/prediction-ledger.ts buildPredictionRow()`)

---

## 2. Views added

### `public.v_profile_active_role_blend` — **NEW** (migration 210, Day 8)

`security_invoker = true` view exposing only currently-active blend rows (`effective_to IS NULL`) with the joined display string.

```sql
CREATE OR REPLACE VIEW public.v_profile_active_role_blend
WITH (security_invoker = true) AS
SELECT
  id,
  profile_id,
  iron_role,
  weight,
  effective_from,
  effective_to,
  reason,
  CASE iron_role
    WHEN 'iron_manager' THEN 'Iron Manager'
    WHEN 'iron_advisor' THEN 'Iron Advisor'
    WHEN 'iron_woman'   THEN 'Iron Woman'
    WHEN 'iron_man'     THEN 'Iron Man'
  END AS iron_role_display
FROM profile_role_blend
WHERE effective_to IS NULL;
```

**Read this view, not the raw table** — the view filters to active rows + joins the display string in one shot.

---

## 3. Triggers / functions changed

### `public.sync_iron_role()` — **EXTENDED** (migration 210, Day 8)

The migration 067 trigger that auto-syncs `profiles.iron_role` from `role + is_support` was extended in migration 210 to ALSO write to `profile_role_blend`. Specifically:

- On `INSERT` OR when the derived `iron_role` actually changes:
  1. Closes the previous active blend row (sets `effective_to = now()`)
  2. Inserts a new blend row with `weight = 1.0` and the new `iron_role`
  3. The reason field is `'auto-sync: profile created'` or `'auto-sync: profiles.role or is_support changed'`
- On a no-op profile update (role unchanged): the trigger does NOT touch the blend table.

This means **any code that updates `profiles.role` or `profiles.is_support` automatically gets a fresh blend row.** No application-layer coupling needed.

---

## 4. QRM Command Center contract changes

### `qrm-command-center` edge function

- **Reads** `v_profile_active_role_blend` for the calling user on every page load (parallel with the profile read via `Promise.allSettled`)
- **Passes the blend through to the ranker** via `blendRoleWeights(effectiveBlend)` — single-role users see byte-identical behavior; blended users get linearly-combined weights
- **Empty blend or load error** → degrades to single-role fallback `[{role: ironRole, weight: 1.0}]` so the request never fails
- **Team-scope gate** changed from `isElevated(ironRole)` to `isBlendTeamScopeEligible(effectiveBlend)` — manager weight ≥ 0.5 now grants team scope (single-role iron_manager users still get it; this only changes behavior for blended operators)

### `inputs_hash` semantics — **BREAKING for hash dedupe history**

The `qrm_predictions.inputs_hash` SHA-256 now includes the full role_blend (sorted alphabetically by role for determinism). Two operators with the same dominant role but different blends produce different hashes.

- **`QRM_RANKER_VERSION` bumped** from `"2026-04-08.1"` to `"2026-04-09.1"` — this invalidates pre-Wave-2 dedupe history, but production was at 0 prediction rows so the impact is nil.
- **For jarvis-os:** if you have any code that compares `inputs_hash` across versions, expect a discontinuity at the version bump. Use `model_source` or `prediction_kind` for grouping instead.

### New `iron-roles.ts` exports

All from `apps/web/src/features/qrm/lib/iron-roles.ts`:

| Function | Purpose |
|---|---|
| `isIronRole(value)` | Canonical narrower for the IronRole enum (frontend) |
| `coerceBlendRowsFromView(rows)` | Defensive coerce + drop invalid rows from `v_profile_active_role_blend` |
| `getIronRoleBlend(rows)` | Parse + sort blend by weight DESC |
| `getDominantIronRoleFromBlend(blend)` | Index 0 (highest weight) |
| `getEffectiveIronRole(userRole, blendRows, ironRoleFromProfile?)` | Blend-first resolution with legacy fallback chain |
| `resolveIronRoleAndBlend(userRole, blendRows, ironRoleFromProfile?)` | Single-pass parse: returns `{info, blend}` together |
| `isIronBlendElevated(blend)` | True if `iron_manager` is anywhere in the blend (any-weight semantics) |

**Legacy `getIronRole` + `isIronElevated` remain as `@deprecated` shims** for backwards compatibility — they still work but new code should use the blend-aware variants.

### Backend equivalents (edge function side)

In `supabase/functions/_shared/qrm-command-center/`:

| Function | Source file | Purpose |
|---|---|---|
| `isIronRole(value)` | `types.ts` | Canonical narrower (Deno backend) |
| `narrowRoleBlendRows(rows)` | `ranking.ts` | Defensive narrower (matches `coerceBlendRowsFromView`) |
| `blendRoleWeights(blend)` | `ranking.ts` | Linearly combines per-role FactorWeights |
| `scoreDealsWithBlend(deals, signals, blend, nowTime)` | `ranking.ts` | Bulk scoring with blend |
| `isBlendTeamScopeEligible(blend)` | `ranking.ts` | Manager weight ≥ 0.5 check |

---

## 5. Cron jobs added

5 new cron jobs landed in this catchup window:

| Job name | Schedule | Migration | Purpose |
|---|---|---|---|
| `anomaly-scan-periodic` | `0 */4 * * *` | 212 | Stalling deals, overdue follow-ups, activity gaps. Publishes `anomaly.detected` to flow_events. |
| `follow-up-engine-hourly` | `0 * * * *` | 212 | Processes due touchpoints + AI value content + notifications. Publishes `follow_up.touchpoint_due`. |
| `prospecting-nudge-2pm` | `0 19 * * 1-5` | 212 | Weekday 14:00 CT advisor nudges per Prospecting SOP. Publishes `prospecting.nudge_dispatched`. |
| `deal-timing-scan-periodic` | `0 */6 * * *` | 212 | Proactive timing alerts (budget cycles, fleet aging). Publishes `deal_timing.alert_generated`. |
| `qrm-prediction-scorer-nightly` | `0 2 * * *` | 213 | Nightly grader closes out predictions against deal outcomes. Updates `qrm_predictions.outcome`. |

**Important context:** all 5 of these have a long backstory. The original migrations (059 / 072 / 088 / 093) used the legacy `current_setting('app.settings.supabase_url')` GUC pattern that doesn't exist on modern Supabase projects, so all 5 silently fell through and never entered `cron.job` until Wave 4b/5a. Migration 205 (morning-briefing) is the canonical example of the modern pattern; migrations 212/213 use the same secret-extraction trick.

**Total cron jobs on remote post-Wave-5a: 11.**

---

## 6. Auth contract additions — `x-internal-service-secret`

5 publisher edge functions now accept BOTH header styles via the new shared helper `supabase/functions/_shared/cron-auth.ts`:

- `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` (legacy)
- `x-internal-service-secret: ${INTERNAL_SERVICE_SECRET}` (modern — also accepts `DGE_INTERNAL_SERVICE_SECRET` as a fallback env var name)

The 5 functions: `anomaly-scan`, `follow-up-engine`, `nudge-scheduler`, `deal-timing-scan`, `qrm-prediction-scorer`.

**For jarvis-os:** these are cron-only publishers — jarvis-os should not normally call them directly. If it does, either auth header is accepted.

---

## 7. New shared helpers (Deno backend)

### `_shared/cron-auth.ts` (Wave 4a)

```ts
export function isServiceRoleCaller(req: Request): boolean
```

Replaces the inline morning-briefing-style auth check across the 5 publishers + scorer. 9 unit tests in `cron-auth.test.ts`.

### `_shared/qrm-command-center/ranking.ts` additions

```ts
export function blendRoleWeights(entries: IronRoleWeightEntry[]): FactorWeights
export function narrowRoleBlendRows(rawRows): IronRoleWeightEntry[]
export function isBlendTeamScopeEligible(blend: IronRoleWeightEntry[]): boolean
export const TEAM_SCOPE_MANAGER_WEIGHT_THRESHOLD = 0.5
export interface IronRoleWeightEntry { role: IronRole; weight: number }
```

---

## 8. TypeScript types that need updating in `jarvis-os`

If `jarvis-os` has a typed Supabase client mirror similar to `apps/web/src/features/qrm/lib/qrm-supabase.ts`, you have two options:

1. **Run typegen against `iciddijgonywtxoelous`** — `supabase gen types typescript --linked > database.types.ts`. This picks up all 213 migrations including the new tables/views/columns.

2. **Add manual typed-shims** for these surfaces:
   - `profile_role_blend` (Row + Insert + Update)
   - `v_profile_active_role_blend` (Row only — view, no inserts)
   - `qrm_predictions.role_blend` (jsonb column add)
   - `flow_events` (full new table — see migration 209 for the 17 ADD-033 fields)
   - `flow_event_types` + `flow_subscriptions` (full new tables)
   - `qrm_prediction_outcomes` (Row column add)

The typed-shim pattern lives at `apps/web/src/features/qrm/lib/qrm-supabase.ts:206-222` for `v_profile_active_role_blend` if you want a worked example.

---

## 9. Breaking changes

**None** that affect production data. Every change is additive or backwards-compatible:

- `profile_role_blend.weight` constraint tightening from `[0,1]` to `(0,1]` is breaking ONLY if any caller writes weight=0. Migration 211 verified pre-apply that no such rows exist; the trigger and backfill both write 1.0, so this is safe by construction.
- `QRM_RANKER_VERSION` bump invalidates dedupe history but production was at 0 prediction rows.
- `team` scope gate change in `qrm-command-center` only differs from prior behavior for blended operators (none in production today).

---

## 10. Verification checklist for jarvis-os

1. Run typegen against `iciddijgonywtxoelous` (or pull `database.types.ts` from this repo's `apps/web/src/lib/database.types.ts`)
2. Confirm any `iron_role` chip in jarvis-os UI handles the multi-row case (a profile can have multiple active blend rows in theory; backfilled-100% users have exactly 1)
3. Confirm any prediction trace surface honors the new `qrm_predictions.role_blend` jsonb column
4. If you have any cron-driven publisher calls, switch them to `x-internal-service-secret` (or keep using `Authorization: Bearer service_role_key` — both work)
5. If you compare `inputs_hash` across `qrm_predictions` rows, factor in the version bump from `2026-04-08.1` → `2026-04-09.1`

---

## 11. What's next

- **Wave 5 closes here** (this handoff is the last item in Wave 5c).
- **Day 10 (P0.6 Honesty Calibration Index)** opens after Wave 5 closes. It will create migration **214** (renumbered from the originally-planned 211) and a new `qrm-honesty-scan` edge function.
- **Day 11 (P0.7 Time Primitive + P0.8 Trace UI)** opens after Day 10. Migration **215** and `qrm-prediction-trace` function.
- **Day 12 (Phase 0 exit audit)** is the last Phase 0 day.

If any of the surfaces above aren't reflected in jarvis-os by the time Day 10 work lands, that catchup is on the jarvis-os repo to do — this handoff is the last pull before Phase 0 starts moving forward again.
