-- ============================================================================
-- Migration 668: G7.1 Parts quotes + phone/email order capture
--
-- Purpose:
--   Turn the existing parts quote tables into a short-lived, priced quote
--   contract that can convert into a tracked counter/phone/email parts order
--   without re-keying quote lines. Phone/email captures inherit the G3.1 cash
--   up-front release rules and include freight in the order total.
-- ============================================================================

BEGIN;

ALTER TABLE public.parts_quotes
  ADD COLUMN IF NOT EXISTS quote_source text NOT NULL DEFAULT 'counter',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS freight_estimate_cents bigint NOT NULL DEFAULT 0 CHECK (freight_estimate_cents >= 0),
  ADD COLUMN IF NOT EXISTS freight_estimate_source text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_rule text NOT NULL DEFAULT 'cash_up_front_including_freight',
  ADD COLUMN IF NOT EXISTS converted_parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_to_order_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_channel text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.parts_quotes
SET expires_at = coalesce(expiry_date::timestamptz, created_at + interval '7 days')
WHERE expires_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_quotes_g71_quote_source_ck'
      AND conrelid = 'public.parts_quotes'::regclass
  ) THEN
    ALTER TABLE public.parts_quotes
      ADD CONSTRAINT parts_quotes_g71_quote_source_ck
      CHECK (quote_source IN ('counter', 'phone', 'email', 'walkin', 'service', 'online')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_quotes_g71_freight_source_ck'
      AND conrelid = 'public.parts_quotes'::regclass
  ) THEN
    ALTER TABLE public.parts_quotes
      ADD CONSTRAINT parts_quotes_g71_freight_source_ck
      CHECK (freight_estimate_source IN ('vendor_estimate', 'staff_estimate', 'not_required', 'unknown')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_quotes_g71_payment_rule_ck'
      AND conrelid = 'public.parts_quotes'::regclass
  ) THEN
    ALTER TABLE public.parts_quotes
      ADD CONSTRAINT parts_quotes_g71_payment_rule_ck
      CHECK (payment_rule = 'cash_up_front_including_freight') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_quotes_g71_conversion_channel_ck'
      AND conrelid = 'public.parts_quotes'::regclass
  ) THEN
    ALTER TABLE public.parts_quotes
      ADD CONSTRAINT parts_quotes_g71_conversion_channel_ck
      CHECK (conversion_channel IS NULL OR conversion_channel IN ('counter_sale', 'parts_order')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.parts_orders
  DROP CONSTRAINT IF EXISTS parts_orders_order_source_check;

ALTER TABLE public.parts_orders
  ADD CONSTRAINT parts_orders_order_source_check
  CHECK (
    order_source IN (
      'portal',
      'counter',
      'phone',
      'email',
      'online',
      'transfer',
      'voice',
      'photo',
      'predictive',
      'auto_replenish'
    )
  );

ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS originating_parts_quote_id uuid REFERENCES public.parts_quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_parts_quotes_g71_expiring
  ON public.parts_quotes (workspace_id, expires_at, status)
  WHERE deleted_at IS NULL
    AND converted_parts_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_quotes_g71_converted_order
  ON public.parts_quotes (workspace_id, converted_parts_order_id)
  WHERE converted_parts_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parts_orders_originating_quote
  ON public.parts_orders (workspace_id, originating_parts_quote_id)
  WHERE originating_parts_quote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.parts_quotes_enforce_customer_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.qrm_companies c
      WHERE c.id = NEW.customer_id
        AND c.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'customer_id must reference a company in the same workspace';
    END IF;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.qrm_contacts c
      WHERE c.id = NEW.contact_id
        AND c.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'contact_id must reference a contact in the same workspace';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_quotes_enforce_customer_workspace_trg ON public.parts_quotes;
CREATE TRIGGER parts_quotes_enforce_customer_workspace_trg
  BEFORE INSERT OR UPDATE OF customer_id, contact_id, workspace_id
  ON public.parts_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.parts_quotes_enforce_customer_workspace();

CREATE OR REPLACE FUNCTION public.parts_quote_lines_sync_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text;
BEGIN
  SELECT q.workspace_id
  INTO v_workspace_id
  FROM public.parts_quotes q
  WHERE q.id = NEW.parts_quote_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'parts_quote not found for parts_quote_lines';
  END IF;

  NEW.workspace_id := v_workspace_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_quote_lines_sync_workspace_trg ON public.parts_quote_lines;
CREATE TRIGGER parts_quote_lines_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF parts_quote_id
  ON public.parts_quote_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.parts_quote_lines_sync_workspace();

DROP POLICY IF EXISTS parts_quotes_g71_parts_operator ON public.parts_quotes;
CREATE POLICY parts_quotes_g71_parts_operator
  ON public.parts_quotes FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP POLICY IF EXISTS parts_quote_lines_g71_parts_operator ON public.parts_quote_lines;
CREATE POLICY parts_quote_lines_g71_parts_operator
  ON public.parts_quote_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP POLICY IF EXISTS parts_orders_g71_parts_operator ON public.parts_orders;
CREATE POLICY parts_orders_g71_parts_operator
  ON public.parts_orders FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP POLICY IF EXISTS parts_order_lines_g71_parts_operator ON public.parts_order_lines;
CREATE POLICY parts_order_lines_g71_parts_operator
  ON public.parts_order_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP POLICY IF EXISTS parts_order_events_g71_parts_operator_insert ON public.parts_order_events;
CREATE POLICY parts_order_events_g71_parts_operator_insert
  ON public.parts_order_events FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

CREATE OR REPLACE FUNCTION public.parts_convert_quote_to_order(
  p_parts_quote_id uuid,
  p_crm_company_id uuid,
  p_order_source text DEFAULT NULL,
  p_payment_classification text DEFAULT 'cash',
  p_created_by uuid DEFAULT NULL,
  p_workspace_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := coalesce(nullif(btrim(p_workspace_id), ''), public.get_my_workspace());
  v_quote public.parts_quotes%ROWTYPE;
  v_order_source text;
  v_payment_classification text := lower(coalesce(nullif(btrim(p_payment_classification), ''), 'cash'));
  v_payment_status text;
  v_charge_authorization_status text;
  v_line_items jsonb;
  v_line_count integer;
  v_subtotal_cents bigint;
  v_discount_cents bigint;
  v_tax_cents bigint;
  v_freight_cents bigint;
  v_total_cents bigint;
  v_order_id uuid;
BEGIN
  IF p_parts_quote_id IS NULL THEN
    RAISE EXCEPTION 'parts_quote_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_crm_company_id IS NULL THEN
    RAISE EXCEPTION 'crm_company_id is required to convert a parts quote to an order' USING ERRCODE = '22023';
  END IF;
  IF v_payment_classification NOT IN ('cash', 'charge') THEN
    RAISE EXCEPTION 'payment_classification must be cash or charge' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.parts_quotes q
  WHERE q.id = p_parts_quote_id
    AND q.workspace_id = v_workspace_id
    AND q.deleted_at IS NULL
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'parts quote not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.converted_parts_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'parts quote has already been converted' USING ERRCODE = '23505';
  END IF;
  IF coalesce(v_quote.expires_at, v_quote.expiry_date::timestamptz, v_quote.created_at + interval '7 days') < now() THEN
    UPDATE public.parts_quotes
    SET status = 'expired'
    WHERE id = v_quote.id;
    RAISE EXCEPTION 'parts quote is expired' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_companies c
    WHERE c.id = p_crm_company_id
      AND c.workspace_id = v_workspace_id
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'crm_company_id must reference a company in the same workspace' USING ERRCODE = '23503';
  END IF;

  SELECT
    count(*)::integer,
    coalesce(sum(l.extended_price_cents), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'part_number', l.part_number,
          'description', l.description,
          'quantity', l.qty,
          'unit_price', round((l.unit_price_cents::numeric / 100.0), 4),
          'is_ai_suggested', false
        )
        ORDER BY l.sort_order
      ),
      '[]'::jsonb
    )
  INTO v_line_count, v_subtotal_cents, v_line_items
  FROM public.parts_quote_lines l
  WHERE l.workspace_id = v_workspace_id
    AND l.parts_quote_id = v_quote.id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'parts quote must have at least one line before conversion' USING ERRCODE = '22023';
  END IF;

  v_order_source := lower(coalesce(nullif(btrim(p_order_source), ''), nullif(btrim(v_quote.quote_source), ''), 'phone'));
  IF v_order_source = 'walkin' THEN
    v_order_source := 'counter';
  END IF;
  IF v_order_source NOT IN ('counter', 'phone', 'email', 'online', 'transfer') THEN
    v_order_source := 'phone';
  END IF;

  v_discount_cents := greatest(coalesce(v_quote.discount_cents, 0), 0);
  v_tax_cents := greatest(coalesce(v_quote.tax_cents, 0), 0);
  v_freight_cents := greatest(coalesce(v_quote.freight_estimate_cents, 0), 0);
  v_total_cents := greatest(v_subtotal_cents - v_discount_cents + v_tax_cents + v_freight_cents, 0);
  v_payment_status := CASE WHEN v_payment_classification = 'cash' THEN 'unpaid' ELSE 'charge_account' END;
  v_charge_authorization_status := CASE
    WHEN v_payment_classification = 'cash' THEN 'not_applicable'
    ELSE 'pending_credit_check'
  END;

  INSERT INTO public.parts_orders (
    workspace_id,
    status,
    portal_customer_id,
    crm_company_id,
    customer_id,
    order_source,
    created_by,
    notes,
    line_items,
    subtotal,
    tax,
    shipping,
    total,
    freight_charge_cents,
    po_total_cents,
    payment_classification,
    payment_status,
    charge_authorization_status,
    originating_parts_quote_id
  )
  VALUES (
    v_workspace_id,
    'draft',
    NULL,
    p_crm_company_id,
    v_quote.customer_id,
    v_order_source,
    p_created_by,
    v_quote.notes,
    v_line_items,
    round((v_subtotal_cents::numeric / 100.0), 2),
    round((v_tax_cents::numeric / 100.0), 2),
    round((v_freight_cents::numeric / 100.0), 2),
    round((v_total_cents::numeric / 100.0), 2),
    v_freight_cents,
    v_total_cents,
    v_payment_classification,
    v_payment_status,
    v_charge_authorization_status,
    v_quote.id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.parts_order_lines (
    workspace_id,
    parts_order_id,
    catalog_item_id,
    part_number,
    description,
    quantity,
    unit_price,
    line_total,
    sort_order
  )
  SELECT
    v_workspace_id,
    v_order_id,
    l.part_catalog_id,
    l.part_number,
    l.description,
    l.qty,
    round((l.unit_price_cents::numeric / 100.0), 4),
    round((l.extended_price_cents::numeric / 100.0), 4),
    l.sort_order
  FROM public.parts_quote_lines l
  WHERE l.workspace_id = v_workspace_id
    AND l.parts_quote_id = v_quote.id
  ORDER BY l.sort_order;

  UPDATE public.parts_quotes
  SET
    status = 'converted',
    converted_parts_order_id = v_order_id,
    converted_to_order_at = now(),
    conversion_channel = CASE WHEN v_order_source = 'counter' THEN 'counter_sale' ELSE 'parts_order' END,
    converted_at = coalesce(converted_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'converted_via', 'parts_convert_quote_to_order',
      'order_source', v_order_source,
      'payment_rule', 'cash_up_front_including_freight'
    )
  WHERE id = v_quote.id;

  INSERT INTO public.parts_order_events (
    workspace_id,
    parts_order_id,
    event_type,
    source,
    actor_id,
    from_status,
    to_status,
    metadata
  )
  VALUES (
    v_workspace_id,
    v_order_id,
    'quote_converted',
    'manual',
    p_created_by,
    NULL,
    'draft',
    jsonb_build_object(
      'parts_quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'order_source', v_order_source,
      'line_count', v_line_count,
      'freight_estimate_cents', v_freight_cents,
      'payment_rule', 'cash_up_front_including_freight'
    )
  );

  RETURN jsonb_build_object(
    'status', 'converted',
    'parts_quote_id', v_quote.id,
    'quote_number', v_quote.quote_number,
    'parts_order_id', v_order_id,
    'order_source', v_order_source,
    'line_count', v_line_count,
    'subtotal_cents', v_subtotal_cents,
    'freight_cents', v_freight_cents,
    'total_cents', v_total_cents,
    'payment_classification', v_payment_classification,
    'payment_status', v_payment_status
  );
END;
$$;

COMMENT ON FUNCTION public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text) IS
  'G7.1 convert-dont-rekey contract: copies priced parts quote lines into a draft counter/phone/email parts order with freight included and cash-up-front payment state.';

REVOKE ALL ON FUNCTION public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/675_g71_parts_quotes_phone_email_capture.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.6, §2') ||
      ' | supabase/migrations/675_g71_parts_quotes_phone_email_capture.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G7.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G7.1 shipped: Parts quotes now carry source, short expiration, freight estimate, cash-up-front payment rule, and convert-don''t-rekey order conversion for phone/email/counter captures.'
  END,
  updated_at = now()
WHERE task_id = 'G7.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G7.1',
  'update',
  jsonb_build_object(
    'reason', 'g71_parts_quotes_phone_email_capture_shipped',
    'migration', '675_g71_parts_quotes_phone_email_capture.sql',
    'mission_alignment', 'pass: parts staff can capture phone/email requests as priced short-lived quotes, convert them into tracked parts orders without re-keying, and enforce cash payment up front including freight before release'
  ),
  'codex'
);

COMMIT;
