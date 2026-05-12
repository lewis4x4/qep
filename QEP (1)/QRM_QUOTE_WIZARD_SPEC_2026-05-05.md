# QRM Quote Tool — Wizard Spec & Implementation Plan

**Source:** Rylee McKenzie email, 2026-05-04 22:12 ET
**Compiled:** 2026-05-05
**Client:** QEP USA (`qep-usa`)
**Module:** QRM > Quote Tool (Phase 1B Sales)
**Pipeline Target:** Paperclip CEO → Architect → Engineer → QA → DevOps → Security → Data & Integration
**Supersedes:** Quote Builder section in `CLAUDE_CODE_HANDOFF_2026-04-23.md` where conflicting

---

## 0. EXECUTIVE DECISIONS (binding, no rework)

1. **Wizard pattern** — Replace the current scroll-down quote builder with a step-by-step wizard. One step per screen. Slide transition forward, jump-back enabled via the progress bar. Save state continuously to the draft store (auto-save per ADR-008/C8 pattern).
2. **Tax engine** — Florida 6% state sales tax applied to subtotal **after** trade allowance. County discretionary surtax added per delivery county, with the Florida $5,000 cap rule enforced at the calculation layer. Tax exempt customers skip entirely when a valid resale certificate is on file. Manual override field retained (with reason code).
3. **Send panel** — Below margin waterfall on Step 9 (Review). Three buttons: Preview Quote (PDF in pane), Email Quote (composer with customer prefilled, rep auto-BCC), Text Quote (Twilio MMS with branded PDF link).
4. **Lease quoting** — Net new scope. Add as a tab inside Step 7 (Financing). Blocks on Rylee delivering rate sheets, OEM list, residual tables.
5. **Default expiration** — 30 days.
6. **Default follow-up** — 3 days, required field on Step 11.

---

## 1. RYLEE FEEDBACK → WORK ITEM MAPPING

| Rylee Item | Status | Maps To | Owner |
|---|---|---|---|
| 6% FL tax on post-trade subtotal | NEW REQ | QRM-TAX-001 | Architect → Engineer |
| County tax rules engine | NEW REQ | QRM-TAX-002 | Architect → Engineer |
| Send / Preview / Email / Text panel | NEW REQ | QRM-SEND-001 | Engineer + Design |
| Wizard / step slide UX | NEW REQ | QRM-UX-001 | Architect + Engineer |
| Step 1 — Customer info + dedupe | EXISTS, expand | QRM-CUST-001 | Engineer |
| Step 2 — Equipment search + availability | EXISTS, expand | QRM-EQUIP-001 + ADR-004 ref | Engineer |
| Step 3 — Configure (attachments / options / accessories) | EXISTS, expand | C1, C2 in handoff | Engineer |
| Step 4 — Trade-in workflow | NEEDS SOP | QRM-TRADE-001 | Architect (blocked on Trade SOP) |
| Step 5 — Pricing build (incl. PDI, freight, 1% good faith, doc/title/tag) | NEW LINE ITEMS | QRM-PRICE-001 | Architect + Engineer |
| Step 6 — Rebates & promotions (mfg + dealer + loyalty) | NEW REQ | QRM-PROMO-001 | Architect + Engineer + Data |
| Step 7 — Financing scenarios + multi-save | EXISTS, expand | QRM-FIN-001 (wraps ADR-006) | Engineer |
| Step 7b — Lease quoting (FMV / FPPO) | NEW SCOPE | QRM-LEASE-001 | Architect (blocked on lease rate sheets) |
| Step 8 — Quote details + Why This Machine narrative | NEW REQ | QRM-DETAIL-001 | Engineer + AI |
| Step 9 — Review + margin gate + manager approval | EXISTS, expand | QRM-APPROVAL-001 | Architect + Engineer |
| Step 10 — Branded PDF output | EXISTS, improve | C3 in handoff | Engineer + Design |
| Step 11 — Send + log + required follow-up date | NEW REQ | QRM-LOG-001 | Engineer |

---

## 2. SCHEMA ADDITIONS

