# Slice 07 — Smoke Test Procedure

**Purpose:** End-to-end walkthrough that exercises every CP in one flow. Run this
once on staging after the PR merges; it verifies the whole pipeline works
as shipped, not just the unit-level pieces the test suite covers.

**Audience:** Any engineer or admin-role user. ~15 minutes if prerequisites
are met.

**Prerequisites:**
- Admin/manager/owner role on staging (`iciddijgonywtxoelous`)
- A real manufacturer price sheet PDF (or XLSX) for any brand. If none
  handy, use any ASV document — the staging DB has ASV pre-seeded.
- Browser with dev tools open (to watch console + network).

---

## Step 1 — Deal Engine Status tab (CP9 verification)

1. Navigate to **Admin → Deal Economics** (`/admin/deal-economics`).
2. Confirm the default tab is **Deal Engine Status** (CP9 new tab, not
   Service Credits).
3. Observe: each brand has a **readiness strip** with 4 badges (price
   sheet / freight zones / programs / freight key).
4. Pick a brand with **red badges on price sheet or freight zones** —
   this is the brand you'll use for the rest of the smoke test.
5. If that brand is currently **Enabled** in the toggle, disable it
   (you'll re-enable after you configure it). If currently disabled,
   leave it disabled.

**Pass criteria:** readiness strip renders, status pill reflects toggle
state, confirm dialog appears on toggle.

---

## Step 2 — Upload a price sheet (CP5 + CP6 verification)

1. Navigate to **Admin → Price Sheets** (`/admin/price-sheets`).
2. Confirm the brand freshness table loads and the **stats bar** at the
   top shows `Brands / No Sheet / Urgent / No Freight` counts.
3. Find the brand row you picked in Step 1. Click **Upload**.
4. The drawer opens. Select **Price Book** radio, drag or pick the PDF,
   click **Upload & extract**.
5. Watch phase transitions in the drawer:
   - "Uploading file…" (fast, <1s)
   - "Creating sheet record…" (fast)
   - "Extracting with Claude…" (30–90s for a typical PDF)
   - "Publishing to catalog…" (only if extraction took <90s; else
     appears after the 90s timer)
   - Success banner: "Published to catalog." with counts of items and
     programs applied.
6. Close the drawer.
7. Confirm the brand's row now shows:
   - **Freshness:** green "Fresh" badge
   - **Version:** `vYYYY.MM` derived from upload time
   - **Items:** count > 0

**Pass criteria:** drawer completes without error, brand row updates
in-place (no page reload), `qb_equipment_models` and `qb_freight_zones`
contain new rows for this brand on staging DB.

**Edge-function log spot-check (optional):**
```
gh ... functions logs publish-price-sheet --project-ref iciddijgonywtxoelous --tail 50
```
Should contain: `auto_approve: flipped N items and M programs from pending to approved`.

---

## Step 3 — Coverage grid + freight zone CRUD (CP7 verification)

1. Still on the Price Sheets page, click **Zones** next to the brand you
   just uploaded for.
2. Drawer opens. The **coverage grid** renders at the top:
   - Extracted freight zones from the price sheet are now visible as
     green (covered) pills.
   - Legend at bottom shows count of covered / overlap / uncovered.
3. Click any uncovered state → it highlights; the zones table below
   filters. Click again or use "Clear filter" link → restored.
4. Click **Add zone**. In the form:
   - Type a name: `Smoke Test Zone`
   - Select 3 states that are currently uncovered (grey)
   - Enter `1,500.00` for Large, `500.00` for Small
   - Observe the overlap preview (should be empty)
   - Click **Create zone**
5. The new zone appears in the table; the 3 states turn green in the
   coverage grid.
6. Click **Edit** on that new zone. Change the Large rate to `$2,000`.
   Click **Save changes**.
7. Click **Delete** → then **Confirm**. The zone is removed; its states
   revert to grey in the coverage grid.

**Pass criteria:** all four operations (list / create / edit / delete)
work without console errors. Coverage grid updates reflect each change.

---

## Step 4 — Re-enable Deal Engine for the brand (CP9)

1. Navigate back to **Admin → Deal Economics → Deal Engine Status**.
2. The brand's readiness strip now shows **green badges** for price
   sheet and freight zones (from Step 2).
3. Flip the **Deal Engine** toggle ON. Since prereqs are met, **no
   confirm dialog** appears (immediate save).
4. Status pill flips to **Live**.

**Pass criteria:** no confirm-with-missing-prereqs dialog (because
prereqs are now met); toast confirms the change.

---

## Step 5 — Generate a scenario and verify time-to-quote (CP2 + CP8)

1. Open the **AI Request Log** at `/admin/ai-request-log` in a second
   tab. Note the current row count — this is your baseline.
2. Switch back to the primary app (Iron Advisor / Quote Builder
   conversational entry). Trigger a scenario:
   - Prompt: `"Quote a [brand] [model code] for a [customer] in FL"`
     using a model that exists in the price sheet you just uploaded.
3. Wait for the scenario SSE stream to complete.
4. Refresh the AI Request Log. A new row should appear at the top:
   - **Make/Model** resolved correctly (brand — model)
   - **Deal Size** populated
   - **Time to Quote** — column renders `—`. **This is the expected and
     correct result today, not a bug.** The FK + join were wired in CP8,
     but no runtime code currently inserts into `qb_quotes` (quote saves
     still land in `quote_packages`). The column will automatically show
     real deltas the moment `qb_quotes` inserts begin in a future slice —
     no further UI change is needed.

**Pass criteria:**
- SSE stream does NOT emit a "not yet configured for Deal Engine" error
  (CP2 error-message + CP9 toggle working together).
- Log row is created with the correct resolved model.
- Time to Quote column displays `—` cleanly (not blank, not undefined).

**If you see "No freight rate configured for [brand] to FL":**
Confirms CP2 message landed. Add a freight zone covering FL per Step 3,
retry Step 5.

---

## Step 6 — Role gate sanity (regression guard)

1. Log out. Log back in as a **`rep` role** user (not admin/manager/owner).
2. Visit `/admin/price-sheets` → should redirect to `/dashboard`.
3. Visit `/admin/deal-economics` → should redirect to `/dashboard`.
4. Visit `/admin/ai-request-log` → should show "You do not have access
   to this page" (or redirect, depending on page).

**Pass criteria:** no admin content is rendered for rep role.

---

## Post-smoke cleanup

Optional (if staging hygiene matters):
- Delete the test `Smoke Test Zone` (if re-created and not deleted in Step 3).
- The uploaded price sheet stays — it's valid production data once
  published, and supersedes prior sheets automatically.

---

## What this smoke test verifies

| Check | CPs exercised |
|---|---|
| Deal Engine Status tab renders with readiness data | CP9 |
| Price Sheets dashboard shows brand freshness | CP4 |
| Upload drawer completes upload → extract → publish | CP5 + CP6 |
| Auto-approve flips pending → approved before apply | CP6 (edge fn) |
| Freight zone CRUD + coverage grid | CP7 |
| Coverage detection (covered / overlap / uncovered) | CP7 |
| Brand toggle with prereq validation | CP9 |
| qb-ai-scenarios error messages reference "deal engine" not "discount" | CP2 |
| Freight error message references "Admin → Price Sheets" | CP2 |
| AI Request Log "Time to Quote" column renders (dash today, data later) | CP8 |
| Role gate enforcement | cross-cutting |

All 69 unit tests in the admin suite continue to pass as the regression
guard underneath this manual flow.
