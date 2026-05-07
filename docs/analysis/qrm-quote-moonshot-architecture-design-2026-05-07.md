# QRM Quote Tool Moonshot — Architecture & Design Report

**Prepared for:** Brian Lewis  
**Role:** Paperclip Architect + Design  
**Date:** 2026-05-07  
**Scope:** Architecture/design only. No code, no migrations, no commits.

## 1. Executive architecture stance

The QRM quote moonshot should extend the existing `quote_packages` / `quote_package_line_items` / `quote_financing_scenarios` model, not create a parallel quote system. The live repo already has additive foundations for quote numbers, commercial terms, wizard state, tax jurisdictions, financing scenarios, document artifacts, delivery events, share tokens, signatures, and version history. The missing work is field-parity hardening, immutable PDF/customer snapshots, multi-unit line fidelity, and the branded acceptance layer.

Current QRM output is visually cleaner than IntelliDealer but commercially unsafe: it shows `PRIMARY CONTACT`, raw AI-like copy, no serial/stock structure, no signature line, no state/county tax parity, no trade/parts/misc sections, no legal/TILA disclaimer pairing, and a misleading cash payment panel beside financed amount. Q02699 is ugly but complete. The target is: keep every Q02699 data element, then present it as a QEP-branded, mobile-readable, acceptance-ready proposal.

## 2. Field-parity matrix

Legend: **Current** = column/table exists today or is materially present. **Proposed** = additive field/snapshot needed for Q02699 parity or moonshot durability.

