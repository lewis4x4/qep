-- ============================================================================
-- Migration 739: E1.16 ADR-016 acceptance flow and e-signature closeout
--
-- ADR-016 is accepted and source-controlled with implementation anchors for the
-- branded quote landing path, native QEP signature, immutable PDF access, and
-- webhook-verified deposit handoff. This records roadmap status only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%739_e116_acceptance_flow_esignature_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/adr/ADR-016-*') ||
      ' | docs/adr/ADR-016-acceptance-flow-e-signature.md' ||
      ' | scripts/verify/adr-016-acceptance-flow.mjs' ||
      ' | supabase/migrations/370_quote_share_tokens.sql' ||
      ' | supabase/migrations/256_quote_package_viewed_at.sql' ||
      ' | supabase/migrations/087_quote_builder_v2.sql' ||
      ' | supabase/migrations/082_customer_portal.sql' ||
      ' | supabase/migrations/085_portal_rls_hardening.sql' ||
      ' | supabase/migrations/599_quote_pdf_r2_versions.sql' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | supabase/functions/portal-api/index.ts' ||
      ' | supabase/functions/portal-stripe/index.ts' ||
      ' | supabase/functions/_shared/quote-document-hash.ts' ||
      ' | supabase/migrations/704_a35_branded_acceptance_flow_closeout.sql' ||
      ' | docs/quote-flow-audit.md' ||
      ' | docs/quote-flow-backend-plan.md' ||
      ' | supabase/migrations/739_e116_acceptance_flow_esignature_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] E1.16 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] E1.16 shipped: ADR-016 is accepted and verified as the canonical QEP acceptance-flow decision. The ADR defines a branded /q/:share_token landing page, short-lived server-signed R2 PDF access, native QEP e-signature as the default acceptance mechanism, signed_snapshot/document_hash evidence before status mutation, webhook-only Stripe payment proof, customer-safe projections that exclude Deal IQ/margin/cost fields, and a state model that separates viewed, accepted_signed, deposit_requested, and deposit_paid. A3.5 shipped the corresponding branded acceptance flow and server-side public accept/deposit routes. External VESign/DocuSign provider work, live Stripe/R2 configuration, and production UAT remain manual/provider gated.'
  END,
  updated_at = now()
WHERE task_id = 'E1.16';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'E1.16',
  'update',
  jsonb_build_object(
    'reason', 'e116_acceptance_flow_esignature_closeout',
    'migration', '739_e116_acceptance_flow_esignature_closeout.sql',
    'mission_alignment', 'pass: QEP has a governed customer acceptance architecture that connects equipment quotes, customer-safe review, native signature evidence, deposits, rep notifications, and stage integrity without leaking internal margin intelligence or depending on a future provider contract',
    'implementation_evidence', jsonb_build_array(
      'docs/adr/ADR-016-acceptance-flow-e-signature.md is accepted for E1.16 / QEP-123',
      'scripts/verify/adr-016-acceptance-flow.mjs verifies required ADR phrases and implementation anchors',
      'supabase/migrations/370_quote_share_tokens.sql supplies share-token quote access',
      'supabase/migrations/256_quote_package_viewed_at.sql records quote view telemetry',
      'supabase/migrations/087_quote_builder_v2.sql and supabase/migrations/082_customer_portal.sql anchor quote signatures and portal quote reviews',
      'supabase/migrations/085_portal_rls_hardening.sql keeps portal access scoped',
      'supabase/migrations/599_quote_pdf_r2_versions.sql anchors immutable PDF versioning and signed URL behavior',
      'supabase/functions/quote-builder-v2/index.ts, portal-api/index.ts, and portal-stripe/index.ts implement public accept, portal payload, and webhook-verified deposit behavior',
      'supabase/functions/_shared/quote-document-hash.ts binds signature evidence to document hashes',
      'supabase/migrations/704_a35_branded_acceptance_flow_closeout.sql shipped the branded acceptance implementation that ADR-016 governs'
    ),
    'safety_bounds', jsonb_build_array(
      'this migration marks only E1.16 shipped and does not alter quote, portal, Stripe, or R2 runtime behavior',
      'browser clients must not directly mutate signature, payment, quote-stage, or deposit-status fields',
      'Stripe redirects are not payment proof; webhook verification remains the payment proof',
      'payment alone does not imply accepted_signed and signature alone does not imply deposit_paid',
      'internal Deal IQ, margin, commission, approval, and cost fields remain rep/manager-only'
    ),
    'manual_boundaries', jsonb_build_array(
      'live Stripe secret and webhook configuration in the target Supabase environment',
      'R2 production bucket credentials and signed URL policy',
      'external VESign or DocuSign provider contract, sender identity, webhook secret, and legal envelope policy',
      'business deposit SOP and production UAT signoff',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
