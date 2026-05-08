## QEP 2-Page Quote Proposal — Owner Feedback Design & IA

**Prepared for:** Rylee McKenzie (QEP) and Brian Lewis
**Author:** QEP OS design pass
**Date:** 2026-05-08
**Scope:** Information architecture only. No code, no migrations, no commits. This is the layout/IA contract for the upcoming 2-page customer-facing proposal — what stays for compliance, where the real assets land, what compresses, and how overflow is handled.

---

## 1. Context

The current parity prototype (`scripts/generate-quote-parity-prototype.mjs`) renders four pages with **placeholder visuals**: a CSS gear "Q" instead of the QEP logo, vendor names typeset as text badges, a hand-drawn CSS grid as a stand-in QR code, and an orange-and-black gradient block where the machine photo should be. It's content-correct (every Q02699 IntelliDealer field is present) but visually it does not yet feel like a premium dealership proposal.

Rylee's feedback in one line: **"two pages, premium, with our real logo and real machine photos — not four pages of placeholders."**

This document locks down what that means before we touch the script or the production renderer.

---

## 2. Owner feedback, decoded

| Rylee said | What that means for IA |
|---|---|
| Make it shorter / cleaner | Default target is **2 pages**, not 4. Density goes up, not type size. |
| Make it look premium | Real masthead lockup, real OEM badges, real machine photo above the fold, real QR. No "[LOGO]" boxes. |
| It needs to look like ours | QEP master logo with the orange-gear + black "IT'S IN THE NAME" tagline drives the visual identity, not generic typography. |
| Keep what we legally have to keep | Banner, tax breakdown, signature line, TILA, legacy financing `**` disclaimer, 30-day footer, QR — all stay verbatim. We compress visuals first, never compliance. |
| If a quote is huge, don't break it | A real package can have many lines. Define the overflow rules so the renderer never tries to cram a 9-spec / 4-trade / 6-misc quote into 2 pages by shrinking 6pt type. |

---

## 3. Inventory of real assets in `/Users/brianlewis/Downloads/reaiagent`

Verified by visual inspection on 2026-05-08.

