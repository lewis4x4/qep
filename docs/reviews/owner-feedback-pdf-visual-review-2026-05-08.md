# Owner-Feedback Quote PDF — Visual Review (2026-05-08)

**Source files reviewed:**
- `tmp/quote-parity/owner-feedback-images/owner-feedback-1.png`
- `tmp/quote-parity/owner-feedback-images/owner-feedback-2.png`

**Rylee's requirements (target state):**
1. Simpler look
2. Ideally 2 pages
3. QEP logo top-left, vendor logos underneath
4. QR code
5. Machine photo in **every** quoted machine segment
6. Preserve legal / tax / signature / TILA compliance

---

## Status vs. Requirements

| Requirement | Status | Notes |
|---|---|---|
| Simpler look | ❌ Not yet | Dense; competing accent colors; duplicate header on p2; long copy blocks |
| 2 pages | ✅ | Currently 2 pages |
| QEP logo top-left | ✅ | "Quality" wordmark is correctly placed |
| Vendor logos underneath logo | ⚠️ Partial | Strip is correct but shows all vendors, not just ones quoted |
| QR code | ✅ | Present bottom-right both pages |
| Photo per machine segment | ⚠️ Inconsistent | One large hero photo + two tiny thumbnails; not equal treatment |
| Legal / TILA / signature | ⚠️ Present but cramped | Signature line is too small/buried; TILA disclosures crammed into right rail |

---

## Actionable Improvement Checklist (Priority Order)

### P0 — Fix before regenerating

1. **Collapse duplicate customer block on p1.** Both columns under the header show the same "Rylee McKenzie / 5520 SE …" address. If Bill-To = Ship-To, render one block plus a "Ship-to: same as billing" line. Recovers ~15% of the upper page.

2. **One photo per quoted machine, equal size.** Today: a large hero image (RT-135F) and two thumbnail cards (RT-135F repeat + HM-78SR) — visually unbalanced. Replace with N uniform machine cards, one per line item, each containing: photo (left, fixed aspect), 3–5 spec bullets (right), and that line's price. Drop the standalone hero image + black "QUOTE TOTAL" panel.

3. **Move grand total out of the photo strip.** The black "QUOTE TOTAL $144,110.65" rectangle riding on the hero photo reads as ad copy, not a financial doc. Put the grand total in a single right-aligned summary band above the signature block on page 2 (where the subtotal already lives).

4. **Filter the vendor-logo strip to vendors actually on this quote.** Currently shows ASV, EFI, CFI, Develon, J.Mass, Frasier regardless of contents. For this quote (ASV + ShearFX) only those two should appear. Reduces clutter and reinforces relevance.

5. **Compress the page-2 repeated header.** Page 2 reprints the full p1 letterhead (logo + vendors + full quote-info block + gold banner). Replace with a slim continuation header: logo left, "Quote #1-LAKE-3777 · Page 2 of 2" right. Frees vertical space for the legal/finance content that's currently cramped.

### P1 — Simplification

6. **Tighten the right-rail quote-info box.** Today it stacks ~10 fields (Date, Expires, Account #, Contact, Customer #, Sales Rep, Reference, Quote #, etc.). Buyer cares about: Quote #, Date, Expires, Sales Rep. Demote the rest to small print or remove.

7. **Shorten the "Why this machine" narrative.** Currently a single dense paragraph spanning the card width. Convert to a 3-bullet "Why this fits" list under the machine card. Keep total ≤ ~40 words per machine.

8. **Hide empty sections on p2.** "Additional Parts" renders an empty header + table when no parts are quoted, eating ~1 inch of whitespace. Conditionally suppress empty Trade-Ins / Additional Parts / Misc Charges sections.

9. **Single accent color.** Right now: gold banner + dark slate quote-info box + black total panel + yellow QR area. Pick one accent (recommend QEP gold) and use neutral grays for the rest.

10. **Larger, clearer QR code with a one-line CTA.** Today it's small with "Scan for proposal feedback" beneath. Scale up ~1.5× and place beside (not below) the signature block so the customer sees it at the action moment.

### P2 — Compliance / signature surface

11. **Promote the signature block.** TILA-style proposals need a clearly demarcated buyer-signature area: printed name, signature, date, plus an "I have read and agree to the Terms & Conditions on page 2" acknowledgment line. Today this reads as a thin footer line — make it a bordered block, full width, above the footer.

12. **Move TILA disclosures out of the side rail into a labeled "Truth-In-Lending Disclosure" block** spanning the page width below Finance Options. Side-rail placement makes it look like marketing copy and weakens the disclosure posture. Keep all current required language verbatim — just relocate.

13. **Label the finance-options table explicitly.** Add a header row caption: "Estimated Financing — Not a Commitment to Lend" so the four columns (24 / 36 / 48 / 60 mo) read as estimates, matching the side-rail "Promised Payments and Estimates" disclaimer.

### P3 — Polish

14. **Drop the "EQUIPMENT ESTIMATE — NOT AN INVOICE" gold banner from p2.** It's already declared on p1; repeating it reinforces visual heaviness without adding info. A small "Estimate — Not an Invoice" watermark or footer stamp is sufficient on continuation pages.

15. **Align numeric columns right.** Spot-check on p2 — Misc Charges and Finance Options should have right-aligned currency for scan-ability.

16. **Consistent typography scale.** Page 1 mixes at least 4 font sizes in the cards; consolidate to: H2 (machine name), Body (specs), Caption (footnotes). Helps the "simpler" feel more than any single layout change.

---

## Suggested 2-page layout (target)

**Page 1 — Buyer-facing summary**
- Letterhead: QEP logo (TL) + filtered vendor logos · Quote-info mini-block (TR, ≤4 fields)
- Single customer block (Bill-to + ship-to note)
- "Equipment Estimate — Not an Invoice" gold band (one-time)
- N uniform machine cards, each with photo + 3 bullets + line price
- Grand total summary band

**Page 2 — Money + legal**
- Slim continuation header (logo · quote # · page 2 of 2)
- Trade-ins / Additional Parts / Misc (only if non-empty)
- Finance Options table with explicit "Estimate" caption
- Full-width Truth-In-Lending Disclosure block
- Bordered Buyer Signature block (name / sig / date / acknowledgment)
- Footer: address line · QR code with CTA

---

## Out-of-scope notes

- Did not inspect generator code; this is a pure visual checklist.
- Photo asset quality looks acceptable — no resolution issues.
- QR code target URL not validated.