| Q02699 field / section | Current / proposed QRM table.column | Notes |
|---|---|---|
| QEP logo, tagline `IT'S IN THE NAME`, company name, address, phone, fax, web | **Proposed:** `quote_document_artifacts.metadata.letterhead_snapshot`; optional `branches` / brand config source | Snapshot on PDF generation so historical PDFs do not change when branch/brand settings change. |
| OEM line-card badges: DEVELON, Bandit, YANMAR, ASV | **Proposed:** `quote_document_artifacts.metadata.oem_badges[]` | Store rendered badge set/version per PDF. Source can be brand config or selected line OEMs. |
| Faded gear watermark | **Proposed:** ADR-014 PDF brand system, not transactional DB | Design token/template responsibility; store template version on artifact metadata. |
| Branch number/name, e.g. `01 - LAKE CITY` | **Current:** `quote_packages.branch_slug`, `branches`; **Proposed:** `quote_packages.branch_code`, `quote_packages.branch_name` or branch snapshot in artifact metadata | Q02699 requires branch code + display on every page. Existing branch slug is not enough for immutable PDFs. |
| Date prepared | **Current:** `quote_packages.created_at`, `quote_document_artifacts.generated_at` | Use artifact generation time for PDF header; quote created time remains lifecycle field. |
| Time prepared | **Current:** `quote_document_artifacts.generated_at` | Render HH:MM:SS ET. |
| Origin marker `(O)` / `(R)` | **Proposed:** `quote_document_artifacts.origin_marker`, or `metadata.origin_marker` | Original vs reprint belongs to document artifact/version, not quote package. |
| Page X of Y | **Current:** PDF renderer concern | Must render every page; store no DB field except template version. |
| Account No `RYLEE001` | **Current:** `qrm_companies.legacy_customer_number`; **Proposed:** expose as `account_code` in customer snapshot | Existing column preserves IntelliDealer customer key. Use it as the account code unless QEP has a distinct account-number export. |
| Customer phone | **Current:** `quote_packages.customer_phone`, `qrm_contacts.phone` / `cell`, `qrm_companies.phone` | Snapshot on quote package/document to avoid later customer edits changing old PDFs. |
| Quote number `Q02699` | **Current:** `quote_packages.quote_number`; legacy `qb_quotes.quote_number` also exists | QRM can keep `QEP-YYYY-NNNN`, but Q02699 parity needs import/reference field if showing legacy quote numbers during parallel run. |
| Ship Via | **Current:** `qb_quotes.ship_via`; **Proposed:** `quote_packages.ship_via` | Canonical wizard uses `quote_packages`, so add here rather than relying on legacy `qb_quotes`. |
| Purchase Order | **Current:** `qb_quotes.po_number`; **Proposed:** `quote_packages.purchase_order` | Same rationale as Ship Via. |
| Tax ID No | **Current:** `qrm_companies.ein`; tax exemption fields exist on company | Render masked/blank per permissions. For customer PDF, use quote-time snapshot or explicit entered tax ID field. |
| Salesperson full name | **Current:** `quote_packages.created_by` -> `profiles` | Snapshot on PDF artifact to preserve name at send time. |
| Salesperson code `RM3` | **Current:** `profiles.salesperson_code` | Do not add to `auth.users`; repo already uses `profiles.salesperson_code` with workspace uniqueness. |
| Separate Ship To / Invoice To blocks | **Current:** `qrm_company_ship_to_addresses`; `qrm_companies` address; **Proposed:** `quote_packages.ship_to_address_id`, `quote_packages.sold_to_address_snapshot`, `quote_packages.ship_to_address_snapshot` | `qb_quotes` has address IDs, but quote wizard canonical table should snapshot both rendered blocks. |
| Legal title banner `EQUIPMENT ESTIMATE - NOT AN INVOICE` | **Proposed:** ADR-014 fixed PDF content | Required on customer-facing PDF; template-level, not mutable user copy. |
| Column header: Description / `** Q U O T E **` / Expiry / Amount | **Current:** `quote_packages.expires_at`; line items current | Template must retain legal/legacy row while modernizing typography. |
| Stock # per unit | **Current:** `catalog_entries.stock_number`; `quote_package_line_items.metadata` may carry it; **Proposed:** `quote_package_line_items.stock_number` | Promote to first-class column for PDF parity and side-by-side QA. |
| Serial # per unit | **Current:** `catalog_entries.serial_number`; `qrm_equipment.serial_number`; **Proposed:** `quote_package_line_items.serial_number` | Must be frozen on each line; source inventory may change after quote. |
| New/Used/Demo flag | **Current:** `catalog_entries.condition`, line `metadata`; **Proposed:** `quote_package_line_items.condition` | Constrain to `new|used|demo` or text with validation. |
| Model year | **Current:** `quote_package_line_items.year` | Existing line column is sufficient; renderer must use it. |
| Make/model | **Current:** `quote_package_line_items.make`, `.model` | Existing line columns are sufficient; normalize capitalization at render. |
| Long marketing description | **Current:** `quote_package_line_items.description`; **Proposed:** `quote_package_line_items.long_description` | Current description is too generic; keep a distinct marketing/spec description. |
| Product line / short description | **Current:** `quote_package_line_items.description` | Can remain description if long description is added separately. |
| Ordered option/spec bullets | **Current:** `quote_package_line_items.metadata`; **Proposed:** `quote_package_line_items.spec_bullets jsonb` | First-class ordered JSON array required for consistent PDF and manufacturer spec ingestion. |
| Warranty callout | **Current:** line type `warranty`; **Proposed:** `quote_package_line_items.warranty_text` for equipment/attachment lines | Warranty needs to render under each unit, not only as a separate commercial line. |
| Multi-unit support | **Current:** `quote_package_line_items` supports multiple rows; line type currently expanded | ADR-015 should declare it canonical: every machine/attachment is its own ordered line. |
| Trade-in serial | **Current:** `trade_valuations.serial_number` | Snapshot needed if trade valuation changes. |
| Trade year/make/model | **Current:** `trade_valuations.year/make/model` | Render in dedicated Trade Ins section. |
| Trade condition/inclusions/free-text notes | **Current:** `trade_valuations.condition`, `.notes`; **Proposed:** `trade_valuations.inclusions_notes` or quote snapshot metadata | Q02699 needs free-text inclusions like bucket included and trade notes. |
| Trade allowance negative amount | **Current:** `quote_packages.trade_allowance`, `quote_packages.trade_credit`, line type `trade_allowance` | Renderer must use suffix-negative notation for IntelliDealer parity; DB amount can remain signed/typed. |
| Trade market context (moonshot) | **Current:** `trade_valuations.market_value`; **Proposed:** `trade_valuations.market_range_low/mid/high`, `source`, `as_of_date` or metadata | Must display ADR-005 range header, not a guaranteed offer. |
| Additional Parts section | **Current:** line types can include `accessory/custom`; parts-only tables exist | Add/standardize `quote_package_line_items.line_type='part'` or use `custom` with `metadata.part_number`; ADR-015 should decide. |
| Part description | **Current:** `quote_package_line_items.description` | Sufficient if line type distinguishes parts. |
| Part number | **Current:** `parts_quote_lines.part_number` in parts module; **Proposed:** `quote_package_line_items.part_number` or `metadata.part_number` | Equipment quote PDF needs parts lines without joining parts quote module. |
| Part quantity / unit price / extended | **Current:** `quote_package_line_items.quantity`, `.unit_price`, `.extended_price` | Existing columns are sufficient. |
| Misc Charges/Credits: down payment, freight, PDI, doc/title/tag/registration | **Current:** line types for `pdi`, `freight`, `good_faith`, `doc_fee`, `title`, `tag`, `registration`, `discount`, `trade_allowance`; `cash_down` on package | Render these as a dedicated section, not blended into a modern summary card. |
| Subtotal | **Current:** `quote_packages.subtotal` | Must be post-line snapshot used by PDF. |
| Florida State 6.00% line | **Current:** `tax_jurisdictions.state_rate`, `quote_packages.tax_total`; **Proposed:** explicit `tax_state_amount` line item or artifact tax snapshot | Q02699 requires rate inline and state amount separate from county. |
| County tax named line + $5,000 cap | **Current:** `tax_jurisdictions.county_name`, `.county_surtax_rate`, `.surtax_cap_amount`, `quote_packages.delivery_county` | Seed currently only Columbia acceptance-test row; full FL DOR source/seed required before compliance use. |
| Quote Total | **Current:** `quote_packages.net_total`; legacy `qb_quotes.total_cents` | Define canonical customer total formula and snapshot in artifact metadata for immutable PDF. |
| Authorization signature line | **Current:** `quote_signatures`; **Proposed:** `quote_packages.authorization_signed_at`, `quote_document_artifacts.signature_required`, or use `quote_signatures` plus artifact metadata | Visual line must appear beside total even before e-sign. Actual e-sign events remain in `quote_signatures`. |
| Comments box | **Current:** `quote_packages.notes` not present; has `special_terms`, `opportunity_description`; **Proposed:** `quote_packages.comments_box` | Separate external comments from internal notes and special terms. |
| Legacy financing disclaimer | **Proposed:** ADR-014 fixed PDF content when payment math shown | Must pair with ADR-006 TILA block; do not replace it. |
| TILA disclaimer block | **Current:** feature-flag/compliance requirement; **Proposed:** reusable disclaimer component + PDF fixed block | Blocks any customer payment math until Angela sign-off. |
| Finance Options grid: 36/48/60/72 | **Current:** `quote_financing_scenarios` | Add program source attribution in scenario metadata; render styled table, not ASCII. |
| Standard footer legal text | **Proposed:** ADR-014 fixed every-page footer | Must be verbatim per spec; do not substitute modern paraphrase. |
| `Thank You For Your Business!` | **Proposed:** ADR-014 fixed closing | Preserve exact phrase. |
| QR code to website / landing page | **Current:** `quote_packages.share_token`; **Proposed:** QR target to branded quote landing `/q/:token`, stored on artifact metadata | Moonshot M10 should point to quote status/accept/contact page, not only qepusa.com. |
| Immutable PDF URL/version | **Current:** `quote_document_artifacts`, `quote_package_versions`, `portal_quote_review_versions`, `quote_packages.pdf_url` | ADR-016 should pick one canonical quote version model and avoid duplicate version semantics. |
| Customer acceptance snapshot | **Current:** `quote_signatures.signed_snapshot`, `.document_hash`, `.signed_via` | Strong base exists; extend for full Q02699 line/tax/terms snapshot. |
| Rep-only Deal IQ data | **Current:** margin fields on quote package and approval policies | Never render in customer artifact; restrict through RLS and separate rep-side UI. |

