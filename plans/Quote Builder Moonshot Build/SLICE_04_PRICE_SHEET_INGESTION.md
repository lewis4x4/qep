# SLICE 04 — Price Sheet Ingestion

**Prerequisite:** Slices 01–03 complete.

**Purpose:** Rylee's explicit ask. Build a drag-and-drop price sheet importer that uses Claude to extract model data + attachments + freight from manufacturer PDFs and Excel files, presents the extraction for admin review, and publishes approved changes to the catalog.

**Expected duration:** 2 days.

**Deliverable:** Admin UI for uploading price sheets + Claude extraction Edge Function + review workflow + version history + quarterly dashboard reminder.

---

## Shipped Reality (post-Slice-04 execution)

### Migrations applied to staging

| # | File | Purpose |
|---|------|---------|
| 291 | `291_qb_price_sheet_columns.sql` | ALTER TABLE: add `sheet_type` to `qb_price_sheets`; add `extraction_metadata` + `diff` (jsonb) to `qb_price_sheet_items` |
| 292 | `292_qb_price_sheet_programs.sql` | New `qb_price_sheet_programs` table for program-type extractions through review pipeline |
| 293 | `293_qb_price_sheet_rls.sql` | RLS on `qb_price_sheet_programs`; service_role + role-gated select/insert |

Note: `qb_price_sheets` and `qb_price_sheet_items` were already created in migration 287 (Slice 01). `qb_freight_zones` was created in migration 284. Migrations 291–293 only extend/add.

### Code paths (outer repo)

```
apps/web/src/features/admin/
├── pages/
│   ├── PriceSheetsPage.tsx           // list + upload
│   └── PriceSheetReviewPage.tsx      // diff + approve/reject per item
├── components/
│   ├── UploadZone.tsx
│   ├── PriceSheetCard.tsx
│   ├── ReviewItem.tsx
│   ├── ExtractionProgress.tsx
│   └── BrandSelector.tsx
└── lib/
    └── price-sheets-api.ts           // Supabase client calls

apps/web/src/lib/pricing/
├── ingestion.ts                      // detectAction() diff engine
└── price-sheet-reminders.ts         // getPendingUpdates() quarterly cadence

apps/web/src/lib/pricing/__tests__/
├── ingestion.test.ts
└── reminders.test.ts
```

### Edge functions shipped

| Function | Purpose |
|----------|---------|
| `extract-price-sheet` | Download from Storage → Claude Sonnet 4.6 extraction (PDF/Excel/CSV) → write to `qb_price_sheet_items` + `qb_price_sheet_programs` → status = `extracted` |
| `publish-price-sheet` | Apply approved items transactionally to catalog (`qb_equipment_models`, `qb_attachments`, `qb_programs`) → supersede old sheets → audit trail → advisory lock by brand_id |

---

## Why This Matters

Rylee: "An upload new price sheet button or area would be great. Something that we can drag and drop current changes into so that it recognizes what is new this month or quarter. Reminders on our dashboard at the beginning of every month or every quarter to update programs would be nice."

Every quarter ASV releases new retail programs. Every year ASV updates the price book (R1, R2, R3, R4). Yanmar programs change quarterly. Develon programs change quarterly. **Manual re-entry of this data is where systems break down.** Self-service ingestion with AI extraction + human review is the difference between a system Rylee uses forever and one that goes stale in three months.

---

## Architecture

```
┌─────────────────────────┐
│  Admin UI — Price Sheets │  src/features/admin/pages/PriceSheetsPage.tsx
│  - Drag & drop           │
│  - Brand tagger          │
│  - Type selector         │
│  - Review queue          │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Supabase Storage         │
│  bucket: price-sheets     │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  extract-price-sheet      │
│  Edge Function            │
│  - Calls Anthropic API    │
│  - Writes to              │
│    qb_price_sheet_items   │
│    qb_price_sheet_programs│
│  - Logs raw Claude resp   │
│    + parsed JSON in       │
│    extraction_metadata    │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Admin Review UI          │  src/features/admin/pages/PriceSheetReviewPage.tsx
│  - Diff against catalog   │
│  - Approve / modify /     │
│    reject per item        │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  publish-price-sheet      │
│  Edge Function            │
│  - Apply approved changes │
│    to catalog             │
│  - Supersede prior sheet  │
│  - Audit trail            │
│  - Advisory lock by       │
│    brand_id               │
└──────────────────────────┘
```

---

## Step 1 — Storage Bucket

Supabase Storage bucket `price-sheets`:
- Private (no anonymous access)
- Policy: upload/read by roles `owner` / `manager` / `admin` / `sales_admin`
- File size limit: 50MB per file
- Organize by brand: `price-sheets/asv/2026-q1/ASV-Retail-Programs.pdf`

Bucket created via Supabase dashboard or `supabase storage create` — not tracked in migrations.

---

## Step 2 — Upload UI

