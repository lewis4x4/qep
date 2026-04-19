# SLICE 07 — Price Sheet Admin + Freight Zones + Discount Cleanup

**Status:** ✅ **SHIPPED** — all 10 CPs complete, all gates green, deployed to staging.

**Branch:** `claude/qep-qb-07-price-sheet-admin` · **Final commit:** see CP10 below
**Smoke test procedure:** [SLICE_07_SMOKE_TEST.md](./SLICE_07_SMOKE_TEST.md)

**Depends on:** Slice 06 (Admin UI Polish) — shipped 2026-04-18 at `ebed3f4`.

---

## Execution Log

| CP | Commit | Shipped | Gates | Notes |
|----|--------|---------|-------|-------|
| CP1 | `c7663b5` | Migration 301 SQL | ✓ | `discount_configured` comment + `qb_quotes.originating_log_id` FK |
| CP1-bis | `df13115` | Types regen | ✓ | After orchestrator applied 301 to staging |
| CP2 | `09b5c4e` | R2 error messages | ✓ | `qb-calculate` freight error updated |
| CP3 | `4c3eca3` | Price Sheets service layer | ✓ (5 tests) | `getBrandSheetStatus`, freight CRUD |
| CP4 | `9f740b7` | Freshness dashboard | ✓ (9 tests) | `PriceSheetsPage`, `UrgencyBadge`, route + nav |
| CP5 | `fd335b7` | Upload drawer | ✓ (14 tests) | `uploadAndExtractSheet` pipeline |
| CP6 | `39fbdb4` | Auto-publish | ✓ (15 tests) | `publish-price-sheet` v3 deployed, `auto_approve` flag |
| CP7 | `ee66109` | Freight zone CRUD | ✓ (49 tests) | `FreightZoneDrawer`, coverage grid, overlap detection |
| CP8 | `f1a1d8b` | `originating_log_id` wire-up | ✓ (59 tests) | `qb-ai-scenarios` v3 deployed, Time-to-Quote column |
| CP9 | `546f3d4` | Deal Engine Status tab | ✓ (65 tests) | `BrandEngineStatusForm` with readiness badges |
| CP10 | _(this commit)_ | Smoke test doc + closeout | ✓ (69 tests) | Full gate re-verify, smoke procedure documented |

**Final gate sweep (CP10):**
- `bun run migrations:check` — 299 files, sequence 001..301 ✓
- `bun x tsc --noEmit` (apps/web) — clean ✓
- `bun test src/features/admin` — **69 pass / 0 fail / 212 assertions** across 5 files ✓
- `bun run build` — ✓ built in 7.09s, exit 0 ✓

**Edge functions deployed to staging `iciddijgonywtxoelous`:**
- `qb-ai-scenarios` v3 — all `complete` SSE events include `logId`
- `publish-price-sheet` v3 — `auto_approve: true` flag support

---

**Source of truth:** All table names, column names, and component paths verified against the
live codebase. Owner Q&A resolved 2026-04-18 (answers folded in below).

---

## Resolved Q&A

| # | Question | Answer |
|---|---|---|
| Q1 | Price sheet pipeline depth | **B — upload UI + auto-publish.** Angela drag-drops a file; `extract-price-sheet` runs; extracted items auto-approve (`review_status='approved'`); `publish-price-sheet` runs immediately. No human review UI this slice. |
| Q2 | Freight zone UI depth | **B — full CRUD.** Add/edit/delete zones per brand. Lives as a tab within `PriceSheetsPage`. Matches Slice 06 Deal Economics editability pattern. |
| Q3 | `discount_configured` cleanup | **A + C.** Update error messages in both edge functions AND add "Brand Engine Status" tab to `DealEconomicsPage`. **Column name stays `discount_configured`** — grepping shows 14 product-code files reference it, above the 10-file rename threshold. UI label = "Deal Engine Enabled". |
| Q4 | `qb_quotes.originating_log_id` FK | **Yes.** Ship in migration 301. Wire `qb-ai-scenarios` to populate it. Unlocks real time-to-quote in AiRequestLogPage. |
| Q5 | Review UI for extracted items | **Skip.** `publish-price-sheet` auto-approves all extracted items on publish. Revisit if extraction quality requires eval data. |