## 3. Page-by-page world-class proposal structure

Every page uses QEP letterhead, OEM badge row, branch/date/time/origin/page metadata, account/phone/quote/salesperson box, faded gear watermark, legal title banner, and standard footer/QR. Header/footer content must be artifact-snapshotted.

### Page 1 — Cover + commercial at-a-glance
- Hero machine/gallery strip with 3–5 equipment photos for the primary unit.
- `EQUIPMENT ESTIMATE - NOT AN INVOICE` banner retained above the proposal headline.
- Prepared-for block with real customer/contact only; PDF generation blocks on placeholder/null values.
- Primary machine/attachment summary with stock #, serial #, year/make/model, branch, and availability status.
- Human-edited `Why This Machine` narrative; no literal quotes around extracted facts and no unedited AI phrasing.
- Executive commercial snapshot: subtotal, trade, rebates, tax, down payment/deposit, quote total.
- Mobile-safe visual hierarchy: large totals, short sections, no tiny receipt-only layout.

### Page 2 — Equipment and configuration detail
- One repeatable section per unit: stock #, serial #, new/used/demo, year/make/model, amount.
- Structured model/spec blocks from manufacturer spec ingestion where available; otherwise frozen ordered `spec_bullets`.
- Attachments, options, accessories, and warranty callout under the correct unit.
- Unit photo thumbnails and spec-source attribution when available.
- Multi-unit support tested with 1, 2, and 3 units; Q02699’s RT-135F + HM-70SR is the floor.

