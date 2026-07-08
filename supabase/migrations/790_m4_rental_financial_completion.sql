-- ============================================================================
-- Migration 790: M4.1 — Rental financial completion
--
--   Stream M (Revenue Convergence, blueprint §2 §4 §5 §9). rental-billing-
--   runner now mirrors EVERY posted rental invoice into customer_invoices
--   (company-anchored via rental_contracts.qrm_company_id when portal
--   identity is absent), computes real county tax through the m666 machinery,
--   pulls branch-prefixed numbers from invoice_number_sequences ('rental' →
--   R), enqueues QuickBooks GL sync, and rental-ops enforces a rate floor
--   against the rental_resolve_rates book. This migration carries:
--
--   1. exception_queue sources +'rental_rate_floor_override' (manager
--      override audit for below-book rates, mirroring
--      rental_overbook_override).
--
--   2. workspace_settings.rental_discount_approval_threshold_pct — the §9
--      workspace threshold. Default 10: discounts >10% below book require a
--      manager override at approve_booking / check_out_contract.
--
--   3. AR-mirror backfill for previously-skipped rental invoices (RF-039:
--      the old runner silently skipped every counter/voice/iron contract —
--      no marker was written, so the predicate is structural: posted
--      rental_invoices with no customer_invoices row at the same
--      (workspace_id, invoice_number)). Backfilled rows carry the amounts
--      AS ISSUED (historical tax stays as billed — retro-taxing changes what
--      the customer owes) and are NOT GL-enqueued (RF-011: some were manually
--      synced to QuickBooks; auto-enqueueing risks double-posting). Rows on
--      contracts with no anchor at all dead-letter to exception_queue.
--
--   4. Typing backfill: pre-existing portal-path mirrors and rental-ops
--      deposit/extension invoices were inserted before invoice_type existed
--      on the writers and defaulted to 'general' — stamp them 'rental' and
--      backfill the rental_invoices.customer_invoice_id back-link (m522
--      column, never populated until now).
-- ============================================================================

BEGIN;

-- 1. exception_queue source whitelist (supersedes m789's list)
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
    'parts_billing_failed',
    'rental_rate_floor_override'
  ]));

-- 2. Workspace rate-floor threshold (§9)
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS rental_discount_approval_threshold_pct numeric(5,2) NOT NULL DEFAULT 10;

COMMENT ON COLUMN public.workspace_settings.rental_discount_approval_threshold_pct is
  'M4.1 rate floor: agreed rental rates more than this % below the rental_resolve_rates book require a manager override at approve_booking/check_out_contract.';

