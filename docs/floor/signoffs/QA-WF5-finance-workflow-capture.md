# QA-WF5 — Finance Workflow Capture

Roadmap item: E5.9 / QEP-140  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9  
Status: PARTIAL — Ryan/Tina finance source packet recorded; live working-session decisions remain open

Owner: Tina and Brian Lewis.  
Required before: treating finance workflow assumptions, accounts-payable behavior, closed-period rules, approval routing, or finance reporting as final.
Current evidence artifact: `docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md`

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-WF5 — Finance workflow capture | Tina + Brian | Finance workflow document |

## Current evidence state

The handoff schedules QA-WF5 and names Tina as the finance workflow capture owner. As of 2026-07-03, the repo now contains Ryan/Tina finance source material and a reconciliation artifact:

- `docs/operations/rewherewestandqep/QEP_Finance_Questionnaire_Responses.docx`
- `docs/QEP_Finance_Questionnaire_Round3_Addendum.docx`
- `docs/operations/rewherewestandqep/E01420.pdf`
- `docs/operations/rewherewestandqep/R00265.pdf`
- `docs/operations/rewherewestandqep/W07299.pdf`
- `docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md`

This source packet satisfies the prior "no finance capture recorded" statement for system-of-record direction, invoice evidence, AP ownership, close/reopen ownership, approval matrix, AR/dunning defaults, tax/FET/Form 8300 requirements, and migration/cutover framing. It does not close the remaining live working-session decisions listed in the K-stream artifact.

## Workflow decision record

Meeting date: Async packet received 2026-06-30; Round 3 addendum received 2026-07-02; repo reconciliation filed 2026-07-03.
Attendees: Ryan McKenzie (President), Tina McKenzie (VP & Controller); received for Brian Lewis / BlackRock AI finance session.
Signed by: Source packet names Ryan + Tina as respondents. Final live-session signoff still pending for remaining open decisions.
Signed at: Main questionnaire received 2026-06-30; Round 3 addendum received 2026-07-02; repo reconciliation filed 2026-07-03.

## Required workflow capture

1. Daily finance start:
   - Question: What does Tina check first each morning: AP, cash, invoices, aging, approvals, exceptions, or bank activity?
   - Decision:

2. Accounts payable intake:
   - Question: How do vendor bills, invoices, statements, credits, and disputes enter the workflow today?
   - Decision:

3. Approval routing:
   - Question: Who approves what by dollar amount, vendor, department, branch, or exception type?
   - Decision:

4. Closed-period policy:
   - Question: What can and cannot be changed after month close, and who can authorize corrections?
   - Decision:

5. Equipment sale reversals:
   - Question: What finance review is required before a completed equipment sale can be reversed or adjusted?
   - Decision:

6. Payment execution:
   - Question: How are payment runs selected, reviewed, approved, and recorded?
   - Decision:

7. Reconciliation and exceptions:
   - Question: What exceptions require research: duplicate bill, wrong vendor, missing PO, price mismatch, tax/freight issue, or credit memo?
   - Decision:

8. Reporting:
   - Question: What finance reports are needed daily, weekly, and at month close?
   - Decision:

9. Audit trail:
   - Question: What notes, signatures, attachments, and timestamps are required for audit confidence?
   - Decision:

10. Acceptance examples:
   - Question: What are 3 real finance scenarios that would prove the workflow is safe enough to use?
   - Decision:

## Implementation gate

Until the remaining working-session decisions are signed or parked behind explicit config, do not claim final finance behavior for allocation basis, floor-plan terms, CPA adjustment posting, open service-WO migration, master-ID strategy, finance-charge basis, invoice width, material recon-change threshold, or missing export-backed migration loads. Existing shipped behavior may remain as source-backed provisional behavior where the Ryan/Tina packet is explicit.

## Closure evidence required

To mark E5.9 shipped, add a dated artifact that includes:

- interviewee: Tina;
- date/time and attendees;
- current-state workflow steps;
- priority finance controls and pain points;
- accepted future-state workflow notes;
- implementation implications for finance UI/API/reporting;
- sign-off verdict from Tina.

## Current blocker

The finance source packet is now present, so the blocker is narrowed. Remaining blocker: live working-session confirmation and missing export package for the open decisions named in `docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md`. This remains a human finance-control gate for the unresolved items, not a reason to re-open the settled QEP-OS-as-system-of-record decision.
