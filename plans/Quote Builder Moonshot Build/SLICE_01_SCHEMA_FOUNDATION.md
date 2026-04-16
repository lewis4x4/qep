# SLICE 01 — Schema Foundation

**Status:** Shipped to `main` in commit `18d7f2e` on 2026-04-16. All 8 migrations (283–290) applied to staging.

**Source of truth:** This document reflects what actually landed in the repo and the database. Downstream slices (02–08) should read this, not the pre-discovery draft.

---

## Objective

Build the Supabase schema foundation for the Quote Builder Moonshot. Twelve new tables plus seven audit companions, with full RLS and security hardening, so every downstream slice can rely on a stable data layer.

---

## Design Decisions Locked by Discovery (see `docs/DISCOVERY_BRIEF_2026_04.md`)

| Decision | What shipped |
|---|---|
| Primary keys | `uuid primary key default gen_random_uuid()` on every new table — the repo pattern, not bigserial |
| Workspace scope | `workspace_id text not null default 'default'` on every new table. There is no `workspaces` table; the value is a tag, not a FK |
| Money | `bigint` with `_cents` suffix. Never `numeric`, never `float` |
| Percentages | `numeric(5,4)` storing decimals (`0.3000` = 30%), `_pct` suffix |
| Role helper | `public.get_my_role()` — reused, not recreated |
| Workspace helper | `public.get_my_workspace()` — reused, not recreated |
| `updated_at` trigger | `public.set_updated_at()` — reused, not recreated |
| Role values | Only `'rep'`, `'admin'`, `'manager'`, `'owner'` (the `user_role` enum). No `'sales_rep'`, no `'sales_admin'` |
| Table prefix | `qb_*` on all new QB tables to avoid collisions with `crm_*`, `qrm_*`, and legacy unprefixed tables |
| CRM integration | `crm_companies` and `crm_equipment` are VIEWS over base tables `qrm_companies` and `qrm_equipment`. Columns added to base tables; views recreated with `security_invoker = true` |
| No new `companies`/`contacts`/`equipment` tables | Extended `qrm_companies`, referenced `qrm_contacts`, extended `qrm_equipment`. Single source of truth |

---

## Schema Overview

### Extensions to existing tables (migration 283)

**`qrm_companies`** — adds QB-specific fields additively:
- `legal_name text`
- `dba text`
- `phone text`
- `website text`
- `classification text` check (`standard`/`gmu`/`forestry`/`construction`/`land_clearing`/`rental`/`logging`/`other`)
- `territory_code text` — `'STORE_01'` (Lake City) or `'STORE_02'` (Ocala)
- `county text`
- `status text default 'active'` check (`active`/`inactive`/`prospect`/`archived`)
- `notes text`

**`qrm_equipment`** — adds replacement-cycle tracking:
- `purchased_from_qep boolean default false`
- `purchase_date date`

Both `crm_companies` and `crm_equipment` views recreated with `security_invoker = true` so RLS runs as the querying user.

### New QB tables (migrations 284–287)

| Table | Purpose |
|---|---|
| `qb_brands` | Manufacturer configs — discount %, markup targets, tariff, PDI default, good-faith %, attachment markup. **`discount_configured boolean` flag** so pricing engine refuses to quote brands with unknown discount rates |
| `qb_equipment_models` | Machine catalog with list prices. Has `pg_trgm` GIN index on `name_display` for Slice 05 natural-language fuzzy matching |
| `qb_attachments` | Attachment catalog. `compatible_model_ids uuid[]` array or `universal` flag |
| `qb_freight_zones` | Geography-based freight lookup. `state_codes text[]` with GIN index |
| `qb_programs` | Manufacturer program library (CIL, low-rate financing, GMU, aged inventory, bridge). Flexible `details jsonb` payload per program type |
| `qb_program_stacking_rules` | Bidirectional rules for which program types can combine. Global (no workspace scope), auth required |
| `qb_quotes` | Full pricing snapshot frozen at quote creation. References `qrm_companies`, `qrm_contacts`, `qrm_equipment`, `qb_equipment_models`. Auto-generated `quote_number` via `qb_quote_number_seq` |
| `qb_quote_line_items` | Attachments, trade-in lines, discounts, adjustments |
| `qb_deals` | What a quote converts to when won. Financial snapshot + commission (15% of gross margin). Links back to `qrm_deals` via optional `crm_deal_id` for CRM pipeline tracking. Status uses `'active'` not `'open'` to distinguish from QRM pipeline |
| `qb_trade_ins` | Trade-in records linked to deal and/or quote, can reference `qrm_equipment` |
| `qb_price_sheets` | Uploaded PDF/Excel files awaiting admin review (Slice 04 target) |
| `qb_price_sheet_items` | Claude-extracted rows awaiting approval |

