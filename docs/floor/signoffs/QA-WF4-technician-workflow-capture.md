# QA-WF4 — Technician Workflow Capture

Roadmap item: E5.8 / QEP-139  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9  
Status: BLOCKED — technician workflow capture owner and signoff not yet recorded

Owner: TBD technician plus Brian Lewis.  
Required before: treating field-service mobile, technician labor tracking, job-code learning, photo/voice capture, or offline-first technician behavior as final.

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-WF4 — Technician workflow capture | TBD + Brian | Technician workflow document |

## Current evidence state

The handoff schedules QA-WF4 but leaves the technician attendee as TBD. Project context says Phase 4 includes field-service mobile, labor tracking, photo/voice capture, and offline-first technician workflows, but no dated technician workflow artifact was found in the tracked signoff folder.

## Workflow decision record

Meeting date:
Interviewee:
Attendees:
Signed by:
Signed at:

## Required workflow capture

1. Job assignment intake:
   - Question: How does a technician receive a job, priority, location, and expected work today?
   - Decision:

2. Pre-job context:
   - Question: What machine/customer/history/parts information does the technician need before starting?
   - Decision:

3. Arrival and diagnosis:
   - Question: What does the technician record on arrival and during diagnosis?
   - Decision:

4. Labor and time tracking:
   - Question: How is labor time started, paused, categorized, corrected, and submitted?
   - Decision:

5. Parts request flow:
   - Question: How does the technician request parts, confirm parts used, or flag missing/incorrect parts?
   - Decision:

6. Photo, voice, and notes capture:
   - Question: What evidence must be captured, when, and what can be dictated versus typed?
   - Decision:

7. Offline and field constraints:
   - Question: What happens when connectivity, device battery, weather, or customer-site access is poor?
   - Decision:

8. Customer communication:
   - Question: What information can the technician share directly with the customer versus routing through service?
   - Decision:

9. Closeout and quality check:
   - Question: What must be completed before the job is marked done or returned to service/warranty/admin?
   - Decision:

10. Acceptance examples:
   - Question: What are 3 real technician scenarios that would prove the workflow works in the field?
   - Decision:

## Implementation gate

Until this workflow capture is signed, do not claim final technician behavior for mobile, offline, voice/photo capture, labor tracking, parts requests, or dynamic job-code learning from assumptions. Existing shipped behavior may remain as provisional/source-data behavior.

## Closure evidence required

To mark E5.8 shipped, add a dated artifact that includes:

- named technician interviewee;
- date/time and attendees;
- current-state workflow steps;
- priority field constraints and pain points;
- accepted future-state workflow notes;
- implementation implications for mobile UI/API/offline behavior;
- sign-off verdict from the interviewee.

## Current blocker

The technician interviewee is still TBD and no technician workflow document has been signed as required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` §9. This is a human workflow-capture gate, not a code implementation gate.
