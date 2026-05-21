# ADR-016 — Acceptance Flow & E-Signature

Status: Accepted  
Roadmap item: E1.16 / QEP-123  
Decision date: 2026-05-21

## Context

QEP quote delivery already has most of the acceptance primitives in place:

- `quote_packages.share_token` creates a customer-safe lookup key for shared quotes.
- `quote_package_versions` and `quote_document_artifacts` preserve immutable customer PDF artifacts.
- `quote-builder-v2` can create short-lived R2 signed URLs and resolve the latest sent PDF version.
- `quote_packages.viewed_at` plus `/mark-viewed` record customer quote-view telemetry.
- `quote_signatures` stores customer signature records with signer identity, snapshot, and document hash fields.
- `portal_quote_reviews` supports portal-side customer review and e-signature state.
- `portal-stripe` handles Stripe checkout/webhook verification for portal payments.

The missing decision was how these pieces connect into one customer-facing acceptance journey without exposing internal margin data, relying on long-lived storage URLs, or treating payment as a substitute for signed quote acceptance.

## Decision

Customer quote acceptance uses a branded QEP landing page keyed by `share_token`; it does not use a raw R2 URL as the customer entry surface.

The acceptance sequence is:

1. Rep sends a quote package.
2. The send action creates or references the latest immutable customer PDF artifact version.
3. The customer opens a branded QEP quote landing route such as `/q/:share_token`.
4. The landing route resolves the current sent quote package server-side and calls `/mark-viewed` when the customer reaches the quote.
5. The landing page displays the customer-safe quote summary and links the latest sent immutable PDF through a short-lived server-signed R2 GET URL.
6. The customer accepts by completing the native QEP e-signature action.
7. The server writes the signature, signed snapshot, document hash, signer evidence, and audit metadata before mutating quote stage/status.
8. If a deposit is required, the server creates a Stripe checkout session after signature intent is captured.
9. Stripe payment state mutates quote/deposit state only from verified webhook events, never from client-side redirects alone.
10. Rep notifications, timeline entries, and deal/quote stage changes are emitted only from server-verified view, signature, and payment events.

Native QEP e-signature is the default acceptance mechanism for this roadmap slice. VESign or another external signature provider remains a provider-gated integration path and must not block native QEP quote acceptance unless a future policy explicitly requires it.

## Required controls

- Browser clients must not directly mutate signature, payment, quote-stage, or deposit-status fields.
- Public quote landing access is scoped by `share_token` and returns only customer-safe projections.
- R2 PDF access uses short-lived signed URLs generated server-side.
- Direct long-lived R2 URLs are not valid acceptance links.
- Customer-visible PDF versions are immutable after send; edits produce a new version.
- The signed snapshot must bind the signature to the quote version and document hash the signer saw.
- Stripe redirects may improve UX but are not payment proof; webhook verification is the proof.
- Signature and payment events must capture enough evidence for dispute defense: quote package id, quote version, artifact id/version, document hash, share token, signer name/email when available, IP address, user agent, timestamp, signature method, Stripe checkout/session/payment-intent/event ids when applicable.
- Internal Deal IQ, margin, commission, approval, and cost fields remain rep/manager-only and are never rendered in the customer landing payload.

## State model

The customer acceptance state machine is:

```text
sent
  -> viewed
  -> accepted_signed
  -> deposit_requested
  -> deposit_paid
```

Allowed alternate terminal or paused states:

```text
sent/viewed -> rejected
sent/viewed -> expired
accepted_signed/deposit_requested -> deposit_failed
```

Payment alone does not imply `accepted_signed`. Signature alone does not imply `deposit_paid`.

## Existing implementation anchors

- `supabase/migrations/370_quote_share_tokens.sql`
- `supabase/migrations/256_quote_package_viewed_at.sql`
- `supabase/migrations/087_quote_builder_v2.sql`
- `supabase/migrations/082_customer_portal.sql`
- `supabase/migrations/085_portal_rls_hardening.sql`
- `supabase/migrations/599_quote_pdf_r2_versions.sql`
- `supabase/functions/quote-builder-v2/index.ts`
- `supabase/functions/portal-api/index.ts`
- `supabase/functions/portal-stripe/index.ts`
- `supabase/functions/_shared/quote-document-hash.ts`
- `docs/quote-flow-audit.md`
- `docs/quote-flow-backend-plan.md`

## Implementation slices

1. Branded quote landing route backed by `share_token` and customer-safe quote projection.
2. Latest sent immutable PDF resolver with short-lived R2 signed URL rotation.
3. Native signature capture tied to quote version, PDF artifact version, signed snapshot, and document hash.
4. Optional deposit handoff to Stripe checkout after acceptance intent.
5. Verified webhook handling for deposit success/failure state mutation.
6. Timeline, rep notification, and stage-update events emitted from server-side verified events only.
7. Regression tests proving customer landing payload excludes margin/Deal IQ fields and cannot mutate status directly.

## Rejected alternatives

- Direct R2 signed URL as the primary customer quote link — rejected because it bypasses QEP branding, telemetry, acceptance state, and customer-safe projection controls.
- Long-lived public R2 quote URLs — rejected because quote artifacts need revocable, auditable access.
- Stripe payment as quote acceptance — rejected because payment and signed commercial acceptance are different legal/business events.
- VESign as the mandatory first acceptance path — rejected because provider evidence is still gated separately and native QEP signature already has repository foundations.
- Client-side quote status mutation after redirect — rejected because redirects are not proof of signature or payment completion.
- Rendering rep-facing Deal IQ or margin context on the public landing page — rejected because customer delivery must remain customer-safe.

## Verification expectations

Static verification for this ADR:

```bash
bun run adr:016:verify
```

Implementation verification for future build slices should include:

```bash
deno test supabase/functions/portal-stripe/portal-stripe-integrity-regression.test.ts --allow-read --allow-env
deno test supabase/functions/quote-builder-v2/quote-financial-integrity-regression.test.ts --allow-read --allow-env
bun run audit:edges
bun run segment:gates --segment E1.16-acceptance-flow --ui
```

## Blockers and follow-up assumptions

- Live Stripe deposit verification requires valid Stripe configuration in the target environment.
- External VESign evidence remains separate from this ADR and should stay tracked through provider-contract/UAT evidence work.
- If the business later requires external e-signature for specific deal classes, add policy routing on top of this native acceptance state machine rather than replacing the branded landing surface.