### Audit tables (migration 288)

Seven companion tables: `qb_quotes_audit`, `qb_deals_audit`, `qb_brands_audit`, `qb_equipment_models_audit`, `qb_attachments_audit`, `qb_programs_audit`, `qb_price_sheets_audit`.

All share the same shape:
```sql
id uuid primary key default gen_random_uuid(),
record_id uuid not null,                              -- NOT qb_quotes_id or similar — always 'record_id'
action text check (action in ('insert','update','delete')),
actor_id uuid,                                         -- auth.users.id of who made the change
changed_fields jsonb,                                  -- {field: {old,new}} only on UPDATE
snapshot jsonb,                                        -- full row at time of change
created_at timestamptz default now()
```

Generic trigger function `public.qb_log_audit()`:
- `SECURITY DEFINER` with `search_path = ''`
- Uses `tg_table_name || '_audit'` to derive audit table
- Inserts always into the uniform `record_id` column
- `changed_fields` excludes `updated_at` noise

Attached via `after insert or update or delete` triggers on all 7 source tables.

### RLS policies (migration 289)

| Table class | Read | Write |
|---|---|---|
| Catalog (`qb_brands`, `qb_equipment_models`, `qb_attachments`, `qb_freight_zones`, `qb_programs`) | Any authenticated user in the workspace | admin / manager / owner |
| `qb_program_stacking_rules` | Any authenticated user (global, no workspace) | admin / manager / owner |
| `qb_quotes`, `qb_quote_line_items` | Team-wide (rep+) per Rylee spec | Rep can only update own quotes; admin/manager/owner any |
| `qb_deals`, `qb_trade_ins` | Team-wide (rep+) | Rep can only update own deals and only while status = 'active'; elevated any |
| `qb_price_sheets`, `qb_price_sheet_items` | admin / manager / owner only | admin / manager / owner only |
| `qb_*_audit` | admin / manager / owner only | No user policies — writes happen only via `SECURITY DEFINER` trigger |

**Service role bypass** on every table so Edge Functions can write with the service key.

### Security hardening (migration 290)

Post-advisor fixes applied in a follow-up migration (and folded back into source files 283/286 for reproducibility):
- `crm_companies` and `crm_equipment` views set `security_invoker = true` so RLS runs as the querying user, not the view creator
- `generate_qb_quote_number`, `generate_qb_deal_number`, `qb_compute_rebate_due_date` all pinned to `set search_path = ''`

---

## Migration Manifest

| # | File | What it does |
|---|---|---|
| 283 | `283_qb_crm_extensions.sql` | Extend `qrm_companies` (9 columns) + `qrm_equipment` (2 columns); recreate `crm_companies`/`crm_equipment` views with `security_invoker = true` |
| 284 | `284_qb_brands_catalog.sql` | Create `qb_brands`, `qb_equipment_models`, `qb_attachments`, `qb_freight_zones`. Seed 13 brands (3 construction `discount_configured = true`, 10 forestry/other `false`) and FL freight zone for ASV |
| 285 | `285_qb_programs.sql` | Create `qb_programs`, `qb_program_stacking_rules`. Seed 10 confirmed stacking rules |
| 286 | `286_qb_quotes_deals.sql` | Create `qb_quotes`, `qb_quote_line_items`, `qb_deals`, `qb_trade_ins`. Quote/deal number sequences + generators. Rebate-due-date trigger (warranty_registration_date + 45 days) |
| 287 | `287_qb_price_sheets.sql` | Create `qb_price_sheets`, `qb_price_sheet_items` |
| 288 | `288_qb_audit.sql` | Create 7 `qb_*_audit` tables with uniform `record_id uuid`; create `qb_log_audit()` trigger function; attach triggers to all 7 audited tables |
| 289 | `289_qb_rls.sql` | Enable RLS on all 19 QB tables; service role bypass on all; policies for catalog / quote / deal / price sheet / audit access per role matrix |
| 290 | `290_qb_security_hardening.sql` | `security_invoker = true` on the two recreated views; `search_path = ''` on the three QB functions (advisor fix) |