---

## Objective

Build the admin UI that makes the Quote Builder pipeline observable and self-serviceable
by Angela/Rylee without Supabase dashboard access. Three gaps closed:

1. **Price sheet pipeline surface** — upload a file, extraction + publish happen automatically,
   freshness status is visible per brand.
2. **Freight zone CRUD** — Angela can add/edit/delete inbound freight rates per brand as new
   price sheets are ingested.
3. **Deal engine enablement** — the 10 forestry/other brands blocked from quoting get a
   visible toggle; error messages no longer say "discount not configured."

---

## Why This Slice

Slices 01–06 built a complete backend pipeline (extract → review → publish) and deal
economics configuration, but the pipeline is entirely dark to Angela:

- `PriceSheetsPage.tsx` **does not exist** (Slice 04 never built it; Slice 06 deferred it).
- No UI to upload a price sheet and trigger Claude extraction.
- `qb_freight_zones` has 1 row (ASV/FL); every non-ASV, non-FL quote falls back to a
  hardcoded $1,942 rate.
- 10 brands are silently blocked from quoting with a confusing "DISCOUNT_NOT_CONFIGURED"
  error that references a concept QEP doesn't use.
- `AiRequestLogPage` shows "—" for time-to-quote because no FK links log rows to quotes.

---

## Key Design Decisions (locked)

### Auto-publish pipeline (Q1=B, Q5=skip)

Upload flow:
1. Angela drags a file onto a brand's upload zone in `PriceSheetsPage`.
2. Frontend calls `extract-price-sheet` (existing edge function) → creates a
   `qb_price_sheets` row (`status='pending_review'`), streams extraction.
3. Frontend polls `qb_price_sheets.status` until `status='extracted'`.
4. Frontend calls `publish-price-sheet` with an `auto_approve=true` flag.
5. `publish-price-sheet` sets all associated `qb_price_sheet_items` /
   `qb_price_sheet_programs` rows to `review_status='approved'`, then applies them
   to the catalog (`qb_equipment_models`, `qb_attachments`, `qb_freight_zones`, `qb_programs`)
   and marks `status='published'`.

`publish-price-sheet` already handles the apply logic. The only new behavior is the
`auto_approve` flag that skips the human review gate.

### Column rename decision (Q3)

`discount_configured` touches **14 product-code files** (2 edge functions, 3 source files,
1 type file, 1 errors file, 1 test file, 6 test fixtures) — above the 10-file threshold.
**No rename.** The column stays `discount_configured`; the UI surfaces it as
"Deal Engine Enabled". Error code `DISCOUNT_NOT_CONFIGURED` in `errors.ts` stays;
only the human-readable message strings in the two edge functions change.

### Freight zone CRUD placement

Lives as the second tab within `PriceSheetsPage` (not a separate route). Matches how
DealEconomicsPage uses tabs for related configuration surfaces. Route: `/admin/price-sheets`,
tab: "Freight Zones".

---

## Checkpoint Plan

### CP1 — Migration 301

**Files:** `supabase/migrations/301_qb_slice07_schema.sql`

```sql
-- 1. Column comment: update qb_brands.discount_configured semantics
comment on column public.qb_brands.discount_configured is
  'True when this brand is fully configured for the deal engine. '
  'False for forestry and other brands pending admin configuration. '
  'Surfaced in UI as "Deal Engine Enabled". '
  'Column name predates Slice 06 Deal Economics reframe — name unchanged '
  'to avoid blast-radius rename (14 files).';

-- 2. originating_log_id FK on qb_quotes
alter table public.qb_quotes
  add column if not exists originating_log_id uuid
    references public.qb_ai_request_log(id) on delete set null;

create index idx_qb_quotes_originating_log
  on public.qb_quotes(originating_log_id)
  where originating_log_id is not null;

comment on column public.qb_quotes.originating_log_id is
  'FK to the qb_ai_request_log row that triggered this quote via the '
  'Conversational Deal Engine. Null for manually-created quotes. '
  'Enables time-from-AI-parse-to-quote-sent metric in AiRequestLogPage.';
```

