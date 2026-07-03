-- ============================================================================
-- Migration 707: A3.10 QR landing page with NPS feedback closeout
--
-- Customer quote PDFs now point to the branded /q/:share_token Deal Room,
-- which shows quote status, acceptance/contact actions, and token-scoped
-- three-question proposal feedback that records NPS signals for rep follow-up.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/600_quote_customer_feedback.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M10') ||
      ' | supabase/migrations/600_quote_customer_feedback.sql' ||
      ' | apps/web/src/features/quote-builder/lib/quote-qr.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx' ||
      ' | apps/web/src/features/deal-room/pages/DealRoomPage.tsx' ||
      ' | apps/web/src/features/deal-room/lib/deal-room-api.ts' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-qr.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.10 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.10 shipped: quote-qr builds a safe public landing QR for the share-token URL and labels it "Scan for quote status, acceptance, and feedback"; quote-proposal-data swaps that generated QR into customer proposal assets whenever a public quote URL is present, and QuotePDFDocument renders the scannable modules in the PDF footer. DealRoomPage is the branded /q/:share_token landing experience with quote status, latest sent PDF, accept quote action, call/email rep actions, and a Proposal feedback panel. The feedback panel captures NPS 0-10, proposal-fit 1-5, missing/unclear free text, optional follow-up request, and optional customer identity fields, deduping browser submissions with a client_submission_id. deal-room-api submits the token-scoped payload to quote-builder-v2 /public-feedback. quote-builder-v2 validates the share token and quote readiness, rate-limits per quote, stores quote_customer_feedback with latest sent PDF/version references, hashes source IP, emits a customer_lifecycle_events nps_response row, and creates crm_in_app_notifications for the latest sending rep when a rep can be resolved.'
  END,
  updated_at = now()
WHERE task_id = 'A3.10';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.10',
  'update',
  jsonb_build_object(
    'reason', 'a310_qr_landing_nps_feedback_closeout',
    'migration', '707_a310_qr_landing_nps_feedback_closeout.sql',
    'mission_alignment', 'pass: QEP customers can scan a quote-specific landing page, act on the proposal, and send structured NPS feedback that becomes lifecycle and rep follow-up evidence for sales operations',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/600_quote_customer_feedback.sql quote_customer_feedback table and RLS',
      'apps/web/src/features/quote-builder/lib/quote-qr.ts safe public quote QR generation',
      'apps/web/src/features/quote-builder/lib/quote-qr.ts Scan for quote status, acceptance, and feedback label',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts generated landing QR asset injection',
      'apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx QR modules rendered in the PDF footer',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx branded /q/:share_token quote status landing',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx Action hub with latest PDF, accept, call, email, and feedback anchors',
      'apps/web/src/features/deal-room/pages/DealRoomPage.tsx Proposal feedback panel',
      'apps/web/src/features/deal-room/lib/deal-room-api.ts submitPublicQuoteFeedback',
      'supabase/functions/quote-builder-v2/index.ts handlePublicQuoteFeedback',
      'supabase/functions/quote-builder-v2/index.ts customer_lifecycle_events nps_response insert',
      'supabase/functions/quote-builder-v2/index.ts crm_in_app_notifications quote_feedback_submitted insert',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-qr.test.ts public QR safety coverage',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts QR asset/proposal coverage'
    ),
    'safety_bounds', jsonb_build_array(
      'public-feedback requires a valid share_token and public-readable quote status',
      'feedback payload validates UUID client_submission_id, NPS 0-10, fit 1-5, email shape, and text length',
      'per-quote one-hour submission rate limit protects the public endpoint',
      'quote_customer_feedback has service-role writes and workspace-scoped staff reads',
      'client_submission_id unique index dedupes repeat submissions for the same quote',
      'IP address is stored only as a SHA-256 hash'
    ),
    'manual_boundaries', jsonb_build_array(
      'production domain and HTTPS configuration for customer QR scan target',
      'live mobile-camera QR scan test against the deployed customer URL',
      'production email/notification delivery monitoring for rep follow-up workflow',
      'customer-facing copy/policy approval for NPS use and retention'
    )
  ),
  'codex'
);

COMMIT;
