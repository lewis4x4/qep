-- ============================================================================
-- Migration 670: G9.1 Cores, customer returns, vendor returns, warranty parts
--
-- Purpose:
--   Turn the Phase 3 cores/returns/warranty foundation tables into governed
--   policy surfaces: customer return eligibility, vendor-credit holds, RA
--   release, bidirectional core ledger movements, warranty evaluation, and
--   receipt policy text.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.parts_return_policy_receipt_text()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 'Parts returns: 30-day window; electrical parts are non-returnable; special-order returns and returns after 30 days carry a 25% restocking fee; special-order credits stay on vendor-credit hold until vendor credit is confirmed; warranty replacements are paid in full up front unless the customer waits for manufacturer credit.';
$$;

COMMENT ON FUNCTION public.parts_return_policy_receipt_text() IS
  'G9.1 receipt-safe policy text for parts returns, cores, vendor-credit holds, and warranty replacement timing.';

ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS return_policy_receipt_text text NOT NULL DEFAULT public.parts_return_policy_receipt_text();

COMMENT ON COLUMN public.parts_orders.return_policy_receipt_text IS
  'G9.1 parts receipt policy text printed with customer-facing counter/phone/email receipts.';

ALTER TABLE public.parts_order_lines
  ADD COLUMN IF NOT EXISTS return_is_special_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_is_electrical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_policy_receipt_text text NOT NULL DEFAULT public.parts_return_policy_receipt_text();

COMMENT ON COLUMN public.parts_order_lines.return_is_special_order IS
  'G9.1 return policy snapshot: special-order lines carry a 25% restocking fee and vendor-credit hold.';
COMMENT ON COLUMN public.parts_order_lines.return_is_electrical IS
  'G9.1 return policy snapshot: electrical parts are non-returnable unless policy changes through a future approved slice.';

ALTER TABLE public.customer_returns
  DROP CONSTRAINT IF EXISTS customer_returns_policy_code_check,
  DROP CONSTRAINT IF EXISTS customer_returns_status_check;

ALTER TABLE public.customer_returns
  ADD CONSTRAINT customer_returns_policy_code_check CHECK (
    policy_code IN (
      'standard_30_day',
      'late_return',
      'special_order',
      'electrical_non_returnable',
      'vendor_credit_hold',
      'manager_exception'
    )
  ),
  ADD CONSTRAINT customer_returns_status_check CHECK (
    status IN (
      'requested',
      'received',
      'inspection',
      'vendor_credit_hold',
      'approved',
      'rejected',
      'credited',
      'scrapped'
    )
  );