No new RLS needed: `qb_quotes` RLS (migration 289) and `qb_ai_request_log` RLS (migration 298)
already cover this column.

**Acceptance criteria:**
- [ ] `bun run migrations:check` passes with 301 in sequence
- [ ] Column exists in staging: `\d qb_quotes` shows `originating_log_id`
- [ ] `database.types.ts` regenerated and committed

---

### CP2 — Error message cleanup

**Files:**
- `supabase/functions/qb-calculate/index.ts`
- `supabase/functions/qb-ai-scenarios/index.ts`

Update every human-readable message on the `discount_configured = false` path:

| Location | Old text | New text |
|---|---|---|
| `qb-calculate` 400 response body | *(existing "Discount not configured" variant)* | `"Deal engine not yet configured for this brand. Contact admin to enable it."` |
| `qb-ai-scenarios` non-fatal error event | *(existing "Discount not configured" variant)* | `"Deal engine not yet configured for this brand. Contact admin to enable it."` |

Error code `DISCOUNT_NOT_CONFIGURED` in `apps/web/src/lib/pricing/errors.ts` stays
unchanged (internal code, not user-visible).

**Acceptance criteria:**
- [ ] `qb-calculate` returns new message string in 400 body for unconfigured brand
- [ ] `qb-ai-scenarios` SSE stream emits new error event text
- [ ] No test fixtures need updating (error code unchanged; tests assert code, not message)
- [ ] Edge function contract tests updated if they assert the old message string

---

### CP3 — Service layer: `price-sheets-api.ts`

**File:** `apps/web/src/features/admin/lib/price-sheets-api.ts`

Exports:

```typescript
/** All 13 brands with latest published sheet per sheet_type and computed urgency. */
getBrandSheetStatus(supabase: SupabaseClient): Promise<BrandSheetStatus[]>

/** All freight zones joined to brand name, ordered by brand then zone. */
getFreightZones(supabase: SupabaseClient): Promise<FreightZoneRow[]>

/** Upsert a freight zone (insert or update by id). */
upsertFreightZone(supabase: SupabaseClient, zone: FreightZoneInput): Promise<FreightZoneRow>

/** Delete a freight zone by id. */
deleteFreightZone(supabase: SupabaseClient, id: string): Promise<void>
```

`getBrandSheetStatus` must cover **all 13 brands**, not just those in `CADENCE_RULES`.
Brands not listed in `CADENCE_RULES` use the 6-month cadence fallback, computed in
the service layer using `computeUrgency('6mo', lastPublishedAt, new Date())`.

**Test file:** `apps/web/src/features/admin/lib/__tests__/price-sheets-api.test.ts`

**Acceptance criteria:**
- [ ] `getBrandSheetStatus` returns all 13 brands, including those with no `qb_price_sheets` rows
- [ ] Brands with no published sheet return `lastPublishedAt: null`, urgency `"overdue"`
- [ ] Urgency computed correctly for quarterly, annual, and 6-month cadences
- [ ] `upsertFreightZone` converts dollar inputs to cents before write
- [ ] Test coverage: brand with no sheets, brand with published sheet, freight zone CRUD

---

### CP4 — `PriceSheetsPage.tsx` — freshness dashboard

**New files:**
- `apps/web/src/features/admin/pages/PriceSheetsPage.tsx`
- `apps/web/src/features/admin/components/PriceSheets/BrandFreshnessTable.tsx`
- `apps/web/src/features/admin/components/PriceSheets/UrgencyBadge.tsx`

**Modified files:**
- `apps/web/src/App.tsx` — add lazy import + route
- `apps/web/src/components/AppLayout.tsx` (or wherever admin nav links live) — add nav link

**Route:** `/admin/price-sheets`, gate: `["admin", "manager", "owner"]`

