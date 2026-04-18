# SLICE 06 — Admin UI Polish

**Status:** Planned. Not yet started.

**Depends on:** Slice 05 (Conversational Deal Engine) — shipped 2026-04-17 at `3bd8ff3`.

**Source of truth:** This document reflects the actual repo state after Slice 05 landed and owner Q&A (2026-04-18). All table names, column names, and component paths are verified against the live codebase.

---

## Scope Questions — Need Answer Before Execution

All owner questions resolved 2026-04-18. One technical question remains:

**Q5 — `home-route.test.ts` fix: update source or update test?**
`resolveHomeRoute("owner")` in `apps/web/src/lib/home-route.ts:16` returns `"/owner"`. The test at `apps/web/src/lib/home-route.test.ts` expects `"/qrm"`. Resolution depends on whether `/owner` is an intentional distinct route or a stale holdover from an earlier design. This is a technical read-the-repo call — owner doesn't need to weigh in. Resolve at start of execution by checking whether a working `/owner` route exists in the router; if yes, fix the test; if the route is dead, fix the source.

---

## Resolved Q&A

| Question | Resolution |
|---|---|
| Q1 — Brand discount config: flat rate or deal sweeteners? | QEP does not have a brand discount structure. Instead they bundle a free first-service credit. Replace Item 1 with a **Deal Economics** admin page (see below). |
| Q2 — Freight zones: state-level or ZIP-level? | State-level. Existing `qb_freight_zones` table + new internal rate card together cover inbound + internal freight. No separate zones UI this slice — defer. |
| Q3 — AI log viewer columns | Iron Advisor (rep), Make/Model, Deal size, Customer, Time from entry to quote sent. |
| Q4 — Voice transcripts in log: full or redacted? | Keep full transcripts. Motivation is early Iron AI training data. Retention policy is soft-keep; do not prune aggressively this slice. |
| Q6 — Price sheet freshness: new page or extend existing? | Extend the existing `PriceSheetsPage.tsx`. Add a `last_updated_at` column showing the most recent update per brand, covering both ingested-sheet publishes and manual catalog updates. No new page. |

---

## Objective

Bring the Quote Builder's admin and configuration surfaces to production quality. Slice 05 deferred all admin UI work to keep the Conversational Deal Engine scope tight. This slice closes that gap: it introduces QEP's actual deal economics (service credits + internal freight rules), adds ops visibility into AI parse quality, and surfaces price sheet freshness without requiring anyone to open a database console.

---

## Why This Slice

The deal engine shipped in Slice 05 but has three structural gaps:

**1. QEP's actual deal sweeteners are not modeled.**
QEP does not compete on discount percentage. They compete on total cost of ownership, and their differentiation is a bundled free first-service credit (typically $1,500–$3,500 depending on machine size) plus a travel allowance from the Lake City or Ocala dealership. These values are currently hardcoded nowhere — they exist in salespeople's heads. Without a configurable service credit table and internal freight rate card, the Conversational Deal Engine cannot build scenarios that reflect what QEP actually offers customers.

**2. `qb_ai_request_log` is dark.**
Migration 298 created the telemetry table but there is no UI. The team cannot see how well the AI is resolving prompts, what reps are asking, or where the engine fails. This is especially important early in deployment when prompt patterns are unknown.

**3. Price sheet freshness is opaque.**
The 6 seeded ASV models use approximate prices from public spec sheets. Angela has no way to see which brands have official ingested prices vs. seed/approximate data at a glance — she has to remember what she has and hasn't uploaded.

---

## What This Slice Unblocks

- **Deal scenarios that include QEP service credits** — once the Deal Economics tables exist, `qb-ai-scenarios` can pull the right credit amount for each machine category and fold it into the scenario summary
- **Internal freight accuracy** — the rate card replaces the `$1,942` ASV FL fallback for all equipment types and delivery distances
- **Brand freight transparency** — the `has_inbound_freight_key` flag replaces implicit fallback behavior with explicit per-brand routing: either use the ingested freight key or insert "Inbound freight: TBD at ship"
- **Ops visibility** into AI parse quality from day one of rep usage
- **Angela self-service** on price sheet freshness status

