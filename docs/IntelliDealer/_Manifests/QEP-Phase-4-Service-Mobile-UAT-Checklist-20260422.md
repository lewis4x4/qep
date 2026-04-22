# QEP Phase 4 Service Mobile UAT Checklist

**Date:** 2026-04-22  
**Gap Register row:** `5`  
**Surface:** `/m/service`

## Purpose

This checklist is the last manual acceptance packet for the service mobile slice.

Repo-side implementation is already built and merged. This checklist exists so an actual technician can validate the production/mobile workflow and close the row with evidence instead of anecdotal approval.

## Required Test Device Context

- active production user with technician-capable permissions
- mobile phone in real field conditions
- stable network test
- degraded / intermittent network test
- at least one active assigned job
- at least one job requiring a stage transition

## Technician Run Sheet

1. Sign in on mobile and open `/m/service`.
2. Confirm the assigned queue loads without desktop overflow or unusable controls.
3. Open an assigned work order from the queue.
4. Review machine, customer, and job summary from the mobile detail view.
5. Execute at least one valid stage transition.
6. Confirm the transition persists and appears back in the main service surface.
7. Confirm empty-state and no-assigned-job messaging is understandable.
8. Repeat the workflow under poor connectivity or after a temporary disconnect.
9. Confirm no action creates duplicate transitions or broken state after reconnect.

## Acceptance Questions

- Could a real technician use this surface without returning to desktop?
- Is the queue legible in bright field conditions?
- Are the available actions obvious for the current stage?
- Did any transition feel risky, ambiguous, or too easy to mis-tap?
- Did any important field, note, or instruction appear missing on mobile?
- Would the technician choose this surface over calling dispatch for routine updates?

## Pass / Fail Record

- Technician name:
- Device:
- Date:
- Result: `PASS` / `FAIL`
- Blocking issues:
- Non-blocking issues:
- Recommended follow-up:

## Closure Rule

Row `5` can be retired only after:

- one named technician executes the checklist on deployed mobile hardware
- the result is recorded
- any blocking issue is either fixed or explicitly waived