**Route:** `/admin/price-sheets` (React Router — `PriceSheetsPage.tsx` registered in the admin router)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Price Sheets                                               │
│  ────────────────────────────────────────────────────────── │
│                                                             │
│  [ Drop files here or click to browse ]                    │
│  Supports PDF, Excel (.xlsx, .xls), CSV. Up to 50MB each.  │
│                                                             │
│  Recent uploads:                                            │
│  ────────────────────────────────────────────────────────── │
│  ASV Retail Price Book (R4) — Jan 1, 2026                  │
│    33 pages · PDF · Uploaded by Angela · ✓ Published       │
│                                                             │
│  ASV Q1 2026 Retail Programs — Jan 1, 2026                 │
│    17 pages · PDF · Uploaded by Rylee · 12 items need      │
│    review  [ Review → ]                                    │
│                                                             │
│  Yanmar Q2 2025 Programs — Apr 1, 2025                     │
│    ⚠ Superseded by Q1 2026 programs — archived             │
└─────────────────────────────────────────────────────────────┘
```

On drop, show a modal asking:
1. Which brand is this for? (dropdown of brands from `qb_brands`)
2. What type of sheet is this? (Price book / Retail programs / Both / Other)
3. Effective date range (from / to)

Then upload to Storage and kick off extraction (calls `extract-price-sheet` edge function).

### Component files

```
apps/web/src/features/admin/
├── pages/
│   ├── PriceSheetsPage.tsx
│   └── PriceSheetReviewPage.tsx
├── components/
│   ├── UploadZone.tsx
│   ├── PriceSheetCard.tsx
│   ├── ReviewItem.tsx
│   ├── ExtractionProgress.tsx
│   └── BrandSelector.tsx
└── lib/
    └── price-sheets-api.ts