---

## Scope Decisions (locked)

| Decision | What ships |
|---|---|
| Deal economics | New `qb_service_credit_config` and `qb_internal_freight_rules` tables + `has_inbound_freight_key` on `qb_brands` (migration 300) |
| Freight zone UI | **Deferred** — existing `qb_freight_zones` table + new internal rate card cover state inbound + internal routing without a new admin surface this slice |
| AI log columns | Iron Advisor, Make/Model (with list price as deal size proxy), Customer (customer_type field), Time-to-quote (see R5 below) |
| Voice transcript retention | Full transcripts, soft-keep; no pruning cron this slice |
| Price sheet freshness | `last_updated_at` column added to brand rows on existing `PriceSheetsPage.tsx` — no new page |
| home-route fix | Technical call at execution time (Q5 above) |

---

## In-Scope Items

### Item 1 — Deal Economics Admin Page

**What:** Admin-editable page covering QEP's three deal-economics levers: service credit defaults by machine category, internal freight rate card, and per-brand inbound freight key flag. All values are data-driven — nothing hardcoded. The Conversational Deal Engine reads from these tables at scenario-build time.

---

#### 1a — Free Service Credits

QEP includes a free first-service visit with every machine sale. The credit amount and travel budget are configurable per equipment category. These default values are stored in `qb_service_credit_config` (one row per workspace_id + category).

**Categories and default values:**
| Category | Credit | Travel budget |
|---|---|---|
| `compact` — compact construction (CTL, skid steer, small excavator) | $1,500 | $200 |
| `large` — large construction (large excavator, dozer) | $2,500 | $200 |
| `forestry` — all forestry brands | $3,500 | $200 |

The travel budget ($200) represents the dollar amount of travel expense from either the Lake City or Ocala dealership that QEP absorbs. It is NOT miles — it is a dollar cap on travel cost. It is shared across all categories but stored per row for future flexibility.

**UI:** A simple 4-field form (3 credit amounts + 1 travel budget). Save upserts all 3 category rows atomically.

**Acceptance criteria:**
- [ ] Admin can view current credit amounts and travel budget, pre-populated from DB
- [ ] Admin can edit any value and save; page shows success confirmation
- [ ] Saving updates all 3 `qb_service_credit_config` rows for the workspace via upsert
- [ ] `bun run typecheck` passes with new DB types for `qb_service_credit_config`
- [ ] Role gate: `admin`/`manager`/`owner` only for writes; `rep` sees read-only values

---

#### 1b — Internal Freight Rate Card

When delivering a machine from QEP's lot to a customer site, the delivery cost depends on machine weight and delivery distance. This rate card is how Angela prices it without calling the trucking company every time.

**Rate rule schema (one row per rule):**
- `weight_from_lbs` / `weight_to_lbs` — weight range in pounds (NULL = unbounded)
- `distance_from_miles` / `distance_to_miles` — distance range in miles from QEP lot
- `rate_type` — `'flat'` (flat dollar amount), `'per_mile'` (per-mile charge), `'per_cwt'` (per-hundredweight)
- `rate_amount_cents` — the rate value in cents
- `priority` — tie-break when multiple rules match (lower = higher priority)

Iron Advisor picks the **first matching rule** (ordered by priority asc) at quote time.

**UI:** Editable table. Admin can add a new row, edit inline, delete with confirmation. Table shows all rules for the workspace sorted by priority.