### Page 3 — Trade, parts, miscellaneous, taxes, authorization
- Dedicated `Trade Ins` section with centered divider, serial, year/make/model, notes, market range context, and negative amount notation.
- Dedicated `ADDITIONAL PARTS` grid with description, part #, qty, unit price, extended.
- Dedicated `Miscellaneous Charges/Credits` grid for down payment received, freight, PDI, doc, title, tag, registration, and adjustments.
- Totals block with separate subtotal, `Florida State 6.00%`, named county tax, and quote total.
- Authorization signature line on the same row as Quote Total.
- Comments box below totals.
- Legacy financing disclaimer + ADR-006 TILA block when payment math exists.

### Page 4 — Finance / lease comparison and terms
- Styled finance comparison table with 36/48/60/72 months and visible APR/source attribution.
- Optional cash vs finance vs lease comparison if enabled and seeded; lease hidden unless rate sheets/residual tables exist and feature flag is on.
- Deposit, expiration, follow-up expectation, sales rep contact card, and next-step CTA.
- Compliance copy remains exact where mandated; brand voice edits apply to non-legal explanatory text only.

### Appendix / long-form pages as needed
- Full manufacturer specs, warranty terms, inspection checklist, trade market comps, and quote version history summary.
- Keep customer PDF concise by default; allow appendix inclusion toggles in the rep portal.

### Branded acceptance landing page (QR/share link, not a PDF page)
- `/q/:token` opens a QEP-branded landing page with latest quote version, accept/e-sign, contact rep, and deposit action when SOP/Stripe are cleared.
- Customer sees only customer-safe data; Deal IQ, margin, commission, and internal notes stay rep-only.
- Accept event writes `quote_signatures`, signed snapshot, document hash, activity timeline, stage update, and rep notification.

## 4. ADR outlines

### ADR-014 — Quote PDF Layout & Brand System
Decision: rebuild the customer quote PDF as a governed QEP document system with Q02699 field parity as the minimum data contract and the QEP brand guide as the visual contract. The ADR should define every-page header/footer, legal banner, watermark, typography, color tokens, OEM badge rules, required disclaimer handling, placeholder-null blocking, and the artifact metadata snapshot (`template_version`, letterhead, badges, footer, origin marker). Rejected approach: cosmetically patching the current two-page proposal, because it lacks legal/commercial fields and allows unsafe placeholders.

### ADR-015 — Multi-Unit Quote Data Model
Decision: make `quote_package_line_items` the canonical ordered source for all customer-visible quote lines: equipment, attachments, options, accessories, warranties, parts, misc charges, discounts, rebates, taxes, and trade allowances. Add first-class parity columns where joins/metadata are unsafe for immutable PDFs (`stock_number`, `serial_number`, `condition`, `long_description`, `spec_bullets`, `warranty_text`, and likely `part_number`). Rejected approach: keeping multi-unit detail in `quote_packages.equipment` JSON only, because field-level QA, rendering, reconciliation, and version diffs become fragile.

