# QEP Parts Intelligence Engine — Phase 1 Ship Report

**Date:** 2026-04-15
**Phase:** 1 — Foundation (Ingestion + Admin UI + Conflict Reconciliation)
**Status:** ✅ Code-complete. Migrations + build GREEN. Ready to deploy and hydrate.

---

## What shipped

### Database (3 migrations, 259 total in sequence)

| File | Purpose |
|---|---|
| `supabase/migrations/257_parts_intelligence_schema.sql` | Extends `parts_catalog` with 50+ CDK PARTMAST fields (multi-branch keyed on `co_code/div_code/branch_code/part_number`). Adds new tables: `parts_history_monthly`, `parts_vendor_prices`, `vendor_order_schedules`, `parts_import_runs`, `parts_import_conflicts`. Adds per-field `_manual_override` flags, manual-edit tracking trigger, `exec_suppress_override_update` RPC, `parts_import_dashboard_stats` RPC, `resolve_parts_import_conflicts_bulk` RPC, `v_parts_margin_signal` view, and a pre-seeded Yanmar `vendor_profiles` row. |
| `supabase/migrations/258_parts_imports_storage.sql` | `parts-imports` Supabase Storage bucket (50MB limit) with RLS policies: admin/manager/owner only, per-user folders. |
| `supabase/migrations/259_parts_import_drift_view.sql` | `v_parts_import_drift` view + `parts_import_drift_summary` RPC. Surfaces bin moves and >50% inventory swings from the most recent PARTMAST import. |

Every new table has RLS using `get_my_workspace()` / `get_my_role()` helpers, service-role override policies, soft-delete where applicable, and composite indexes for catalog/history/vendor lookups. Full-text GIN index on `parts_catalog` primes NL search for Phase 3.

### Edge function — `supabase/functions/parts-bulk-import/`

Actions: `preview` · `commit` · `cancel` · `status`.

Four files:
- `parts-bulk-import/index.ts` — main entrypoint with JWT auth, file-type detection, orchestration
- `_shared/parts-import-types.ts` — shared types, field priority config, manual-override list, parsers
- `_shared/parts-import-partmast.ts` — CDK PARTMAST parser (187 cols → parts_catalog + history) with conflict detection
- `_shared/parts-import-vendor-price.ts` — supplier catalog parser with column auto-detection
- `_shared/parts-import-vendor-contacts.ts` — multi-sheet workbook parser (Parts/Service/Admin contacts + ordering schedule)

Key behaviors:
- **File-hash dedup** — re-uploading the same file short-circuits.
- **Preview-before-commit** — preview writes a diff to `parts_import_runs.preview_diff`; commit is a separate call.
- **Conflicts > silent overwrites** — if a field has `_manual_override = true` and incoming differs, it lands in `parts_import_conflicts` and blocks commit until resolved.
- **Per-field priority policies** — price/bin/ROP/EOQ are `high` (always preview), inventory counters are `low` (auto-take-CDK).
- **Plan stashing** — parsed plan written to Storage beside the source file, so commit doesn't re-parse the 3MB workbook.
- **Batched transactions** — 250-row inserts, 500-row history upserts, 100-row updates.

### Frontend — Parts Companion

Three new files, wired into the companion shell:
- `apps/web/src/features/parts-companion/lib/import-api.ts` — typed client for the edge function + direct table reads/RPC calls
- `apps/web/src/features/parts-companion/pages/ImportPage.tsx` — the admin import surface
- `apps/web/src/features/parts-companion/pages/ImportConflictsPage.tsx` — side-by-side conflict review

Plus: sidebar nav entry (admin-only, gated by profile role), routes registered at `/parts/companion/import` and `/parts/companion/import/conflicts/:runId`, active-tab detection updated in the shell.

**ImportPage UX:**
- Drag-drop zone with hint chips for file-type override.
- Stat cards at top: total parts, vendor prices, unresolved conflicts (warning tone), last PARTMAST import.
- After upload: live preview with insert/update/unchanged/conflict/error counts, sample inserts table, per-row change diffs with changed-fields highlighted, commit or cancel, recent runs timeline.
- Conflict banner with one-click jump to the review queue when `rows_conflicted > 0`.

**ImportConflictsPage UX:**
- Two modes: **Quick** (one conflict at a time, keyboard-driven — ← keep / → take / ↑ edit / j-k navigate) and **Audit** (full table with filters).
- Side-by-side card layout: "Your value" (with attribution + timestamp) vs. "DMS says" (with source file) vs. free-form "enter new value."
- Filter pills: Unresolved / High priority / All.
- Bulk actions by field: "Keep all current bins", "Take all incoming inventory counts", etc.
- Sticky commit bar appears when unresolved count hits zero.

### Hydration script — `scripts/hydrate-parts-intelligence.ts`

`bun run parts:hydrate` (added to package.json).

Loads all 4 delivered files directly via service role — no edge function deploy required:
1. Vendor Contacts → vendor_profiles + vendor_contacts + vendor_order_schedules (47 vendors, 241 contacts, 26 schedules parsed in dry-run)
2. Yanmar Price File → parts_vendor_prices attached to pre-seeded Yanmar vendor (17,881 rows)
3. PARTMAST → parts_catalog + parts_history_monthly (4,309 rows; ~100k history rows)

**Dry-run verified** against all three files. Example parse from dry-run:
```
Part 129150-35170 (OIL FILTER)
  cost $7.11 · list $10.76 · avg $7.31
  on_hand=3 · vendor=YANMAR · branch=01
  last sale 2026-01-22 · last modified 2026-02-19
  safety_stock=2 · EOQ=1
```