**Page structure:** `<Tabs defaultValue="freshness">` with two tabs:
- "Price Sheets" — `BrandFreshnessTable`
- "Freight Zones" — placeholder (CP7 fills it)

**`BrandFreshnessTable` columns:**

| Column | Detail |
|---|---|
| Brand | `qb_brands.name` |
| Category | Badge: construction / forestry / other |
| Sheet type | `price_book` / `retail_programs` / `both` |
| Last published | Relative date ("3 months ago") with ISO tooltip |
| Urgency | `UrgencyBadge`: overdue (red) / upcoming (amber) / current (green) / never (muted) |

**Acceptance criteria:**
- [ ] Route `/admin/price-sheets` renders, redirects `rep` role to `/dashboard`
- [ ] All 13 brands shown (including those with no sheets)
- [ ] Urgency badges match `computeUrgency()` output
- [ ] "Never uploaded" state renders for brands with no published sheet
- [ ] Nav link present in admin sidebar/menu
- [ ] `bun run build` in `apps/web` passes

---

### CP5 — Upload UI + `extract-price-sheet` invocation

**New files:**
- `apps/web/src/features/admin/components/PriceSheets/UploadDrawer.tsx`

**Modified files:**
- `apps/web/src/features/admin/components/PriceSheets/BrandFreshnessTable.tsx` — add "Upload" button per brand row that opens `UploadDrawer`

**Upload drawer behavior:**
1. Pre-populated with brand name and a `sheet_type` selector (`price_book` / `retail_programs` / `both`).
2. Drag-drop or click-to-browse file input. Accepts: `pdf`, `xlsx`, `xls`, `csv`.
3. On submit: upload file to Supabase Storage → call `extract-price-sheet` edge function with `{ brand_id, file_url, sheet_type }`.
4. Drawer shows an in-progress state ("Extracting… this takes 15–60 seconds").
5. Frontend polls `qb_price_sheets` row by id until `status = 'extracted'` or `status = 'rejected'`.
6. On `extracted`: proceed to CP6 auto-publish step.
7. On `rejected`: show extraction error from `extraction_metadata.error`.

**Acceptance criteria:**
- [ ] File upload to Supabase Storage succeeds and returns a URL
- [ ] `extract-price-sheet` called with correct payload
- [ ] In-progress state shown during extraction (spinner + "Extracting…")
- [ ] Polling terminates on `extracted`, `rejected`, or after 120s timeout
- [ ] Error state shown on `rejected` with message from `extraction_metadata`
- [ ] Accepted file types enforced in the input (`accept=".pdf,.xlsx,.xls,.csv"`)

---

### CP6 — Auto-publish on extraction complete

**Modified files:**
- `supabase/functions/publish-price-sheet/index.ts` — add `auto_approve` boolean request param
- `apps/web/src/features/admin/components/PriceSheets/UploadDrawer.tsx` — call publish after extraction

**`publish-price-sheet` change:**

When `auto_approve: true` is passed:
1. Before applying items, run:
   ```sql
   UPDATE qb_price_sheet_items
     SET review_status = 'approved'
   WHERE price_sheet_id = $1 AND review_status = 'pending';

   UPDATE qb_price_sheet_programs
     SET review_status = 'approved'
   WHERE price_sheet_id = $1 AND review_status = 'pending';
   ```
2. Then proceed with existing publish logic (apply approved items, mark `status='published'`).

**Frontend (UploadDrawer) flow after CP5 polling resolves to `extracted`:**
1. Call `publish-price-sheet` with `{ price_sheet_id, auto_approve: true }`.
2. Show "Publishing…" state.
3. On success: show "Published ✓ — [N] models, [M] programs updated." Close drawer after 2s.
4. Invalidate `getBrandSheetStatus` query so freshness table refreshes.

