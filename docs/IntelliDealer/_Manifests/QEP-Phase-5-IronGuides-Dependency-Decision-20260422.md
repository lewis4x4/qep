# QEP Phase 5 IronGuides Dependency Decision

**Date:** 2026-04-22  
**Gap Register row:** `20`

## Current State

- `ironguides` integration row exists in `integration_status`
- current remote status is `demo_mode`
- market valuation logic already supports zero-blocking fallback behavior through mock / blended valuation sources

## What Is Actually Blocked

Not the entire valuation surface.

What remains blocked is the decision to move from demo-mode / fallback valuation support to a live contracted IronGuides feed.

## Decision Questions

1. Is a live IronGuides contract still desired?
2. If yes, is the goal:
   - fair market value only
   - comparables plus FMV
   - full pricing-intelligence feed
3. If no, should QEP formally standardize on mock/blended valuation and retire the live-feed dependency?

## Practical Outcomes

- If `YES`, the blocker is vendor contract + credential onboarding.
- If `NO`, this row can be closed the same way HubSpot/IntelliDealer were closed:
  - product decommission decision
  - runtime marked non-required
  - parity artifact updated

## Recommendation

Make an explicit business decision rather than leaving the row in passive dependency limbo.