**Acceptance criteria:**
- [ ] Admin can view all rate rules in a sortable table
- [ ] Admin can add a new rule (modal or inline form with all fields)
- [ ] Admin can edit an existing rule
- [ ] Admin can delete a rule (confirm dialog; hard delete)
- [ ] Priority field accepts positive integers; table re-sorts on save
- [ ] `rate_type` is a select: Flat amount / Per mile / Per hundredweight (cwt)
- [ ] Role gate: same as 1a

---

#### 1c — Brand Freight Keys

When a price sheet is ingested, it may include a manufacturer freight key (a table of rates from the factory to dealer by zone or state). If a brand has a freight key in the ingested sheet, use it for inbound freight. If not, insert a placeholder line on the quote: "Inbound freight: TBD at ship" so the rep knows to follow up manually.

**UI:** A read-modify table showing all 13 brands with a toggle per brand.

| Brand | Has inbound freight key |
|---|---|
| ASV | ✓ on |
| Yanmar | ✓ on |
| Develon | ✓ on |
| Bandit | ✗ off |
| Barko | ✗ off |
| … | … |

**Acceptance criteria:**
- [ ] Admin can see all 13 brands with current `has_inbound_freight_key` toggle state
- [ ] Toggling a brand updates `qb_brands.has_inbound_freight_key` immediately (optimistic update)
- [ ] `discount_configured` flag is NOT touched by this UI (separate concern)
- [ ] Role gate: same as 1a

---

### Item 2 — Freight Zone Management UI

**Deferred to a later slice.**

Rationale: the existing `qb_freight_zones` table (inbound freight from manufacturer by state/brand) combined with the new `qb_internal_freight_rules` table (outbound delivery from QEP lot) covers the operational freight use cases for Slice 06. A full CRUD UI for `qb_freight_zones` can ship when Angela has uploaded price sheets for more brands and needs to manage their inbound zones explicitly. No `qb_freight_zones` UI this slice.

---

### Item 3 — `qb_ai_request_log` Ops Viewer

**What:** Read-only admin dashboard for the telemetry table created in migration 298. Gives the team visibility into deal engine usage, parse accuracy, and failure patterns — essential in the first weeks of rep adoption.

**Table schema reference (`qb_ai_request_log` — migration 298):**
```
id, workspace_id, user_id, raw_prompt, resolved_brand_id, resolved_model_id,
model_candidates (jsonb), confidence (jsonb), delivery_state, customer_type,
latency_ms, error, prompt_source ('text'|'voice'), created_at
```

**Column design (owner-specified):**

| Displayed column | Data source | Notes |
|---|---|---|
| Iron Advisor | `user_id` → join to user profile/email | Show display name or email; requires a join to `auth.users` or a `profiles` table |
| Make / Model | `resolved_brand_id` + `resolved_model_id` → join to `qb_brands` + `qb_equipment_models` | Show "ASV RT-135" or "Unresolved" if null |
| Deal size | `qb_equipment_models.list_price_cents` via `resolved_model_id` | List price as proxy for deal size; blank if model unresolved |
| Customer | `customer_type` field (`standard` \| `gmu` \| null) | Display as "Standard" / "GMU" / "—" |
| Time to quote sent | Correlated lookup in `qb_quotes` by `(salesman_id = user_id, created_at proximity)` | Complex — see R5 in Risks; treat as best-effort for Slice 06 |

**Additional display elements:**
- Stats bar (top): total requests (7d), resolve rate (resolved_model_id not null / total), voice vs. text split
- Date range filter: Last 7d / Last 30d / All time
- Filter by prompt source (text / voice)
- Row color coding: green = model resolved + no error; yellow = unresolved + no error; red = error present
- Row expansion: full `raw_prompt`, `model_candidates` JSON (formatted), full `confidence` object, `error` text if any
- Retention note visible in page header: "Logs are kept in full to support Iron AI training. Retention policy: soft-keep, no scheduled pruning."