```

Note: **No `actions.ts` server actions** — this is Vite + React + Supabase client, not Next.js. API calls go through `price-sheets-api.ts` (Supabase client) and Edge Functions.

---

## Step 3 — Claude Extraction Edge Function

`supabase/functions/extract-price-sheet/index.ts`

### Input
```ts
{ priceSheetId: string } // UUID — looks up file_url, brand_id, sheet_type from qb_price_sheets
```

### Flow

1. Download the file from Storage.
2. Determine file type:
   - PDF: use Anthropic's native PDF support — pass as `document` content block
   - Excel: convert to CSV using `xlsx` npm package, then pass as text
   - CSV: pass as text
3. Build the prompt based on `sheet_type` (price_book vs. retail_programs).
4. Call Claude Sonnet 4.6 (fast + accurate for structured extraction).
5. Parse JSON response.
6. For each extracted item, detect action (`create`/`update`/`no_change`) by comparing against existing catalog.
7. Write rows to `qb_price_sheet_items` (models, attachments, freight) and `qb_price_sheet_programs` (program-type items).
8. **Log raw Claude response + parsed JSON into each item's `extraction_metadata` for admin debugging.**
9. Update `qb_price_sheets.status = 'extracted'`.

### Prompt for Price Book Extraction

```ts
const systemPrompt = `You are extracting structured data from a heavy equipment manufacturer price book for an AI-native dealership operating system at QEP USA.

The output must be valid JSON matching this schema:

{
  "sheet_type": "price_book" | "retail_programs" | "mixed",
  "effective_from": "YYYY-MM-DD",
  "effective_to": "YYYY-MM-DD" | null,
  "models": [
    {
      "model_code": "string",
      "family": "Compact Track Loader" | "Skid Steer Loader" | "Excavator" | "Dozer" | ...,
      "name_display": "string",
      "standard_config": "string",
      "list_price_cents": integer,
      "specs": { /* any key-value facts */ },
      "notes": "string"
    }
  ],
  "attachments": [
    {
      "part_number": "string",
      "name": "string",
      "category": "bucket" | "thumb" | "mulcher" | "auger" | ...,
      "list_price_cents": integer,
      "compatible_model_codes": ["string"],
      "attachment_type": "factory_option" | "field_install" | "recommended_bucket"
    }
  ],
  "freight_zones": [
    {
      "state_codes": ["FL"],
      "zone_name": "string",
      "freight_large_cents": integer,
      "freight_small_cents": integer
    }
  ],
  "notes": ["string"]
}

Rules:
- All monetary values must be integer cents. $7,500 = 750000.
- If a price is missing or "Call", omit that item and add a note.
- Use exact model codes as printed. Don't normalize or "clean up".
- If a section has a date (e.g., "Pricing Effective: 01/01/2026"), use it.
- Freight tables: each row is one zone. Multi-state zones: list every state.
- For attachments, include compatible model codes if listed on the page where the attachment appears.
- Be exhaustive. If the document has 200 line items, return 200 items.
- Return ONLY JSON. No prose, no markdown fences.`;
```

### Prompt for Programs Extraction

```ts
const programsSystemPrompt = `You are extracting manufacturer incentive programs from a heavy equipment dealer program document.

Output JSON schema:

{
  "sheet_type": "retail_programs",
  "effective_from": "YYYY-MM-DD",
  "effective_to": "YYYY-MM-DD",
  "programs": [
    {
      "program_code": "string",
      "program_type": "cash_in_lieu" | "low_rate_financing" | "gmu_rebate" | "aged_inventory" | "bridge_rent_to_sales" | "additional_rebate",
      "name": "string",
      "details": { /* type-specific fields */ },
      "program_rules_notes": "string"
    }
  ],
  "stacking_notes": ["string"]
}

Rules:
- rate_pct is decimal: 0.00 for 0%, 0.0199 for 1.99%.
- dealer_participation_pct same format.
- If a program lists cash amounts per model in a table, extract every row.
- Return ONLY JSON.`;
```

### Error handling

- If Claude returns invalid JSON: retry once with stricter prompt. If still fails, mark `qb_price_sheets.status = 'rejected'` with error message.
- If extraction succeeds but returns empty arrays: flag for manual review with reason.
- Always store raw Claude response + parsed result in `extraction_metadata` — never discard, even on parse error.

---

## Step 4 — Action Detection (Diff Engine)

`apps/web/src/lib/pricing/ingestion.ts`

```ts
// detectAction() compares an extracted item against the existing qb_equipment_models / qb_attachments catalog
// Returns: { action: 'create' | 'update' | 'no_change' | 'skip', existingId?, changes?, confidence }
// Pure function — DB I/O injected via context (same pattern as QuoteContext in Slice 02)
```

---

## Step 5 — Admin Review UI

`/admin/price-sheets/:id/review` → `PriceSheetReviewPage.tsx`

Groups items by action. Bulk-approve "no_change". Individual approve/modify/reject for `create` and `update`.

Human-sounding copy:
- "12 prices changed since last time" (not "12 UPDATE operations staged")
- "3 new machines to add" (not "3 CREATE candidates")

---

## Step 6 — Publish Edge Function

`supabase/functions/publish-price-sheet/index.ts`

- Accepts `priceSheetId` + list of approved `priceSheetItemIds`
- Transactional: apply creates/updates to `qb_equipment_models`, `qb_attachments`, `qb_programs`
- Supersede prior sheets (same brand + overlapping effective dates → `status = 'superseded'`)
- Set `qb_price_sheets.status = 'published'`, `published_at = now()`
- Postgres advisory lock keyed to `brand_id`

---

## Step 7 — Dashboard Reminder

`apps/web/src/lib/pricing/price-sheet-reminders.ts`

Quarterly cadence: ASV/Yanmar/Develon programs check on 1st of Jan/Apr/Jul/Oct.
Annual: ASV price book on Jan 1. Other brands: flag if >6 months since last publish.

---

## Step 8 — Programs Extraction Path

`qb_price_sheet_programs` table (migration 292) holds extracted program rows through the same review pipeline. On publish, inserts/updates `qb_programs`; deactivates old programs with overlapping effective dates for the same `(brand_id, program_type)`.

---

## Acceptance Criteria

- [ ] Admin can drag-and-drop the ASV price book PDF. Extraction completes within 60 seconds.
- [ ] Admin can drag-and-drop the ASV Q1 2026 programs PDF. Extraction produces 5 programs.
- [ ] Admin can drag-and-drop an Excel file. Multi-sheet workbooks handled.
- [ ] Review UI shows diffs clearly. Bulk approve works. Individual modify works.
- [ ] Publish applies changes transactionally. Rollback on failure.
- [ ] Audit trail on `qb_equipment_models`, `qb_attachments`, `qb_freight_zones`, `qb_programs`.
- [ ] Superseding older programs works.
- [ ] Dashboard widget shows pending updates on 1st of each quarter.
- [ ] `extraction_metadata` captures raw Claude response + parsed JSON on every item.
- [ ] Error path: corrupt PDF → graceful error, sheet marked rejected.

## Known TODOs / Flags for Slice 05+

- `bun test` (global) hangs — some test outside `apps/web/src/lib/` opens a port/DB connection. Use scoped runs: `bun test apps/web/src/lib/pricing apps/web/src/lib/programs`. Track down and fix in a future cleanup pass.
- Migrations 291–293 from Slice 03 were "applied to staging" per commit message but SQL files were never committed to the outer repo. Slice 04 starts at 291.
- Storage bucket `price-sheets` must be created manually in Supabase dashboard or via CLI — not tracked in SQL migrations.
- Admin UI components are stubs for Slice 04 (edge function + logic are the priority). Full React UI polish is Slice 05 scope.

## Finish Up

Commit prefix: `[QEP-QB-04]`
PR title: `[QEP-QB-04] Price sheet ingestion with Claude extraction`