### ADR-016 — Acceptance Flow & E-Signature
Decision: customer delivery uses an immutable PDF artifact plus a signed branded landing page backed by `share_token`, `quote_document_artifacts`, `quote_package_versions`, and `quote_signatures`. Every send creates or references a versioned artifact; edits produce a new version; acceptance stores a signed snapshot and document hash. The ADR should settle TTL, latest-version routing, signed URL rotation, e-sign provider vs in-house canvas signature, deposit handoff, audit events, and RLS/customer-safe projections. Rejected approach: sending only a static PDF attachment, because it cannot support acceptance, version dispute defense, or quote-status telemetry.

## 5. Migration filename and rollback approach

Recommended repo-sequence filename:

- `supabase/migrations/552_quote_pdf_parity_schema.sql`
- Companion rollback artifact: `supabase/migrations/552_quote_pdf_parity_schema_rollback.sql` or a rollback section in the migration header, matching nearby migration style.

If Paperclip requires timestamp naming instead of numeric sequencing, use:

- `supabase/migrations/20260507HHMMSS_quote_pdf_parity_schema.sql`

Migration should be additive and reversible:

1. Add nullable parity columns to `quote_packages` and `quote_package_line_items`.
2. Add artifact/version metadata columns only where existing tables cannot carry the field cleanly.
3. Add check constraints as `NOT VALID` first where legacy rows may be dirty; validate after backfill/QA.
4. Create indexes only for lookup-critical fields: quote package line ordering, stock/serial search, artifact latest-version lookup.
5. Do not drop or rename existing quote tables.
6. Backfill from `catalog_entries`, `qrm_equipment`, `qrm_companies.legacy_customer_number`, `profiles.salesperson_code`, and branch rows where deterministic; record unresolved rows for QA rather than guessing.
7. Rollback drops new indexes, constraints, triggers if any, then additive columns/tables in dependency order. Rollback must not delete existing quote packages, signatures, document artifacts, or delivery events.

## 6. Blockers and dependencies

### Brian / QEP decision blockers
- Rylee: Trade SOP for Step 4 and how trade notes/inclusions should render.
- Rylee: Deposit SOP before deposit amount, acceptance-page deposit collection, or Stripe flow can go live.
- Rylee: Lease rate sheets, OEM list, residual tables, and whether lease comparison is customer-visible by default.
- Rylee + Ryan: approval thresholds for margin floor, trade max, and rep discount cap.
- Ryan + Rylee: side-by-side PDF sign-off that QRM covers Q02699 and exceeds it.
- Angela: TILA / Florida lending-rule sign-off before any customer-visible payment math.

### Data / integration blockers
- Full Florida county tax source/seed from FL DOR or approved static seed; current Columbia seed is acceptance-test only.
- Manufacturer spec sheet ingestion source for live specs and consistent bullets.
- APR/program source data for Bandit, Develon, Yanmar, ASV attribution.
- Sandhills / Iron Solutions trade comp feed decision for market range context.
- IntelliDealer data miner reconciliation rule: confirm `qrm_companies.legacy_customer_number` is the canonical account code for Q02699-style `RYLEE001`.

### DevOps / platform blockers
- R2 bucket policy and signed URL TTL/rotation for versioned PDFs.
- E-sign provider decision or in-house signature acceptance decision.
- M365 Graph send-as configuration for Email Quote.
- Twilio number + A2P 10DLC for Text Quote.
- Stripe readiness remains blocked until deposit SOP is approved.

### Design / QA blockers
- Final QEP brand assets: production logo lockup, OEM badge assets, gear watermark asset, approved typography packaging.
- Mobile rendering QA on real iOS/Android/iPad devices.
- Placeholder/null blocker tests: no `PRIMARY CONTACT`, missing serial, missing customer phone/account, missing tax rows, or raw AI text can leave the system.
- Verbatim legal copy tests for Section 10.12 and 10.14 plus ADR-006 TILA block.

## 7. Phase A handoff summary

Before Engineering starts Phase B, Paperclip Architect should deliver:

1. Approved ADR-014/015/016.
2. Final field-parity matrix signed by Brian.
3. `552_quote_pdf_parity_schema.sql` design reviewed, with rollback defined.
4. PDF wireframe/structure sign-off from Design using QEP brand rules.
5. Updated QA checklist mapping each Q02699 parity item to a test/assertion.

No calendar-week estimates are included. The gating unit is phase completion and written approval, not time.