**Acceptance criteria:**
- [ ] Admin can reach page and see all log entries for their workspace
- [ ] Stats bar shows accurate resolve rate and voice/text split for selected date range
- [ ] Date range filter changes the table and stats bar contents
- [ ] All 5 owner-specified columns render with correct data or graceful fallbacks
- [ ] Row expansion shows full `raw_prompt` (no truncation), candidates JSON, confidence object
- [ ] `rep` role cannot access this page (role gate in routing or component guard)
- [ ] Page handles zero entries gracefully
- [ ] Pagination at 50 rows (or virtual scroll) — no full-table dump to DOM

---

### Item 4 — Price Sheet Freshness on `PriceSheetsPage.tsx`

**What:** Extend the existing `apps/web/src/features/admin/pages/PriceSheetsPage.tsx` to show a `last_updated_at` column per brand, covering both ingested-sheet publishes (from `qb_price_sheets.published_at`) and manual catalog entry updates (from `qb_equipment_models.updated_at` or `qb_brands.updated_at`). No new page or route.

**`last_updated_at` derivation per brand:**
```
MAX(
  qb_price_sheets.published_at  WHERE brand_id = ? AND status = 'published',
  qb_brands.updated_at          WHERE id = ?
)
```
This covers the two update paths: price sheet ingestion pipeline (Slice 04) and any direct catalog edits (admin manually correcting a price). Computed client-side from two Supabase queries already needed to render the page.

**Display:**
- "Last refreshed" column in the brand summary band at the top of PriceSheetsPage
- Value: relative timestamp ("3 days ago", "2 months ago") with ISO tooltip on hover
- Color hint: green if < 30 days, yellow if 30–90 days, red if > 90 days or null (never updated)
- Covers all 13 brands — brands with no sheets show "Never" in red

**Acceptance criteria:**
- [ ] Existing PriceSheetsPage upload and review workflow is unchanged
- [ ] Brand summary band shows `last_updated_at` for all 13 brands
- [ ] Freshness color coding matches thresholds above
- [ ] Hovering shows exact ISO timestamp
- [ ] "Never" shown in red for brands with no published sheet and no brand-level updates

---

### Item 5 — Fix `home-route.test.ts` Pre-existing Failure

**What:** Resolve the `resolveHomeRoute("owner")` mismatch. Source (`apps/web/src/lib/home-route.ts:16`) returns `"/owner"`; test expects `"/qrm"`. Resolve at execution time per Q5 guidance above.

**Acceptance criteria:**
- [ ] `bun test apps/web/src/lib/home-route.test.ts` exits 0, 0 failures
- [ ] No other routing tests broken by the change
- [ ] `bun test apps/web/src/lib apps/web/src/features/quote-builder/lib` exits 0, all pass

---

## Out of Scope for Slice 06

- `qb_freight_zones` CRUD UI — deferred (see Item 2 above)
- `qb_brands` discount/markup field editing — QEP does not use a dealer discount structure; these fields remain DB-only until a future slice identifies a use case
- `qb_programs` eligibility admin UI — separate surface, later slice
- P50/P95 latency SLA alerting (future analytics pass)
- AI log pruning / retention cron — soft-keep policy, no delete this slice
- New pricing engine features or formula changes (Slice 07)
- Scenario → quote save flow refinement (Slice 07 open item)
- CRM / HubSpot integration (QRM Phase 1 track)

---

## Migration Plan

**Migration 300 is required for this slice.**

### Current migration state

| # | File | Purpose |
|---|---|---|
| 297 | `297_qb_notifications_hardening.sql` | Last Slice 03/04 migration |
| 298 | `298_qb_fuzzy_search_ai_log.sql` | `qb_ai_request_log` + `qb_search_equipment_fuzzy()` RPC |
| 299 | `299_qb_demo_equipment_models.sql` | 6 ASV CTL seed models |

### Migration 300 — `300_qb_deal_economics.sql`

Three changes in one file:

**1. `qb_service_credit_config` — service credit defaults per equipment category**

