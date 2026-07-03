-- ============================================================================
-- Migration 704: A3.5 branded acceptance flow closeout
--
-- Public Deal Room acceptance now uses a branded share-token landing route,
-- native QEP signature capture, server-side quote/stage mutation, rep evidence,
-- and token-authorized Stripe deposit handoff with webhook-only payment proof.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/deal-room/pages/DealRoomPage.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M5 + ADR-016') ||
      ' | docs/adr/ADR-016-acceptance-flow-e-signature.md' ||
      ' | apps/web/src/features/deal-room/pages/DealRoomPage.tsx' ||
      ' | apps/web/src/features/deal-room/lib/deal-room-api.ts' ||
      ' | apps/web/src/features/deal-room/pages/__tests__/DealRoomPage.acceptance-source.test.ts' ||
      ' | apps/web/src/features/deal-room/lib/__tests__/deal-room-api.test.ts' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-public-accept-regression.test.ts' ||
      ' | supabase/functions/_shared/portal-stripe-reconcile.test.ts' ||
      ' | scripts/verify/adr-016-acceptance-flow.mjs'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.5 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.5 shipped: ADR-016 resolves the DocuSign-style provider ambiguity by making native QEP e-signature the default acceptance mechanism and keeping external VESign/DocuSign provider evidence manual-gated. DealRoomPage renders the branded /q/:share_token customer landing experience with shared PortalSignaturePad capture, typed-signature accessibility fallback, explicit acceptance terms, and a deposit panel that opens only after accepted/converted quote status. deal-room-api posts public-accept and public-deposit-checkout requests through token-authorized quote-builder-v2 routes. quote-builder-v2 handles public accept before staff auth, validates share_token/status/readiness, writes quote_signatures with signed_snapshot/document_hash/IP/user-agent evidence before status mutation, advances the deal to sales-order-signed, and records idempotent qb_notifications plus quote_delivery_events rep timeline evidence. Public deposit checkout is token-scoped, requires accepted status and a linked deal/company, creates or reuses a collectible deposit row, inserts portal_payment_intents with quote_deposit metadata when Stripe is configured, and returns a mailto fallback when Stripe is not configured. portal-stripe reconciliation verifies Stripe webhook evidence before marking deposits and deal gates verified.'
  END,
  updated_at = now()
WHERE task_id = 'A3.5';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.5',
  'update',
  jsonb_build_object(
    'reason', 'a35_branded_acceptance_flow_closeout',
    'migration', '711_a35_branded_acceptance_flow_closeout.sql',
    'mission_alignment', 'pass: QEP customers can move from a branded quote landing page to signed acceptance and deposit handoff while reps receive auditable evidence, preserving customer trust and operational stage integrity for equipment sales',
    'implementation_evidence', jsonb_build_array(
      'docs/adr/ADR-016-acceptance-flow-e-signature.md native QEP e-signature acceptance decision',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx branded /q/:share_token acceptance panel',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx PortalSignaturePad plus typed signature fallback',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx DepositCheckoutPanel opens only after accepted/converted quote status',
      'apps/web/src/features/deal-room/lib/deal-room-api.ts acceptPublicQuote public-accept route',
      'apps/web/src/features/deal-room/lib/deal-room-api.ts createPublicQuoteDepositCheckout public-deposit-checkout route',
      'supabase/functions/quote-builder-v2/index.ts handlePublicAccept',
      'supabase/functions/quote-builder-v2/index.ts recordPublicAcceptRepEvidence',
      'supabase/functions/quote-builder-v2/index.ts handlePublicDepositCheckout',
      'supabase/functions/quote-builder-v2/quote-public-accept-regression.test.ts public route and mutation-order regressions',
      'apps/web/src/features/deal-room/pages/__tests__/DealRoomPage.acceptance-source.test.ts customer acceptance/deposit gate source test',
      'apps/web/src/features/deal-room/lib/__tests__/deal-room-api.test.ts token-authorized public API tests',
      'supabase/functions/_shared/portal-stripe-reconcile.test.ts quote_deposit webhook verification tests'
    ),
    'safety_bounds', jsonb_build_array(
      'public accept and public deposit routes execute before staff JWT auth but remain share-token scoped',
      'signature is inserted with signed snapshot and document hash before quote status mutation',
      'deposit checkout is blocked until quote status is accepted or converted_to_deal',
      'Stripe redirect is not treated as payment proof; portal-stripe webhook reconciliation verifies deposit state',
      'external provider signing remains optional/provider-gated rather than blocking native QEP acceptance'
    ),
    'manual_boundaries', jsonb_build_array(
      'live Stripe secret/webhook configuration in target Supabase environment',
      'R2 production bucket credentials and signed URL policy',
      'external VESign/DocuSign provider contract, sender identity, webhook secret, and legal envelope policy',
      'business deposit SOP and production UAT signoff'
    )
  ),
  'codex'
);

COMMIT;
