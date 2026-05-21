# QA-S1 — Sandhills Account Scoping

Roadmap item: E5.10 / QEP-141  
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9 and ADR-010 callout  
Status: BLOCKED — Sandhills account owner scoping memo not yet recorded

Owner: Data & Integration, Sandhills account owner at QEP, and Brian Lewis.  
Required before: committing 8x8 call-recording ingestion timing, recording export automation, or ADR-010 closure.

## Required session

| Session | Attendees | Required output |
| --- | --- | --- |
| QA-S1 — Sandhills account scoping | Sandhills account owner at QEP + Brian | Recording export feasibility memo feeding ADR-010 |

## Current evidence state

The handoff schedules QA-S1 and states that 8x8 integration remains Phase 1C scope until a Sandhills one-page scoping memo exists. No dated Sandhills account scoping memo was found in the tracked signoff folder or ADR folder.

## Scoping memo record

Meeting date:
Sandhills account owner:
Attendees:
Signed by:
Signed at:

## Required scoping answers

1. Account ownership:
   - Question: Who owns/administers the Sandhills account at QEP?
   - Decision:

2. Recording footprint:
   - Question: What is the current recording volume by day/week/month?
   - Decision:

3. Retention:
   - Question: How long are recordings retained and what deletion/archival policy applies?
   - Decision:

4. Bulk export:
   - Question: Can recordings be exported in bulk, and in what format?
   - Decision:

5. API availability:
   - Question: Is there an API or integration endpoint for recordings, call metadata, or transcript export?
   - Decision:

6. Access permissions:
   - Question: What credentials, admin roles, audit controls, or vendor approvals are required for export?
   - Decision:

7. Consent language:
   - Question: What two-party consent disclosure language is currently used for recorded calls?
   - Decision:

8. Integration recommendation:
   - Question: Should QEP pursue Sandhills export, 8x8 integration, Twilio-first messaging, or defer recording ingestion?
   - Decision:

## Implementation gate

Until this scoping memo is signed, do not claim final ADR-010 closure, 8x8 recording ingestion, bulk Sandhills export, or recording-derived quote prefill behavior. Keep 8x8/Sandhills integration as Phase 1C scope only.

## Closure evidence required

To mark E5.10 shipped, add a dated one-page memo that includes:

- named Sandhills account owner;
- date/time and attendees;
- recording volume and retention details;
- bulk export and API feasibility;
- consent disclosure language currently used;
- recommended integration path and phase;
- explicit impact on ADR-010 and 8x8 scope.

## Current blocker

The Sandhills account owner has not yet provided the recording export feasibility memo required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` ADR-010 and §9. This is a vendor/account scoping gate, not a code implementation gate.
