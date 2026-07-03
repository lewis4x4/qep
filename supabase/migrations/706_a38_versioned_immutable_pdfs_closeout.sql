-- ============================================================================
-- Migration 706: A3.8 versioned immutable PDFs in R2 closeout
--
-- Customer sends now require a fresh generated R2 customer PDF artifact,
-- expose sent versions only after successful email commit, resolve public
-- links to the latest sent version, and show reps version history with diffs.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/599_quote_pdf_r2_versions.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M8') ||
      ' | supabase/migrations/599_quote_pdf_r2_versions.sql' ||
      ' | supabase/functions/_shared/r2-storage.ts' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-financial-integrity-regression.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-pdf-version-snapshot.ts' ||
      ' | apps/web/src/features/quote-builder/components/QuotePdfVersionHistoryPanel.tsx' ||
      ' | apps/web/src/features/quote-builder/components/SendQuoteSection.tsx' ||
      ' | apps/web/src/features/quote-builder/pages/QuoteListPage.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/QuotePdfVersionHistoryPanel.test.tsx' ||
      ' | apps/web/src/features/quote-builder/components/__tests__/SendQuoteSection.versioned-send.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.8 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.8 shipped: migration 599 extends quote_document_artifacts with R2 storage_provider, version_number, content_sha256, size_bytes, proposal_snapshot_json, customer_visible_at, sent_delivery_event_id, upload_intent, and upload_expires_at; it also creates quote_begin_customer_pdf_version and quote_send_package_commit so version allocation and send visibility are service-role controlled. quote-builder-v2 begin-upload allocates a versioned customer_quote_pdf artifact and returns a short-lived R2 PUT URL, complete-upload verifies R2 object metadata, size, content type, readback, and SHA-256 before marking generated, and send-package refuses missing, stale, already-visible, non-R2, or non-generated artifacts. The public Deal Room latest PDF resolver returns a no-store 302 to a short-lived R2 GET URL for the newest sent artifact. quote-api persists immutable versions from generated PDF blobs and exposes list/diff APIs. QuotePdfVersionHistoryPanel shows sent versions, hashes, recipients, totals, newest-vs-previous selectors, line item diffs, total diffs, financing diffs, and terms/narrative diffs. SendQuoteSection and QuoteListPage block send/resend bypasses that would skip fresh immutable PDF generation.'
  END,
  updated_at = now()
WHERE task_id = 'A3.8';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.8',
  'update',
  jsonb_build_object(
    'reason', 'a38_versioned_immutable_pdfs_closeout',
    'migration', '706_a38_versioned_immutable_pdfs_closeout.sql',
    'mission_alignment', 'pass: QEP quote delivery now has auditable, immutable customer PDF versions with latest-link routing and rep-visible diff history, giving sales and operations dispute-proof quote evidence without exposing mutable files',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/599_quote_pdf_r2_versions.sql quote_document_artifacts R2 version metadata',
      'supabase/migrations/599_quote_pdf_r2_versions.sql quote_begin_customer_pdf_version',
      'supabase/migrations/599_quote_pdf_r2_versions.sql quote_send_package_commit',
      'supabase/functions/_shared/r2-storage.ts createR2PutUrl/createR2GetUrl/headR2Object/readR2ObjectBytes',
      'supabase/functions/quote-builder-v2/index.ts begin-upload document-artifacts route',
      'supabase/functions/quote-builder-v2/index.ts complete-upload R2 verification',
      'supabase/functions/quote-builder-v2/index.ts send-package fresh artifact gate',
      'supabase/functions/quote-builder-v2/index.ts handlePublicLatestQuotePdfRead',
      'apps/web/src/features/quote-builder/lib/quote-api.ts persistImmutableQuotePdfVersion',
      'apps/web/src/features/quote-builder/lib/quote-api.ts listQuotePdfVersions/diffQuotePdfVersions',
      'apps/web/src/features/quote-builder/components/QuotePdfVersionHistoryPanel.tsx sent version history and line diffs',
      'apps/web/src/features/quote-builder/components/SendQuoteSection.tsx fresh immutable PDF copy',
      'apps/web/src/features/quote-builder/pages/QuoteListPage.tsx resend bypass disabled',
      'supabase/functions/quote-builder-v2/quote-financial-integrity-regression.test.ts R2/version/public latest regressions',
      'apps/web/src/features/quote-builder/components/__tests__/QuotePdfVersionHistoryPanel.test.tsx newest-vs-previous diff test',
      'apps/web/src/features/quote-builder/components/__tests__/SendQuoteSection.versioned-send.test.ts bypass guard test'
    ),
    'safety_bounds', jsonb_build_array(
      'send-package requires a generated, fresh, unsent R2 customer_quote_pdf artifact for the active quote package version',
      'customer_visible_at is set only by quote_send_package_commit after the email send record is inserted',
      'public latest PDF access redirects to a short-lived R2 GET URL and uses Cache-Control no-store',
      'complete-upload verifies R2 HEAD/readback and SHA-256 before marking an artifact generated',
      'quick resend is disabled so customer email cannot bypass fresh immutable PDF generation'
    ),
    'manual_boundaries', jsonb_build_array(
      'production R2 credentials in Supabase function environment',
      'R2 bucket CORS/policy and lifecycle configuration',
      'production email provider configuration for send-package delivery',
      'live storage smoke test in target environment'
    )
  ),
  'codex'
);

COMMIT;
