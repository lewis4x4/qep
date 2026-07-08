-- ============================================================================
-- Migration 789: M2.1 — Parts order invoicing + counter tender capture
--
--   Stream M (Revenue Convergence, blueprint §2, §6). parts-order-manager's
--   delivered transition now writes customer_invoices (invoice_type='parts')
--   + parts_invoice_lines — the m468 detail table's first-ever writer — via
--   _shared/parts-invoice.ts. This migration carries the schema plumbing:
--
--   1. exception_queue sources +'parts_billing_failed' (dead-letter for
--      invoice-generation failures on the delivered transition, mirroring
--      rental_billing_failed / equipment_billing_failed).
--
--   2. Counter tender capture (RF-012: the POS stamped only
--      payment_received_at with neither tender type nor amount):
--      parts_orders gains tender_type (cash/check/card/ach/wire) and
--      tender_amount. Cash-class paid tickets settle their invoice at
--      generation (amount_paid = min(tender, total)); charge-account
--      tickets post 'pending' and age in AR.
--
--   3. parts_orders.branch_id — the order's issuing branch, feeding
--      next_invoice_number's branch-prefixed numbering ('parts' → P).
--      Nullable; the invoice writer falls back to the workspace's first
--      legacy-coded branch, same as the equipment path.
--
--   4. Partial index for the writer's idempotency probe (invoice looked up
--      by parts_order_id + invoice_type='parts' on every delivered
--      transition).
-- ============================================================================

BEGIN;

-- 1. exception_queue source whitelist (supersedes m788's list)
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
    'equipment_billing_failed', 'doc_center_review',
    'parts_billing_failed'
  ]));

-- 2. Counter tender capture
ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS tender_type text,
  ADD COLUMN IF NOT EXISTS tender_amount numeric(14,2);

ALTER TABLE public.parts_orders DROP CONSTRAINT IF EXISTS parts_orders_tender_type_chk;
ALTER TABLE public.parts_orders ADD CONSTRAINT parts_orders_tender_type_chk
  CHECK (tender_type IS NULL OR tender_type IN ('cash', 'check', 'card', 'ach', 'wire'));

ALTER TABLE public.parts_orders DROP CONSTRAINT IF EXISTS parts_orders_tender_amount_chk;
ALTER TABLE public.parts_orders ADD CONSTRAINT parts_orders_tender_amount_chk
  CHECK (tender_amount IS NULL OR tender_amount >= 0);

COMMENT ON COLUMN public.parts_orders.tender_type is
  'Counter tender instrument for cash-class tickets (M2.1). NULL on charge-account tickets and legacy rows.';
COMMENT ON COLUMN public.parts_orders.tender_amount is
  'Amount tendered at the counter. Invoice settlement applies min(tender_amount, invoice total).';

-- 3. Issuing branch for branch-prefixed invoice numbering
ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.parts_orders.branch_id is
  'Branch that issued the order; feeds next_invoice_number branch prefix. NULL falls back to the workspace''s first legacy-coded branch.';

-- 4. Idempotency probe for the delivered-transition invoice writer
CREATE INDEX IF NOT EXISTS idx_customer_invoices_parts_by_order
  ON public.customer_invoices (parts_order_id)
  WHERE invoice_type = 'parts' AND reversal_of_invoice_id IS NULL;

COMMIT;