```sql
-- Tax engine
CREATE TABLE tax_jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code text NOT NULL,
  county text NOT NULL,
  state_rate numeric(6,5) NOT NULL,
  county_surtax_rate numeric(6,5) NOT NULL,
  surtax_cap_amount numeric(12,2),  -- $5000 for FL
  effective_from date NOT NULL,
  effective_to date,
  source_url text,
  UNIQUE (state_code, county, effective_from)
);

CREATE INDEX tax_jurisdictions_lookup_idx
  ON tax_jurisdictions (state_code, county, effective_from DESC);

-- Quotes (extend existing)
ALTER TABLE quotes
  ADD COLUMN wizard_step smallint NOT NULL DEFAULT 1,
  ADD COLUMN wizard_completed_at timestamptz,
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN follow_up_at timestamptz,
  ADD COLUMN deposit_required_amount numeric(12,2),
  ADD COLUMN delivery_eta date,
  ADD COLUMN special_terms text,
  ADD COLUMN why_this_machine text,
  ADD COLUMN tax_jurisdiction_id uuid REFERENCES tax_jurisdictions(id),
  ADD COLUMN tax_override_amount numeric(12,2),
  ADD COLUMN tax_override_reason text,
  ADD COLUMN approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN approval_route_reason text,
  ADD COLUMN approver_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN approved_at timestamptz;

-- Quote line item types (so pricing build is modular)
CREATE TYPE quote_line_kind AS ENUM (
  'equipment', 'attachment', 'option', 'accessory',
  'pdi', 'freight', 'good_faith', 'doc_fee',
  'title', 'tag', 'registration', 'discount',
  'trade_allowance', 'rebate_mfg', 'rebate_dealer',
  'loyalty_discount', 'tax_state', 'tax_county'
);

ALTER TABLE quote_lines
  ADD COLUMN kind quote_line_kind NOT NULL,
  ADD COLUMN reason_code text,
  ADD COLUMN approval_required boolean NOT NULL DEFAULT false;

-- Financing scenarios (multi-save)
CREATE TABLE quote_financing_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  scenario_label text NOT NULL,  -- "36 month", "48 month FMV lease"
  kind text NOT NULL,            -- 'finance' | 'lease_fmv' | 'lease_fppo' | 'cash'
  down_payment numeric(12,2),
  term_months smallint,
  apr numeric(6,4),
  residual_amount numeric(12,2),  -- lease only
  monthly_payment numeric(12,2),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quote_financing_scenarios_quote_idx
  ON quote_financing_scenarios (quote_id);

-- Promotions catalog
CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,         -- 'manufacturer' | 'dealer' | 'loyalty'
  manufacturer text,             -- 'Bandit', 'Develon', 'Yanmar', etc.
  name text NOT NULL,
  description text,
  amount_type text NOT NULL,     -- 'flat' | 'percent' | 'rate_buydown'
  amount_value numeric(12,4) NOT NULL,
  conditions jsonb,              -- min_amount, customer_tier, equipment_categories
  effective_from date NOT NULL,
  effective_to date,
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX promotions_active_idx
  ON promotions (active, effective_from, effective_to)
  WHERE active = true;

-- Approval thresholds (configurable per dealership)
CREATE TABLE approval_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,           -- 'margin_floor_pct', 'trade_credit_max', 'rep_discount_max_pct'
  value numeric(12,4) NOT NULL,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
```

Rollback migration filed alongside (per blueprint-template).

---

## 3. STEP-BY-STEP WIZARD SPEC

### Step 1 — Customer

**Search-first UX.** Single autofocus input on entry. Fuzzy match across `customers.business_name`, `contacts.first_name + last_name`, `contacts.phone`, `contacts.email`. Top 5 results with badges (existing customer / equipment owner / tax exempt). New customer drawer slides in only when the rep clicks "Create new."

Required on new: first name, last name, phone, billing address, assigned salesperson. Optional: business name, email, shipping address (default same as billing toggle), tax ID + resale certificate upload. Territory auto-assigned from billing zip via the territory map.

Dedupe enforcement: phone match + last name match → blocks save, surfaces existing record.

### Step 2 — Equipment

Two entry paths. Path A: serial / stock number search (per ADR-004 pattern). Path B: category → make → model filter cascade. Result card displays year, hours, condition, location, base cost, photos, availability status.

Availability statuses: `in_stock`, `in_transit`, `source_required`. The "source_required" state surfaces a "Confirm availability" button that fires a Slack-style notification to the sales manager + admin (via 8x8 / email / in-app) and locks the wizard at Step 2 until cleared.

### Step 3 — Configure

Two-pane layout. Left: equipment hero with photo and base price. Right: tabbed configuration with Attachments, Factory Options, Accessories, Warranty.

Attachment compatibility sidebar (per C1 in handoff) with one-click add. Each attachment shows MSRP, dealer cost, margin badge. Warranty tab pre-populates extended warranty offers per OEM (ASV, Bandit, Yanmar prefilled per C2).

