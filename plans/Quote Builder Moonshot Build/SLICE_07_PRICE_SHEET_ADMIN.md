# SLICE 07 — Price Sheet Admin + Freight Zones + Discount Cleanup

**Status:** Planned. Awaiting owner Q&A before execution.

**Depends on:** Slice 06 (Admin UI Polish) — shipped 2026-04-18 at `ebed3f4`. PR #2 merged.  
Post-PR cleanup commit: `b4cdea4` (migration allowlist, main branch).

**Branch:** `claude/qep-qb-07-price-sheet-admin`

**Source of truth:** This document reflects repo state after Slice 06 landed and a thorough
read-only audit run on 2026-04-18. All table names, column names, and component paths are
verified against the live codebase. Next migration number: **301**.

---

## Scope Questions — Need Answer Before Execution

Mark each resolved answer below before execution starts.

| # | Question | Stakes | Resolution |
|---|---|---|---|
| Q1 | **Price sheet page scope: read-only dashboard or full upload+review pipeline?** See §Q1 | Scope size 2x difference | Pending |
| Q2 | **Freight zone UI depth: read-only viewer or full CRUD?** See §Q2 | Scope size | Pending |
| Q3 | **`discount_configured` fix approach: error-message-only vs. expose toggle in UI?** See §Q3 | 1 day vs. 3 days | Pending |
| Q4 | **`qb_quotes.originating_log_id` FK — ship in Slice 07 or defer?** See §Q4 | Minimal schema + wire-up | Pending |
| Q5 | **Who reviews extracted price sheet items and approves publish?** See §Q5 | Gating and UX design | Pending |

---

## Q&A Detail

### Q1 — Price sheet page scope

**Background:**  
`PriceSheetsPage.tsx` **does not exist**. The Slice 06 plan's Q6 resolution said "extend the
existing PriceSheetsPage.tsx — no new page," but the page was never built in Slice 04 either.
The existing infrastructure (created in Slice 04) is:

- `apps/web/src/lib/pricing/price-sheet-reminders.ts` — computes per-brand freshness urgency
  from `qb_price_sheets` where `status='published'`. Covers ASV (quarterly programs + annual
  price book), YANMAR (quarterly programs), DEVELON (quarterly programs), all others (6-month).
- `supabase/functions/extract-price-sheet/` — edge function: receives file + brand_id, sends
  to Claude for extraction, writes `qb_price_sheet_items` / `qb_price_sheet_programs` rows
  with `review_status='pending'`.
- `supabase/functions/publish-price-sheet/` — edge function: applies approved items to catalog
  (`qb_equipment_models`, `qb_attachments`, `qb_freight_zones`, `qb_programs`), marks sheet
  `status='published'`.

**Option A — Read-only freshness dashboard (smallest scope, ~2 days):**  
Build `PriceSheetsPage.tsx` showing a table of all 13 brands with: brand name, category,
sheet type (price_book / retail_programs), last published date, urgency badge
(overdue / upcoming / current). Uses `getPendingUpdates()` from `price-sheet-reminders.ts`.
No upload UI. Angela sees the status board and uploads sheets via Supabase dashboard or a
future slice's upload UI.

**Option B — Status dashboard + file upload trigger (~4 days):**  
Option A plus a drag-drop file upload component per brand that calls `extract-price-sheet`
and creates a `qb_price_sheets` row with `status='pending_review'`. No review UI yet —
Angela still approves via Supabase dashboard.

**Option C — Full pipeline: upload + review + publish (~8 days):**  
Option B plus a review/approval UI for `qb_price_sheet_items` and
`qb_price_sheet_programs`: paginated table of extracted rows, approve/reject/modify per
row, bulk-approve-all, then publish. This is the complete admin experience.

**Recommended:** Option A for Slice 07 (unblocks the metric visibility Brian asked for),
Option B+C planned for Slice 08. But owner decides.

---

### Q2 — Freight zone UI depth

**Background:**  
`qb_freight_zones` schema (migration 284):

