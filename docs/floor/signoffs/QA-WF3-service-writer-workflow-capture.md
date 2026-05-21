# QA-WF3 — Service Writer Workflow Capture

Roadmap item: E5.7 / QEP-138  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9  
Status: BLOCKED — service-writer workflow capture owner and signoff not yet recorded

Owner: TBD service writer plus Brian Lewis.  
Required before: treating service-writer notifications, parts-received handoffs, work-order status updates, or service workflow automation as final.

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-WF3 — Service writer workflow capture | TBD + Brian | Service workflow document |

## Current evidence state

The handoff schedules QA-WF3 but leaves the service-writer attendee as TBD. Existing docs reference service writer notifications and service/parts handoffs, but no dated service-writer workflow artifact was found in the tracked signoff folder.

## Workflow decision record

Meeting date:
Interviewee:
Attendees:
Signed by:
Signed at:

## Required workflow capture

1. Work-order intake:
   - Question: How does a service request become a work order today?
   - Decision:

2. Customer communication:
   - Question: What updates does the service writer send, when, and through which channel?
   - Decision:

3. Parts dependency handling:
   - Question: How does the service writer know parts are needed, ordered, received, or blocking the job?
   - Decision:

4. Technician coordination:
   - Question: How are technician assignments, estimates, and status changes captured?
   - Decision:

5. Warranty and approval steps:
   - Question: What approvals, warranty checks, photos, or signatures are required before work proceeds?
   - Decision:

6. Exception handling:
   - Question: What happens when a job is delayed, customer unreachable, estimate rejected, or parts unavailable?
   - Decision:

7. Closeout:
   - Question: What must be updated before a job can be closed, invoiced, or handed back to the customer?
   - Decision:

8. Reporting:
   - Question: What does the service writer need to see each morning to know what is blocked or urgent?
   - Decision:

9. Pain points:
   - Question: What manual steps, duplicate entry, or missing context slows service writers down today?
   - Decision:

10. Acceptance examples:
   - Question: What are 3 real service-writer scenarios that would prove the workflow helps?
   - Decision:

## Implementation gate

Until this workflow capture is signed, do not claim final service-writer behavior for notifications, work-order status, parts-received handoffs, or service reporting from assumptions. Existing shipped behavior may remain as provisional/source-data behavior.

## Closure evidence required

To mark E5.7 shipped, add a dated artifact that includes:

- named service-writer interviewee;
- date/time and attendees;
- current-state workflow steps;
- priority pain points;
- accepted future-state workflow notes;
- implementation implications for service UI/API/reporting;
- sign-off verdict from the interviewee.

## Current blocker

The service-writer interviewee is still TBD and no service workflow document has been signed as required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` §9. This is a human workflow-capture gate, not a code implementation gate.