Arguments:
- `--dir=<path>` (default `~/Downloads/fwmixingequipmentwsecurity`)
- `--workspace=<id>` (default `default`)
- `--skip=partmast,vendor_price,vendor_contacts` (any combo)
- `--dry-run` (prints parsed samples, no writes)

### Plan documents

- `QEP-Parts-Intelligence-Engine-Master-Plan-2026-04-15.md` — the full 3-phase plan with decisions locked
- `QEP-Parts-Intelligence-Phase-1-Ship-Report-2026-04-15.md` — this document

---

## Build gates

- ✅ `bun run migrations:check` — 259 files, canonical sequence 001..259
- ✅ `bun run build` — 19.65s, all chunks built, ParsCompanionRoutes bundle 32.83 kB gzipped 8.51 kB
- ✅ RLS on every new table (workspace-scoped, role-gated, service-role escape)
- ✅ Dry-run of hydration script parses all 3 file types correctly

---

## How to deploy (operator runbook)

### 1. Apply migrations to Supabase
```bash
# dev
supabase db push

# prod
supabase db push --db-url $PROD_DB_URL
```

### 2. Deploy the edge function
```bash
supabase functions deploy parts-bulk-import
```

### 3. Run initial hydration
```bash
# make sure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are in .env.local
bun run parts:hydrate \
  --dir=/Users/brianlewis/Downloads/fwmixingequipmentwsecurity \
  --workspace=default
```

Expected output (rough):
- Vendor Contacts: ~47 vendor profiles, ~241 contacts, ~26 ordering schedules inserted
- Yanmar Price File: ~17,881 vendor prices
- PARTMAST: ~4,309 parts + ~100k history rows

### 4. Visit Parts Companion
- Navigate to `/parts/companion/lookup` — 4,300+ parts searchable
- Navigate to `/parts/companion/import` — dashboard shows live stats, recent runs
- Drop a new file to test the preview → commit flow

### 5. Verify with SQL
```sql
select count(*) from parts_catalog where workspace_id = 'default';
-- expect ~4,309

select count(*) from parts_history_monthly;
-- expect ~80k–100k (depending on how many parts have non-zero history)

select count(*) from parts_vendor_prices where currency = 'USD';
-- expect ~17,881

select count(*) from vendor_profiles; select count(*) from vendor_contacts;
-- expect ~47 / ~241
```

---

## What's next — Phase 2 (Intelligence)

Already pre-wired by the Phase 1 schema:

1. **Seeded demand forecast** (Slice 2.1) — hook `parts-demand-forecast` edge function to `parts_history_monthly`. No cold start — real 24-month history on day one.
2. **Machine ↔ parts knowledge graph** (Slice 2.6, moved up) — join `parts_catalog.machine_code/model_code` into `machine_profiles` for the predictive-failure moonshot.
3. **Auto-replenish** (Slice 2.2) — reads `vendor_order_schedules` + forecast to draft POs on the vendor's ordering day.
4. **Dead/slow/hot stock** (Slice 2.3) — classification from `movement_code` + `activity_code` + 24mo velocity.
5. **Vendor price arbitrage** (Slice 2.4) — `v_parts_margin_signal` view is already live; Phase 2 adds the dashboard + alerts.
6. **Stockout prevention** (Slice 2.5) — days-until-stockout projection using seeded forecast.

Then **Phase 3 — Moonshot** starts with Slice 3.3 (Predictive Failure → Pre-Position Parts).

---

## Known follow-ups (not blockers)

1. **Vendor contacts parser edge case** — the Bandit row in Vendor Contacts 2026.xlsx has a mashed-together cell with multiple contacts stuffed into one. Dry-run picked up 241/many; a v2 parser should split on inline "Email:/Phone:/ext" tokens.
2. **Watched folder for CDK drops** — once CDK cadence is confirmed (still TBD, §11 of master plan), add a Supabase Storage trigger that auto-previews new PARTMAST files landing in a designated folder but never auto-commits.
3. **Parts Companion Import page — live conflict count badge** — the sidebar Import nav item could surface `high_priority_conflicts` as a red badge for urgency.
4. **Rollback UI** — `parts_import_runs` captures everything needed for rollback; a one-click rollback action on the history tab is a natural Slice 1.6.

None of these block Phase 2 kickoff.

---

## Files touched

### New
```
supabase/migrations/257_parts_intelligence_schema.sql
supabase/migrations/258_parts_imports_storage.sql
supabase/migrations/259_parts_import_drift_view.sql
supabase/functions/parts-bulk-import/index.ts
supabase/functions/_shared/parts-import-types.ts
supabase/functions/_shared/parts-import-partmast.ts
supabase/functions/_shared/parts-import-vendor-price.ts
supabase/functions/_shared/parts-import-vendor-contacts.ts
apps/web/src/features/parts-companion/lib/import-api.ts
apps/web/src/features/parts-companion/pages/ImportPage.tsx
apps/web/src/features/parts-companion/pages/ImportConflictsPage.tsx
scripts/hydrate-parts-intelligence.ts
QEP-Parts-Intelligence-Engine-Master-Plan-2026-04-15.md
QEP-Parts-Intelligence-Phase-1-Ship-Report-2026-04-15.md
```

### Modified
```
apps/web/src/features/parts-companion/PartsCompanionRoutes.tsx
apps/web/src/features/parts-companion/PartsCompanionShell.tsx
apps/web/src/features/parts-companion/components/CompanionSidebar.tsx
package.json (parts:hydrate script + xlsx dep)
bun.lock
```

---

*Ready to apply migrations, deploy, and run `bun run parts:hydrate`.*