**Acceptance criteria:**
- [ ] `publish-price-sheet` with `auto_approve: true` sets all pending items to `approved` before applying
- [ ] `publish-price-sheet` with `auto_approve: false` (default) behaves exactly as before — no regression
- [ ] After successful publish, `qb_price_sheets.status = 'published'` and `published_at` is set
- [ ] Freshness table refreshes after upload+publish cycle
- [ ] Summary count shown in success state ("3 models, 1 program updated")
- [ ] If publish fails, drawer shows error and does not close

---

### CP7 — Freight zone CRUD tab

**New files:**
- `apps/web/src/features/admin/components/PriceSheets/FreightZonesTab.tsx`
- `apps/web/src/features/admin/components/PriceSheets/FreightZoneForm.tsx`

**Modified files:**
- `apps/web/src/features/admin/pages/PriceSheetsPage.tsx` — wire "Freight Zones" tab

**`FreightZonesTab` behavior:**
- Table of all `qb_freight_zones` grouped by brand, columns:
  Brand | Zone name | States | Large freight | Small freight | Effective from | Effective to | Actions
- "Add zone" button opens `FreightZoneForm` in a dialog.
- Edit/delete actions per row.
- Dollar inputs in the form (converted to cents on save: `Math.round(dollars * 100)`).
- `state_codes` field: comma-separated input or multi-select of US state codes.
- `effective_to` optional (blank = open-ended).

