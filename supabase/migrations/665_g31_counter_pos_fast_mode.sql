-- ============================================================================
-- Migration 665: G3.1 Counter POS fast mode
--
-- Purpose:
--   Make the existing internal parts order spine act as the dedicated counter
--   POS ticket path by recording Cash/Charge classification, tender state, and
--   receipt evidence directly on parts_orders. Release is blocked until the
--   ticket is paid in full or has approved charge authority.
-- ============================================================================

BEGIN;

ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS payment_classification text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS charge_authorization_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS charge_authorized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charge_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS charge_authorization_note text,
  ADD COLUMN IF NOT EXISTS receipt_number text;

COMMENT ON COLUMN public.parts_orders.payment_classification IS
  'G3.1 Counter POS ticket class: cash requires pay-in-full before release; charge requires approved credit or AR-recorded executive approval.';
COMMENT ON COLUMN public.parts_orders.payment_status IS
  'G3.1 Counter POS tender state: unpaid, paid, or charge_account.';
COMMENT ON COLUMN public.parts_orders.charge_authorization_status IS
  'G3.1 Counter POS charge authority: approved_credit for normal account credit, exec_approved for AR-recorded cash-to-charge conversion.';
COMMENT ON COLUMN public.parts_orders.receipt_number IS
  'G3.1 Counter POS receipt number generated when a cash ticket is tendered or a charge ticket is authorized.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_orders_g31_payment_classification_ck'
      AND conrelid = 'public.parts_orders'::regclass
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_g31_payment_classification_ck CHECK (
        payment_classification IN ('cash', 'charge')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_orders_g31_payment_status_ck'
      AND conrelid = 'public.parts_orders'::regclass
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_g31_payment_status_ck CHECK (
        payment_status IN ('unpaid', 'paid', 'charge_account')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_orders_g31_charge_authorization_status_ck'
      AND conrelid = 'public.parts_orders'::regclass
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_g31_charge_authorization_status_ck CHECK (
        charge_authorization_status IN (
          'not_applicable',
          'approved_credit',
          'exec_approved',
          'pending_ar_approval',
          'denied'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_orders_g31_tender_shape_ck'
      AND conrelid = 'public.parts_orders'::regclass
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_g31_tender_shape_ck CHECK (
        (
          payment_classification = 'cash'
          AND payment_status IN ('unpaid', 'paid')
          AND charge_authorization_status = 'not_applicable'
        )
        OR (
          payment_classification = 'charge'
          AND payment_status = 'charge_account'
          AND charge_authorization_status IN (
            'approved_credit',
            'exec_approved',
            'pending_ar_approval',
            'denied'
          )
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_orders_g31_counter_release_ck'
      AND conrelid = 'public.parts_orders'::regclass
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_g31_counter_release_ck CHECK (
        order_source = 'portal'
        OR status IN ('draft', 'cancelled', 'canceled')
        OR (
          payment_classification = 'cash'
          AND payment_status = 'paid'
        )
        OR (
          payment_classification = 'charge'
          AND charge_authorization_status IN ('approved_credit', 'exec_approved')
        )
      ) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_parts_orders_g31_tender
  ON public.parts_orders (workspace_id, payment_classification, payment_status, charge_authorization_status)
  WHERE order_source <> 'portal';

CREATE UNIQUE INDEX IF NOT EXISTS parts_orders_g31_receipt_number_uidx
  ON public.parts_orders (workspace_id, receipt_number)
  WHERE receipt_number IS NOT NULL;

UPDATE public.qep_roadmap_tasks
SET ship_state = 'shipped',
    blocking_decision = NULL,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/665_g31_counter_pos_fast_mode.sql%'
        THEN evidence_link
      ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §2') ||
        ' | supabase/migrations/665_g31_counter_pos_fast_mode.sql'
    END,
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-07-02] G3.1 shipped%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-07-02] G3.1 shipped: Counter POS fast mode records Cash/Charge classification, tender state, receipt evidence, and release-blocking rules on the parts order spine.'
    END,
    updated_at = now()
WHERE task_id = 'G3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G3.1',
  'update',
  jsonb_build_object(
    'reason', 'g31_counter_pos_fast_mode_shipped',
    'migration', '665_g31_counter_pos_fast_mode.sql',
    'mission_alignment', 'gives parts counter staff a fast ticket-to-tender path while protecting corporate cash and charge controls'
  ),
  'codex'
);

COMMIT;
