# QRM Quote Tool — Moonshot Handoff Prompt

**Source:** Brian Lewis, 2026-05-07
**Client:** QEP USA (`qep-usa`)
**Module:** QRM > Quote Tool (Phase 1B Sales)
**Pipeline Target:** Paperclip CEO → Architect → Engineer → QA → DevOps → Security → Data & Integration
**Supersedes:** Quote PDF spec in `QRM_QUOTE_WIZARD_SPEC_2026-05-05.md` Section 10 with the moonshot vision and exit bar below

---

## PASTE-INTO-PAPERCLIP HANDOFF PROMPT

```
You are taking the QRM Quote Tool from the rough draft we shipped last week to a
moonshot, world-class equipment dealer quote — the best customer-facing proposal
in heavy equipment, period. The bar is "QEP customers stop comparing it to
IntelliDealer because it makes IntelliDealer look like a 1990s receipt printer."

Read these three files in the qep-usa client knowledge base before doing anything
else:

1. CLAUDE_CODE_HANDOFF_2026-04-23.md          (master pipeline doc, brand rules, ADRs)
2. QRM_QUOTE_WIZARD_SPEC_2026-05-05.md         (wizard spec + Section 10 parity)
3. The two reference PDFs:
   - QEP-2026-0001-proposal.pdf  (current QRM output — what we have)
   - Q02699.PDF                  (IntelliDealer output — the data structure we MUST match)

THE TRANSFORMATION

FROM: A two-page QRM proposal that says "Prepared for PRIMARY CONTACT", renders
raw AI text with literal quotes around extracted entities ('10 acres'), shows
$0/mo cash payment next to a $54,000 financed amount, has no serial number, no
signature line, no TILA disclaimer, no tax line, no trade-in, no parts, no
financing comparison, no rep contact, and no QEP letterhead.

TO: A world-class equipment proposal that:

  1. Carries 100% of the data structure from IntelliDealer Q02699 — every field,
     every section, every disclaimer, every legal phrase, verbatim where listed
     in QRM_QUOTE_WIZARD_SPEC_2026-05-05.md Section 10.
  2. Renders that data structure in a presentation that QEP customers, sales
     reps, and Ryan all walk away from saying "this is the nicest quote I've
     ever seen from any dealer."
  3. Gates every payment-math surface behind ADR-006 TILA compliance.
  4. Honors the qep_brand_guide.pdf — orange/charcoal/white, Bebas Neue or
     Barlow Condensed Bold headlines, Montserrat ExtraBold subheads, Inter body,
     Montserrat Bold for numbers, gear motifs, orange left-rules, "IT'S IN THE
     NAME" tagline, OEM line-card badges (DEVELON, Bandit, YANMAR, ASV).
  5. Removes every trace of unedited AI text. "Why This Machine" pre-suggests a
     draft from the customer's discovery notes, but every word that ships
     externally has been edited by the rep or run through a brand-voice pass.
     No literal quotes around AI-extracted entities, ever.

NON-NEGOTIABLES (will fail QA review if any are violated)

  - The 30-item parity checklist in QRM_QUOTE_WIZARD_SPEC_2026-05-05.md Section
    10.15 is the floor, not the ceiling. Every item must be present.
  - Authorization signature line on the same row as Quote Total — customer
    signs the PDF, period.
  - State tax line shows rate inline ("Florida State 6.00%:"). County tax line
    is named after the actual delivery county. $5,000 surtax cap math
    replicates IntelliDealer Q02699 exactly (Columbia County 1.5% × $5,000 =
    $75.00).
  - Verbatim disclaimer text in Sections 10.12 and 10.14 of the spec — copy
    character for character, including double asterisks and double spaces.
  - TILA disclaimer block from ADR-006 paired with — not replacing — the
    legacy "FINANCING BASED ON CREDIT APPROVAL..." text.
  - Multi-unit support. A single quote must render machine + attachment +
    secondary equipment as separate stock lines, each with stock #, serial #,
    spec list, warranty callout, and amount. Q02699 has TWO units (RT-135F +
    HM-70SR) on a single quote — that is the floor.
  - Dedicated Trade Ins, Additional Parts, and Miscellaneous Charges/Credits
    sections, each with the divider headers and column structure shown in
    Q02699.
  - Branch number + name on every page (01 - LAKE CITY, 02 - OCALA).
  - Page X of Y numbering on every page.
  - Account code on customer (RYLEE001 pattern). Salesperson code on user
    (RM3 pattern). These map to existing IntelliDealer customer/rep IDs and
    are mandatory for the IntelliDealer data miner reconciliation (ADR-009).
  - Never ship "PRIMARY CONTACT" or any placeholder token externally. PDF
    generation blocks if any required customer field is null.
  - Never use the name "Riley." It is "Rylee." Enforce in every agent output.

MOONSHOT MOVES (above and beyond parity — these are what take it from
"caught up" to "world-class")

  M1. Equipment hero with full machine photo gallery (3-5 images per unit) on
      the cover page. Pulled from the equipment record's photo set.
  M2. Live spec sheet rendering — model specs from a structured source
      (manufacturer spec sheet ingestion), not free-text bullets. Filterable,
      searchable, and consistent across every quote for the same model.
  M3. Side-by-side financing scenario comparison table — cash vs finance vs
      lease — with toggle to show/hide on the customer copy. APR source
      attribution per ADR-006 ("Bandit Q2 0% for 36 mo, eff. 04/01/2026").
  M4. Trade-in market context — when a trade is on the quote, render the
      ADR-005 comparable market range below the trade allowance line, with
      the "COMPARABLE MARKET RANGE — NOT A GUARANTEED OFFER" header. Builds
      customer trust in the trade number.
  M5. Branded acceptance flow — the PDF link the customer receives is a
      signed R2 URL that opens to a branded QEP page where they can review,
      e-sign the authorization line via DocuSign-style flow, and pay deposit
      via Stripe (deposit SOP pending). Sign event triggers activity timeline
      entry, opportunity stage update, and rep notification.
  M6. Rep-facing "deal IQ" sidebar (rep portal only, never on customer PDF) —
      margin %, margin $, commission projection, win-probability score,
      flagged risks (margin below floor, trade above max, discount above cap).
      This is what Rylee will check before sending.
  M7. Mobile-first PDF and acceptance page. Reps quote from the field.
      Customers open the PDF on their phone in a tractor cab. Both must look
      world-class on a 5.5" screen.
  M8. Versioning — every send creates an immutable PDF in R2. Edits create a
      new version. Customer always opens the latest, but the rep can see the
      version history with diff (what changed line by line). Wins arguments
      about "you said the price was X."
  M9. Email and SMS templates that match brand voice — no AI-sounding copy.
      Run every template through the email-voice skill before shipping.
  M10. QR code on the PDF links to a branded landing page (not just qepusa.com)
       that shows the quote status, accept button, contact rep button, and a
       3-question NPS-style "anything missing?" feedback box that pings the
       rep on submit.

DATA STRUCTURE — BUILD THE SCHEMA TO MATCH Q02699 EXACTLY

The IntelliDealer field set in Q02699 is the canonical structure. Architect
delivers the field-parity matrix as the first deliverable on this work.
Schema additions are already specified in QRM_QUOTE_WIZARD_SPEC_2026-05-05.md
Section 10.16 — implement those migrations as Sprint 1B Sub-Sprint 1.

Map every IntelliDealer field to a QRM column. Where IntelliDealer is
flat/denormalized, normalize. Where IntelliDealer is missing structure,
add it. But never lose a field.

Reconciliation against the IntelliDealer data miner (ADR-009) requires
account_code on customers and salesperson_code on users. Architect confirms
the matching rules in the field-parity matrix.

BUILD ORDER

  Phase A — Architect deliverables (blocks Engineer)
    A1. Field-parity matrix (IntelliDealer → QRM) covering every Q02699 field
    A2. ADR-014: Quote PDF Layout & Brand System
    A3. ADR-015: Multi-Unit Quote Data Model
    A4. ADR-016: Acceptance Flow & E-Signature
    A5. Updated supabase/migrations/<timestamp>_quote_pdf_parity_schema.sql
        + rollback per blueprint-template

  Phase B — Engineer deliverables (parallel where possible)
    B1. PDF template rebuild per Section 10.15 parity checklist + Moonshot M1, M2
    B2. Multi-unit rendering on Step 3 wizard + PDF
    B3. Financing comparison table per M3
    B4. Trade-in market context block per M4
    B5. Acceptance flow page (signed R2 URL → branded landing → e-sign + deposit) per M5
    B6. Deal IQ sidebar (rep portal only) per M6
    B7. Mobile-first responsive on PDF + acceptance page per M7
    B8. PDF versioning + diff view per M8
    B9. Email and SMS templates run through email-voice skill per M9
    B10. Branded QR landing page per M10

  Phase C — QA deliverables
    C1. Side-by-side review: QRM PDF vs IntelliDealer Q02699 — every field
        present (acceptance criteria 12 in Section 6 + criterion 13)
    C2. Tax math test matrix per Section 6 #2 and #3
    C3. TILA + verbatim disclaimer presence test
    C4. Multi-unit render test with 1, 2, and 3 units
    C5. Mobile rendering on iOS Safari, Android Chrome, iPad
    C6. PDF accessibility (machine-readable text, no image-only PDF)

  Phase D — DevOps
    D1. R2 bucket policy for signed URLs + versioned PDFs
    D2. DocuSign / e-sign provider selection + integration
    D3. Stripe deposit collection (deposit SOP pending — coordinate with Rylee)
    D4. M365 Graph send-as for Email Quote button (BLK-6)
    D5. Twilio A2P 10DLC for Text Quote button (BLK-7)

  Phase E — Security
    E1. RLS audit on quote_lines new columns (stock_number, serial_number,
        spec_bullets — sales rep can read own, manager all, finance_admin
        margin column)
    E2. Signed URL TTL policy (30-day default, rotate on edit)
    E3. E-sign payload integrity check
    E4. PII handling on customer.account_code

  Phase F — Data & Integration
    F1. IntelliDealer data miner reconciliation by account_code +
        salesperson_code per ADR-009
    F2. Manufacturer spec sheet ingestion pipeline for M2
    F3. Live finance program sync (Bandit, Develon, Yanmar, ASV) for M3 APR
        attribution
    F4. Comp data feed wiring for M4 (Sandhills/Iron Solutions — pending
        QA-S1 scoping)

EXIT BAR — DO NOT MARK COMPLETE UNTIL

  ✓ All 30 parity items in Section 10.15 verified line-by-line on a real test
    quote with multi-unit + trade + parts + misc + financing
  ✓ Section 6 acceptance criteria 1–13 all pass
  ✓ Side-by-side review with Ryan + Rylee — they sign off in writing that the
    QRM quote covers everything Q02699 covers and more
  ✓ Brand voice pass on every user-facing string (email-voice skill)
  ✓ TILA sign-off from Angela (BLK-8) before any payment-math surface goes
    live to customers
  ✓ Mobile rendering review on real devices (iOS + Android phone, iPad)
  ✓ Three real customers receive a quote and respond with positive feedback
    on the look/feel — captured in writing for the project file

VOICE AND CULTURE GUARDRAILS (apply throughout)

  - No AI-sounding copy ships externally. Rylee will reject it. Run every
    LLM-generated user-facing string through the email-voice skill or a
    human edit pass.
  - Never "Riley." Always "Rylee."
  - Don't show other-client demos on QEP calls.
  - Transcripts mislabel speakers — Ryan is often present even when not
    labeled. Don't infer absence from speaker IDs.
  - Use phases / modules / sub-sprints in any planning output. Do not put
    weeks or duration estimates in deliverables — Brian doesn't use them.

ROUTING

  - ADRs (ADR-014, ADR-015, ADR-016) → Architect, Brian sign-off
  - Phase A field-parity matrix → Architect → Brian review
  - Phase B PDF + features → Engineer after Architect ships A1–A5
  - Phase C QA → QA agent after Engineer ships each Phase B deliverable
  - Phase D infra → DevOps in parallel with Engineer
  - Phase E security review → Security after Engineer feature-complete
  - Phase F data feeds → Data & Integration in parallel
  - Coordinate cross-agent handoffs through Paperclip CEO

FIRST DELIVERABLE BACK TO BRIAN (do not start B work until this is approved)

Reply to Brian with a one-page plan that includes:

  1. Confirmation you have read all three reference files + both PDFs
  2. The field-parity matrix as a table (IntelliDealer Q02699 column →
     QRM table.column → notes)
  3. The ADR-014/015/016 outlines (one paragraph each)
  4. The migration filename and rollback approach
  5. Any clarifying questions on M1-M10 moonshot moves before Engineer starts
  6. Phase A target completion in Paperclip phases (no calendar weeks)
  7. The three blocking dependencies you most need from Brian/Rylee right now

After Brian approves the one-page plan, file Paperclip issues for every
phase deliverable, tag by source (parity / moonshot / adr / gate / migration),
route per the Routing section above, and kick off Phase A.
```

---

## NOTES FOR BRIAN BEFORE PASTING

1. The prompt above is self-contained — Paperclip CEO can act on it alone.
2. The three reference files it cites are already in the qep-usa client folder. The two PDFs (`QEP-2026-0001-proposal.pdf` and `Q02699.PDF`) are in your uploads folder — copy them into the qep-usa client knowledge base before pasting if Paperclip CEO needs filesystem access to them.
3. The exit bar is intentionally hard. If Architect or Engineer pushes back on the moonshot moves (M1–M10), let them — but only relax the moonshot bar, never the parity bar.
4. The first deliverable back is a one-page plan from Paperclip CEO. Do not let it kick off Engineer work without your written approval on that plan.
5. BLK-1 through BLK-8 from `QRM_QUOTE_WIZARD_SPEC_2026-05-05.md` Section 4 still apply. Track them in the same Brian Bundle outbound to Rylee.

---