**Delete behavior:** Confirm dialog ("Delete this freight zone? This will affect live quote
calculations for [Brand] in [States]."). No soft-delete — hard delete via RLS-permitted
`DELETE` (verified: `289_qb_rls.sql` `FOR ALL` policy covers DELETE for admin/manager/owner).

**Acceptance criteria:**
- [ ] Existing ASV/FL zone ($1,942 / $777) visible in the table
- [ ] "No freight zones configured" empty state per brand section
- [ ] Add zone: form validates required fields, saves, table refreshes
- [ ] Edit zone: form pre-populated, saves patch, table refreshes
- [ ] Delete zone: confirm dialog shown, zone removed on confirm
- [ ] Dollar inputs convert correctly to cents (e.g. "19.42" → 1942)
- [ ] Only admin/manager/owner can see the tab (inherited from page gate)

---

### CP8 — `originating_log_id` wire-up

**Modified files:**
- `supabase/functions/qb-ai-scenarios/index.ts` — set `originating_log_id` on quote write
- `apps/web/src/features/admin/pages/AiRequestLogPage.tsx` — replace "—" with real duration

**`qb-ai-scenarios` change:**
When the function creates or upserts a `qb_quotes` row from a scenario session, include:
```typescript
originating_log_id: logRowId  // the qb_ai_request_log.id for this session
```

**`AiRequestLogPage` change:**
Join `qb_ai_request_log` to `qb_quotes` on `originating_log_id`. For rows where the
join succeeds, compute `qb_quotes.created_at - qb_ai_request_log.created_at` and display
as `"Xm Ys"`. For rows with no linked quote, continue showing "—".

**Acceptance criteria:**
- [ ] New quotes created via `qb-ai-scenarios` have `originating_log_id` set
- [ ] `AiRequestLogPage` shows elapsed time (e.g. "4m 23s") when FK is populated
- [ ] Rows with no linked quote still show "—" (no regression)
- [ ] Duration is non-negative (guard against clock skew producing negative values — show "—" if negative)

---

### CP9 — DealEconomicsPage: "Brand Engine Status" tab

**New files:**
- `apps/web/src/features/admin/components/DealEconomics/BrandEngineStatusForm.tsx`

**Modified files:**
- `apps/web/src/features/admin/pages/DealEconomicsPage.tsx` — add fourth tab

**Tab: "Brand Engine Status"**

Table of all 13 brands with columns:

| Column | Detail |
|---|---|
| Brand | `qb_brands.name` |
| Category | Badge: construction / forestry / other |
| Deal Engine Enabled | Toggle (reads/writes `qb_brands.discount_configured`) |
| Status | "Ready" (green) / "Not configured" (muted) |

Toggle behavior:
- Optimistic update (toggle flips immediately in UI).
- Writes `PATCH qb_brands SET discount_configured = $1 WHERE id = $2`.
- On error: rollback toggle + toast error.
- Toggle-to-false shows a confirmation: "Disabling the deal engine for [Brand] will block
  all quotes for this brand. Continue?" (on-to-off only, per Slice 06 R7 pattern).

**Acceptance criteria:**
- [ ] All 13 brands visible with correct current `discount_configured` state
- [ ] Toggle writes to DB and reflects persisted state on page refresh
- [ ] Confirmation shown on toggle-to-false
- [ ] Optimistic update rolls back on error
- [ ] Tab is fourth in `DealEconomicsPage` tabs list; existing three tabs unaffected

---

### CP10 — Build gates + smoke tests

**Checks to pass before closing slice:**

1. `bun run migrations:check` — 301 in sequence, no gaps
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. Edge function contract tests:
   - `qb-calculate`: 400 body contains new message string
   - `qb-ai-scenarios`: non-fatal error event contains new message string
   - `publish-price-sheet`: `auto_approve=true` path sets items to `approved` before applying
5. Role/workspace security spot-checks:
   - `GET /admin/price-sheets` as `rep` role → redirects to `/dashboard`
   - Freight zone DELETE as `rep` → RLS blocks (403)
   - `discount_configured` PATCH as `rep` → RLS blocks

**Acceptance criteria:**
- [ ] All three builds pass with zero new TypeScript errors
- [ ] Migration check passes
- [ ] Contract test suite green
- [ ] Role-gate checks pass

---

## Data Model Summary

### Migration 301 (`301_qb_slice07_schema.sql`)

| Change | Type | Table | Detail |
|---|---|---|---|
| Column comment | cosmetic | `qb_brands.discount_configured` | Updates semantics description |
| Add column | additive | `qb_quotes.originating_log_id` | `uuid FK → qb_ai_request_log(id) on delete set null` |
| Add index | additive | `qb_quotes` | `idx_qb_quotes_originating_log` (partial, where not null) |

No new tables. No RLS additions. No destructive changes.

### `publish-price-sheet` behavior change (no migration)

New `auto_approve: boolean` request parameter (default `false`). When true, bulk-updates
`qb_price_sheet_items` and `qb_price_sheet_programs` to `review_status='approved'` before
applying. Existing callers passing no flag are unaffected.

---

## File Map

| File | Status | CP |
|---|---|---|
| `supabase/migrations/301_qb_slice07_schema.sql` | new | CP1 |
| `supabase/functions/qb-calculate/index.ts` | modified | CP2 |
| `supabase/functions/qb-ai-scenarios/index.ts` | modified | CP2, CP8 |
| `supabase/functions/publish-price-sheet/index.ts` | modified | CP6 |
| `apps/web/src/features/admin/lib/price-sheets-api.ts` | new | CP3 |
| `apps/web/src/features/admin/lib/__tests__/price-sheets-api.test.ts` | new | CP3 |
| `apps/web/src/features/admin/pages/PriceSheetsPage.tsx` | new | CP4 |
| `apps/web/src/features/admin/components/PriceSheets/BrandFreshnessTable.tsx` | new | CP4 |
| `apps/web/src/features/admin/components/PriceSheets/UrgencyBadge.tsx` | new | CP4 |
| `apps/web/src/features/admin/components/PriceSheets/UploadDrawer.tsx` | new | CP5, CP6 |
| `apps/web/src/features/admin/components/PriceSheets/FreightZonesTab.tsx` | new | CP7 |
| `apps/web/src/features/admin/components/PriceSheets/FreightZoneForm.tsx` | new | CP7 |
| `apps/web/src/features/admin/components/DealEconomics/BrandEngineStatusForm.tsx` | new | CP9 |
| `apps/web/src/features/admin/pages/DealEconomicsPage.tsx` | modified | CP9 |
| `apps/web/src/features/admin/pages/AiRequestLogPage.tsx` | modified | CP8 |
| `apps/web/src/App.tsx` | modified | CP4 |
| `apps/web/src/components/AppLayout.tsx` (or nav file) | modified | CP4 |

---

## Scope Estimate

| Checkpoint | Effort |
|---|---|
| CP1 — Migration 301 | 0.5 day |
| CP2 — Error messages | 0.5 day |
| CP3 — Service layer + tests | 0.5 day |
| CP4 — Freshness dashboard | 1.0 day |
| CP5 — Upload UI + extract invocation | 1.5 days |
| CP6 — Auto-publish pipeline | 1.0 day |
| CP7 — Freight zone CRUD | 1.5 days |
| CP8 — `originating_log_id` wire-up | 0.5 day |
| CP9 — Brand Engine Status tab | 1.0 day |
| CP10 — Build gates + smoke | 0.5 day |
| **Total** | **~8.5 days** |

---

## Risks

**R1 — `extract-price-sheet` is async; polling interval unknown.**
The edge function triggers a Claude extraction pass that may take 15–120 seconds. The
frontend polling loop must use a reasonable interval (3–5s) and a hard timeout (120s)
to avoid hanging sessions. If the function currently returns synchronously (waiting for
Claude), re-evaluate whether polling is even needed.

**R2 — `publish-price-sheet` atomicity with auto_approve.**
The `auto_approve` bulk UPDATE must run inside the same transaction (or at minimum before
any item-apply logic) so a partial failure leaves items in `pending` not `approved`. Verify
the function's transaction semantics before shipping CP6.

**R3 — `PriceSheetsPage` must cover all 13 brands, not just cadence-rule brands.**
`getPendingUpdates()` in `price-sheet-reminders.ts` only returns brands listed in
`CADENCE_RULES` (4 rules, 3 brands). The service layer (`price-sheets-api.ts`) must
run a separate `qb_brands` query to ensure all 13 brands appear in the table, computing
6-month urgency for the unlisted ones.

**R4 — Supabase Storage bucket for price sheet files.**
`extract-price-sheet` receives a `file_url`. A Supabase Storage bucket must exist for
uploaded files. Verify the bucket exists (likely `price-sheets` or `documents`) before
CP5 — if not, add a bucket creation step to CP1.

**R5 — Mobile layout with 4 tabs in DealEconomicsPage.**
Adding a fourth tab may cause overflow on narrow screens. Use `overflow-x-auto` on
`TabsList` in CP9 if needed.

---

## Out of Scope

| Item | Reason |
|---|---|
| Human review UI for `qb_price_sheet_items` / `qb_price_sheet_programs` | Q5 answered skip; revisit with extraction eval data |
| `discount_configured` column rename to `deal_engine_enabled` | 14 product-code files > 10-file threshold; UI label handles it |
| Notification emails for overdue price sheets | Separate workstream; infrastructure exists (`qb_notifications`) |
| `qb_programs` freshness tracking | No separate cadence logic needed yet |
| Removal of `FALLBACK_FREIGHT_CENTS = 194200` hardcode | Real ASV/FL rate, not a fake stub — leave with clarifying comment |

---

## Commit / Branch Convention

- Branch: `claude/qep-qb-07-price-sheet-admin`
- Commit prefix: `[QEP-QB-07]`
- Example commits:
  - `[QEP-QB-07] Migration 301: column comment + originating_log_id FK`
  - `[QEP-QB-07] Error message update: deal engine not configured`
  - `[QEP-QB-07] price-sheets-api: getBrandSheetStatus + freight zone CRUD`
  - `[QEP-QB-07] PriceSheetsPage: freshness dashboard + route`
  - `[QEP-QB-07] UploadDrawer: file upload + extract-price-sheet invocation`
  - `[QEP-QB-07] Auto-publish: publish-price-sheet auto_approve flag + frontend flow`
  - `[QEP-QB-07] Freight zones CRUD tab`
  - `[QEP-QB-07] originating_log_id wire-up: qb-ai-scenarios + AiRequestLogPage`
  - `[QEP-QB-07] DealEconomicsPage: Brand Engine Status tab`
  - `[QEP-QB-07] Build gates + smoke tests`
