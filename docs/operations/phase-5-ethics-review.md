# Phase 5 Ethics Review

## Purpose

This document is the required preflight process for opening any `7C` slice.
It exists because the roadmap explicitly blocks `7C` until ethics review is
documented and owned.

## Process Owner

- Primary owner: Brian Lewis
- Default operator: Brian Lewis until a different operator is explicitly named
  in the roadmap or handoff materials

## Scope

This review is required before work begins on any `7C` surface, including:

- `7C.1 — Trust Thermostat`
- `7C.2 — Machine Fate Engine`
- `7C.3 — Silence Map`
- `7C.4 — Customer Gravity Field`
- `7C.5 — Rep Mythology Layer`
- `7C.6 — Pre-Regret Simulator`
- `7C.7 — Internal Market for Attention`
- `7C.8 — Ruin Prevention Mode`
- `7C.9 — Shadow Org Chart`
- `7C.10 — Ghost Buyer`
- `7C.11 — Institutional Grief Archive`
- `7C.12 — Body of the Operator`
- `7C.13 — Tempo Conductor`

## Entry Checks

Before a `7C` slice opens, confirm all of the following:

1. `7B` is signed off.
2. Honesty Calibration has run for a full fiscal year.
3. The slice has a written problem statement and a named operating owner.
4. The slice has explicit ethical limits for what it may infer, display, and
   automate.

If any item is false, the slice stays closed.

## Review Questions

For each proposed `7C` slice, answer these questions in writing:

1. What real operator decision becomes better if this slice exists?
2. What private or sensitive attribute could the slice appear to infer?
3. What harm occurs if the slice is wrong but presented confidently?
4. What organizational behavior could the slice distort or incentivize?
5. What information must never be shown directly to reps, managers, or owners?
6. What is the minimum safe audience for the first release?
7. What user-facing explanation, confidence framing, and drill trace are
   required so the output is contestable?
8. What is the immediate kill switch if the slice starts degrading honesty or
   trust?

## Required Output

Each ethics review must produce one short approval note with:

- slice id
- problem statement
- allowed audience
- blocked audience
- explicit no-go inferences
- required confidence / trace behavior
- pilot metric to watch
- kill-switch owner
- decision: `approved`, `pilot_only`, or `blocked`

Store that note beside the build work for the slice before implementation
starts.

## Approval Rules

- `approved`: slice may open for implementation
- `pilot_only`: slice may open only behind role or pilot limits documented in
  the approval note
- `blocked`: no implementation work starts

## Ongoing Guardrail

If a `7C` slice causes negative Honesty Calibration movement or produces a
trust failure in pilot review, pause the slice immediately and reopen ethics
review before shipping more work.