```
brand_id         uuid  → qb_brands.id
zone_name        text  (e.g. "FL")
state_codes      text[] (e.g. ['FL'])
freight_large_cents  bigint
freight_small_cents  bigint
effective_from   date
effective_to     date
```

Currently **1 row**: ASV / FL / $1,942 large / $777 small / effective 2026-01-01.

The `FALLBACK_FREIGHT_CENTS = 194200` hardcode in `supabase/functions/qb-ai-scenarios/index.ts`
is not a fake stub — it IS the real ASV FL rate from seed data. The fallback fires when
`qb_freight_zones` has no matching row for a given brand+state combination. As Angela uploads
more brands' price sheets (Yanmar, Develon, etc.), new zones are written by `publish-price-sheet`.
The hardcode becomes less relevant over time but is never wrong for ASV/FL.

**Option A — Read-only zone viewer (~0.5 days):**  
A table within PriceSheetsPage (or DealEconomicsPage tab) showing current zones:
brand, zone name, states, large rate, small rate, effective dates. No add/edit/delete.
Admin can see what's seeded. Useful for audit but not for Angela entering zones manually.

**Option B — Full CRUD UI (~2 days):**  
Add/edit/delete freight zones per brand. Includes a state-codes multi-select, rate inputs
in dollars (convert to cents), effective date range. RLS already supports write for
admin/manager/owner (migration 289). DELETE RLS was flagged as unverified in Slice 06 R3 —
confirm before enabling delete in UI.

**Note on DELETE RLS (Slice 06 R3 carry-forward):** `289_qb_rls.sql` policy for
`qb_freight_zones` uses `FOR ALL` for the write policy (line 83-84), which covers DELETE
at the Postgres policy level. Verify in `289_qb_rls.sql` before enabling UI delete.

**Recommended:** Option A is sufficient for Slice 07 if upload pipeline is also deferred.
Option B ships alongside or after the upload pipeline (once zones are being created by
published price sheets, Angela needs to edit/correct them).

---

### Q3 — `discount_configured` cleanup

**Background:**  
`qb_brands.discount_configured boolean` — 3 construction brands = true, 10 forestry/other = false.

**Readers (verified):**
- `apps/web/src/lib/pricing/calculator.ts:70` — throws `DISCOUNT_NOT_CONFIGURED` error
- `supabase/functions/qb-calculate/index.ts:236` — passes flag to calculator
- `supabase/functions/qb-ai-scenarios/index.ts:315` — surfaces non-fatal error if false
- `apps/web/src/lib/pricing/types.ts:323` — type definition
- `apps/web/src/lib/database.types.ts:13352` — generated type

**The flag is still semantically correct.** It gates brands where QEP has not yet configured
their pricing inputs. Slice 06 replaced the *label* (discount % → deal economics) but the
*guard* is still needed — Angela hasn't set up forestry brand rate inputs yet.

**The problem:** The error message `DISCOUNT_NOT_CONFIGURED` and the column name are
confusing to anyone reading the code post-Slice 06. The Slice 06 plan flagged this
(R2) but explicitly deferred.

**Option A — Error message update only (~0.5 days, cheapest):**  
No migration. Update error message in `qb-calculate` and `qb-ai-scenarios` from
"Discount not configured for this brand" → "Deal engine not yet configured for this brand
(contact admin)". Optionally add `COMMENT ON COLUMN` in migration 301. No rename of
column or error code. No UI surface.

**Option B — Column rename to `deal_engine_enabled` (~2 days):**  
Migration 301: `ALTER TABLE qb_brands RENAME COLUMN discount_configured TO deal_engine_enabled`.
Update 10 callsites: `calculator.ts`, `qb-calculate`, `qb-ai-scenarios`, `types.ts`,
`database.types.ts`, 7 test fixtures. High change count, zero functional gain. Not recommended.

