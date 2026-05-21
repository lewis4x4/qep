# QA-WF5 — Finance Workflow Capture

Roadmap item: E5.9 / QEP-140  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9  
Status: BLOCKED — Tina finance workflow capture not yet recorded

Owner: Tina and Brian Lewis.  
Required before: treating finance workflow assumptions, accounts-payable behavior, closed-period rules, approval routing, or finance reporting as final.

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-WF5 — Finance workflow capture | Tina + Brian | Finance workflow document |

## Current evidence state

The handoff schedules QA-WF5 and names Tina as the finance workflow capture owner. Existing docs reference AP, finance policy signatures, and closed-period/finance gates, but no dated Tina finance workflow artifact was found in the tracked signoff folder.

## Workflow decision record

Meeting date:
Attendees:
Signed by:
Signed at:

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

Until this workflow capture is signed, do not claim final finance behavior for AP workflows, approval routing, closed-period changes, sale reversals, payment execution, or finance reporting from assumptions. Existing shipped behavior may remain as provisional/source-data behavior.

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

Tina has not yet provided the finance workflow document required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` §9. This is a human workflow-capture and finance-control gate, not a code implementation gate.