### Step 4 — Trade-in (skippable)

**BLOCKED on Trade SOP delivery.** Provisional fields based on email and ADR-005:

Make, model, year, hours, condition notes, photos (multi-upload, IndexedDB queue per ADR-008), lien holder, payoff amount, evaluated trade value with manager approval flag.

Inspection checklist (mandatory before trade credit unlocks): hour meter, undercarriage condition, hydraulic leaks Y/N + notes, engine hours at last service, tires/tracks condition, visible damage photos. Per ADR-005 the trade allowance line is locked until checklist completes.

Photo-to-estimate displays the comparable market range with the ADR-005 disclaimer. No single number estimate.

### Step 5 — Pricing build

Auto-summed line groups in a vertical waterfall:

Equipment base price (locked, from Step 2). Attachments + factory options + accessories subtotal (locked, from Step 3). Manual discount field with required reason code dropdown (`competitive_match`, `volume_buyer`, `aged_inventory`, `loyalty`, `other`). Trade allowance applied (locked, from Step 4). Freight/delivery (manual entry or zip-to-zip estimate). PDI (configurable default per equipment type). 1% good faith cost (auto-calculated on subtotal). Doc fee, title, tag, registration (configurable defaults, optional toggle).

Sales tax preview at the bottom, calculated from delivery county. Override available with reason code.

### Step 6 — Rebates & promotions