-- 3. Backfill AR mirrors for previously-skipped rental invoices
WITH src AS (
  SELECT
    ri.id AS rental_invoice_id,
    ri.workspace_id,
    ri.invoice_number,
    ri.total_cents,
    ri.tax_cents,
    ri.amount_paid_cents,
    COALESCE(ri.due_date, ri.period_end) AS due_date,
    ri.period_start,
    ri.period_end,
    ri.status AS rental_status,
    rc.portal_customer_id,
    COALESCE(rc.qrm_company_id, pc.crm_company_id) AS crm_company_id,
    'Rental invoice · ' || COALESCE(rc.contract_number, rc.id::text) || ' · '
      || ri.period_start || ' → ' || ri.period_end AS description
  FROM public.rental_invoices ri
  JOIN public.rental_contracts rc ON rc.id = ri.rental_contract_id
  LEFT JOIN public.portal_customers pc ON pc.id = rc.portal_customer_id
  WHERE ri.deleted_at IS NULL
    AND ri.status IN ('open', 'posted', 'sent', 'partial', 'paid', 'overdue')
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_invoices ci
      WHERE ci.workspace_id = ri.workspace_id
        AND ci.invoice_number = ri.invoice_number
    )
), anchored AS (
  SELECT * FROM src WHERE portal_customer_id IS NOT NULL OR crm_company_id IS NOT NULL
), ins AS (
  INSERT INTO public.customer_invoices (
    workspace_id, portal_customer_id, crm_company_id, invoice_number,
    invoice_date, due_date, description, amount, tax, total, amount_paid,
    status, invoice_type, invoice_source_code, tax_breakdown
  )
  SELECT
    a.workspace_id,
    a.portal_customer_id,
    a.crm_company_id,
    a.invoice_number,
    a.period_end,
    a.due_date,
    a.description,
    (a.total_cents - a.tax_cents) / 100.0,
    a.tax_cents / 100.0,
    a.total_cents / 100.0,
    LEAST(a.amount_paid_cents, a.total_cents) / 100.0,
    CASE
      WHEN a.rental_status = 'paid' THEN 'paid'
      WHEN a.amount_paid_cents > 0 THEN 'partial'
      WHEN a.rental_status = 'overdue' THEN 'overdue'
      ELSE 'pending'
    END,
    'rental',
    'RENTAL',
    jsonb_build_object(
      'source_label', 'rental-mirror-backfill',
      'backfill', true,
      'total_tax', a.tax_cents / 100.0,
      'note', 'Mirrored as issued; historical tax not recomputed; GL not enqueued (possible prior manual QuickBooks sync).'
    )
  FROM anchored a
  RETURNING id, workspace_id, invoice_number, description, amount
), lines AS (
  INSERT INTO public.customer_invoice_line_items (
    workspace_id, invoice_id, line_number, description, quantity, unit_price
  )
  SELECT i.workspace_id, i.id, 1, i.description, 1, i.amount
  FROM ins i
  RETURNING invoice_id
)
UPDATE public.rental_invoices ri
SET customer_invoice_id = ins.id
FROM ins
WHERE ri.workspace_id = ins.workspace_id
  AND ri.invoice_number = ins.invoice_number
  AND ri.customer_invoice_id IS NULL;

-- 3b. Dead-letter the unmirrorable remainder (no anchor on the contract)
INSERT INTO public.exception_queue (workspace_id, source, severity, title, detail, payload, entity_table, entity_id)
SELECT
  ri.workspace_id,
  'rental_billing_failed',
  'error',
  'Rental invoice ' || ri.invoice_number || ' has no AR anchor — not mirrored',
  'Backfill (migration 790): contract carries neither portal_customer_id nor qrm_company_id; invoice remains invisible to AR aging until an anchor is set.',
  jsonb_build_object('rental_invoice_id', ri.id, 'rental_contract_id', ri.rental_contract_id, 'backfill', true),
  'rental_invoices',
  ri.id
FROM public.rental_invoices ri
JOIN public.rental_contracts rc ON rc.id = ri.rental_contract_id
LEFT JOIN public.portal_customers pc ON pc.id = rc.portal_customer_id
WHERE ri.deleted_at IS NULL
  AND ri.status IN ('open', 'posted', 'sent', 'partial', 'paid', 'overdue')
  AND rc.portal_customer_id IS NULL
  AND rc.qrm_company_id IS NULL
  AND pc.crm_company_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_invoices ci
    WHERE ci.workspace_id = ri.workspace_id
      AND ci.invoice_number = ri.invoice_number
  );

-- 4a. Type the pre-existing portal-path mirrors + stamp the back-link
UPDATE public.customer_invoices ci
SET invoice_type = 'rental', invoice_source_code = 'RENTAL'
FROM public.rental_invoices ri
WHERE ci.workspace_id = ri.workspace_id
  AND ci.invoice_number = ri.invoice_number
  AND ci.invoice_type = 'general';

UPDATE public.rental_invoices ri
SET customer_invoice_id = ci.id
FROM public.customer_invoices ci
WHERE ci.workspace_id = ri.workspace_id
  AND ci.invoice_number = ri.invoice_number
  AND ri.customer_invoice_id IS NULL
  AND ci.invoice_type = 'rental';

-- 4b. Type rental-ops deposit/extension invoices (no rental_invoices row)
UPDATE public.customer_invoices
SET invoice_type = 'rental', invoice_source_code = 'RENTAL'
WHERE invoice_type = 'general'
  AND description IN ('Rental deposit', 'Rental extension charge');

COMMIT;
