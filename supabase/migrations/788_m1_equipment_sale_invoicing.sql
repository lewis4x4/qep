-- ============================================================================
-- Migration 788: M1.1 — Equipment sale invoicing (forward billing path)
--
--   Stream M (Revenue Convergence, blueprint §2): the equipment-invoice-runner
--   edge function sweeps delivered/closed-won deals with an accepted quote
--   package and writes the first-ever invoice_type='equipment' rows in
--   customer_invoices, making the m536/540/659/667 reversal foundation
--   operable (it hard-requires qrm_equipment.in_out_state='sold' and locates
--   invoices via customer_invoices.qrm_equipment_id).
--
--   This migration carries the schema plumbing for that writer:
--
--   1. exception_queue sources +'equipment_billing_failed' (dead-letter for
--      per-deal generation failures, mirroring rental_billing_failed) and
--      +'doc_center_review' — document-twin/service.ts has inserted that
--      source since it shipped, and every insert has failed the CHECK
--      silently; whitelisting it un-breaks an existing producer.
--
--   2. quickbooks_gl_sync_jobs status +'queued'. The invoice writers
--      (_shared/service-invoice.ts since it shipped, _shared/
--      equipment-invoice.ts now) upsert status='queued', and
--      quickbooks-gl-sync's sync_pending action polls status in
--      ('queued','failed') — but the m368 CHECK never allowed 'queued', so
--      the service path's GL enqueue has failed silently since day one.
--      Allowing 'queued' un-breaks the whole enqueue→sync_pending loop.
--
--   3. Partial index for the runner's "delivered deals not yet invoiced"
--      anti-join (customer_invoices probed by deal_id for equipment rows on
--      every sweep tick).
--
--   4. equipment-invoice-runner pg_cron every 10 minutes. Auth header reads
--      INTERNAL_SERVICE_SECRET from Supabase Vault at runtime (the post-
--      incident 2026-07-08 fleet pattern — see flow-runner's job) so no
--      secret lands in the repo or in cron.job; fail-safe NOTICE when
--      pg_cron or the vault secret is unavailable.
-- ============================================================================

BEGIN;

-- 1. exception_queue source whitelist (supersedes m772's list)
ALTER TABLE public.exception_queue DROP CONSTRAINT IF EXISTS exception_queue_source_check;
ALTER TABLE public.exception_queue ADD CONSTRAINT exception_queue_source_check
  CHECK (source = ANY (ARRAY[
    'tax_failed', 'price_unmatched', 'health_refresh_failed', 'ar_override_pending',
    'stripe_mismatch', 'portal_reorder_approval', 'sop_evidence_mismatch',
    'geofence_conflict', 'stale_telematics', 'doc_visibility', 'data_quality',
    'analytics_alert', 'workflow_dead_letter', 'messaging_failure', 'messaging_opt_out_review',
    'rental_rate_mismatch', 'rental_overdue_return', 'rental_coi_expired',
    'rental_credit_hold', 'rental_damage_dispute', 'rental_overbook_override',
    'rental_billing_failed',
    'equipment_billing_failed', 'doc_center_review'
  ]));

-- 2. Allow the 'queued' state the invoice writers and sync_pending already use
ALTER TABLE public.quickbooks_gl_sync_jobs DROP CONSTRAINT IF EXISTS quickbooks_gl_sync_jobs_status_check;
ALTER TABLE public.quickbooks_gl_sync_jobs ADD CONSTRAINT quickbooks_gl_sync_jobs_status_check
  CHECK (status IN ('pending', 'queued', 'processing', 'posted', 'failed', 'skipped'));

-- 3. Runner anti-join: delivered deals probed for an existing equipment invoice
CREATE INDEX IF NOT EXISTS idx_customer_invoices_equipment_by_deal
  ON public.customer_invoices (deal_id)
  WHERE invoice_type = 'equipment' AND reversal_of_invoice_id IS NULL;

-- 4. equipment-invoice-runner cron (vault-backed secret, post-incident fleet pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping equipment-invoice-runner cron: pg_cron not available.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'INTERNAL_SERVICE_SECRET') THEN
    RAISE NOTICE 'Skipping equipment-invoice-runner cron: INTERNAL_SERVICE_SECRET not in vault.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'equipment-invoice-runner') THEN
    PERFORM cron.unschedule('equipment-invoice-runner');
  END IF;

  PERFORM cron.schedule(
    'equipment-invoice-runner',
    '*/10 * * * *',
    $job$select net.http_post(
    url := 'https://iciddijgonywtxoelous.supabase.co/functions/v1/equipment-invoice-runner',
    headers := jsonb_build_object('x-internal-service-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'INTERNAL_SERVICE_SECRET')),
    body := '{}'::jsonb
  )$job$);
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping equipment-invoice-runner cron: %', SQLERRM;
END $$;

COMMIT;
