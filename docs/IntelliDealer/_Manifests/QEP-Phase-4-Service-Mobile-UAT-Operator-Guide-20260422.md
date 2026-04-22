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
9. Repeat one action under weaker connectivity if available.
10. Confirm the technician would use this flow instead of calling dispatch for a routine status update.

## What To Watch For

- buttons too small for field use
- text unreadable outside or in bright light
- confusing stage names
- missing customer or machine context
- duplicate transitions
- state not persisting after reconnect
- need to go back to desktop for basic technician work

## Pass Criteria

Mark the session `PASS` only if:

- queue is usable on mobile
- a work order can be opened reliably
- at least one transition succeeds
- transition persists correctly
- no blocker forces a return to desktop for basic status handling

## Fail Criteria

Mark the session `FAIL` if:

- technician cannot reliably load or use the queue
- primary actions are unclear
- a transition fails or creates inconsistent state
- a core field workflow is missing on mobile

## Related Files

- [QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md](/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/docs/IntelliDealer/_Manifests/QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md:1)
- [QEP-Phase-4-Service-Mobile-Validation-Ship-Report-20260422.md](/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/docs/IntelliDealer/_Manifests/QEP-Phase-4-Service-Mobile-Validation-Ship-Report-20260422.md:1)