**Option C — Add toggle to DealEconomicsPage > new "Brand Engine Status" tab (~1.5 days):**  
Keep column name as-is. Add a fourth tab to the existing `DealEconomicsPage` (which already
has Service Credits / Internal Freight Rules / Brand Freight Keys tabs). New tab shows
all 13 brands with a toggle: "Deal engine enabled" (backed by `discount_configured`).
Angela can flip forestry brands to `true` once she has configured their pricing inputs.
This is the highest operator value of the three options — it surfaces the flag as a product
concept rather than leaving it buried.

**Recommended:** Option A + Option C. Ship Option A immediately (error message), Option C
as part of the DealEconomicsPage extension in this slice.

---

### Q4 — `qb_quotes.originating_log_id` FK

**Background:**  
Slice 06 R4 identified this gap: `qb_ai_request_log` has no FK to `qb_quotes`, so
`AiRequestLogPage` cannot compute accurate "time from AI parse to quote sent" — it would
require heuristic correlation (wrong). The clean fix is:

```sql
-- In migration 301:
alter table public.qb_quotes
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;
```

`qb-ai-scenarios` writes this when it creates/updates a quote from a scenario.

**Option A — Ship in Slice 07 (schema only, ~0.5 days):**  
Add the column in migration 301. Wire `qb-ai-scenarios` to set `originating_log_id` when
a quote is created from a session. `AiRequestLogPage` can then show a "→ Quote" link and
compute time-to-quote accurately. No UI change needed beyond adding a column to the log table.

**Option B — Defer to Slice 08:**  
AiRequestLogPage shows "—" for time-to-quote (already the documented behavior). No migration.

**Recommended:** Option A — it's a small schema change that pays off immediately in
the log UI without complicating this slice.

---

### Q5 — Who reviews extracted price sheet items?

**Background:**  
When Angela uploads a price sheet and `extract-price-sheet` runs, it populates
`qb_price_sheet_items` and `qb_price_sheet_programs` with `review_status='pending'`.
`publish-price-sheet` requires items to be approved before applying them. Currently no
frontend review UI exists — approval requires direct DB access.

**Question:** Who approves? Angela alone? Any admin/manager/owner? Is there a need for a
review UI in Slice 07, or is Supabase dashboard access sufficient for now?

This question gates whether Option B or C in Q1 is the right scope for the pipeline.

---

## Objective

Build the admin UI layer that makes the Quote Builder's data pipeline observable and
manageable by Angela/Rylee without requiring database access. Slice 06 delivered deal
economics configuration. Slice 07 delivers visibility and control over:

1. Price sheet freshness — which brands are current, overdue, or missing
2. Freight zone data — what inbound freight rates exist per brand
3. Deal engine enablement — which brands are ready for the quote engine

---

## Why This Slice

The pipeline built in Slices 01–06 is operationally dark:
- Angela cannot see which brand price sheets are current or overdue without querying the DB
- There is no UI to upload price sheets and trigger the Claude extraction pipeline
- The 10 forestry/other brands are silently blocked from quoting with no clear admin path to unblock them
- `qb_freight_zones` has 1 row (ASV/FL); every other brand falls back to a hardcoded rate
- The `qb_ai_request_log` "time-to-quote" metric shows "—" for all rows

---

## In-Scope Items (pending Q&A resolution)

### Item 1 — `PriceSheetsPage.tsx` (new page, admin-gated)

**Route:** `/admin/price-sheets`  
**Role gate:** `["admin", "manager", "owner"]` (matches pattern in `App.tsx:2296`)  
**File:** `apps/web/src/features/admin/pages/PriceSheetsPage.tsx`

**Minimum viable (Option A from Q1):**

A table of all brands tracked in `CADENCE_RULES` plus any brand with an existing
`qb_price_sheets` row, showing:

| Column | Source |
|---|---|
| Brand | `qb_brands.name` |
| Category | `qb_brands.category` |
| Sheet type | `retail_programs` / `price_book` / `both` |
| Last published | `qb_price_sheets.published_at` (most recent where status='published') |
| Urgency badge | `computeUrgency()` from `price-sheet-reminders.ts` |
| Expected period | Q2 2026 / Annual 2026 / etc. |

