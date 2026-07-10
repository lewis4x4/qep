# ADR-017 — Q14: Availability-escalation provider (8x8 vs Twilio)

**Status:** Proposed (decision brief for Q14 / roadmap A4.5)
**Date:** 2026-07-10
**Decider:** Brian

## Context

`rental.availability.low` events are live and, post-m822, mathematically trustworthy (per-day minimum headroom over a 14-day window, service-down units excluded, holds deduplicated, `critical_date` in the payload). Today the consuming workflow creates tasks and exceptions. Q14 decides which provider carries the **next escalation tier**: machine-initiated SMS/voice to the on-call rental manager when headroom hits zero on a near critical date and the task sits unacknowledged.

Scope note: this tier is **internal** (reps/managers), so TCPA exposure is minimal. Any future *customer-facing* notification must route through `service-customer-notify-dispatch` (consent-checked) regardless of provider — that doctrine (L8.c) is unchanged by this decision.

## Options

### Twilio
- Programmable SMS + voice with the most mature API/SDK ecosystem; trivial to call from an edge function with a vault-held token.
- Pay-per-use (~$0.008/SMS segment, ~$0.014/min voice); no platform fee at this volume (tens of messages/month).
- A2P 10DLC registration is required for US SMS from a new number — brand + campaign registration typically takes days-to-weeks; voice-only escalation works immediately.
- New vendor relationship, one more credential to hold.

### 8x8
- Likely already the dealership phone system (assumption — **confirm in-session whether the QEP 8x8 contract includes CPaaS/API credits**; if it does, marginal cost is ~zero).
- CPaaS APIs exist (SMS, voice) but the developer ecosystem, docs, and edge-function ergonomics are notably weaker than Twilio's.
- Escalation calls would originate from the dealership's known numbers — recipients recognize the caller.

### Neither (status quo)
- Tasks + exceptions only. Zero cost, but a zero-headroom weekend goes unseen until someone opens the Command Center.

## Recommendation

**Twilio for the machine-initiated tier, scoped to internal recipients**, behind a provider-agnostic dispatch seam (one `escalation-dispatch` adapter with a `provider` config), so switching to 8x8 later is configuration, not code. Rationale: the integration is hours on Twilio vs days of discovery on 8x8's CPaaS, volume cost is negligible, and the seam removes lock-in. Start voice-first (no 10DLC wait), add SMS once registration clears.

**Flip to 8x8 if** the existing contract already bundles CPaaS credits/DIDs and IT prefers one vendor — the seam makes that a config change.

## Consequences

- A vault-held `TWILIO_*` credential set (or 8x8 equivalent) joins the secrets inventory; the escalation edge function is internal-secret-gated like other runners.
- The workflow gains one action (`escalate_availability_alert`) that fires only after task-unacknowledged-for-N-hours — thresholds tuned after one observed billing cycle, per the operate/observe/tune posture.
- No customer-facing sends are introduced by this decision.