ALTER TABLE public.customer_returns
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sold_at timestamptz,
  ADD COLUMN IF NOT EXISTS eligible_until date,
  ADD COLUMN IF NOT EXISTS is_special_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_electrical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_credit_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_credit_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_line_total_cents bigint NOT NULL DEFAULT 0 CHECK (original_line_total_cents >= 0),
  ADD COLUMN IF NOT EXISTS requested_refund_cents bigint NOT NULL DEFAULT 0 CHECK (requested_refund_cents >= 0),
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'not_due',
  ADD COLUMN IF NOT EXISTS policy_receipt_text text NOT NULL DEFAULT public.parts_return_policy_receipt_text();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_returns_g91_refund_status_ck'
      AND conrelid = 'public.customer_returns'::regclass
  ) THEN
    ALTER TABLE public.customer_returns
      ADD CONSTRAINT customer_returns_g91_refund_status_ck CHECK (
        refund_status IN (
          'not_due',
          'blocked_vendor_credit',
          'pending',
          'credited',
          'rejected'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_returns_g91_policy_shape_ck'
      AND conrelid = 'public.customer_returns'::regclass
  ) THEN
    ALTER TABLE public.customer_returns
      ADD CONSTRAINT customer_returns_g91_policy_shape_ck CHECK (
        (
          is_electrical = false
          OR (
            policy_code = 'electrical_non_returnable'
            AND status = 'rejected'
            AND refund_cents = 0
            AND requested_refund_cents = 0
          )
        )
        AND (
          vendor_credit_required = false
          OR (
            policy_code = 'vendor_credit_hold'
            AND refund_status IN ('blocked_vendor_credit', 'credited', 'rejected')
          )
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_returns_g91_policy_queue
  ON public.customer_returns (workspace_id, status, refund_status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_returns_g91_vendor_hold
  ON public.customer_returns (workspace_id, vendor_credit_required, vendor_credit_confirmed_at)
  WHERE deleted_at IS NULL
    AND vendor_credit_required = true;

ALTER TABLE public.vendor_returns
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ra_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS ra_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_credit_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_credit_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_hold_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_customer_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS policy_receipt_text text NOT NULL DEFAULT public.parts_return_policy_receipt_text();

CREATE INDEX IF NOT EXISTS idx_vendor_returns_g91_credit_release
  ON public.vendor_returns (workspace_id, status, vendor_credit_confirmed_at, customer_return_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.core_ledger
  ADD COLUMN IF NOT EXISTS customer_return_id uuid REFERENCES public.customer_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_return_id uuid REFERENCES public.vendor_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parts_order_line_id uuid REFERENCES public.parts_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS core_charge_cents bigint NOT NULL DEFAULT 0 CHECK (core_charge_cents >= 0),
  ADD COLUMN IF NOT EXISTS core_credit_cents bigint NOT NULL DEFAULT 0 CHECK (core_credit_cents >= 0),
  ADD COLUMN IF NOT EXISTS settlement_reference text,
  ADD COLUMN IF NOT EXISTS policy_code text NOT NULL DEFAULT 'core_exchange';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'core_ledger_g91_policy_code_ck'
      AND conrelid = 'public.core_ledger'::regclass
  ) THEN
    ALTER TABLE public.core_ledger
      ADD CONSTRAINT core_ledger_g91_policy_code_ck CHECK (
        policy_code IN (
          'core_exchange',
          'customer_core_credit',
          'vendor_core_credit',
          'vendor_ra',
          'write_off',
          'manual_adjustment'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'core_ledger_g91_bidirectional_amount_ck'
      AND conrelid = 'public.core_ledger'::regclass
  ) THEN
    ALTER TABLE public.core_ledger
      ADD CONSTRAINT core_ledger_g91_bidirectional_amount_ck CHECK (
        (
          direction IN ('customer_owes_qep', 'qep_owes_customer')
          AND core_charge_cents >= 0
          AND core_credit_cents >= 0
        )
        OR (
          direction IN ('qep_owes_vendor', 'vendor_owes_qep', 'settled')
          AND core_charge_cents >= 0
          AND core_credit_cents >= 0
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_core_ledger_g91_customer_return
  ON public.core_ledger (workspace_id, customer_return_id, status)
  WHERE customer_return_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_core_ledger_g91_vendor_return
  ON public.core_ledger (workspace_id, vendor_return_id, status)
  WHERE vendor_return_id IS NOT NULL;

ALTER TABLE public.warranty_claims
  ADD COLUMN IF NOT EXISTS manufacturer_evaluation_status text NOT NULL DEFAULT 'required',
  ADD COLUMN IF NOT EXISTS manufacturer_evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS manufacturer_credit_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS replacement_parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replacement_paid_up_front boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_waits_for_credit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certified_technician_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS certified_technician_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_warranty_advisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_runner_role text NOT NULL DEFAULT 'parts_department';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warranty_claims_g91_manufacturer_eval_ck'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_g91_manufacturer_eval_ck CHECK (
        manufacturer_evaluation_status IN (
          'required',
          'submitted',
          'approved',
          'partial_credit',
          'denied',
          'not_required'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warranty_claims_g91_runner_role_ck'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_g91_runner_role_ck CHECK (
        claim_runner_role IN ('parts_department', 'warranty_advisor')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warranty_claims_g91_replacement_policy_ck'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_g91_replacement_policy_ck CHECK (
        replacement_paid_up_front = false
        OR customer_waits_for_credit = false
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warranty_claims_g91_credit_after_evaluation_ck'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_g91_credit_after_evaluation_ck CHECK (
        claim_scope <> 'parts'
        OR approved_amount_cents IS NULL
        OR manufacturer_evaluation_status IN ('approved', 'partial_credit')
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_warranty_claims_g91_parts_eval
  ON public.warranty_claims (workspace_id, claim_scope, manufacturer_evaluation_status, updated_at DESC)
  WHERE claim_scope = 'parts';

CREATE INDEX IF NOT EXISTS idx_warranty_claims_g91_advisor
  ON public.warranty_claims (workspace_id, assigned_warranty_advisor_id, status)
  WHERE assigned_warranty_advisor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.parts_evaluate_customer_return_policy(
  p_sold_at timestamptz DEFAULT NULL,
  p_requested_at timestamptz DEFAULT now(),
  p_quantity numeric DEFAULT 1,
  p_unit_price_cents bigint DEFAULT 0,
  p_is_electrical boolean DEFAULT false,
  p_is_special_order boolean DEFAULT false,
  p_manager_exception boolean DEFAULT false
)
RETURNS TABLE (
  policy_code text,
  return_status text,
  eligible boolean,
  restocking_fee_cents bigint,
  refund_cents bigint,
  vendor_credit_required boolean,
  eligible_until date,
  policy_receipt_text text
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_requested_at timestamptz := COALESCE(p_requested_at, now());
  v_quantity numeric := GREATEST(COALESCE(p_quantity, 1), 0);
  v_original_cents bigint := GREATEST(ROUND((COALESCE(p_unit_price_cents, 0)::numeric * GREATEST(COALESCE(p_quantity, 1), 0)))::bigint, 0);
  v_fee_cents bigint := 0;
  v_late boolean := false;
  v_policy text := 'standard_30_day';
  v_status text := 'approved';
  v_eligible boolean := true;
  v_vendor_credit_required boolean := false;
  v_eligible_until date := NULL;
BEGIN
  IF p_sold_at IS NOT NULL THEN
    v_eligible_until := (p_sold_at::date + 30);
    v_late := v_requested_at::date > v_eligible_until;
  ELSE
    v_status := 'inspection';
  END IF;

  IF p_is_electrical THEN
    v_policy := 'electrical_non_returnable';
    v_status := 'rejected';
    v_eligible := false;
    v_fee_cents := 0;
    v_original_cents := 0;
  ELSIF p_is_special_order THEN
    v_policy := 'vendor_credit_hold';
    v_status := 'vendor_credit_hold';
    v_vendor_credit_required := true;
    v_fee_cents := ROUND(v_original_cents::numeric * 0.25)::bigint;
  ELSIF v_late THEN
    v_policy := 'late_return';
    v_status := 'approved';
    v_fee_cents := ROUND(v_original_cents::numeric * 0.25)::bigint;
  ELSIF p_manager_exception THEN
    v_policy := 'manager_exception';
    v_status := 'inspection';
  END IF;

  policy_code := v_policy;
  return_status := v_status;
  eligible := v_eligible;
  restocking_fee_cents := v_fee_cents;
  refund_cents := GREATEST(v_original_cents - v_fee_cents, 0);
  vendor_credit_required := v_vendor_credit_required;
  eligible_until := v_eligible_until;
  policy_receipt_text := public.parts_return_policy_receipt_text();
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.parts_evaluate_customer_return_policy(timestamptz, timestamptz, numeric, bigint, boolean, boolean, boolean) IS
  'G9.1 deterministic customer-return policy: 30-day window, electrical non-returnable, 25% late/special-order restocking fee, and vendor-credit hold for special orders.';

REVOKE ALL ON FUNCTION public.parts_evaluate_customer_return_policy(timestamptz, timestamptz, numeric, bigint, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_evaluate_customer_return_policy(timestamptz, timestamptz, numeric, bigint, boolean, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_create_customer_return(
  p_return_number text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_parts_order_id uuid DEFAULT NULL,
  p_parts_order_line_id uuid DEFAULT NULL,
  p_part_id uuid DEFAULT NULL,
  p_part_number text DEFAULT NULL,
  p_quantity numeric DEFAULT 1,
  p_reason text DEFAULT NULL,
  p_requested_at timestamptz DEFAULT now(),
  p_sold_at timestamptz DEFAULT NULL,
  p_unit_price_cents bigint DEFAULT NULL,
  p_is_special_order boolean DEFAULT NULL,
  p_is_electrical boolean DEFAULT NULL,
  p_manager_exception boolean DEFAULT false,
  p_notes text DEFAULT NULL
)
RETURNS public.customer_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_return_number text := NULLIF(btrim(COALESCE(p_return_number, '')), '');
  v_customer_id uuid := p_customer_id;
  v_parts_order_id uuid := p_parts_order_id;
  v_part_id uuid := p_part_id;
  v_part_number text := NULLIF(btrim(COALESCE(p_part_number, '')), '');
  v_quantity numeric := GREATEST(COALESCE(p_quantity, 1), 0);
  v_sold_at timestamptz := p_sold_at;
  v_unit_price_cents bigint := COALESCE(p_unit_price_cents, 0);
  v_original_line_total_cents bigint := 0;
  v_is_special_order boolean := COALESCE(p_is_special_order, false);
  v_is_electrical boolean := COALESCE(p_is_electrical, false);
  v_order record;
  v_line record;
  v_policy record;
  v_return public.customer_returns%ROWTYPE;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to create customer returns' USING ERRCODE = '42501';
  END IF;

  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF p_parts_order_line_id IS NOT NULL THEN
    SELECT
      l.id,
      l.workspace_id,
      l.parts_order_id,
      l.part_id,
      l.catalog_item_id,
      l.part_number,
      l.description,
      l.quantity,
      l.unit_price,
      l.final_unit_price,
      l.line_total,
      l.return_is_special_order,
      l.return_is_electrical,
      l.pricing_metadata,
      o.customer_id,
      o.created_at AS order_created_at,
      o.po_type,
      o.order_source,
      o.metadata AS order_metadata,
      p.parts_catalog_id,
      p.category AS phase3_category,
      p.metadata AS phase3_metadata,
      pc.category AS catalog_category
    INTO v_line
    FROM public.parts_order_lines l
    JOIN public.parts_orders o ON o.id = l.parts_order_id
    LEFT JOIN public.parts p ON p.id = l.part_id
    LEFT JOIN public.parts_catalog pc ON pc.id = COALESCE(l.catalog_item_id, p.parts_catalog_id)
    WHERE l.id = p_parts_order_line_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parts_order_line_id % not found', p_parts_order_line_id USING ERRCODE = '23503';
    END IF;

    IF v_line.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'parts order line belongs to a different workspace' USING ERRCODE = '42501';
    END IF;

    v_parts_order_id := COALESCE(v_parts_order_id, v_line.parts_order_id);
    v_customer_id := COALESCE(v_customer_id, v_line.customer_id);
    v_part_id := COALESCE(v_part_id, v_line.part_id);
    v_part_number := COALESCE(v_part_number, v_line.part_number);
    v_quantity := LEAST(v_quantity, COALESCE(v_line.quantity, v_quantity));
    v_sold_at := COALESCE(v_sold_at, v_line.order_created_at);
    v_unit_price_cents := COALESCE(
      p_unit_price_cents,
      ROUND((COALESCE(v_line.final_unit_price, v_line.unit_price, 0)::numeric * 100.0))::bigint,
      0
    );
    v_is_special_order := COALESCE(
      p_is_special_order,
      v_line.return_is_special_order,
      lower(COALESCE(v_line.po_type, '')) = 'special_order',
      COALESCE((v_line.order_metadata ->> 'special_order')::boolean, false),
      COALESCE((v_line.pricing_metadata ->> 'special_order')::boolean, false),
      false
    );
    v_is_electrical := COALESCE(
      p_is_electrical,
      v_line.return_is_electrical,
      lower(COALESCE(v_line.phase3_category, '')) LIKE '%electrical%',
      lower(COALESCE(v_line.catalog_category, '')) LIKE '%electrical%',
      lower(COALESCE(v_line.phase3_metadata ->> 'system', '')) = 'electrical',
      lower(COALESCE(v_line.description, '')) LIKE '%electrical%',
      false
    );
  ELSIF p_parts_order_id IS NOT NULL THEN
    SELECT id, workspace_id, customer_id, created_at, po_type, metadata
    INTO v_order
    FROM public.parts_orders
    WHERE id = p_parts_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parts_order_id % not found', p_parts_order_id USING ERRCODE = '23503';
    END IF;

    IF v_order.workspace_id <> v_workspace_id THEN
      RAISE EXCEPTION 'parts order belongs to a different workspace' USING ERRCODE = '42501';
    END IF;

    v_customer_id := COALESCE(v_customer_id, v_order.customer_id);
    v_sold_at := COALESCE(v_sold_at, v_order.created_at);
    v_is_special_order := COALESCE(
      p_is_special_order,
      lower(COALESCE(v_order.po_type, '')) = 'special_order',
      COALESCE((v_order.metadata ->> 'special_order')::boolean, false),
      false
    );
  END IF;

  IF v_part_number IS NULL AND v_part_id IS NOT NULL THEN
    SELECT part_number
    INTO v_part_number
    FROM public.parts
    WHERE id = v_part_id
      AND workspace_id = v_workspace_id
      AND deleted_at IS NULL;
  END IF;

  v_return_number := COALESCE(
    v_return_number,
    'RET-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8))
  );
  v_original_line_total_cents := GREATEST(ROUND((v_unit_price_cents::numeric * v_quantity))::bigint, 0);

  SELECT *
  INTO v_policy
  FROM public.parts_evaluate_customer_return_policy(
    v_sold_at,
    p_requested_at,
    v_quantity,
    v_unit_price_cents,
    v_is_electrical,
    v_is_special_order,
    COALESCE(p_manager_exception, false)
  );

  INSERT INTO public.customer_returns (
    workspace_id,
    return_number,
    customer_id,
    parts_order_id,
    parts_order_line_id,
    part_id,
    part_number,
    quantity,
    reason,
    policy_code,
    status,
    restocking_fee_cents,
    refund_cents,
    requested_at,
    sold_at,
    eligible_until,
    is_special_order,
    is_electrical,
    vendor_credit_required,
    original_line_total_cents,
    requested_refund_cents,
    refund_status,
    policy_receipt_text,
    notes,
    metadata
  )
  VALUES (
    v_workspace_id,
    v_return_number,
    v_customer_id,
    v_parts_order_id,
    p_parts_order_line_id,
    v_part_id,
    v_part_number,
    v_quantity,
    p_reason,
    v_policy.policy_code,
    v_policy.return_status,
    v_policy.restocking_fee_cents,
    v_policy.refund_cents,
    COALESCE(p_requested_at, now()),
    v_sold_at,
    v_policy.eligible_until,
    v_is_special_order,
    v_is_electrical,
    v_policy.vendor_credit_required,
    v_original_line_total_cents,
    v_policy.refund_cents,
    CASE
      WHEN v_policy.return_status = 'rejected' THEN 'rejected'
      WHEN v_policy.vendor_credit_required THEN 'blocked_vendor_credit'
      WHEN v_policy.refund_cents > 0 THEN 'pending'
      ELSE 'not_due'
    END,
    v_policy.policy_receipt_text,
    p_notes,
    jsonb_build_object(
      'policy_version', 'G9.1',
      'eligible', v_policy.eligible,
      'manager_exception', COALESCE(p_manager_exception, false),
      'source', 'parts_create_customer_return'
    )
  )
  RETURNING * INTO v_return;

  RETURN v_return;
END;
$$;

COMMENT ON FUNCTION public.parts_create_customer_return(text, uuid, uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, bigint, boolean, boolean, boolean, text) IS
  'G9.1 governed customer-return creator: applies 30-day/electrical/special-order/vendor-credit policy and writes receipt text.';

REVOKE ALL ON FUNCTION public.parts_create_customer_return(text, uuid, uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, bigint, boolean, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_create_customer_return(text, uuid, uuid, uuid, uuid, text, numeric, text, timestamptz, timestamptz, bigint, boolean, boolean, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_confirm_vendor_return_credit(
  p_vendor_return_id uuid,
  p_credit_received_cents bigint,
  p_confirmed_by uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.vendor_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_confirmed_by uuid := COALESCE(p_confirmed_by, (select auth.uid()));
  v_vendor_return public.vendor_returns%ROWTYPE;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to confirm vendor return credit' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_vendor_return
  FROM public.vendor_returns
  WHERE id = p_vendor_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_return_id % not found', p_vendor_return_id USING ERRCODE = '23503';
  END IF;

  IF v_vendor_return.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'vendor return belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  UPDATE public.vendor_returns
  SET
    status = 'credited',
    credit_received_cents = GREATEST(COALESCE(p_credit_received_cents, 0), 0),
    credited_at = now(),
    vendor_credit_confirmed_at = now(),
    vendor_credit_confirmed_by = v_confirmed_by,
    release_customer_credit = true,
    customer_hold_released_at = CASE
      WHEN customer_return_id IS NULL THEN customer_hold_released_at
      ELSE COALESCE(customer_hold_released_at, now())
    END,
    notes = CASE
      WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN notes
      ELSE COALESCE(notes || E'\n', '') || p_note
    END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'policy_version', 'G9.1',
      'credit_release_source', 'parts_confirm_vendor_return_credit',
      'customer_hold_released', customer_return_id IS NOT NULL
    ),
    updated_at = now()
  WHERE id = p_vendor_return_id
  RETURNING * INTO v_vendor_return;

  IF v_vendor_return.customer_return_id IS NOT NULL THEN
    UPDATE public.customer_returns
    SET
      status = CASE
        WHEN status = 'vendor_credit_hold' THEN 'credited'
        ELSE status
      END,
      refund_status = CASE
        WHEN refund_status = 'blocked_vendor_credit' THEN 'credited'
        ELSE refund_status
      END,
      vendor_credit_confirmed_at = COALESCE(vendor_credit_confirmed_at, now()),
      resolved_at = COALESCE(resolved_at, now()),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'policy_version', 'G9.1',
        'vendor_return_id', v_vendor_return.id,
        'vendor_credit_received_cents', v_vendor_return.credit_received_cents,
        'vendor_credit_released_at', v_vendor_return.vendor_credit_confirmed_at
      ),
      updated_at = now()
    WHERE id = v_vendor_return.customer_return_id
      AND workspace_id = v_workspace_id;
  END IF;

  RETURN v_vendor_return;
END;
$$;

COMMENT ON FUNCTION public.parts_confirm_vendor_return_credit(uuid, bigint, uuid, text) IS
  'G9.1 vendor RA completion: confirming vendor credit releases linked special-order customer-return holds.';

REVOKE ALL ON FUNCTION public.parts_confirm_vendor_return_credit(uuid, bigint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_confirm_vendor_return_credit(uuid, bigint, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_record_core_ledger_movement(
  p_movement_type text,
  p_direction text,
  p_amount_cents bigint,
  p_quantity numeric DEFAULT 1,
  p_part_id uuid DEFAULT NULL,
  p_part_number text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_vendor_id uuid DEFAULT NULL,
  p_parts_order_id uuid DEFAULT NULL,
  p_parts_order_line_id uuid DEFAULT NULL,
  p_customer_return_id uuid DEFAULT NULL,
  p_vendor_return_id uuid DEFAULT NULL,
  p_purchase_order_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_settlement_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS public.core_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_amount_cents bigint := GREATEST(COALESCE(p_amount_cents, 0), 0);
  v_core_charge_cents bigint := 0;
  v_core_credit_cents bigint := 0;
  v_status text := 'open';
  v_policy_code text := 'core_exchange';
  v_entry public.core_ledger%ROWTYPE;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to record core ledger movements' USING ERRCODE = '42501';
  END IF;

  IF p_movement_type NOT IN (
    'core_sold',
    'customer_core_returned',
    'vendor_core_returned',
    'vendor_credit_received',
    'customer_credit_issued',
    'write_off',
    'adjustment'
  ) THEN
    RAISE EXCEPTION 'unsupported core movement_type %', p_movement_type USING ERRCODE = '22023';
  END IF;

  IF p_direction NOT IN (
    'customer_owes_qep',
    'qep_owes_customer',
    'qep_owes_vendor',
    'vendor_owes_qep',
    'settled'
  ) THEN
    RAISE EXCEPTION 'unsupported core direction %', p_direction USING ERRCODE = '22023';
  END IF;

  IF p_direction = 'customer_owes_qep' THEN
    v_core_charge_cents := v_amount_cents;
  ELSE
    v_core_credit_cents := v_amount_cents;
  END IF;

  IF p_movement_type IN ('vendor_credit_received', 'customer_credit_issued') THEN
    v_status := 'settled';
  ELSIF p_movement_type = 'vendor_core_returned' THEN
    v_status := 'pending_vendor_credit';
  ELSIF p_movement_type = 'write_off' THEN
    v_status := 'written_off';
    v_policy_code := 'write_off';
  END IF;

  v_policy_code := CASE
    WHEN p_movement_type = 'customer_core_returned' THEN 'customer_core_credit'
    WHEN p_movement_type IN ('vendor_core_returned', 'vendor_credit_received') THEN 'vendor_core_credit'
    WHEN p_vendor_return_id IS NOT NULL THEN 'vendor_ra'
    WHEN p_movement_type = 'adjustment' THEN 'manual_adjustment'
    ELSE v_policy_code
  END;

  INSERT INTO public.core_ledger (
    workspace_id,
    part_id,
    part_number,
    customer_id,
    vendor_id,
    parts_order_id,
    purchase_order_id,
    movement_type,
    direction,
    quantity,
    amount_cents,
    status,
    reference_number,
    notes,
    created_by,
    customer_return_id,
    vendor_return_id,
    parts_order_line_id,
    core_charge_cents,
    core_credit_cents,
    settlement_reference,
    policy_code,
    metadata
  )
  VALUES (
    v_workspace_id,
    p_part_id,
    NULLIF(btrim(COALESCE(p_part_number, '')), ''),
    p_customer_id,
    p_vendor_id,
    p_parts_order_id,
    p_purchase_order_id,
    p_movement_type,
    p_direction,
    GREATEST(COALESCE(p_quantity, 1), 0),
    v_amount_cents,
    v_status,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    p_notes,
    p_created_by,
    p_customer_return_id,
    p_vendor_return_id,
    p_parts_order_line_id,
    v_core_charge_cents,
    v_core_credit_cents,
    NULLIF(btrim(COALESCE(p_settlement_reference, '')), ''),
    v_policy_code,
    jsonb_build_object(
      'policy_version', 'G9.1',
      'source', 'parts_record_core_ledger_movement'
    )
  )
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

COMMENT ON FUNCTION public.parts_record_core_ledger_movement(text, text, bigint, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) IS
  'G9.1 bidirectional core ledger RPC for customer core charges/credits, vendor core returns, vendor credit receipt, write-off, and manual adjustment movements.';

REVOKE ALL ON FUNCTION public.parts_record_core_ledger_movement(text, text, bigint, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_record_core_ledger_movement(text, text, bigint, numeric, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_apply_warranty_replacement_policy(
  p_warranty_claim_id uuid,
  p_customer_needs_replacement_now boolean DEFAULT true,
  p_certified_technician_id uuid DEFAULT NULL,
  p_assigned_warranty_advisor_id uuid DEFAULT NULL,
  p_replacement_parts_order_id uuid DEFAULT NULL
)
RETURNS public.warranty_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_claim public.warranty_claims%ROWTYPE;
  v_replacement_policy text := CASE
    WHEN COALESCE(p_customer_needs_replacement_now, true) THEN 'paid_up_front'
    ELSE 'order_after_credit'
  END;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to apply warranty replacement policy' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.warranty_claims
  WHERE id = p_warranty_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'warranty_claim_id % not found', p_warranty_claim_id USING ERRCODE = '23503';
  END IF;

  IF v_claim.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'warranty claim belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  IF v_claim.claim_scope = 'service'
     AND COALESCE(p_certified_technician_id, v_claim.certified_technician_id) IS NULL THEN
    RAISE EXCEPTION 'service warranties require certified technician confirmation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.warranty_claims
  SET
    evaluation_required = true,
    manufacturer_evaluation_status = CASE
      WHEN manufacturer_evaluation_status IN ('approved', 'partial_credit', 'denied') THEN manufacturer_evaluation_status
      ELSE 'required'
    END,
    replacement_policy = v_replacement_policy,
    replacement_paid_up_front = COALESCE(p_customer_needs_replacement_now, true),
    customer_waits_for_credit = NOT COALESCE(p_customer_needs_replacement_now, true),
    certified_technician_id = COALESCE(p_certified_technician_id, certified_technician_id),
    certified_technician_confirmed_at = CASE
      WHEN COALESCE(p_certified_technician_id, certified_technician_id) IS NULL THEN certified_technician_confirmed_at
      ELSE COALESCE(certified_technician_confirmed_at, now())
    END,
    assigned_warranty_advisor_id = COALESCE(p_assigned_warranty_advisor_id, assigned_warranty_advisor_id),
    claim_runner_role = CASE
      WHEN COALESCE(p_assigned_warranty_advisor_id, assigned_warranty_advisor_id) IS NULL THEN 'parts_department'
      ELSE 'warranty_advisor'
    END,
    replacement_parts_order_id = COALESCE(p_replacement_parts_order_id, replacement_parts_order_id),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'policy_version', 'G9.1',
      'manufacturer_evaluation_required_before_credit', true,
      'replacement_paid_up_front_if_needed_now', COALESCE(p_customer_needs_replacement_now, true),
      'service_certified_technician_required', claim_scope = 'service'
    ),
    updated_at = now()
  WHERE id = p_warranty_claim_id
  RETURNING * INTO v_claim;

  RETURN v_claim;
END;
$$;

COMMENT ON FUNCTION public.parts_apply_warranty_replacement_policy(uuid, boolean, uuid, uuid, uuid) IS
  'G9.1 warranty policy RPC: manufacturer evaluation before credit, paid-up-front replacement when needed now, wait-for-credit option, service technician confirmation, and Parts/Warranty Advisor ownership.';

REVOKE ALL ON FUNCTION public.parts_apply_warranty_replacement_policy(uuid, boolean, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_apply_warranty_replacement_policy(uuid, boolean, uuid, uuid, uuid) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/677_g91_cores_returns_warranty_parts.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.9, §1.10, §1.11') ||
      ' | supabase/migrations/677_g91_cores_returns_warranty_parts.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G9.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G9.1 shipped: Core movements, customer returns, special-order vendor-credit holds, vendor RA credit release, and warranty replacement policy now have governed database/RPC contracts with receipt policy text.'
  END,
  updated_at = now()
WHERE task_id = 'G9.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G9.1',
  'update',
  jsonb_build_object(
    'reason', 'g91_cores_returns_warranty_parts_shipped',
    'migration', '677_g91_cores_returns_warranty_parts.sql',
    'mission_alignment', 'pass: parts employees get deterministic returns, cores, vendor RA, and warranty rules while corporate operations can audit holds, credits, and replacement-payment timing'
  ),
  'codex'
);

COMMIT;