### Seed data shipped

- **13 brands** in `qb_brands`:
  - Construction (`discount_configured = true`): ASV (30% disc, 12% markup, 5% tariff), YANMAR (same), DEVELON (25% disc, 12% markup, 0% tariff)
  - Forestry (`discount_configured = false`, discount = 0): BARKO, PRINOTH, LAMTRAC, BANDIT, SHEAREX, DENIS_CIMAF, SUPERTRAK
  - Other (`discount_configured = false`): CMI, SERCO, DIAMOND_Z
- **1 freight zone** in `qb_freight_zones`: ASV for FL, $1,942 large / $777 small, effective 2026-01-01
- **10 stacking rules** in `qb_program_stacking_rules`: CIL × financing = false, CIL × aged = true, financing × aged = true, GMU × everything else = false, bridge × everything else = false

### TypeScript

- `apps/web/src/lib/database.types.ts` regenerated via Supabase MCP. UserRole re-export preserved at the tail.
- `apps/web/src/types/quote-builder.ts` — new file with Row/Insert wrappers for all 12 QB tables, string-union types matching DB check constraints, JSONB payload shape interfaces (`QbCashInLieuDetails`, `QbLowRateFinancingDetails`, etc.), and money helpers (`formatCents`, `dollarsToCents`, `formatPct`).

---

## Acceptance Criteria — Verified at Ship

- [x] Migrations 283–290 applied cleanly to staging and registered under numeric versions in `supabase_migrations.schema_migrations`
- [x] All 13 brands seeded; 3 flagged `discount_configured = true`, 10 flagged `false`
- [x] FL freight zone seeded for ASV
- [x] 10 stacking rules seeded
- [x] Audit smoke test passed: insert → update → delete on `qb_brands` produces exactly 3 rows in `qb_brands_audit` with correct `action` values; UPDATE row has `changed_fields` diff populated; `updated_at` excluded from diff
- [x] Supabase advisors: clean (only pre-existing `auth_leaked_password_protection` warning unrelated to this slice)
- [x] `bun run typecheck` in `apps/web` passes with no errors
- [x] No `numeric`/`decimal`/`float`/`real` on any new QB money column — grep confirmed zero hits
- [x] `crm_companies` and `crm_equipment` views operate with `security_invoker = true` (verified via `get_advisors`)
- [x] RLS enabled on all 19 new tables

---

## Open Items for Downstream Slices

These aren't blockers for Slice 01, but must be resolved before their respective downstream slices ship.

1. **Forestry brand discount rates** — all 7 forestry brands plus CMI/SERCO/DIAMOND_Z have `discount_configured = false`. Admin UI (Slice 04-adjacent) must let Angela/Rylee set the correct rates before any forestry quote is valid. Pricing engine (Slice 02) checks this flag and refuses to calculate otherwise.
2. **Additional freight zones** — only FL is seeded for ASV. Other state zones and other brands get ingested in Slice 04 via price sheet uploads.
3. **Equipment models catalog is empty** — will be populated via Slice 04 price sheet ingestion, plus manual admin entry for edge cases.
4. **ANTHROPIC_API_KEY** already lives in Supabase function secrets per `iron-knowledge-secrets` memory. Slice 04 (price sheet extraction) and Slice 05 (natural language builder) consume it directly.

---

## What This Slice Explicitly Did NOT Do

- No pricing engine — that's Slice 02, and it depends on this schema
- No UI — that's Slices 05–06
- No Edge Functions — the `qb-calculate`, `qb-parse-request`, and price sheet ingestion functions ship in Slices 02, 04, 05
- No real price sheet data beyond the ASV FL freight seed — Slice 04
- No modifications to existing tables beyond the additive columns in migration 283

---

## Commit Reference

`18d7f2e` on `main`: `[QEP-QB-01] Slice 01 schema foundation — qb_* tables, audit, RLS`