```sql
create table public.qb_service_credit_config (
  workspace_id         text        not null default 'default',
  category             text        not null check (category in ('compact', 'large', 'forestry')),
  credit_cents         int         not null,
  travel_budget_cents  int         not null,
  updated_at           timestamptz not null default now(),
  primary key (workspace_id, category)
);
-- RLS: all authenticated read; admin/manager/owner write
-- Seed: 3 rows for workspace 'default' with defaults from owner spec
```

**2. `qb_internal_freight_rules` — internal delivery rate card**

```sql
create table public.qb_internal_freight_rules (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        text        not null default 'default',
  weight_from_lbs     int,
  weight_to_lbs       int,
  distance_from_miles int,
  distance_to_miles   int,
  rate_type           text        not null check (rate_type in ('flat', 'per_mile', 'per_cwt')),
  rate_amount_cents   bigint      not null,
  priority            int         not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Index: btree on (workspace_id, priority) for rule selection ordering
-- Index: btree on (workspace_id, weight_from_lbs, weight_to_lbs) for weight range narrowing
-- RLS: all authenticated read; admin/manager/owner write
```

**3. `qb_brands` column addition**

```sql
alter table public.qb_brands
  add column has_inbound_freight_key boolean not null default false;

-- Seed known brands with freight keys from ingested price sheets:
update public.qb_brands set has_inbound_freight_key = true
  where code in ('ASV', 'YANMAR', 'DEVELON');
-- All other brands default false
```

**RLS note:** `qb_service_credit_config` and `qb_internal_freight_rules` need RLS policies. Pattern follows other catalog tables in `289_qb_rls.sql`:
- SELECT: `auth.role() = 'authenticated'`
- INSERT/UPDATE/DELETE: `get_my_role() IN ('admin', 'manager', 'owner')`

---

## Edge Function Work

**None required for Slice 06.** All operations use direct Supabase client calls from the browser. The existing RLS policies (plus new ones in migration 300) handle role gating at the DB layer.

| Operation | Table | Client call pattern |
|---|---|---|
| Read service credits | `qb_service_credit_config` | `.from('qb_service_credit_config').select('*').eq('workspace_id', ws)` |
| Upsert service credits | `qb_service_credit_config` | `.upsert([...3 rows], { onConflict: 'workspace_id,category' })` |
| Read/write freight rules | `qb_internal_freight_rules` | `.select` / `.insert` / `.update` / `.delete` |
| Toggle freight key | `qb_brands` | `.update({ has_inbound_freight_key: bool }).eq('id', id)` |
| Read AI log | `qb_ai_request_log` | `.select(*, qb_brands(*), qb_equipment_models(*))` with RLS filtering |
| Price sheet freshness | `qb_price_sheets` | `.select('brand_id, published_at').eq('status', 'published')` + `qb_brands` query |

**Future consideration:** Once Deal Economics tables exist, `qb-ai-scenarios` should read `qb_service_credit_config` and `qb_internal_freight_rules` to fold service credits into scenario outputs. That wire-up is Slice 07 scope.

---

## Frontend Work

All new and modified files follow existing conventions under `apps/web/src/features/admin/`.

### New Pages

```
apps/web/src/features/admin/pages/
├── DealEconomicsPage.tsx        // Items 1a + 1b + 1c — service credits, freight rules, brand freight keys
└── AiRequestLogPage.tsx         // Item 3 — AI log viewer: stats bar + filterable table
```

### New Components

```
apps/web/src/features/admin/components/
├── deal-economics/
│   ├── ServiceCreditForm.tsx       // 4-field form: compact/large/forestry credit + travel budget
│   ├── FreightRuleTable.tsx        // Editable table of internal freight rules with add/edit/delete
│   ├── FreightRuleForm.tsx         // Add/edit modal: weight range, distance range, rate type, amount, priority
│   └── BrandFreightKeyTable.tsx    // 13-brand toggle table for has_inbound_freight_key
└── ai-log/
    ├── AiLogStatsBar.tsx           // Resolve rate, voice/text split, date range selector
    └── AiLogTable.tsx              // Sortable table: Iron Advisor, Make/Model, Deal size, Customer, Time-to-quote
```

