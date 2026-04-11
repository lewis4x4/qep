# 7C.1 Ethics Review — Trust Thermostat

- Slice id: `7C.1`
- Slice name: `Trust Thermostat`
- Decision: `blocked`
- Process owner: `Brian Lewis`
- Kill-switch owner: `Brian Lewis`

## Problem Statement

Trust Thermostat is proposed as a post-hoc receipt for trust, not a real-time
score. Its intended value is to help leadership understand whether the system
and dealership behavior increased or damaged customer trust after an outcome
already happened.

## Entry Check Status

1. `7B` signed off: yes
2. Honesty Calibration run for a full fiscal year: not evidenced in current repo
3. Written problem statement and named operating owner: yes
4. Explicit ethical limits documented: yes, in this note

Because item 2 is not yet satisfied, this slice stays blocked.

## Allowed Audience

- owner
- manager

## Blocked Audience

- rep
- admin without explicit owner review
- customer / portal viewers

## No-Go Inferences

The slice must not:

- infer a customer's private emotional state beyond evidence already captured in
  explicit interaction records
- produce a real-time trust score for live frontline use
- infer protected traits or personal vulnerability
- recommend punitive action against a rep or operator from a single trust event
- present a synthetic certainty that the system cannot trace back to specific
  post-hoc evidence

## Required Confidence / Trace Behavior

- Any future Trust Thermostat output must be post-hoc only.
- Every score or conclusion must include visible confidence and a working trace.
- The trace must point to concrete evidence such as:
  - follow-up completion or omission
  - service recovery records
  - portal review response timing
  - won-back / churn-risk / lost lifecycle events
- If evidence is sparse or mixed, the surface must default to uncertainty, not
  synthetic precision.

## Ethical Limits

- No rep-visible rollout in v1.
- No automated workflow action may fire directly from Trust Thermostat.
- Any pilot must be owner/manager-only and advisory-only.
- Any derived trust reading must be reversible and contestable.

## Pilot Metric To Watch

- Honesty Calibration trend after Trust Thermostat exposure
- False-confidence rate in pilot review
- Cases where leadership action changed because of the slice but later evidence
  contradicted the output

## Review Questions Answered

1. Better operator decision: leadership can review whether post-sale behavior
   repaired or damaged trust after the fact.
2. Sensitive inference risk: it can appear to infer “how much a customer trusts
   us” beyond what the evidence really supports.
3. Wrong-but-confident harm: leadership could overreact to noisy evidence,
   misjudge account health, or unfairly blame teams.
4. Distortion risk: teams may optimize for trust optics instead of honest
   operating behavior.
5. Must never show: speculative personal judgments or real-time rep-facing trust
   grades.
6. Minimum safe audience: owner + manager only.
7. Contestability requirement: visible confidence and evidence trace on every
   conclusion.
8. Kill switch: owner can pause the slice immediately if honesty or trust
   metrics degrade.

## Outcome

`7C.1 — Trust Thermostat` is reviewed but remains blocked.

It may not open for implementation until the repo or operating record shows
that Honesty Calibration has run for a full fiscal year and the owner chooses
to convert this note from `blocked` to `pilot_only` or `approved`.