Urgency badge colors:
- `overdue` → destructive/red
- `upcoming` → warning/amber  
- `current` → success/green
- No data → muted/gray ("Never uploaded")

**Acceptance criteria:**
- [ ] Page renders at `/admin/price-sheets`, gated to admin/manager/owner
- [ ] All 13 brands visible (not just those with cadence rules — include brands with no rules using 6-month fallback)
- [ ] Urgency badges compute correctly (use `getPendingUpdates()` + a supplementary all-brands query)
- [ ] "Last published" shows relative date ("3 months ago") with full ISO date in tooltip
- [ ] Empty state: "No price sheets uploaded yet" for brands with no rows
- [ ] Route registered in `App.tsx` following the `/admin/deal-economics` pattern
- [ ] Nav link added to admin section in sidebar/AppLayout

**Component tree:**
```
PriceSheetsPage.tsx
  └── PriceSheetStatusTable.tsx       ← brand-freshness table
        └── UrgencyBadge.tsx          ← reusable badge (overdue/upcoming/current/none)
```

**API adapter:** `apps/web/src/features/admin/lib/price-sheets-api.ts`  
Queries `qb_brands` joined to `qb_price_sheets` (latest published per brand per sheet_type).

---

### Item 2 — Freight Zone Viewer (sub-tab of PriceSheetsPage)

**Minimum viable (Option A from Q2):**

A second tab or section within `PriceSheetsPage` showing current `qb_freight_zones`:

| Column | Source |
|---|---|
| Brand | `qb_brands.name` via brand_id FK |
| Zone name | `qb_freight_zones.zone_name` |
| States | `qb_freight_zones.state_codes` (comma-joined) |
| Large freight | `freight_large_cents / 100` formatted as USD |
| Small freight | `freight_small_cents / 100` formatted as USD |
| Effective from | `effective_from` |
| Effective to | `effective_to` or "—" |

**Acceptance criteria:**
- [ ] ASV/FL zone ($1,942 large / $777 small) visible
- [ ] Brands with no zones show "No freight zones configured"
- [ ] Data is read-only (no add/edit/delete in Option A)
- [ ] If CRUD is approved (Q2 Option B), add/edit form with state-code multi-select and dollar inputs (convert on save: `Math.round(dollars * 100)`)

---

### Item 3 — `discount_configured` cleanup

**Sub-item 3a — Error message update (no migration needed):**

Update error messages in two edge functions:

- `supabase/functions/qb-calculate/index.ts` — update the human-readable message surfaced on 400 response from "Discount not configured" to "Deal engine not yet configured for this brand. Contact admin to enable it."
- `supabase/functions/qb-ai-scenarios/index.ts:315` — update the non-fatal error event message similarly.