### Modified Files

| File | Change |
|---|---|
| `apps/web/src/features/admin/pages/PriceSheetsPage.tsx` | Add brand summary band with `last_updated_at` freshness column (Item 4) |
| `apps/web/src/lib/home-route.ts` | Fix `resolveHomeRoute("owner")` return value (Item 5 — direction TBD at execution per Q5) |
| Admin router (verify path at execution) | Add routes: `/admin/deal-economics`, `/admin/ai-log` |
| `apps/web/src/lib/database.types.ts` | Regenerate after migration 300 applies (`supabase gen types`) |

> **Note on admin router:** The file that registers `/admin/*` routes (likely in `apps/web/src/app/` or `apps/web/src/routes/`) has not been located in research. Find it by searching for where `BranchManagementPage` or `RentalPricingPage` is imported as a route — that is the file to extend.

### New Lib Files

```
apps/web/src/features/admin/lib/
├── deal-economics-api.ts    // getServiceCredits(), upsertServiceCredits(), listFreightRules(),
│                            // createFreightRule(), updateFreightRule(), deleteFreightRule(),
│                            // toggleBrandFreightKey()
└── ai-log-api.ts            // listLogEntries(filters), getLogStats(since)
```

---

## Test Plan

### Unit Tests

| Test file | What to test |
|---|---|
| `apps/web/src/lib/home-route.test.ts` | Already written — passes after Item 5 fix |
| `apps/web/src/features/admin/lib/__tests__/deal-economics-api.test.ts` | Mock Supabase; assert `upsertServiceCredits()` sends all 3 category rows; assert `deleteFreightRule()` hits `.delete().eq('id', ...)` |
| `apps/web/src/features/admin/lib/__tests__/ai-log-api.test.ts` | Mock Supabase; assert `getLogStats()` resolve rate = non-null `resolved_model_id` count / total |

### RLS Integration Checks

| Scenario | Expected result |
|---|---|
| `rep` role upserts `qb_service_credit_config` | Blocked by RLS |
| `admin` role upserts `qb_service_credit_config` | Succeeds |
| `rep` role inserts `qb_internal_freight_rules` | Blocked by RLS |
| `admin` role inserts `qb_internal_freight_rules` | Succeeds |
| `admin` role deletes `qb_internal_freight_rules` row | Succeeds |
| `rep` updates `qb_brands.has_inbound_freight_key` | Blocked by RLS |
| `admin` updates `qb_brands.has_inbound_freight_key` | Succeeds |
| `rep` selects `qb_ai_request_log` | Own rows only (`user_id = auth.uid()`) |
| `admin` selects `qb_ai_request_log` | All workspace rows |
| Any user inserts `qb_ai_request_log` directly | Blocked — no user INSERT policy |

### Build Gate

- `bun run migrations:check` — migration 300 applies cleanly
- `bun run typecheck` in `apps/web` → exit 0 (types regenerated after migration)
- `bun run build` from repo root → exit 0
- `bun run build` in `apps/web` → exit 0
- `bun test apps/web/src/lib apps/web/src/features/admin/lib` → 0 failures

---

## Sequencing

1. **Migration 300 first** — all three DB changes in one file. Apply to staging and regenerate `database.types.ts` before writing any frontend code that touches the new tables.
2. **Item 5** (home-route fix) — 10-minute change, clears the pre-existing test failure immediately.
3. **Item 1** (Deal Economics page) — highest operator value; unblocks future `qb-ai-scenarios` wire-up. Ship 1a (service credits) before 1b (freight rules) since it's simpler; 1c (freight keys) is a toggle and can ship alongside either.
4. **Item 4** (price sheet freshness) — frontend-only change to an existing page, low risk, can ship in parallel with Item 3.
5. **Item 3** (AI log viewer) — read-only observability surface, no operator workflow dependency. Ships last; most useful after reps have run real deals in staging.