Three sections: Manufacturer Programs (filtered to the equipment's OEM and active dates), Dealer Promotions (active flag from `promotions` table), Loyalty Discounts (auto-suggested if customer.repeat_customer = true or prior purchase count >= 2).

Each rebate is an opt-in checkbox with the program name + amount + effective dates visible. Selected rebates become quote_lines with kind `rebate_mfg` / `rebate_dealer` / `loyalty_discount`.

### Step 7 — Financing scenarios (skippable for cash)

Tabbed: Cash | Finance | Lease.

Finance tab: down payment, term length (preset chips: 24/36/48/60/72), interest rate (auto-pulled from active manufacturer rate buy-down promotions if applicable), monthly payment auto-calculated. Save Scenario button creates a `quote_financing_scenarios` row. Multiple scenarios save in parallel.

Lease tab (NEW SCOPE, blocked on rate sheets): toggle FMV vs FPPO, term, residual, money factor, monthly payment auto-calculated.

All payment math is gated by `FEATURE_FINANCING_CALCULATOR` flag (ADR-006). TILA disclaimer module renders on every payment surface.

### Step 8 — Quote details

Quote expiration date (default +30 days, editable). Deposit amount (BLOCKED on deposit SOP). Estimated delivery date (date picker). Special terms / notes (long-text). "Why This Machine" narrative (long-text, AI pre-suggests from discovery notes on customer record + equipment specs; rep edits before save, no AI-sounding output ships unedited per QEP voice rules).

### Step 9 — Review + approval gate

Full summary screen: customer block, equipment block, configuration block, pricing waterfall, rebates, financing scenarios, expiration, follow-up.

Margin check: system calculates margin = (sale price - dealer cost - trade allowance - rebates) / sale price. Compares to `approval_thresholds` row for `margin_floor_pct`.

Approval routing logic:

```
IF margin < margin_floor_pct
  OR trade_credit > trade_credit_max
  OR rep_discount_pct > rep_discount_max_pct
  OR any quote_line.approval_required = true
THEN
  approval_status = 'pending_manager'
  notify(sales_manager, quote_id)
  block "Generate Quote" button
ELSE
  approval_status = 'rep_cleared'
  enable "Generate Quote" button
END
```

Manager approval has four outcomes (per existing handoff): approve, approve-with-edits, reject, reject-with-comments.

### Step 10 — Generate quote document

Branded PDF per `qep_brand_guide.pdf`. Includes: machine photos, specs, configuration, pricing waterfall, financing scenarios, rebates applied, expiration, deposit, terms, rep contact card, QEP letterhead.

PDF generation via Puppeteer-on-Workers (existing pattern). Stored in R2 bucket `qep-quote-pdfs`, addressable by quote UUID.

### Step 11 — Send & log (Send Panel)

**Layout:** Below the margin waterfall on Step 9 result OR as the final wizard step. Three primary buttons in a horizontal row.

Preview Quote: opens PDF in side pane (no send action). Email Quote: opens composer with customer email prefilled, subject `Your QEP Quote {quote_number}`, body templated and editable, rep BCC'd via `Microsoft Graph send-as` (Phase 1C dependency). PDF auto-attached. Text Quote: Twilio outbound MMS with short message ("Hey {first_name}, here's your quote from QEP. {short_link}") and PDF link via R2 signed URL with 30-day expiry.

Send action triggers:

1. Quote saved to customer record in CRM (linked to company + contact + equipment).
2. Activity timeline entry created on company record.
3. Opportunity stage updated to `quote_sent`.
4. Follow-up date REQUIRED (date picker, default +3 days, editable, cannot save without).
5. Cadence engine schedules: day 0 send, day 2-3 nudge, day 7 check-in, day 14 escalation, day 30 close-or-archive.

---

## 4. BLOCKING DEPENDENCIES (route to CEO escalation)

| ID | Item | Owner | Blocks |
|---|---|---|---|
| BLK-1 | Trade SOP from Rylee | Rylee | QRM-TRADE-001 (Step 4) |
| BLK-2 | Deposit SOP from Rylee | Rylee | QRM-DETAIL-001 (Step 8 deposit field) |
| BLK-3 | Lease rate sheets + OEM list + residual tables | Rylee | QRM-LEASE-001 (Step 7 lease tab) |
| BLK-4 | Approval thresholds (margin floor, trade max, rep discount cap) | Rylee + Ryan | QRM-APPROVAL-001 (Step 9 routing) |
| BLK-5 | Florida county tax rate source (FL DOR data feed or static seed) | Data agent | QRM-TAX-002 (Step 5 county surtax) |
| BLK-6 | Microsoft Graph send-as configuration in QEP M365 tenant | Rylee + DevOps | Email Quote button (Step 11) |
| BLK-7 | Twilio number provisioning + A2P 10DLC registration for QEP | DevOps | Text Quote button (Step 11) |
| BLK-8 | TILA disclaimer sign-off (ADR-006) | Angela | Lease tab + Finance tab go-live |

---

## 5. AGENT ROUTING

**Architect** owns: ADR addendum for wizard pattern, schema migrations, approval routing logic, lease scenario data model.

**Engineer** owns: wizard component framework (single-page route with step state machine), tax engine implementation (jurisdiction lookup + cap rule), send panel UI + Twilio + Graph wiring, all step UIs, PDF generator updates.

**QA** owns: test matrix per step, approval gate boundary tests (at floor / above floor / way above floor), tax math tests for FL counties (with $5K cap edge cases), lease vs finance vs cash calculation parity tests.

**DevOps** owns: Twilio A2P registration, M365 OAuth + send-as scope, R2 bucket policy for PDF signed URLs, environment flag setup for `FEATURE_LEASE_QUOTING`.

**Security** owns: RLS policies on `quotes`, `quote_lines`, `quote_financing_scenarios`, `promotions`, `approval_thresholds`. Rep can read/write own quotes, manager can read all + approve, finance_admin can read all + see margin, sales_rep cannot see margin column.

**Data & Integration** owns: tax_jurisdictions seed for FL counties (DOR source), promotions sync from manufacturer portals (manual import → Phase 5 automated), customer dedupe matching algorithm tuning.

---

## 6. ACCEPTANCE CRITERIA (QA must verify all before ship)

1. Quote builder is a wizard, not a scroll. Each step renders solo. Forward / back navigation persists state.
2. Tax line correctly shows: state tax = (subtotal - trade) * 0.06 for any FL delivery address.
3. County surtax line correctly applies the $5,000 cap. Test with a $50,000 sale in Columbia County (1% surtax = $50, not $500).
4. Tax exempt customer with valid certificate produces $0 tax line and a "Tax Exempt" badge on the quote PDF.
5. Send Panel renders three buttons. Each opens its expected destination and logs the activity.
6. Approval gate fires on margin below floor, trade above max, rep discount above cap, OR any line item flagged for approval.
7. Manager approve / approve-with-edits / reject / reject-with-comments all route correctly.
8. Follow-up date is required at Step 11. Save blocked without it.
9. Quote PDF matches brand guide (orange accents, charcoal base, Bebas / Montserrat fonts, gear motif).
10. Lease tab renders only when `FEATURE_LEASE_QUOTING=true` AND rate sheets are seeded.
11. TILA disclaimer renders on every screen showing payment math.

---

## 7. OPEN ITEMS FOR FOLLOW-UP CALL

To close on the next QEP touchpoint:

1. Confirm 30-day quote expiration default is acceptable (Rylee gave "14 or 30").
2. Confirm 3-day default follow-up cadence (was implied, not specified).
3. Confirm rep BCC on email send is correct, vs. visible CC.
4. Confirm whether manager approval routes to one specific user or to a role-based queue.
5. Confirm "Why This Machine" AI pre-suggest is desired (could be hand-written only if Rylee wants zero AI text exposure).
6. Confirm Sandhills / Iron Solutions feed is the comp data source for Step 4 trade ranges.

---

## 8. CHANGES TO PRIOR HANDOFF

The following items in `CLAUDE_CODE_HANDOFF_2026-04-23.md` are clarified or extended by this spec:

- **C1 (attachment compatibility sidebar)** — Confirmed inside Step 3 of the wizard.
- **C2 (extended warranty)** — Confirmed inside Step 3 Warranty tab, prefilled OEMs unchanged.
- **C3 (PDF improvement)** — Reaffirmed as gating on customer-facing send actions in Step 11.
- **C5 (mobile floating action bar)** — Now applies to wizard "Next Step" button on mobile.
- **Sales cadence (Section 5)** — Reaffirmed: day 0 / 2-3 / 7 / 14 / 30 from quote send.
- **ADR-005 (trade-in guardrails)** — Reaffirmed at Step 4.
- **ADR-006 (financing compliance gate)** — Extended to cover lease tab; same gate, expanded scope.
- **ADR-008 (offline-first)** — Wizard state persists to IndexedDB through every step, syncs on reconnect.

---

## 9. FILES TO PRODUCE NEXT

For Architect to draft as Phase 1B Sprint addendum:

- `docs/adr/ADR-011-quote-wizard-pattern.md`
- `docs/adr/ADR-012-tax-jurisdiction-engine.md`
- `docs/adr/ADR-013-lease-quoting-scope.md`
- `supabase/migrations/<timestamp>_quote_wizard_schema.sql` (and rollback)
- `src/features/quote-wizard/` route + step components
- `src/features/quote-wizard/tax-engine.ts`
- `src/features/quote-wizard/send-panel.tsx`
- `src/lib/financing-math.ts` (extend with lease functions)

---

## 10. INTELLIDEALER PDF PARITY (Q02699 REFERENCE)

**Source:** IntelliDealer quote `Q02699` (RYLEE MCKENZIE, 05/07/2026, ASV RT-135F + ShearEx HM-70SR + Trade + Parts + Misc, Quote Total $144,110.65).
**Purpose:** Lock in every element from the legacy IntelliDealer PDF that customers and the sales team are already trained on. The QRM PDF must match this content set or exceed it. Cosmetic upgrade is welcome — content omission is not. C3 (PDF improvement) cannot close without every item below present.

### 10.1 Letterhead (every page)

- QEP gear logo lockup, full color
- Tagline: `IT'S IN THE NAME`
- Company name: `Quality Equipment & Parts`
- Address: `4894 NW US Highway 41 • Lake City, Florida 32055`
- Phone: `(386) 754-6186`
- Fax: `(386) 888-1413`
- Web: `www.qepusa.com`
- OEM line-card badges, top right: `DEVELON` · `Bandit Industries, Inc.` · `YANMAR` · `asv`
- Faded gear watermark across page body

### 10.2 Header / metadata box (every page, top right)

- Branch number + name (e.g., `01 - LAKE CITY`, `02 - OCALA`)
- Date (MM/DD/YYYY)
- Time of preparation (HH:MM:SS)
- Origin marker `(O)` original / `(R)` reprint
- Page X of Y
- Account No (customer code, e.g., `RYLEE001`)
- Customer phone
- Quote number (e.g., `Q02699`)
- Ship Via field
- Purchase Order field
- Tax ID No field
- Salesperson code (e.g., `RM3`) + full name

### 10.3 Bill-to / Ship-to

Separate `Ship To:` and `Invoice To:` address blocks. Default ship = bill toggle, but rendered separately on the PDF.

### 10.4 Document title banner

```
EQUIPMENT ESTIMATE - NOT AN INVOICE
```

Boxed and bolded at the top of body. Replaces / pairs with the modern `Equipment Proposal` headline — keep the legal banner.

### 10.5 Column header row

```
Description     ** Q U O T E **     EXPIRY DATE: MM/DD/YYYY     Amount
```

### 10.6 Equipment line item structure (per unit, repeating)

```
Stock #: Qxxxxxx        Serial #: xxxxxxxxxxx        $xxx,xxx.xx
New/Used  YYYY  MAKE MODEL
Long marketing description (HP, class, family)
Short product line
*****************************************
INCLUDING THE FOLLOWING OPTIONS:
- Spec line 1
- Spec line 2
- ...
*****************************************
**Warranty callout (e.g., "2 Year/ 2000 Hour Full Machine Warranty")**
```

Multi-unit support required: machine + attachment + secondary equipment each as their own stock line with their own spec list and amount.

### 10.7 Trade-In section (when applicable)

```
                          Trade Ins
                          =========
Serial #: xxxxxx                                       50000.00-
YYYY MAKE MODEL
Condition / inclusions notes
Free-text trade notes
```

Negative amount notation (`-` suffix). Centered section header with `=` divider.

### 10.8 Additional Parts section

```
                       ADDITIONAL PARTS
                       ================
PART DESCRIPTION  PARTNUM  Qty: NN  Price: NN.NN     EXTENDED
```

Columns: Description / Part # / Qty / Unit Price / Extended.

### 10.9 Miscellaneous Charges/Credits section

```
                  Miscellaneous Charges/Credits
                  =============================
LESS DOWN PAYMENT RECD.        Qty: 1  Price: 10000.00   10000.00-
```

Down payment received, freight, PDI, doc fee, title, tag, registration, and any other adjustments live here as line items with Qty + Unit Price + Extended.

### 10.10 Totals block

```
                                       Subtotal:    XXX,XXX.XX
                                Florida State 6.00%:   X,XXX.XX
                                  COLUMBIA COUNTY:        XX.XX
Authorization: _________________________  Quote Total:  XXX,XXX.XX
```

- State tax line shows the rate percentage inline (`Florida State 6.00%:`)
- County tax line named after the actual delivery county (`COLUMBIA COUNTY:`, `MARION COUNTY:`, `SUWANNEE COUNTY:`, etc.)
- $5,000 surtax cap math must replicate IntelliDealer (Q02699: Columbia County 1.5% × $5,000 = $75.00)
- **`Authorization: _________________________`** customer signature line on the same row as Quote Total — required signature gate

### 10.11 Comments box

Free-text comments field below totals. Used for special terms, deal notes, delivery instructions.

### 10.12 Standard financing disclaimer (verbatim)

Print directly below the comments box whenever any payment math is shown. Pair with — do not replace — the ADR-006 TILA block.

```
** FINANCING BASED ON CREDIT APPROVAL. INTEREST RATE MAY
VARY. MONTHLY PAYMENTS ARE ESTIMATED **
```

### 10.13 Finance Options grid

Render as a styled table (not ASCII). Default columns 36 / 48 / 60 / 72 months. Three rows: Months / %Rate / $Payment. Reference layout:

```
************************************************************
*                    Finance Options                       *
*                                                          *
* Months:       36       48       60       72              *
* %Rate         0.00     0.00     0.00     2.99            *
* $Payment    4003.07  3002.31  2401.84  2188.93           *
************************************************************
```

### 10.14 Standard footer (verbatim, every page)

```
Good for thirty (30) days from date of quote.  This estimate is not a contract.  Estimate is based on initial inspection.
Does not cover any issues that came up when work started.  Prices not guaranteed.

Thank You For Your Business!
```

QR code bottom right linking to `https://www.qepusa.com` with label `Visit our Website`.

### 10.15 Parity checklist (Engineer signs off line by line before C3 closes)

1. Full QEP letterhead with address, phone, fax, web, tagline `IT'S IN THE NAME`
2. OEM line-card badges (DEVELON / Bandit / YANMAR / ASV)
3. Faded gear watermark on body
4. Branch number + name on every page
5. Date + time of preparation with `(O)` / `(R)` marker
6. `Page X of Y` numbering
7. Account No, customer phone, quote number, salesperson code in header box
8. Ship Via, Purchase Order, Tax ID No fields (blank when N/A but rendered)
9. Separate Ship To and Invoice To address blocks
10. Salesperson code AND full name
11. `EQUIPMENT ESTIMATE - NOT AN INVOICE` banner
12. Per-line stock # + serial # for every machine
13. New/Used flag on each unit
14. Full spec bullet list under each machine (`INCLUDING THE FOLLOWING OPTIONS:`)
15. Warranty callout per machine
16. Multi-unit support (machine + attachment as separate stock lines)
17. Dedicated `Trade Ins` section with serial # and notes, negative amount notation
18. Dedicated `ADDITIONAL PARTS` section with Qty / Unit Price / Extended columns
19. Dedicated `Miscellaneous Charges/Credits` section (down payment, freight, PDI, doc fee, title, tag, registration)
20. Subtotal line
21. State tax line with rate % inline (`Florida State 6.00%:`)
22. County tax line named after actual county with $5K cap math
23. `Authorization: ____________________` customer signature line on the totals row
24. Quote Total (final out-the-door)
25. Free-text comments box
26. Standard financing disclaimer (verbatim block in 10.12)
27. Finance Options grid: Months / %Rate / $Payment for 36/48/60/72
28. Standard footer disclaimer (verbatim block in 10.14)
29. `Thank You For Your Business!` closing
30. QR code → qepusa.com

### 10.16 Schema additions to support parity

```sql
-- Multi-unit support: link multiple equipment lines per quote
-- (already supported by quote_lines.kind = 'equipment'; ensure stock_number and serial_number
-- carry through and warranty_text + spec_bullets render in PDF)
ALTER TABLE quote_lines
  ADD COLUMN stock_number text,
  ADD COLUMN serial_number text,
  ADD COLUMN condition text,           -- 'new' | 'used' | 'demo'
  ADD COLUMN model_year smallint,
  ADD COLUMN make text,
  ADD COLUMN model text,
  ADD COLUMN long_description text,
  ADD COLUMN spec_bullets jsonb,        -- ordered array of spec lines
  ADD COLUMN warranty_text text;

-- Branch and origin metadata on quotes
ALTER TABLE quotes
  ADD COLUMN branch_code text,          -- '01', '02'
  ADD COLUMN branch_name text,          -- 'LAKE CITY', 'OCALA'
  ADD COLUMN origin_marker text NOT NULL DEFAULT 'O',  -- 'O' original, 'R' reprint
  ADD COLUMN ship_via text,
  ADD COLUMN purchase_order text,
  ADD COLUMN comments_box text,
  ADD COLUMN authorization_signed_at timestamptz,
  ADD COLUMN authorization_signature_url text;  -- R2 path to signed PDF

-- Customer account code (IntelliDealer parity, e.g., 'RYLEE001')
ALTER TABLE customers
  ADD COLUMN account_code text UNIQUE;

-- Salesperson code (IntelliDealer parity, e.g., 'RM3')
ALTER TABLE auth.users
  ADD COLUMN salesperson_code text UNIQUE;
```

### 10.17 Acceptance addition to Section 6

Add to the Section 6 acceptance criteria:

12. PDF renders 100% of items 1–30 in the parity checklist (10.15) for a real customer + multi-unit + trade-in + parts + misc + financing scenario.
13. Side-by-side review against IntelliDealer Q02699 shows no missing element. Architect signs off in writing before C3 closes.

---

## 11. CUSTOMER-FACING PDF REFINEMENTS (2026-05-07 BRIAN PASS)

First-look design feedback from Brian on the rendered draft. These refinements modify Sections 10.x where noted and become required acceptance items for C3 closure.

### 11.1 Typography — bump base size

Body type is too small for comfortable read in the current draft. Scale the entire type system one step up:

- Body: 11pt → **12pt** (Inter)
- Table cells: 9pt → **10pt** (Inter)
- Section headers / subheads: scale proportionally (Montserrat ExtraBold)
- Primary headlines (Bebas Neue / Barlow Condensed Bold) hold or scale up
- Numbers / KPI (Montserrat Bold) scale up with body

Goal: customer reads the quote on phone or print without zoom.

### 11.2 Drop redundant header text

Remove the metadata line that repeats the quote test name, quote number, and expiry date to the right of the `EQUIPMENT ESTIMATE - NOT AN INVOICE` banner. Quote number and expiry already appear in the top-right metadata box (10.2) and the column header row (10.5). Keep the banner clean and centered. Do not triple-print the same fields.

### 11.3 Prepared by / Rep card — fill the space

Increase font size on the "Prepared by" rep card so it fills its container. Canonical rep card layout (use as the spec):

```
RYLEE MCKENZIE
Iron Manager

Mobile:  (386) 292-3743
Office:  (386) 754-6189
Email:   rylee@qepusa.com
```

Type stack on the card:
- Rep name: Bebas Neue or Barlow Condensed Bold, large
- Title: Montserrat ExtraBold, mid
- Contact rows: Inter, bumped from 11.1 base

Card reads at a glance. No wasted whitespace inside the box.

### 11.4 Trade-in — remove comparable market range from customer copy

Strike the ADR-005 "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER" block from the customer-facing PDF. The comp range is internal context for the rep, not for the customer.

- Customer PDF: trade allowance line only (already in 10.7).
- Rep portal "Deal IQ" sidebar (Moonshot M6): comp range renders here.
- Internal QRM trade detail view: comp range renders here.

This amends Moonshot M4 in the QRM Quote Moonshot Handoff: M4 is rep-facing only.

### 11.5 Misc Charges / Additional Parts / Trade-In — conditional rendering

Empty sections do not render at all. No header, no divider, no body — section is removed and content below pushes up.

Inside Miscellaneous Charges/Credits:
- Do not pre-print empty `PDI`, `Freight`, `Doc Fee`, `Title`, `Tag`, `Registration` rows.
- Only render line items the rep actually selected and populated.
- If zero line items are populated, the entire Misc Charges/Credits section is suppressed.

Same rule for Additional Parts and Trade Ins sections.

This amends parity checklist items 17, 18, and 19 in Section 10.15: empty sections are suppressed.

### 11.6 Totals + Signature — two-column layout

Subtotal/totals block sits in a left column. Customer authorization signature line sits in a right column directly across from it on the same row, vertically aligned. Replaces the single-row authorization layout in 10.10.

Layout:

```
┌──────────────────────────────────┬──────────────────────────────────┐
│ Subtotal:           XXX,XXX.XX   │                                  │
│ Florida State 6.00%:    X,XXX.XX │  Authorization:                  │
│ COLUMBIA COUNTY:           XX.XX │  ______________________________  │
│ Quote Total:        XXX,XXX.XX   │  Date: _____________             │
└──────────────────────────────────┴──────────────────────────────────┘
```

This amends parity checklist item 23 in Section 10.15: signature line moves to right-column position.

### 11.7 Financing box — payment is the hero

The monthly payment is the largest, boldest text in the financing block. Customer's eye lands on the payment first. In current market conditions Brian is pushing payment-first selling — the PDF reinforces that.

Apply across:
- Single-payment display: monthly payment renders in Montserrat Bold at headline scale. Term, rate, total of payments, APR attribution, and TILA disclaimer all sit below at standard body size.
- Multi-term comparison grid (10.13): the `$Payment` row uses Montserrat Bold at a larger size than the `Months` and `%Rate` rows.

ADR-006 TILA disclaimer still renders on every payment-math surface. Verbatim financing disclaimer from 10.12 still prints. The bolding is on the number — the legal text holds its standard size.

### 11.8 One-page priority

Default target: single page. The generator collapses empty sections (per 11.5) and tightens vertical spacing to keep simple quotes on one page.

- Single-unit quote, no trade, no parts, no misc → MUST render on one page.
- Multi-unit with parts, trade, and financing comparison → 2–3 pages acceptable.
- Page break rules:
  - Cover (letterhead + customer block + equipment header) stays intact.
  - Each equipment line's spec list stays intact — no orphan section headers.
  - Totals + Signature block, Comments box, and Financing Options grid MUST stay together on the same page. If they would split across pages, push the whole block to the next page rather than orphan.
  - Repeating header/footer prints on every page regardless of count.

### 11.9 Section 10 parity checklist amendments

- Item 17 (Trade Ins section): renders only when populated. Empty = suppressed.
- Item 18 (Additional Parts section): renders only when populated. Empty = suppressed.
- Item 19 (Misc Charges/Credits section): renders only when populated. Empty = suppressed.
- Item 23 (Authorization signature line): moves to right-column position across from the totals block per 11.6.

### 11.10 Moonshot handoff amendments

These refinements modify the QRM Quote Moonshot Handoff (`QRM_QUOTE_MOONSHOT_HANDOFF_2026-05-07.md`):

- **M4 (Trade-in market context)**: rep-facing only. Removed from customer-facing PDF and customer acceptance page. Renders on the M6 Deal IQ sidebar and the internal QRM trade detail view.
- **M3 (Financing comparison)**: payment column is the hero — bold, large, leads the customer's eye per 11.7.
- New moonshot move **M11 — One-page priority** is added per 11.8.

### 11.11 Acceptance addition to Section 6 (continued)

14. PDF renders single-unit, no-trade, no-parts, no-misc quote on exactly one page including letterhead, customer, equipment, totals, signature, financing options, comments, and footer.
15. Monthly payment is the largest/boldest typographic element in the financing block on every quote that includes a financing scenario.
16. Empty Misc Charges/Credits, Additional Parts, and Trade Ins sections produce zero rendered output (no header, no divider, no body).
17. Customer-facing PDF contains no comparable market range / ADR-005 internal context text.
18. Rep card renders the canonical layout in 11.3 with the contact rows visible and readable at body scale.

---
