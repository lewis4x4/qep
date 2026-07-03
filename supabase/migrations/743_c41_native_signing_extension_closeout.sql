-- ============================================================================
-- Migration 736: C4.1 native invoice and rental signing closeout
--
-- C4.1 is satisfied by the source-controlled native QEP signature schema,
-- portal signing endpoints, and portal UI readiness labels. This closeout
-- intentionally does not promote external VESign/provider envelope readiness.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%743_c41_native_signing_extension_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-106 packet') ||
      ' | supabase/migrations/607_native_invoice_rental_signatures.sql' ||
      ' | supabase/functions/portal-api/index.ts' ||
      ' | apps/web/src/features/portal/pages/PortalInvoicesPage.tsx' ||
      ' | apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx' ||
      ' | apps/web/src/features/portal/pages/PortalRentalsPage.tsx' ||
      ' | apps/web/src/features/portal/components/PortalNativeSignatureCard.tsx' ||
      ' | apps/web/src/features/portal/lib/signing-readiness.ts' ||
      ' | apps/web/src/features/portal/lib/signing-readiness.test.ts' ||
      ' | test-results/agent-gates/20260521T002558Z-C4.1-native-invoice-rental-esign.json' ||
      ' | supabase/migrations/743_c41_native_signing_extension_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C4.1 shipped: Native QEP e-signature was extended from quote acceptance to invoice and rental contract surfaces. Migration 607 creates customer_invoice_signatures and rental_contract_signatures, links latest valid native signatures back to customer_invoices and rental_contracts, records signer, portal customer, signed snapshot, signature image, and document hash evidence, and keeps RLS scoped to internal workspace readers, portal self readers, and service-role writers. portal-api exposes customer-owned invoice and rental sign routes, validates base64 PNG signatures, rejects void invoices and unassigned/unapproved rental terms, stores stable snapshot hashes, returns idempotent existing valid signatures, and adds native signature summaries/timeline evidence to portal payloads. Portal invoice and rental pages render PortalNativeSignatureCard capture/status UI, while signing-readiness labels native signatures as QEP portal evidence and keeps VESign provider readiness false pending external provider proof.'
  END,
  updated_at = now()
WHERE task_id = 'C4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C4.1',
  'update',
  jsonb_build_object(
    'reason', 'c41_native_signing_extension_closeout',
    'migration', '743_c41_native_signing_extension_closeout.sql',
    'mission_alignment', 'pass: invoice and rental customers can sign critical QEP documents inside the portal with auditable native evidence, reducing stalled sales/rental handoffs while preserving the external VESign boundary for legal/provider decisions',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/607_native_invoice_rental_signatures.sql creates customer_invoice_signatures and rental_contract_signatures with signer, snapshot, hash, validity, latest-signature links, and workspace/portal/service RLS policies',
      'supabase/functions/portal-api/index.ts validates native base64 PNG signatures, canonicalizes signed snapshots to document hashes, records invoice signatures, records rental contract signatures, and returns native_signature payloads',
      'apps/web/src/features/portal/components/PortalNativeSignatureCard.tsx provides shared native portal signature capture/status UI for invoices and rentals',
      'apps/web/src/features/portal/pages/PortalInvoiceDetailPage.tsx signs invoices through portalApi.signInvoice and disables voided invoice signing',
      'apps/web/src/features/portal/pages/PortalRentalsPage.tsx signs approved/assigned rental terms through portalApi.signRentalContract',
      'apps/web/src/features/portal/pages/PortalInvoicesPage.tsx surfaces signed/native-signature status in invoice history',
      'apps/web/src/features/portal/lib/signing-readiness.ts and signing-readiness.test.ts label invoice/rental signatures as native_qep evidence while keeping vesignReady false',
      'test-results/agent-gates/20260521T002558Z-C4.1-native-invoice-rental-esign.json records the historical C4.1 segment gate as PASS'
    ),
    'safety_bounds', jsonb_build_array(
      'this migration marks only C4.1 shipped and does not alter signing runtime behavior',
      'native QEP signatures are distinct from external VESign provider-envelope status',
      'invoice signing remains portal-customer-owned and rejects void invoices',
      'rental signing remains portal-customer-owned and requires assigned approved, awaiting_payment, or active terms',
      'signature payload validation requires base64 PNG content and size limits'
    ),
    'manual_boundaries', jsonb_build_array(
      'no VitalEdge/VESign contract, sender identity, credentials, webhook secret, replay sample, or status vocabulary was provided',
      'no legal/accounting policy decision retires or replaces VESign provider requirements',
      'no live provider envelope, webhook, or poller flow was tested',
      'no real customer UAT signature session was performed in this closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