No column rename. No `database.types.ts` change. Error code `DISCOUNT_NOT_CONFIGURED` can stay as-is in `apps/web/src/lib/pricing/errors.ts` (it's an internal code, not user-visible).

**Sub-item 3b — Deal engine toggle tab in DealEconomicsPage (pending Q3 decision):**

Add a fourth tab "Brand Engine Status" to `apps/web/src/features/admin/pages/DealEconomicsPage.tsx`.

Component: `apps/web/src/features/admin/components/DealEconomics/BrandEngineStatusForm.tsx`

Shows all 13 brands as rows with:
- Brand name + category badge
- Toggle: "Deal engine enabled" (reads/writes `qb_brands.discount_configured`)
- Warning on toggle-to-false if any open quotes reference this brand (future safety; can skip for now)

**Acceptance criteria (3a):**
- [ ] `qb-calculate` returns updated message on 400 for unconfigured brands
- [ ] `qb-ai-scenarios` SSE stream emits updated error event text
- [ ] No test fixtures need updating (internal error code unchanged)

**Acceptance criteria (3b):**
- [ ] All 13 brands visible in the tab with correct `discount_configured` state
- [ ] Toggle writes to `qb_brands.discount_configured` via upsert
- [ ] Only admin/manager/owner can see the tab (inherited from DealEconomicsPage gate)
- [ ] Optimistic update with rollback on error

---

### Item 4 — `qb_quotes.originating_log_id` schema addition (pending Q4 decision)

**Migration 301 addition:**

```sql
alter table public.qb_quotes
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;

create index idx_qb_quotes_originating_log
  on public.qb_quotes(originating_log_id)
  where originating_log_id is not null;

comment on column public.qb_quotes.originating_log_id is
  'FK to the qb_ai_request_log row that triggered this quote via the Conversational Deal Engine. '
  'Null for manually-created quotes. Used to compute time-from-AI-parse-to-quote-sent in AiRequestLogPage.';
```

**Wire-up:** `supabase/functions/qb-ai-scenarios/index.ts` — when creating/updating a `qb_quotes`
row from a scenario session, set `originating_log_id` to the current session's log row ID.

**Frontend:** `apps/web/src/features/admin/pages/AiRequestLogPage.tsx` — replace the `—`
placeholder in the "Time to quote" column with the actual duration when the FK is set.

**Acceptance criteria:**
- [ ] Migration 301 applies cleanly (`bun run migrations:check` passes)
- [ ] New quotes created via `qb-ai-scenarios` have `originating_log_id` set
- [ ] `AiRequestLogPage` shows elapsed time (e.g. "4m 23s") when `originating_log_id` is
  linked to a quote with a `created_at`

---

## Data Model Changes

### Migration 301 (`301_qb_slice07_schema.sql`)

All items below are additive; no destructive changes.

```sql
-- ── Item 3a: column comment (cosmetic, no functional change) ─────────────────

comment on column public.qb_brands.discount_configured is
  'True when this brand is fully configured for the deal engine '
  '(service credit rates, freight key, pricing inputs confirmed by admin). '
  'False for forestry and other brands pending Angela''s configuration. '
  'Previously named conceptually as "discount_configured" — the guard is still '
  'valid; the terminology shifted to Deal Economics in Slice 06.';

-- ── Item 4: originating_log_id FK on qb_quotes ───────────────────────────────

alter table public.qb_quotes
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;

create index idx_qb_quotes_originating_log
  on public.qb_quotes(originating_log_id)
  where originating_log_id is not null;

comment on column public.qb_quotes.originating_log_id is
  'FK to the qb_ai_request_log row that triggered this quote via the '
  'Conversational Deal Engine. Null for manually-created quotes. '
  'Used to compute time-from-AI-parse-to-quote-sent in AiRequestLogPage.';
```

No new RLS policies needed: `qb_quotes` and `qb_ai_request_log` RLS already in place
(migrations 289, 298).

**If Q2 Option B approved — add to migration 301:**

```sql
-- Confirm DELETE is covered by existing qb_freight_zones_write policy
-- (289_qb_rls.sql:83 uses FOR ALL which includes DELETE — verified)
-- No new policy needed; document that DELETE is intentionally permitted.
comment on table public.qb_freight_zones is
  'Geography-based inbound freight lookup per brand. '
  'Admin/manager/owner: full CRUD (SELECT/INSERT/UPDATE/DELETE) via RLS. '
  'Service role: unrestricted (edge functions). '
  'Reps: SELECT only.';
```

---

## API / Service Changes

### New: `apps/web/src/features/admin/lib/price-sheets-api.ts`

```typescript
// Exports:
getPriceSheetStatusByBrand(supabase): Promise<BrandSheetStatus[]>
// Joins qb_brands → qb_price_sheets (latest published per brand per sheet_type)
// Returns all 13 brands, even those with no price sheet rows.

getFreightZones(supabase): Promise<FreightZoneRow[]>
// Selects all qb_freight_zones joined to qb_brands.name
```

### Modified: `supabase/functions/qb-calculate/index.ts`
- Update human-readable error message on DISCOUNT_NOT_CONFIGURED path.

### Modified: `supabase/functions/qb-ai-scenarios/index.ts`
- Update non-fatal error event message on `!brand.discount_configured` path.
- (If Q4 approved) Set `originating_log_id` when writing `qb_quotes` row.

### Modified: `apps/web/src/features/admin/pages/DealEconomicsPage.tsx` (if Q3 Option C approved)
- Add fourth tab "Brand Engine Status"

---

## UI Surfaces

| Page | Route | File | Role gate |
|---|---|---|---|
| Price Sheet Status | `/admin/price-sheets` | `features/admin/pages/PriceSheetsPage.tsx` | admin, manager, owner |
| Deal Economics (extended) | `/admin/deal-economics` | `features/admin/pages/DealEconomicsPage.tsx` | admin, manager, owner |

**Route registration pattern** (matches existing admin pages in `App.tsx`):

```tsx
const PriceSheetsPage = lazy(() =>
  import("./features/admin/pages/PriceSheetsPage").then((m) => ({ default: m.PriceSheetsPage }))
);

// In AnimatedRoutes:
<Route
  path="/admin/price-sheets"
  element={
    ["admin", "manager", "owner"].includes(profile.role) ? (
      <PriceSheetsPage />
    ) : (
      <Navigate to="/dashboard" replace />
    )
  }
/>
```

---

## Test Coverage Required

| Test file | What to cover |
|---|---|
| `apps/web/src/lib/pricing/__tests__/reminders.test.ts` | Already has coverage; verify `getPendingUpdates()` is exercised — no new tests needed unless query shape changes |
| `apps/web/src/features/admin/lib/__tests__/price-sheets-api.test.ts` | `getPriceSheetStatusByBrand()` — brand with no sheets returns `lastPublishedAt: null`; brand with published sheet returns correct date; urgency computed correctly |
| Edge function tests | `qb-calculate`: 400 response body updated message asserted; `qb-ai-scenarios`: error event message asserted |
| Migration smoke test | `migrations:check` passes with 301 in sequence |

---

## Build / Release Gates

Per CLAUDE.md, before closing this slice:

1. `bun run migrations:check` — migration 301 in sequence, no gaps
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. Edge function contract tests for `qb-calculate` and `qb-ai-scenarios` (error message paths)
5. Role/workspace security check: verify `/admin/price-sheets` returns 403/redirect for `rep` role

---

## Open Scope Questions (Owner-Facing)

These are the questions Brian/Angela need to answer before execution begins.

**Q1 — How much of the price sheet pipeline ships in Slice 07?**  
Option A: read-only freshness dashboard only (see which brands are current/overdue).  
Option B: A + file upload UI (drag-drop a PDF/Excel to trigger Claude extraction).  
Option C: A + B + review/approve extracted items before publish.  
Recommend starting with A; the pipeline edge functions already exist.

**Q2 — Freight zone UI: view-only or editable?**  
Option A: show current zones in a table (read-only).  
Option B: full add/edit/delete UI per brand.  
If Angela will be entering zones manually (not just waiting for publish-price-sheet to write them), Option B is needed.

**Q3 — How should `discount_configured` surface to Angela?**  
Option A: just update the error messages (no UI).  
Option C: add a "Brand Engine Status" tab to Deal Economics so Angela can toggle brands ready/not-ready with a visible list.  
The tab is the highest operator value since it gives Angela a dashboard of which brands she still needs to configure.

**Q4 — Should the `qb_quotes.originating_log_id` FK ship in Slice 07?**  
It's a small additive migration (~30 lines) that unlocks accurate time-to-quote metrics in AiRequestLogPage. Low risk. Recommend yes.

**Q5 — Who reviews extracted price sheet items before publish?**  
Currently no frontend review UI exists — the extraction pipeline runs but items sit in
`qb_price_sheet_items` with `review_status='pending'` indefinitely. Is Supabase dashboard
access sufficient for Angela to approve items in the short term, or does Slice 07 need to
include the review/approval UI (which is Option C in Q1)?

---

## Out of Scope (Explicit Punts)

| Item | Reason |
|---|---|
| Full price sheet review/approval UI (`qb_price_sheet_items` / `qb_price_sheet_programs` table editor) | Significant scope; plan as Slice 08 once Q5 is answered |
| `discount_configured` column rename to `deal_engine_enabled` | High change count (10+ files), zero functional gain — not worth it |
| Freight zone CRUD (if Q2 Option A chosen) | Defer until Angela is actively uploading multi-brand price sheets |
| Notification / reminder emails for overdue price sheets | Infrastructure exists (`qb_notifications`) but trigger + email template is a separate workstream |
| `qb_programs` freshness tracking | Programs are ingested with price sheets; no separate cadence logic needed yet |
| Removal of `FALLBACK_FREIGHT_CENTS = 194200` from `qb-ai-scenarios` | It's the real ASV/FL rate, not a fake stub — leave it; add a comment clarifying provenance |

---

## Risks and Known Unknowns

**R1 — `PriceSheetsPage.tsx` must be created from scratch.**  
The Slice 06 Q6 resolution said "extend the existing PriceSheetsPage.tsx" but the page
was never built. This slice must create it. No existing patterns to copy for the price sheet
domain — use `DealEconomicsPage.tsx` as the structural template.

**R2 — `getPendingUpdates()` only covers 4 cadence rules (ASV×2, YANMAR, DEVELON).**  
The remaining 9 brands (BARKO, PRINOTH, LAMTRAC, BANDIT, SHEAREX, DENIS_CIMAF, SUPERTRAK,
CMI, SERCO, DIAMOND_Z) fall under the generic "6-month" fallback in `CADENCE_RULES` — but
this fallback is not currently in `CADENCE_RULES` at all. The function only returns items
for brands explicitly listed. The status page needs a supplementary `qb_brands` query to
show ALL brands, then compute the 6-month urgency for unlisted brands in the frontend.

**R3 — `qb_price_sheets.status` enum vs. actual published-at semantics.**  
The reminders library filters `status='published'` to find freshness dates. A sheet with
`status='superseded'` is NOT counted as the latest — which is correct. But a sheet that
was uploaded and extracted but never reviewed/published shows as "Never uploaded" even
though a file exists. This is acceptable UX (unpublished = not official) but worth noting.

**R4 — `qb_freight_zones` delete RLS (Slice 06 R3 carry-forward).**  
`289_qb_rls.sql` line 83: `create policy "qb_freight_zones_write" on public.qb_freight_zones for all`.
`FOR ALL` in Postgres RLS covers SELECT/INSERT/UPDATE/DELETE. Verified: DELETE is permitted
for admin/manager/owner. Safe to expose in CRUD UI if Q2 Option B approved.

**R5 — DealEconomicsPage tab count.**  
Adding a fourth tab ("Brand Engine Status") to `DealEconomicsPage` brings the tab count
to 4. On mobile the `TabsList` may overflow. Use `overflow-x-auto` on `TabsList` or
consolidate into a sidebar nav if tabs grow further.

---

## Commit / Branch Convention

- Branch: `claude/qep-qb-07-price-sheet-admin`
- Commit prefix: `[QEP-QB-07]`
- Example commits:
  - `[QEP-QB-07] Migration 301: qb_brands column comment + qb_quotes.originating_log_id FK`
  - `[QEP-QB-07] PriceSheetsPage: brand freshness dashboard at /admin/price-sheets`
  - `[QEP-QB-07] Freight zone viewer tab in PriceSheetsPage`
  - `[QEP-QB-07] DealEconomicsPage: Brand Engine Status tab (discount_configured toggle)`
  - `[QEP-QB-07] qb-calculate + qb-ai-scenarios: update deal-engine error messages`
  - `[QEP-QB-07] AiRequestLogPage: wire originating_log_id time-to-quote column`
