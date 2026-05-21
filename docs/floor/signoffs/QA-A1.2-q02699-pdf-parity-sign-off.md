# QA-A1.2 Q02699 PDF Parity Sign-Off

Roadmap item: A1.2 / QEP-2
Source evidence: `QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md` §10.15 + §11, `docs/operations/IRON_QUOTE_BUILD_VERIFICATION_HANDOFF_2026-05-16.md` §3.4, and gate `test-results/agent-gates/20260521T041144Z-A1.2-q02699-pdf-parity-anchors.json`
Status: unsigned. Engineering parity anchors are shipped; final unblock requires side-by-side human review against IntelliDealer quote Q02699.

Owner: Architect + Ryan.
Required before: unblocking roadmap items that depend on A1.2 PDF/customer artifact acceptance.

## Decision Record

Staging URL:
QEP quote number / package id reviewed:
IntelliDealer reference artifact: Q02699
Reviewer names:
Review date:
Signed by:
Signed at:

## Preconditions

- Regression gate artifact exists and passed: `test-results/agent-gates/20260521T041144Z-A1.2-q02699-pdf-parity-anchors.json`.
- The generated QEP artifact uses a realistic quote containing equipment, multi-unit detail where applicable, trade-in, parts/misc lines, taxes, financing/payment math, and signature/authorization surfaces.
- Q02699 is opened side-by-side with the generated QEP customer PDF/proposal.

## Required Parity Review

Mark each item `present`, `intentionally suppressed when empty`, or `defect filed`.

| # | Q02699 / spec parity area | Expected result in QEP artifact | Evidence link / notes | Result |
|---|---|---|---|---|
| 1 | Branch identity | Branch code/name are visible or captured in immutable artifact metadata | | |
| 2 | Quote number / estimate identity | Quote number is visible and customer-safe | | |
| 3 | "EQUIPMENT ESTIMATE - NOT AN INVOICE" | Exact customer-facing estimate/not-invoice concept appears | | |
| 4 | Customer/account identity | Customer name/account context is present without unsafe placeholders | | |
| 5 | Salesperson / QEP contact | Rep/contact details are present where available | | |
| 6 | Quote dates / expiration | Quote date and expiration/valid-through language are present | | |
| 7 | Equipment make/model | Equipment lines carry make/model detail | | |
| 8 | Stock / serial / unit identifiers | Identifiers are present when available; no fake placeholders appear | | |
| 9 | Quantity and pricing | Quantities and prices match source quote math | | |
| 10 | Attachments/options/accessories | Present when populated; suppressed when empty | | |
| 11 | Parts and misc charges | Present when populated; suppressed when empty | | |
| 12 | Trade allowance | Trade value is visible and math is correct | | |
| 13 | Discounts / rebates | Discounts/rebates are visible when applicable | | |
| 14 | Florida state tax | State tax line/rate behavior matches accepted quote math | | |
| 15 | County surtax | Surtax cap behavior matches accepted quote math | | |
| 16 | Tax-exempt case | Tax-exempt badge/copy appears when applicable | | |
| 17 | Financing/payment math | TILA/disclaimer copy appears with payment math | | |
| 18 | Totals | Subtotal, tax, trade/discount, and final total reconcile | | |
| 19 | Delivery terms | Delivery language is customer-safe and contains no unresolved `{{placeholder}}` tokens | | |
| 20 | Legal/customer-safe copy | No internal AI, approval, margin, or unsafe operational language leaks to customer | | |
| 21 | Authorization signature/date lines | Signature/date lines are visible | | |
| 22 | Thank-you / closing language | Customer-facing closing language is present | | |
| 23 | Empty-section suppression | Empty sections are suppressed rather than shown as bare headers | | |
| 24 | Multi-page readability | Artifact remains readable across page breaks | | |
| 25 | Mobile/opened PDF readability | Artifact can be opened and reviewed on a mobile device | | |
| 26 | Desktop PDF readability | Artifact can be opened and reviewed on desktop | | |
| 27 | Brand acceptability | Artifact is acceptable as QEP-branded customer output | | |
| 28 | Immutable snapshot acceptability | Artifact content appears stable enough for customer acceptance/audit | | |
| 29 | Side-by-side deltas | Any intentional differences from Q02699 are listed below | | |
| 30 | Final reviewer acceptance | Architect + Ryan accept the artifact for launch gate purposes | | |

## Intentional Differences From IntelliDealer Q02699

List approved differences here. If there are no approved differences, write `none`.

1.
2.
3.

## Defects / Follow-Up Issues

1.
2.
3.

## Sign-Off Decision

Decision: `pass` / `pass with exceptions` / `fail`

## Completion Rule

A1.2 can move from `blocked` to `shipped` only when this file is completed with reviewer names, dated side-by-side evidence, and a `pass` or explicitly accepted `pass with exceptions` decision. If the decision is `fail`, leave A1.2 blocked and link the remediation issue(s).
