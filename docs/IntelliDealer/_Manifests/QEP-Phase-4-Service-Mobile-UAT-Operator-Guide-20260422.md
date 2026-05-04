# QEP Phase 4 Service Mobile UAT Operator Guide

**Date:** 2026-04-22  
**Gap Register row:** `5`  
**Surface:** `/m/service`

## Goal

Run the last real-world validation of the service mobile experience with an actual technician on mobile hardware.

This is the final acceptance step for row `5`.

## What Has Already Been Completed

Engineering is already done:

- mobile technician workspace exists at `/m/service`
- queue and detail views are built
- technician stage actions are wired
- repo tests and segment gate already passed

What remains is only human validation in the field.

## Who Should Run This

- service technician, lead technician, or service manager acting as technician proxy
- use a real production-style phone, not desktop browser only

## Before Starting

Have these ready:

- technician-capable login
- at least one assigned work order
- one work order where a stage transition is valid
- both good signal and degraded signal conditions if possible
- device model, OS, browser, branch / location, and production account name for the result template
- a source-control-safe way to capture screenshots/video, or a controlled evidence location for customer-sensitive proof

## Technician Script

1. Open QEP on the phone and sign in.
2. Go to `/m/service`.
3. Confirm the queue loads quickly and is readable on a phone screen.
4. Open a work order from the queue.
5. Review:
   - customer
   - machine
   - job summary
   - available next action
6. Execute one valid stage transition.
7. Confirm the action succeeds and the job state updates correctly.
8. Reopen the same job or check the main service surface to confirm the update persisted.
9. Repeat the transition and persistence check under weaker connectivity or a temporary disconnect.
10. During slow or failed saves, confirm the UI gives clear loading/offline/retry feedback, preserves field context, and prevents duplicate stage transitions from repeated taps.
11. Capture source-control-safe proof for the normal and degraded-network portions, or record the controlled evidence location if proof contains customer or job-sensitive data.
12. Confirm the technician would use this flow instead of calling dispatch for a routine status update.

## What To Watch For

- buttons too small for field use
- text unreadable outside or in bright light
- confusing stage names
- missing customer or machine context
- duplicate transitions
- missing loading/offline/retry feedback under degraded signal
- lost field notes or in-progress context after reconnect
- state not persisting after reconnect
- need to go back to desktop for basic technician work

## Pass Criteria

Mark the session `PASS` only if:

- queue is usable on mobile
- a work order can be opened reliably
- at least one transition succeeds
- transition persists correctly
- degraded-network behavior is understandable and does not lose field context
- duplicate taps do not create duplicate stage transitions
- no blocker forces a return to desktop for basic status handling
- result template includes technician, reviewer, device/browser/network, production account, evidence location, and blocker disposition

## Fail Criteria

Mark the session `FAIL` if:

- technician cannot reliably load or use the queue
- primary actions are unclear
- a transition fails or creates inconsistent state
- degraded-network behavior loses context, hides retry state, or allows duplicate transitions
- a core field workflow is missing on mobile
- proof or blocker disposition is missing

## Related Files

- [QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md](QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md)
- [QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md](QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md)
- [QEP-Phase-4-Service-Mobile-Validation-Ship-Report-20260422.md](QEP-Phase-4-Service-Mobile-Validation-Ship-Report-20260422.md)
