# QA-WF2 — Parts Counter Workflow Capture

Roadmap item: E5.6 / QEP-137  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9  
Status: BLOCKED — Bobby parts-counter workflow capture not yet recorded

Owner: Bobby and Brian Lewis.  
Required before: treating parts-counter workflow assumptions, serial-first lookup, quote drafts, lost-sales logging, or customer-facing parts counter behavior as final.

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-WF2 — Parts counter workflow capture | Bobby + Brian | Parts counter workflow document |

## Current evidence state

The handoff schedules QA-WF2 and identifies Bobby as the parts-counter workflow capture owner. Existing docs reference Juan/Bobby/Robert parts-counter personas and provisional serial-first concepts, but no dated Bobby workflow-capture artifact was found in the tracked signoff folder.

## Workflow decision record

Meeting date:
Attendees:
Signed by:
Signed at:

## Required workflow capture

1. Customer arrival / request intake:
   - Question: How does a counter request arrive: walk-in, phone, service, sales, email, or portal?
   - Decision:

2. Serial-first lookup:
   - Question: When is serial number required, where is it found, and what happens when the customer lacks it?
   - Decision:

3. Customer and machine matching:
   - Question: How does Bobby identify the right customer, machine, model, and prior purchase history?
   - Decision:

4. Part identification:
   - Question: What systems, catalogs, notes, or coworker checks are used to identify the right part?
   - Decision:

5. Availability and alternatives:
   - Question: How are stock, substitutes, backorders, vendor-direct options, and ETA communicated?
   - Decision:

6. Quote and draft handling:
   - Question: When does a parts inquiry become a quote, draft, invoice, order, or abandoned request?
   - Decision:

7. Pricing exceptions:
   - Question: What counter-level discount, freight, core, or special-order questions require manager approval?
   - Decision:

8. Lost sale / no-sale capture:
   - Question: What reason should be recorded when the customer does not buy?
   - Decision:

9. Handoff to service or sales:
   - Question: When does the counter hand off to service, sales, Norman, or another role?
   - Decision:

10. Acceptance examples:
   - Question: What are 3 real counter scenarios that would prove the workflow is faster and safer than today?
   - Decision:

## Implementation gate

Until this workflow capture is signed, do not claim final parts-counter behavior for serial-first lookup, parts quote drafts, lost-sales reason capture, or counter handoffs from assumptions. Existing shipped behavior may remain as provisional/source-data behavior.

## Closure evidence required

To mark E5.6 shipped, add a dated artifact that includes:

- interviewee: Bobby;
- date/time and attendees;
- current-state workflow steps;
- priority pain points;
- accepted future-state workflow notes;
- implementation implications for parts-counter UI/API/reporting;
- sign-off verdict from Bobby.

## Current blocker

Bobby has not yet provided the parts-counter workflow document required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` §9. This is a human workflow-capture gate, not a code implementation gate.