| File (current) | Suggested production filename | What it actually is | Quote slot |
|---|---|---|---|
| `ITS IN THE NAME Quality Logo- PNG.png` | `qep-its-in-the-name-logo.png` | QEP master lockup: orange gear + black/orange "Quality" wordmark + "Equipment & Parts INC." + "IT'S IN THE NAME" tagline. Includes social-icons strip across the top. | **Page 1 masthead, top-left.** Crop the social-icons strip out for the proposal — those belong on web, not on a customer quote header. |
| `StackedLogo.png` | `vendor-yanmar.png` | Yanmar Y-chevron mark over the **YANMAR** wordmark, all black. | Vendor strip (page 1). |
| `ASVLogo_AllBlack_PNG.png` | `vendor-asv.png` | ASV all-black wordmark. | Vendor strip (page 1) **and** small "powered by" tag inside the RT-135F unit card. |
| `CMI_LogoENG-Couleur.png` | `vendor-cmi.png` | CMI color logo. | Vendor strip (page 1). |
| `Develon-logo Black.png` | `vendor-develon.png` | Develon all-black wordmark. | Vendor strip (page 1). |
| `New Bandit_Authorized_Logo_BLACK.png` | `vendor-bandit-authorized.png` | "Authorized Dealer" Bandit Industries lockup. | Vendor strip (page 1) — note the *Authorized Dealer* qualifier is part of the mark; do not crop it. |
| `Untitled design (8).png` | `qep-qr-acceptance.png` | A real, scannable QR code (square, high contrast). | **Page 2 footer, bottom-right.** This is the acceptance-landing QR. In production it will be regenerated per quote → `/q/:share_token`; this asset is the visual stand-in for the prototype only. |
| `IMG_5439.JPG` | `package-rt135f-shearex.jpg` | **Hero shot** — the actual ASV RT-135F **with the ShearEx HM-70SR mulching head already attached**, on the QEP lot, branded ASV decal visible. This is the configuration being sold. | **Page 1 hero.** This is the photo above the fold, beside the Quote Total. Single best image we have. |
| `IMG_2090.JPG` | `attachment-shearex-hm70sr.jpg` | Close-up of the ShearEx HM-70SR rotor/teeth and SX badge — answers "what is the cutting head". | **Page 1 ShearEx unit card thumbnail** (smaller, ~1.4" wide), and as the secondary photo in the appendix if overflow occurs. |

> **Production note (do not skip).** These paths are local-only. For the static prototype only, copy them into `test-results/proposals/assets/` and reference relative paths. For the production renderer (`QuotePDFDocument.tsx` / `quote-print-html.ts`), brand/vendor/QR files must live under `apps/web/public/brand/qep/quote/` so React-PDF can fetch them same-origin. Equipment photos stay in Supabase Storage and arrive via `metadata.photo_url` / `metadata.photo_urls[]`.

---

## 4. Asset placement map (the picture in your head)

```
┌────────────────────────────────────────────────────────────────────────┐
│  PAGE 1                                                                │
│  ┌──────────────────────────────────┬──────────────────────────────┐  │
│  │  [QEP master logo]               │  01 - LAKE CITY              │  │
│  │  4894 NW US Hwy 41, Lake City FL │  Date / Time / Page 1 of 2   │  │
│  │  (386) 754-6186 · qepusa.com     │  Account · Quote · Ship Via  │  │
│  │  [ASV][Bandit][CMI][Develon][YM] │  Salesperson · PO · Tax ID   │  │
│  └──────────────────────────────────┴──────────────────────────────┘  │
│  ━━━ EQUIPMENT ESTIMATE — NOT AN INVOICE ━━━ Q02699 / QEP-2026-0001    │
│  ┌──────────────────┐  ┌────────────────────────────┐  ┌────────────┐ │
│  │ Ship To: ...     │  │ Invoice To: ...            │  │ Prepared by│ │
│  └──────────────────┘  └────────────────────────────┘  │ Rylee · RM3│ │
│                                                        └────────────┘ │
│  ┌─────────────────────────────────────┐  ┌──────────────────────┐   │
│  │  [HERO PHOTO — IMG_5439.JPG]        │  QUOTE TOTAL              │
│  │   RT-135F with ShearEx attached     │  $144,110.65              │
│  │   (real photo, full-bleed inside)   │  Valid through 06/06/2026 │
│  └─────────────────────────────────────┘  └──────────────────────┘   │
│  Why this machine: <confirmed narrative — 2 lines max>                │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ UNIT 1   Stock Q003403 · Serial ASVRT135LTDF01723 · NEW · $148,950│
│  │ 2026 ASV RT-135F · 132 HP Forestry Track Loader                   │
│  │ • 6–7 lead specs in two columns                                   │
│  │ ** 2 Year / 2000 Hour Full Machine Warranty **                    │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ UNIT 2  [IMG_2090 thumb]  Stock Q003475 · Serial 2500HC0440 · NEW │
│  │                           2026 ShearEx HM-70SR · 74" Mulcher · $45,750│
│  │                           • 5–6 lead specs                        │
│  │                           ** 1 Year Attachment Warranty **        │
│  └──────────────────────────────────────────────────────────────────┘ │
│  Footer: 30-day legal copy · "Thank You For Your Business!"           │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  PAGE 2 (running header: QEP-2026-0001 · Page 2 of 2)                  │
│  ┌─ Trade Ins ──────────────────────────────────────────────────────┐ │
│  │ Serial 123456 · 2021 CAT 299D3 · Bucket Included      –$50,000.00│ │
│  │ Market range: $44k / $52k / $58k — not a guaranteed offer         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ┌─ Additional Parts ─┐   ┌─ Misc Charges/Credits ─────────────────┐  │
│  │ SHEAREX CARBIDE    │   │ Less Down Payment Recd.   –$10,000.00  │  │
│  │ BD668 · 15 · $41.11│   │ PDI · Freight · Doc/Title/Tag: $0.00   │  │
│  └────────────────────┘   └────────────────────────────────────────┘  │
│  ┌─ Totals ─────────────────────────────────────────────────────────┐ │
│  │ Subtotal                                              $135,316.65│ │
│  │ Florida State 6.00%                                     $8,719.00│ │
│  │ Columbia County (1.5% × $5,000 cap)                        $75.00│ │
│  │ ───────────────────────────────────────────────────────────────  │ │
│  │ Authorization: __________________     QUOTE TOTAL  $144,110.65   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ┌─ Finance Options ────────────────────────────────────────────────┐ │
│  │  36 mo  · 0.00% · $4,003.07     60 mo · 0.00% · $2,401.84       │ │
│  │  48 mo  · 0.00% · $3,002.31     72 mo · 2.99% · $2,188.93       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ** FINANCING BASED ON CREDIT APPROVAL. INTEREST RATE MAY VARY... **  │
│  TILA: This is a payment estimate, not a guaranteed rate...            │
│  ┌─ Comments ─────────────────────────────────────────┐  [QR CODE]    │
│  │ Delivery, final inspection, attachment fit-up...   │  Visit our    │
│  └────────────────────────────────────────────────────┘  Quote Hub    │
│  Footer: 30-day legal copy · "Thank You For Your Business!"           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Page-by-page slot table

### Page 1 — Cover + machine

| Slot | Asset / source | Notes |
|---|---|---|
| Masthead logo | `qep-its-in-the-name-logo.png` (cropped to remove social-icons row) | Approx 1.6" wide, left-aligned. Replaces the current `.gear-mark` CSS Q. |
| Branch line | `branch_snapshot` | Address / city-state-zip / phone / fax / web — single line, muted weight. |
| Vendor strip | `vendor-asv.png`, `vendor-bandit-authorized.png`, `vendor-cmi.png`, `vendor-develon.png`, `vendor-yanmar.png` | Greyscale bar of authorized OEM marks. Each ~0.7" wide, uniform height. Not text badges. |
| Metadata box | Branch code+name, date, time + origin, page X of Y, account #, phone, quote #, legacy ref, ship via, PO, tax ID, salesperson code+name | Right-aligned. Same content as today; tighter type. |
| Banner | `EQUIPMENT ESTIMATE — NOT AN INVOICE` | Verbatim, full-width, charcoal bar with orange edge. Required. |
| Ship-to / Invoice-to / Prepared-by | `quote_packages.*_address_snapshot`, `profiles` | Three compact cards. Prepared-by card carries rep email so the customer can reply. |
| Hero photo | `IMG_5439.JPG` → `package-rt135f-shearex.jpg` | ~4.5" wide × 2.5" tall on the left, the **actual sold configuration**. |
| Quote total callout | `quote_packages.net_total`, `expires_at` | Charcoal panel beside hero, orange total figure, expiry date below. |
| Why-this-machine | `quote_packages.confirmed_why_this_machine` | 2 lines max. Confirmed narrative only — never raw AI output. |
| Unit card 1 (RT-135F) | Stock, Serial, condition, marketing line, top **6–7** specs, warranty | Specs cap from 15 → 7. Remainder summarized as `+8 more specs available on request` if Rylee wants it inline; otherwise omitted on page 1. |
| Unit card 2 (ShearEx) | Same as Unit 1 + thumbnail `IMG_2090.JPG` | Smaller card, photo thumbnail ~1.4" wide on the left edge. Specs cap 5–6. |
| Footer | 30-day disclaimer + "Thank You For Your Business!" | On every page. |

### Page 2 — Commercial, acceptance, compliance

| Slot | Source | Notes |
|---|---|---|
| Running header | Quote # · Page 2 of 2 · customer name | Tight strip, no logo restated. Saves vertical space versus repeating the full masthead. |
| Trade-ins | `trade_valuations` + market-range bracket | Serial / year-make-model / inclusions / notes / market-context bracket. Negative trade allowance shown with trailing minus per IntelliDealer convention. |
| Additional Parts | `quote_package_line_items` line type `part` | Compact 2-column table: description, part #, qty, unit, extended. |
| Misc Charges / Credits | `quote_package_line_items` line types `pdi/freight/doc_fee/title/tag/registration/discount/good_faith` | Same compact table; credits keep trailing-minus convention. |
| Totals block | `quote_packages.subtotal`, `tax_state_amount`, `tax_county_amount`, `net_total` | County line shows the $5,000-cap math inline as a small caption. |
| Authorization line + Quote Total | `quote_signatures` (rendered field) + `net_total` | **Same row.** Visual signature line on the left, big orange total on the right. This row is non-negotiable for parity. |
| Finance Options grid | `quote_financing_scenarios` | 4 columns: 36 / 48 / 60 / 72. Rate row + payment row. Source attribution per column in small caption. |
| Legacy financing disclaimer | Verbatim ADR-014 fixed copy | The `**` block — never paraphrased. |
| TILA disclaimer | Verbatim ADR-006 fixed copy | Never paraphrased. |
| Comments box | `quote_packages.comments_box` | External comments only. Internal `notes` / `opportunity_description` / `special_terms` never render here. |
| QR code | `qep-qr-acceptance.png` (prototype) → per-quote QR for `/q/:share_token` (production) | Bottom-right. Real, scannable. |
| Footer | 30-day disclaimer + "Thank You For Your Business!" | Required on every page. |

---

## 6. Compliance lock — what must stay verbatim

These items **never compress, never abbreviate, never reword** to hit the 2-page target. If the renderer cannot fit them at standard size, it overflows (see §7) before it shrinks compliance copy.

1. `EQUIPMENT ESTIMATE — NOT AN INVOICE` banner.
2. Branch code + name (`01 - LAKE CITY`) on every page.
3. Page X of Y on every page.
4. Account No, Quote No, Date, Time + Origin marker, Salesperson code + name, Ship Via, PO, Tax ID — full metadata block on page 1; running header on subsequent pages still carries quote #, page index, and customer name.
5. Ship To and Invoice To as **two separate** address blocks (not merged "customer address").
6. Per-unit Stock #, Serial #, condition (New/Used/Demo), warranty line.
7. Trade serials and trade allowance with trailing-minus notation.
8. Trade market-context bracket — must read "comparable market range — not a guaranteed offer" (ADR-005).
9. Subtotal · Florida State X.XX% · County name + cap math · Quote Total — every row visible.
10. Authorization signature line on the same row as Quote Total.
11. Legacy financing `** ... **` disclaimer when any payment math appears.
12. ADR-006 TILA block when any payment math appears.
13. 30-day "good for thirty (30) days" footer on every page.
14. "Thank You For Your Business!" closing.
15. QR code linking to the customer-facing acceptance landing.

If any of these are missing, the proposal is not a valid QEP customer artifact regardless of how good it looks.

---

## 7. Overflow rules (the readability guard)

The renderer targets 2 pages, but **never** at the cost of legibility or compliance. The order of operations when content is too dense:

**Step 1 — visuals compress first.**
- Hero photo height is the first thing to shrink (down to a 2.0" minimum).
- Vendor strip drops to greyscale and may go from 5 → 3 most-relevant marks (the OEMs of the units actually on the quote).
- Why-this-machine text caps at 2 lines on page 1; longer narratives truncate with no ellipsis (just stop at sentence boundary).

**Step 2 — supporting detail compresses second.**
- Spec bullets cap at **7 per unit**. Remainder is dropped silently from the customer copy (they're not legally required) — never rendered as a runt list of 1–2 stragglers.
- Long marketing description collapses to `productLine` only.
- Trade `notes` field caps at 2 lines.

**Step 3 — overflow to a third page (`Appendix`) before shrinking compliance.**

Trigger any of these → render an appendix page 3:

| Trigger | Threshold |
|---|---|
| Equipment lines | > 3 |
| Total spec bullets across all units | > 18 |
| Trade-ins | > 2 |
| Parts rows | > 6 |
| Misc rows | > 6 |
| Combined commercial rows (trade + parts + misc) | > 12 |
| Finance scenarios | > 4 |
| Comments box | > 6 lines |

**Appendix layout when triggered.**
- Page 3 inherits the same masthead-lite running header as page 2.
- Receives the *commercial overflow* (extra parts, extra misc, extra finance scenarios, full spec lists).
- Compliance content (totals row with sig line, TILA, legacy disclaimer, QR, footer) **stays on page 2** so the customer's signature, total, and disclosures remain co-located on a single page.
- Page count updates to `1 of 3`, `2 of 3`, `3 of 3`.

**Step 4 — never.**
- Never shrink type below 8pt for body, 9pt for legal/TILA/footer.
- Never drop the authorization line, the tax breakdown, the TILA block, the legacy financing disclaimer, the 30-day footer, or the QR.
- Never merge Ship To and Invoice To.
- Never paraphrase legal copy to make it shorter.

---

## 8. What never renders in the customer copy (safety rail)

These are present in the data model but must not appear in the proposal artifact, on any page, ever:

- Dealer cost, margin, target margin, approval state, approver IDs.
- Raw `metadata` blob from `quote_package_line_items`.
- AI confidence scores, trigger reasons, source-citation excerpts, coach hints, "ghost-box" copy.
- Internal `notes`, `opportunity_description`, internal `special_terms` (only the customer-safe `comments_box` renders).
- Source/lookup IDs (`hubspot_id`, `intellidealer_*`, `catalog_entry_id`, etc.).
- Workspace IDs, role flags, RLS-bound metadata.
- Salesperson personal phone / mobile unless explicitly approved on the rep card.

The data builder (`quote-proposal-data.ts`) projects only an explicit allowlist of customer-safe fields per the Oracle plan §3.B / §3.F.

---

## 9. Photo + asset rules for the production renderer

1. **Brand assets (logo, vendor marks, fallback QR)** live in `apps/web/public/brand/qep/quote/` and are referenced by stable root-relative paths so React-PDF can render them same-origin.
2. **Equipment / trade photos** come from `metadata.photo_url` / `metadata.photo_urls[]` / `metadata.trade_photo_url` after URL-scheme validation (`http(s)://` or `/`-rooted only — `file:`, `javascript:`, raw `data:` from quote data are rejected).
3. **Per-line photo cap**: 1 hero + 2 supporting = 3 max gallery images. Anything beyond is dropped, not paginated.
4. **Per-quote QR** is generated per `share_token` at render time. The reaiagent `Untitled design (8).png` is the prototype-only stand-in.
5. Missing-asset behavior:
   - If the QEP master logo is missing → fail loudly (the masthead is identity-critical).
   - If a vendor logo is missing → drop that single mark, keep the strip.
   - If the equipment hero photo is missing → fall back to the hero callout panel without a photo (do **not** show a placeholder gradient or a "[no image]" tile in customer copy).
   - If the QR is missing → render the URL text instead.

---

## 10. Open questions for Rylee

1. **Vendor strip ordering.** Today's prototype lists Develon · Bandit · Yanmar · ASV. For an ASV/ShearEx package quote, lead with ASV + Bandit/ShearEx? Or always alphabetical so it doesn't change per quote?
2. **Why-this-machine on page 1.** 2-line cap is tight. Confirm 2 lines reads as "premium concise" rather than "we ran out of room."
3. **Spec cap of 7.** RT-135F has 15 specs in the current quote. Tell me the seven you most want a customer to read first; that becomes the lead-spec pattern for every track-loader quote going forward.
4. **QR target.** Should it land on the quote acceptance hub (`/q/:share_token`) directly, or on an in-between QEP page that lets them choose Accept / Ask a Question / Schedule a Walk-Through? My recommendation is the latter — three calls to action beats one.
5. **Appendix page on overflow.** Confirm a third page is acceptable when content genuinely demands it. The alternative — squeezing 6pt type onto two pages — is worse.
6. **Photo ownership for stocked units.** Should each `qrm_equipment` row carry its own photoset (recommended), or do we keep using model-level catalog photos until per-unit photos are uploaded? The first is more honest and acceptance-ready.

---

## 11. Implementation handoff (pointer only — no code in this doc)

This IA is the contract that the Oracle implementation plan executes against. The companion plan is at `prompt-exports/oracle-plan-2026-05-08-125223-fix-qep-proposal-4dd-c761.md` and covers:

- Updating `scripts/generate-quote-parity-prototype.mjs` to emit `QEP-2026-0001-owner-feedback-2page.html` / `.pdf` using the real assets.
- Adding `QuoteProposalBrandAssets` and `QuoteProposalLineMedia` to `QuotePDFData` in `apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx`.
- Promoting safe media/spec extraction in `apps/web/src/features/quote-builder/lib/quote-proposal-data.ts`.
- Mirroring the 2-page layout in `apps/web/src/features/quote-builder/lib/quote-print-html.ts`.

When Rylee signs off on this design, the implementation pass starts from the Oracle plan and uses this report as its layout reference and overflow contract.