---

## Risks and Known Unknowns

**R1 — Admin router registration path unknown.**
The file registering `/admin/*` routes has not been located. Find it by searching for where `BranchManagementPage` or `RentalPricingPage` is imported as a route. Verify the pattern (React Router v6 `<Route>`, Tanstack Router, etc.) before adding new routes.

**R2 — `discount_configured` flag on `qb_brands` is now semantically orphaned.**
Slice 05 emits a non-fatal error when `discount_configured = false`. Now that QEP is not using the discount structure, this flag's meaning has shifted. The 10 brands still have `discount_configured = false`, and the deal engine still surfaces the error. Slice 06 does not fix this unless the error text is updated to match the new Deal Economics framing ("Service credit rates not yet configured" vs. "Discount rates not configured"). Flag for product review — could be a one-line edge function copy change or deferred to when Deal Economics wire-up happens in Slice 07.

**R3 — `qb_freight_zones` DELETE RLS not verified.**
The Slice 01 plan states catalog tables have admin/manager/owner write access but does not confirm whether "write" covers DELETE. If a freight zone UI is ever added, confirm `289_qb_rls.sql` policy includes `FOR DELETE`. No action needed this slice since the zones UI is deferred.

**R4 — "Time from entry to quote sent" is a derived metric requiring correlation.**
The `qb_ai_request_log` table has no `quote_id` FK. Computing "time from AI parse to quote sent" requires correlating log entries to `qb_quotes` by `(salesman_id, model proximity, date proximity)` — which is heuristic and may produce false matches. Options for Slice 06: (a) show the column as "—" until a future slice adds a `log_id` FK to `qb_quotes`; (b) compute a best-effort match and display with a "~" indicator. Either way, document the limitation in the UI tooltip. A clean solution requires `qb_quotes.originating_log_id uuid references qb_ai_request_log(id)` — add as a Slice 07 schema note.

**R5 — "Customer" column maps to `customer_type`, not a customer name.**
The `qb_ai_request_log` schema has no customer name field — only `customer_type` ('standard' | 'gmu' | null) and the raw prompt text. The displayed "Customer" column will show "Standard" / "GMU" / "—". If the owner expects an actual customer name here, that requires a future schema change to store parsed customer identity from the prompt.

**R6 — Service credit upsert atomicity.**
`upsertServiceCredits()` sends 3 rows to `qb_service_credit_config`. If the upsert partially fails (row 2 of 3 errors), the table will be in an inconsistent state. Use Supabase's single `.upsert([...3 rows])` call (single DB round-trip) rather than 3 sequential calls. Wrap in a try/catch and surface a single error if any row fails.

**R7 — `has_inbound_freight_key` toggle affects live quote behavior immediately.**
Toggling a brand's freight key flag is an instant live-data change — no staging or review step. If Angela accidentally toggles ASV to `false`, all new ASV quotes will show "Inbound freight: TBD at ship" until she toggles it back. The UI should show a confirmation on toggle-to-false (not on toggle-to-true) since turning off is the more consequential direction.

---

## Commit / Branch Convention

- Branch: `claude/qep-qb-06-admin-ui-polish`
- Commit prefix: `[QEP-QB-06]`
- Example commits:
  - `[QEP-QB-06] Migration 300: deal economics tables + has_inbound_freight_key on qb_brands`
  - `[QEP-QB-06] Fix home-route owner path`
  - `[QEP-QB-06] Deal Economics page — service credits, freight rules, brand freight keys`
  - `[QEP-QB-06] Price sheet freshness column on PriceSheetsPage`
  - `[QEP-QB-06] AI request log viewer — AiRequestLogPage + stats bar + table`
