-- ============================================================================
-- Migration 669: G8.1 Parts pricing engine + 5% counter discount cap
--
-- Purpose:
--   Turn the D3.7 parts pricing ruleset into an enforceable server-side
--   resolver for counter, phone, and email parts orders/quotes.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Parts-Manager-owned customer and volume price overrides.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parts_customer_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_catalog_id uuid REFERENCES public.parts_catalog(id) ON DELETE SET NULL,
  part_number text NOT NULL,
  qrm_company_id uuid REFERENCES public.qrm_companies(id) ON DELETE CASCADE,
  crm_company_id uuid REFERENCES public.qrm_companies(id) ON DELETE CASCADE,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  min_margin_pct numeric(5, 2) NOT NULL DEFAULT 25.00,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parts_customer_prices_customer_ck CHECK (
    (qrm_company_id IS NOT NULL AND crm_company_id IS NULL)
    OR (qrm_company_id IS NULL AND crm_company_id IS NOT NULL)
  ),
  CONSTRAINT parts_customer_prices_part_present_ck CHECK (length(btrim(part_number)) > 0),
  CONSTRAINT parts_customer_prices_margin_ck CHECK (min_margin_pct >= 0 AND min_margin_pct <= 100),
  CONSTRAINT parts_customer_prices_dates_ck CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

COMMENT ON TABLE public.parts_customer_prices IS
  'G8.1 Parts-Manager-owned customer-specific parts prices. Counter staff consume these through parts_resolve_priced_line; they do not own the rows.';

CREATE INDEX IF NOT EXISTS idx_parts_customer_prices_qrm
  ON public.parts_customer_prices (workspace_id, qrm_company_id, lower(part_number), status)
  WHERE qrm_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parts_customer_prices_crm
  ON public.parts_customer_prices (workspace_id, crm_company_id, lower(part_number), status)
  WHERE crm_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parts_customer_prices_part
  ON public.parts_customer_prices (workspace_id, part_id, part_catalog_id, status);

ALTER TABLE public.parts_customer_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_customer_prices_service_all ON public.parts_customer_prices;
CREATE POLICY parts_customer_prices_service_all
  ON public.parts_customer_prices FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_customer_prices_admin_all ON public.parts_customer_prices;
CREATE POLICY parts_customer_prices_admin_all
  ON public.parts_customer_prices FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  );

DROP TRIGGER IF EXISTS set_parts_customer_prices_updated_at ON public.parts_customer_prices;
CREATE TRIGGER set_parts_customer_prices_updated_at
  BEFORE UPDATE ON public.parts_customer_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_volume_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_catalog_id uuid REFERENCES public.parts_catalog(id) ON DELETE SET NULL,
  part_number text NOT NULL,
  min_quantity numeric(14, 4) NOT NULL CHECK (min_quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  min_margin_pct numeric(5, 2) NOT NULL DEFAULT 25.00,
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parts_volume_prices_part_present_ck CHECK (length(btrim(part_number)) > 0),
  CONSTRAINT parts_volume_prices_margin_ck CHECK (min_margin_pct >= 0 AND min_margin_pct <= 100),
  CONSTRAINT parts_volume_prices_dates_ck CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

COMMENT ON TABLE public.parts_volume_prices IS
  'G8.1 Parts-Manager-owned volume price breaks. Highest qualifying min_quantity wins after customer-specific price checks.';

CREATE INDEX IF NOT EXISTS idx_parts_volume_prices_part_qty
  ON public.parts_volume_prices (workspace_id, lower(part_number), min_quantity DESC, status);

CREATE INDEX IF NOT EXISTS idx_parts_volume_prices_ids_qty
  ON public.parts_volume_prices (workspace_id, part_id, part_catalog_id, min_quantity DESC, status);

ALTER TABLE public.parts_volume_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_volume_prices_service_all ON public.parts_volume_prices;
CREATE POLICY parts_volume_prices_service_all
  ON public.parts_volume_prices FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_volume_prices_admin_all ON public.parts_volume_prices;
CREATE POLICY parts_volume_prices_admin_all
  ON public.parts_volume_prices FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  );

DROP TRIGGER IF EXISTS set_parts_volume_prices_updated_at ON public.parts_volume_prices;
CREATE TRIGGER set_parts_volume_prices_updated_at
  BEFORE UPDATE ON public.parts_volume_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Pricing audit columns on the live quote/order line spines.
-- ----------------------------------------------------------------------------

ALTER TABLE public.parts_order_lines
  ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'list_price',
  ADD COLUMN IF NOT EXISTS price_source_id uuid,
  ADD COLUMN IF NOT EXISTS pricing_rule_id uuid REFERENCES public.parts_pricing_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_authority text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_override_reason text,
  ADD COLUMN IF NOT EXISTS list_unit_price numeric(14, 4),
  ADD COLUMN IF NOT EXISTS base_unit_price numeric(14, 4),
  ADD COLUMN IF NOT EXISTS final_unit_price numeric(14, 4),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14, 4),
  ADD COLUMN IF NOT EXISTS margin_pct numeric(6, 2),
  ADD COLUMN IF NOT EXISTS margin_floor_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.parts_quote_lines
  ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'list_price',
  ADD COLUMN IF NOT EXISTS price_source_id uuid,
  ADD COLUMN IF NOT EXISTS pricing_rule_id uuid REFERENCES public.parts_pricing_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_authority text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_override_reason text,
  ADD COLUMN IF NOT EXISTS list_unit_price_cents bigint,
  ADD COLUMN IF NOT EXISTS base_unit_price_cents bigint,
  ADD COLUMN IF NOT EXISTS final_unit_price_cents bigint,
  ADD COLUMN IF NOT EXISTS unit_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS margin_pct numeric(6, 2),
  ADD COLUMN IF NOT EXISTS margin_floor_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.parts_order_lines
SET
  list_unit_price = COALESCE(list_unit_price, unit_price),
  base_unit_price = COALESCE(base_unit_price, unit_price),
  final_unit_price = COALESCE(final_unit_price, unit_price),
  requested_discount_pct = COALESCE(requested_discount_pct, 0),
  applied_discount_pct = COALESCE(applied_discount_pct, COALESCE(requested_discount_pct, 0)),
  discount_authority = COALESCE(NULLIF(discount_authority, ''), 'none'),
  discount_approval_status = COALESCE(NULLIF(discount_approval_status, ''), 'not_required')
WHERE final_unit_price IS NULL
   OR base_unit_price IS NULL
   OR list_unit_price IS NULL;

UPDATE public.parts_quote_lines
SET
  list_unit_price_cents = COALESCE(list_unit_price_cents, unit_price_cents),
  base_unit_price_cents = COALESCE(base_unit_price_cents, unit_price_cents),
  final_unit_price_cents = COALESCE(final_unit_price_cents, unit_price_cents),
  requested_discount_pct = COALESCE(requested_discount_pct, COALESCE(discount_pct, 0)),
  applied_discount_pct = COALESCE(applied_discount_pct, COALESCE(discount_pct, 0)),
  discount_authority = COALESCE(NULLIF(discount_authority, ''), 'none'),
  discount_approval_status = COALESCE(NULLIF(discount_approval_status, ''), 'not_required')
WHERE final_unit_price_cents IS NULL
   OR base_unit_price_cents IS NULL
   OR list_unit_price_cents IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parts_order_lines_g81_price_source_ck'
      AND conrelid = 'public.parts_order_lines'::regclass
  ) THEN
    ALTER TABLE public.parts_order_lines
      ADD CONSTRAINT parts_order_lines_g81_price_source_ck
      CHECK (price_source IN ('list_price', 'customer_price', 'volume_price', 'internal_formula', 'manual_manager_override')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parts_order_lines_g81_discount_ck'
      AND conrelid = 'public.parts_order_lines'::regclass
  ) THEN
    ALTER TABLE public.parts_order_lines
      ADD CONSTRAINT parts_order_lines_g81_discount_ck
      CHECK (
        requested_discount_pct >= 0
        AND requested_discount_pct <= 100
        AND applied_discount_pct >= 0
        AND applied_discount_pct <= 100
        AND discount_authority IN ('none', 'counter', 'parts_manager')
        AND discount_approval_status IN ('not_required', 'pending_parts_manager_approval', 'approved', 'rejected')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parts_quote_lines_g81_price_source_ck'
      AND conrelid = 'public.parts_quote_lines'::regclass
  ) THEN
    ALTER TABLE public.parts_quote_lines
      ADD CONSTRAINT parts_quote_lines_g81_price_source_ck
      CHECK (price_source IN ('list_price', 'customer_price', 'volume_price', 'internal_formula', 'manual_manager_override')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parts_quote_lines_g81_discount_ck'
      AND conrelid = 'public.parts_quote_lines'::regclass
  ) THEN
    ALTER TABLE public.parts_quote_lines
      ADD CONSTRAINT parts_quote_lines_g81_discount_ck
      CHECK (
        requested_discount_pct >= 0
        AND requested_discount_pct <= 100
        AND applied_discount_pct >= 0
        AND applied_discount_pct <= 100
        AND discount_authority IN ('none', 'counter', 'parts_manager')
        AND discount_approval_status IN ('not_required', 'pending_parts_manager_approval', 'approved', 'rejected')
      ) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_parts_order_lines_g81_discount_review
  ON public.parts_order_lines (workspace_id, discount_approval_status, updated_at DESC)
  WHERE discount_approval_status IN ('pending_parts_manager_approval', 'rejected');

CREATE INDEX IF NOT EXISTS idx_parts_quote_lines_g81_discount_review
  ON public.parts_quote_lines (workspace_id, discount_approval_status, updated_at DESC)
  WHERE discount_approval_status IN ('pending_parts_manager_approval', 'rejected');

COMMENT ON COLUMN public.parts_order_lines.price_source IS
  'G8.1 source for the final sell price: list price, Parts Manager customer price, Parts Manager volume price, internal formula, or manager override.';
COMMENT ON COLUMN public.parts_order_lines.requested_discount_pct IS
  'G8.1 counter-requested discount. Values above 5 percent require Parts Manager approval before the ticket can leave draft.';
COMMENT ON COLUMN public.parts_order_lines.unit_cost IS
  'G8.1 cost snapshot used for policy margin checks. Direct authenticated column reads are revoked; use elevated pricing audit views.';
COMMENT ON COLUMN public.parts_quote_lines.unit_cost_cents IS
  'G8.1 cost snapshot used for policy margin checks. Direct authenticated column reads are revoked; use elevated pricing audit views.';

-- Direct table access should not expose cost/margin snapshots to sales_rep or
-- parts_counter. Elevated users get these through the audit views below.
REVOKE SELECT (unit_cost, margin_pct, pricing_metadata)
  ON public.parts_order_lines FROM anon, authenticated;
REVOKE SELECT (unit_cost_cents, margin_pct, pricing_metadata)
  ON public.parts_quote_lines FROM anon, authenticated;

CREATE OR REPLACE VIEW public.parts_order_line_pricing_audit AS
SELECT
  l.id,
  l.workspace_id,
  l.parts_order_id,
  l.part_number,
  l.price_source,
  l.price_source_id,
  l.pricing_rule_id,
  l.requested_discount_pct,
  l.applied_discount_pct,
  l.discount_authority,
  l.discount_approval_status,
  l.discount_approved_by,
  l.discount_approved_at,
  l.discount_override_reason,
  l.list_unit_price,
  l.base_unit_price,
  l.final_unit_price,
  l.unit_cost,
  l.margin_pct,
  l.margin_floor_applied,
  l.pricing_metadata,
  l.created_at,
  l.updated_at
FROM public.parts_order_lines l
WHERE (
  (select auth.role()) = 'service_role'
  OR (
    l.workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  )
);

CREATE OR REPLACE VIEW public.parts_quote_line_pricing_audit AS
SELECT
  l.id,
  l.workspace_id,
  l.parts_quote_id,
  l.part_number,
  l.price_source,
  l.price_source_id,
  l.pricing_rule_id,
  l.requested_discount_pct,
  l.applied_discount_pct,
  l.discount_authority,
  l.discount_approval_status,
  l.discount_approved_by,
  l.discount_approved_at,
  l.discount_override_reason,
  l.list_unit_price_cents,
  l.base_unit_price_cents,
  l.final_unit_price_cents,
  l.unit_cost_cents,
  l.margin_pct,
  l.margin_floor_applied,
  l.pricing_metadata,
  l.created_at,
  l.updated_at
FROM public.parts_quote_lines l
WHERE (
  (select auth.role()) = 'service_role'
  OR (
    l.workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  )
);

GRANT SELECT ON public.parts_order_line_pricing_audit TO authenticated, service_role;
GRANT SELECT ON public.parts_quote_line_pricing_audit TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Baseline G8.1 policy rules in the existing pricing engine.
-- ----------------------------------------------------------------------------

INSERT INTO public.parts_pricing_rules (
  workspace_id,
  name,
  description,
  scope_type,
  scope_value,
  rule_type,
  min_margin_pct,
  price_target,
  tolerance_pct,
  auto_apply,
  is_active,
  priority
)
SELECT
  'default',
  'G8.1 parts 25% floor',
  'D3.7/G8.1 baseline: parts must not sell below a 25% margin floor.',
  'global'::public.pricing_rule_scope_type,
  NULL,
  'min_margin_pct'::public.pricing_rule_type,
  25.00,
  'list_price'::public.pricing_level_target,
  0.01,
  false,
  true,
  810
WHERE NOT EXISTS (
  SELECT 1
  FROM public.parts_pricing_rules
  WHERE workspace_id = 'default'
    AND name = 'G8.1 parts 25% floor'
);

INSERT INTO public.parts_pricing_rules (
  workspace_id,
  name,
  description,
  scope_type,
  scope_value,
  rule_type,
  target_margin_pct,
  price_target,
  tolerance_pct,
  auto_apply,
  is_active,
  priority
)
SELECT
  'default',
  'G8.1 parts 35% target',
  'D3.7/G8.1 baseline: parts pricing target margin is 35%; suggestions stay manager-reviewed.',
  'global'::public.pricing_rule_scope_type,
  NULL,
  'target_margin_pct'::public.pricing_rule_type,
  35.00,
  'list_price'::public.pricing_level_target,
  2.00,
  false,
  true,
  800
WHERE NOT EXISTS (
  SELECT 1
  FROM public.parts_pricing_rules
  WHERE workspace_id = 'default'
    AND name = 'G8.1 parts 35% target'
);

-- ----------------------------------------------------------------------------
-- Private resolver and public counter-safe pricing resolver.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.parts_compute_priced_line_private(
  p_part_number text,
  p_part_catalog_id uuid DEFAULT NULL,
  p_qrm_company_id uuid DEFAULT NULL,
  p_crm_company_id uuid DEFAULT NULL,
  p_quantity numeric DEFAULT 1,
  p_requested_discount_pct numeric DEFAULT 0
)
RETURNS TABLE (
  part_catalog_id uuid,
  part_id uuid,
  part_number text,
  description text,
  price_source text,
  price_source_id uuid,
  pricing_rule_id uuid,
  list_unit_price_cents bigint,
  base_unit_price_cents bigint,
  final_unit_price_cents bigint,
  unit_cost_cents bigint,
  requested_discount_pct numeric,
  applied_discount_pct numeric,
  discount_authority text,
  discount_approval_status text,
  margin_pct numeric,
  margin_floor_applied boolean,
  pricing_metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := COALESCE(public.get_my_workspace(), 'default');
  v_input_part_number text := NULLIF(btrim(COALESCE(p_part_number, '')), '');
  v_quantity numeric := GREATEST(COALESCE(p_quantity, 1), 1);
  v_requested_discount numeric := LEAST(GREATEST(COALESCE(p_requested_discount_pct, 0), 0), 100);
  v_catalog record;
  v_part_id uuid;
  v_list_cents bigint := 0;
  v_cost_cents bigint;
  v_candidate_cents bigint := 0;
  v_floor_cents bigint := 0;
  v_final_cents bigint := 0;
  v_discounted_cents bigint := 0;
  v_price_source text := 'list_price';
  v_price_source_id uuid;
  v_pricing_rule_id uuid;
  v_customer_id uuid;
  v_customer_price bigint;
  v_volume_id uuid;
  v_volume_price bigint;
  v_margin_pct numeric(6, 2);
  v_floor_applied boolean := false;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  IF (select auth.role()) <> 'service_role' AND NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'insufficient role for parts pricing';
  END IF;

  IF p_part_catalog_id IS NULL AND v_input_part_number IS NULL THEN
    RAISE EXCEPTION 'part_number or part_catalog_id is required for parts pricing';
  END IF;

  SELECT pc.*
  INTO v_catalog
  FROM public.parts_catalog pc
  WHERE pc.workspace_id = v_workspace_id
    AND pc.deleted_at IS NULL
    AND pc.is_active = true
    AND (
      (p_part_catalog_id IS NOT NULL AND pc.id = p_part_catalog_id)
      OR (v_input_part_number IS NOT NULL AND lower(pc.part_number) = lower(v_input_part_number))
    )
  ORDER BY
    CASE WHEN p_part_catalog_id IS NOT NULL AND pc.id = p_part_catalog_id THEN 0 ELSE 1 END,
    pc.updated_at DESC NULLS LAST,
    pc.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'part not found for pricing';
  END IF;

  SELECT p.id
  INTO v_part_id
  FROM public.parts p
  WHERE p.workspace_id = v_workspace_id
    AND p.deleted_at IS NULL
    AND (
      p.parts_catalog_id = v_catalog.id
      OR lower(p.part_number) = lower(v_catalog.part_number)
    )
  ORDER BY CASE WHEN p.parts_catalog_id = v_catalog.id THEN 0 ELSE 1 END, p.created_at DESC
  LIMIT 1;

  v_list_cents := GREATEST(COALESCE(round(COALESCE(v_catalog.list_price, 0) * 100)::bigint, 0), 0);
  v_cost_cents := NULLIF(GREATEST(COALESCE(round(COALESCE(v_catalog.cost_price, 0) * 100)::bigint, 0), 0), 0);
  v_candidate_cents := v_list_cents;

  IF v_cost_cents IS NOT NULL THEN
    v_floor_cents := ceil(v_cost_cents::numeric / 0.75)::bigint;
  END IF;

  SELECT cp.id, cp.unit_price_cents
  INTO v_customer_id, v_customer_price
  FROM public.parts_customer_prices cp
  WHERE cp.workspace_id = v_workspace_id
    AND cp.status = 'active'
    AND cp.effective_from <= current_date
    AND (cp.effective_until IS NULL OR cp.effective_until >= current_date)
    AND (
      (p_qrm_company_id IS NOT NULL AND cp.qrm_company_id = p_qrm_company_id)
      OR (p_crm_company_id IS NOT NULL AND cp.crm_company_id = p_crm_company_id)
    )
    AND (
      cp.part_id = v_part_id
      OR cp.part_catalog_id = v_catalog.id
      OR lower(cp.part_number) = lower(v_catalog.part_number)
    )
  ORDER BY cp.effective_from DESC, cp.created_at DESC
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    v_candidate_cents := v_customer_price;
    v_price_source := 'customer_price';
    v_price_source_id := v_customer_id;
  ELSE
    SELECT vp.id, vp.unit_price_cents
    INTO v_volume_id, v_volume_price
    FROM public.parts_volume_prices vp
    WHERE vp.workspace_id = v_workspace_id
      AND vp.status = 'active'
      AND vp.effective_from <= current_date
      AND (vp.effective_until IS NULL OR vp.effective_until >= current_date)
      AND vp.min_quantity <= v_quantity
      AND (
        vp.part_id = v_part_id
        OR vp.part_catalog_id = v_catalog.id
        OR lower(vp.part_number) = lower(v_catalog.part_number)
      )
    ORDER BY vp.min_quantity DESC, vp.effective_from DESC, vp.created_at DESC
    LIMIT 1;

    IF v_volume_id IS NOT NULL THEN
      v_candidate_cents := v_volume_price;
      v_price_source := 'volume_price';
      v_price_source_id := v_volume_id;
    END IF;
  END IF;

  IF v_candidate_cents <= 0 AND v_cost_cents IS NOT NULL THEN
    v_candidate_cents := ceil(v_cost_cents::numeric / 0.65)::bigint;
    SELECT pr.id
    INTO v_pricing_rule_id
    FROM public.parts_pricing_rules pr
    WHERE pr.workspace_id = v_workspace_id
      AND pr.name = 'G8.1 parts 35% target'
    ORDER BY pr.created_at DESC
    LIMIT 1;
    v_metadata := v_metadata || jsonb_build_object('target_margin_defaulted', true);
  ELSE
    SELECT pr.id
    INTO v_pricing_rule_id
    FROM public.parts_pricing_rules pr
    WHERE pr.workspace_id = v_workspace_id
      AND pr.name = 'G8.1 parts 25% floor'
    ORDER BY pr.created_at DESC
    LIMIT 1;
  END IF;

  IF v_cost_cents IS NOT NULL AND v_candidate_cents < v_floor_cents THEN
    v_candidate_cents := v_floor_cents;
    v_floor_applied := true;
  END IF;

  v_discounted_cents := floor(v_candidate_cents::numeric * (1 - (v_requested_discount / 100.0)))::bigint;
  v_final_cents := GREATEST(v_discounted_cents, 0);

  IF v_cost_cents IS NOT NULL AND v_final_cents < v_floor_cents THEN
    v_final_cents := v_floor_cents;
    v_floor_applied := true;
  END IF;

  IF v_final_cents > 0 AND v_cost_cents IS NOT NULL THEN
    v_margin_pct := round((((v_final_cents - v_cost_cents)::numeric / v_final_cents::numeric) * 100), 2);
  END IF;

  v_metadata := v_metadata || jsonb_build_object(
    'policy', 'G8.1',
    'target_margin_pct', 35,
    'min_margin_pct', 25,
    'counter_discount_cap_pct', 5,
    'quantity', v_quantity,
    'floor_price_applied', v_floor_applied
  );

  RETURN QUERY SELECT
    v_catalog.id::uuid,
    v_part_id,
    v_catalog.part_number::text,
    v_catalog.description::text,
    v_price_source,
    v_price_source_id,
    v_pricing_rule_id,
    v_list_cents,
    v_candidate_cents,
    v_final_cents,
    v_cost_cents,
    v_requested_discount,
    v_requested_discount,
    CASE
      WHEN v_requested_discount = 0 THEN 'none'
      WHEN v_requested_discount <= 5 THEN 'counter'
      ELSE 'parts_manager'
    END,
    CASE
      WHEN v_requested_discount <= 5 THEN 'not_required'
      ELSE 'pending_parts_manager_approval'
    END,
    v_margin_pct,
    v_floor_applied,
    v_metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.parts_compute_priced_line_private(text, uuid, uuid, uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.parts_resolve_priced_line(
  p_part_number text,
  p_part_catalog_id uuid DEFAULT NULL,
  p_qrm_company_id uuid DEFAULT NULL,
  p_crm_company_id uuid DEFAULT NULL,
  p_quantity numeric DEFAULT 1,
  p_requested_discount_pct numeric DEFAULT 0
)
RETURNS TABLE (
  part_catalog_id uuid,
  part_id uuid,
  part_number text,
  description text,
  price_source text,
  price_source_id uuid,
  pricing_rule_id uuid,
  list_unit_price_cents bigint,
  base_unit_price_cents bigint,
  final_unit_price_cents bigint,
  requested_discount_pct numeric,
  applied_discount_pct numeric,
  discount_authority text,
  discount_approval_status text,
  margin_floor_applied boolean,
  pricing_metadata jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    priced.part_catalog_id,
    priced.part_id,
    priced.part_number,
    priced.description,
    priced.price_source,
    priced.price_source_id,
    priced.pricing_rule_id,
    priced.list_unit_price_cents,
    priced.base_unit_price_cents,
    priced.final_unit_price_cents,
    priced.requested_discount_pct,
    priced.applied_discount_pct,
    priced.discount_authority,
    priced.discount_approval_status,
    priced.margin_floor_applied,
    priced.pricing_metadata
  FROM public.parts_compute_priced_line_private(
    p_part_number,
    p_part_catalog_id,
    p_qrm_company_id,
    p_crm_company_id,
    p_quantity,
    p_requested_discount_pct
  ) priced;
$$;

COMMENT ON FUNCTION public.parts_resolve_priced_line(text, uuid, uuid, uuid, numeric, numeric) IS
  'G8.1 counter-safe pricing resolver. Returns list/customer/volume/final price and discount approval state without exposing cost or margin.';

REVOKE ALL ON FUNCTION public.parts_resolve_priced_line(text, uuid, uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_resolve_priced_line(text, uuid, uuid, uuid, numeric, numeric) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Triggers enforce pricing snapshots regardless of caller-supplied prices.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.parts_order_lines_apply_g81_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order record;
  v_priced record;
BEGIN
  IF COALESCE((NEW.pricing_metadata ->> 'g81_preserve_pricing')::boolean, false) THEN
    NEW.unit_price := COALESCE(NEW.final_unit_price, NEW.unit_price);
    NEW.line_total := CASE
      WHEN NEW.unit_price IS NULL THEN NULL
      ELSE round((NEW.unit_price * NEW.quantity)::numeric, 4)
    END;
    RETURN NEW;
  END IF;

  SELECT o.workspace_id, o.crm_company_id
  INTO v_order
  FROM public.parts_orders o
  WHERE o.id = NEW.parts_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parts_order not found for pricing';
  END IF;

  SELECT *
  INTO v_priced
  FROM public.parts_compute_priced_line_private(
    NEW.part_number,
    NEW.catalog_item_id,
    NULL,
    v_order.crm_company_id,
    NEW.quantity,
    COALESCE(NEW.requested_discount_pct, 0)
  );

  NEW.workspace_id := v_order.workspace_id;
  NEW.catalog_item_id := v_priced.part_catalog_id;
  NEW.part_id := v_priced.part_id;
  NEW.part_number := v_priced.part_number;
  NEW.description := COALESCE(NULLIF(NEW.description, ''), v_priced.description);
  NEW.price_source := v_priced.price_source;
  NEW.price_source_id := v_priced.price_source_id;
  NEW.pricing_rule_id := v_priced.pricing_rule_id;
  NEW.requested_discount_pct := v_priced.requested_discount_pct;
  NEW.applied_discount_pct := v_priced.applied_discount_pct;
  NEW.discount_authority := v_priced.discount_authority;
  NEW.discount_approval_status := v_priced.discount_approval_status;
  NEW.list_unit_price := round((v_priced.list_unit_price_cents::numeric / 100.0), 4);
  NEW.base_unit_price := round((v_priced.base_unit_price_cents::numeric / 100.0), 4);
  NEW.final_unit_price := round((v_priced.final_unit_price_cents::numeric / 100.0), 4);
  NEW.unit_price := NEW.final_unit_price;
  NEW.line_total := round((NEW.unit_price * NEW.quantity)::numeric, 4);
  NEW.unit_cost := CASE
    WHEN v_priced.unit_cost_cents IS NULL THEN NULL
    ELSE round((v_priced.unit_cost_cents::numeric / 100.0), 4)
  END;
  NEW.margin_pct := v_priced.margin_pct;
  NEW.margin_floor_applied := v_priced.margin_floor_applied;
  NEW.pricing_metadata := v_priced.pricing_metadata;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_order_lines_apply_g81_pricing_trg ON public.parts_order_lines;
CREATE TRIGGER parts_order_lines_apply_g81_pricing_trg
  BEFORE INSERT OR UPDATE OF part_number, catalog_item_id, quantity, requested_discount_pct
  ON public.parts_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.parts_order_lines_apply_g81_pricing();

CREATE OR REPLACE FUNCTION public.parts_quote_lines_apply_g81_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote record;
  v_priced record;
BEGIN
  SELECT q.workspace_id, q.customer_id
  INTO v_quote
  FROM public.parts_quotes q
  WHERE q.id = NEW.parts_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parts_quote not found for pricing';
  END IF;

  SELECT *
  INTO v_priced
  FROM public.parts_compute_priced_line_private(
    NEW.part_number,
    NEW.part_catalog_id,
    v_quote.customer_id,
    NULL,
    NEW.qty,
    COALESCE(NEW.requested_discount_pct, NEW.discount_pct, 0)
  );

  NEW.workspace_id := v_quote.workspace_id;
  NEW.part_catalog_id := v_priced.part_catalog_id;
  NEW.part_id := v_priced.part_id;
  NEW.part_number := v_priced.part_number;
  NEW.description := COALESCE(NULLIF(NEW.description, ''), v_priced.description);
  NEW.price_source := v_priced.price_source;
  NEW.price_source_id := v_priced.price_source_id;
  NEW.pricing_rule_id := v_priced.pricing_rule_id;
  NEW.requested_discount_pct := v_priced.requested_discount_pct;
  NEW.applied_discount_pct := v_priced.applied_discount_pct;
  NEW.discount_pct := v_priced.requested_discount_pct;
  NEW.discount_authority := v_priced.discount_authority;
  NEW.discount_approval_status := v_priced.discount_approval_status;
  NEW.list_unit_price_cents := v_priced.list_unit_price_cents;
  NEW.base_unit_price_cents := v_priced.base_unit_price_cents;
  NEW.final_unit_price_cents := v_priced.final_unit_price_cents;
  NEW.unit_price_cents := v_priced.final_unit_price_cents;
  NEW.extended_price_cents := v_priced.final_unit_price_cents * NEW.qty;
  NEW.unit_cost_cents := v_priced.unit_cost_cents;
  NEW.margin_pct := v_priced.margin_pct;
  NEW.margin_floor_applied := v_priced.margin_floor_applied;
  NEW.pricing_metadata := v_priced.pricing_metadata;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_quote_lines_apply_g81_pricing_trg ON public.parts_quote_lines;
CREATE TRIGGER parts_quote_lines_apply_g81_pricing_trg
  BEFORE INSERT OR UPDATE OF part_number, part_catalog_id, qty, requested_discount_pct
  ON public.parts_quote_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.parts_quote_lines_apply_g81_pricing();

CREATE OR REPLACE FUNCTION public.parts_orders_block_g81_unapproved_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('submitted', 'confirmed', 'processing', 'shipped', 'delivered')
    AND COALESCE(NEW.order_source, 'portal') <> 'portal'
    AND EXISTS (
      SELECT 1
      FROM public.parts_order_lines l
      WHERE l.parts_order_id = NEW.id
        AND l.workspace_id = NEW.workspace_id
        AND l.discount_approval_status IN ('pending_parts_manager_approval', 'rejected')
    )
  THEN
    RAISE EXCEPTION 'Parts Manager approval is required for discounts beyond 5 percent before ticket close';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_orders_block_g81_unapproved_discount_trg ON public.parts_orders;
CREATE TRIGGER parts_orders_block_g81_unapproved_discount_trg
  BEFORE INSERT OR UPDATE OF status
  ON public.parts_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.parts_orders_block_g81_unapproved_discount();

CREATE OR REPLACE FUNCTION public.parts_decide_line_discount(
  p_line_type text,
  p_line_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_actor uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF (select auth.role()) <> 'service_role' AND NOT public.qep_parts_admin_role() THEN
    RAISE EXCEPTION 'Parts Manager approval role required';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected';
  END IF;

  IF p_line_type = 'order' THEN
    UPDATE public.parts_order_lines
    SET discount_approval_status = p_decision,
        discount_authority = 'parts_manager',
        discount_approved_by = CASE WHEN p_decision = 'approved' THEN v_actor ELSE NULL END,
        discount_approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
        discount_override_reason = p_reason,
        updated_at = now()
    WHERE id = p_line_id
      AND (
        (select auth.role()) = 'service_role'
        OR workspace_id = v_workspace_id
      )
      AND requested_discount_pct > 5;
  ELSIF p_line_type = 'quote' THEN
    UPDATE public.parts_quote_lines
    SET discount_approval_status = p_decision,
        discount_authority = 'parts_manager',
        discount_approved_by = CASE WHEN p_decision = 'approved' THEN v_actor ELSE NULL END,
        discount_approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
        discount_override_reason = p_reason,
        updated_at = now()
    WHERE id = p_line_id
      AND (
        (select auth.role()) = 'service_role'
        OR workspace_id = v_workspace_id
      )
      AND requested_discount_pct > 5;
  ELSE
    RAISE EXCEPTION 'line_type must be order or quote';
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'discount line not found or does not require approval';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'line_type', p_line_type,
    'line_id', p_line_id,
    'decision', p_decision
  );
END;
$$;

COMMENT ON FUNCTION public.parts_decide_line_discount(text, uuid, text, text) IS
  'G8.1 Parts Manager approval/rejection for line discounts beyond the 5% counter cap.';

REVOKE ALL ON FUNCTION public.parts_decide_line_discount(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_decide_line_discount(text, uuid, text, text) TO authenticated, service_role;

-- Preserve accepted quote pricing when converting to an order.
DROP FUNCTION IF EXISTS public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.parts_convert_quote_to_order(
  p_parts_quote_id uuid,
  p_crm_company_id uuid,
  p_order_source text DEFAULT NULL,
  p_payment_classification text DEFAULT 'cash',
  p_created_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_quote public.parts_quotes%ROWTYPE;
  v_crm_company public.crm_companies%ROWTYPE;
  v_order_id uuid;
  v_order_source text;
  v_payment_classification text;
  v_payment_status text;
  v_freight_cents bigint;
  v_subtotal_cents bigint;
  v_discount_cents bigint;
  v_tax_cents bigint;
  v_total_cents bigint;
  v_line_count integer;
  v_line_items jsonb;
BEGIN
  SELECT *
  INTO v_quote
  FROM public.parts_quotes
  WHERE id = p_parts_quote_id
    AND workspace_id = v_workspace_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'parts quote not found';
  END IF;

  IF v_quote.converted_parts_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'parts quote has already been converted';
  END IF;

  IF v_quote.expires_at IS NOT NULL AND v_quote.expires_at < now() THEN
    RAISE EXCEPTION 'parts quote is expired';
  END IF;

  SELECT *
  INTO v_crm_company
  FROM public.crm_companies
  WHERE id = p_crm_company_id
    AND workspace_id = v_workspace_id;

  IF v_crm_company.id IS NULL THEN
    RAISE EXCEPTION 'crm_company_id must reference a company in the same workspace';
  END IF;

  SELECT count(*)::integer
  INTO v_line_count
  FROM public.parts_quote_lines
  WHERE parts_quote_id = v_quote.id
    AND workspace_id = v_workspace_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'parts quote has no lines';
  END IF;

  SELECT
    coalesce(sum(l.extended_price_cents), 0)::bigint,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'part_number', l.part_number,
        'description', l.description,
        'quantity', l.qty,
        'unit_price', round((l.unit_price_cents::numeric / 100.0), 4),
        'line_total', round((l.extended_price_cents::numeric / 100.0), 4),
        'price_source', l.price_source,
        'requested_discount_pct', l.requested_discount_pct,
        'discount_approval_status', l.discount_approval_status
      )
      ORDER BY l.sort_order
    ), '[]'::jsonb)
  INTO v_subtotal_cents, v_line_items
  FROM public.parts_quote_lines l
  WHERE l.parts_quote_id = v_quote.id
    AND l.workspace_id = v_workspace_id;

  v_freight_cents := greatest(coalesce(v_quote.freight_estimate_cents, 0), 0);
  v_discount_cents := greatest(coalesce(v_quote.discount_cents, 0), 0);
  v_tax_cents := greatest(coalesce(v_quote.tax_cents, 0), 0);
  v_total_cents := greatest(v_subtotal_cents - v_discount_cents + v_tax_cents + v_freight_cents, 0);
  v_order_source := coalesce(nullif(btrim(p_order_source), ''), nullif(v_quote.quote_source, ''), 'phone');

  IF v_order_source NOT IN ('counter', 'phone', 'email', 'online') THEN
    v_order_source := 'phone';
  END IF;

  v_payment_classification := CASE
    WHEN p_payment_classification = 'charge' THEN 'charge'
    ELSE 'cash'
  END;
  v_payment_status := CASE
    WHEN v_payment_classification = 'charge' THEN 'charge_account'
    ELSE 'unpaid'
  END;

  INSERT INTO public.parts_orders (
    workspace_id,
    status,
    portal_customer_id,
    crm_company_id,
    order_source,
    created_by,
    notes,
    line_items,
    subtotal,
    tax,
    shipping,
    total,
    originating_parts_quote_id,
    payment_classification,
    payment_status,
    charge_authorization_status,
    freight_charge_cents,
    freight_status,
    freight_metadata,
    metadata
  )
  VALUES (
    v_workspace_id,
    'draft',
    NULL,
    p_crm_company_id,
    v_order_source,
    p_created_by,
    COALESCE(p_notes, v_quote.notes),
    v_line_items,
    round((v_subtotal_cents::numeric / 100.0), 4),
    round((v_tax_cents::numeric / 100.0), 4),
    round((v_freight_cents::numeric / 100.0), 4),
    round((v_total_cents::numeric / 100.0), 4),
    v_quote.id,
    v_payment_classification,
    v_payment_status,
    CASE WHEN v_payment_classification = 'charge' THEN 'pending_ar_approval' ELSE 'not_applicable' END,
    v_freight_cents,
    CASE WHEN v_freight_cents > 0 THEN 'estimated' ELSE 'not_required' END,
    jsonb_build_object(
      'source', 'parts_quote',
      'parts_quote_id', v_quote.id,
      'freight_estimate_source', v_quote.freight_estimate_source
    ),
    jsonb_build_object(
      'source', 'parts_quote_conversion',
      'parts_quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'payment_rule', v_quote.payment_rule,
      'pricing_policy', 'G8.1'
    )
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.parts_order_lines (
    workspace_id,
    parts_order_id,
    catalog_item_id,
    part_id,
    part_number,
    description,
    quantity,
    unit_price,
    line_total,
    sort_order,
    price_source,
    price_source_id,
    pricing_rule_id,
    requested_discount_pct,
    applied_discount_pct,
    discount_authority,
    discount_approval_status,
    discount_approved_by,
    discount_approved_at,
    discount_override_reason,
    list_unit_price,
    base_unit_price,
    final_unit_price,
    unit_cost,
    margin_pct,
    margin_floor_applied,
    pricing_metadata
  )
  SELECT
    v_workspace_id,
    v_order_id,
    l.part_catalog_id,
    l.part_id,
    l.part_number,
    l.description,
    l.qty,
    round((l.final_unit_price_cents::numeric / 100.0), 4),
    round((l.extended_price_cents::numeric / 100.0), 4),
    l.sort_order,
    l.price_source,
    l.price_source_id,
    l.pricing_rule_id,
    l.requested_discount_pct,
    l.applied_discount_pct,
    l.discount_authority,
    l.discount_approval_status,
    l.discount_approved_by,
    l.discount_approved_at,
    l.discount_override_reason,
    round((l.list_unit_price_cents::numeric / 100.0), 4),
    round((l.base_unit_price_cents::numeric / 100.0), 4),
    round((l.final_unit_price_cents::numeric / 100.0), 4),
    CASE WHEN l.unit_cost_cents IS NULL THEN NULL ELSE round((l.unit_cost_cents::numeric / 100.0), 4) END,
    l.margin_pct,
    l.margin_floor_applied,
    l.pricing_metadata || jsonb_build_object('g81_preserve_pricing', true, 'source', 'quote_conversion')
  FROM public.parts_quote_lines l
  WHERE l.parts_quote_id = v_quote.id
    AND l.workspace_id = v_workspace_id
  ORDER BY l.sort_order;

  UPDATE public.parts_quotes
  SET
    status = 'converted',
    converted_parts_order_id = v_order_id,
    converted_to_order_at = now(),
    converted_at = COALESCE(converted_at, now()),
    conversion_channel = 'parts_order',
    total_cents = v_total_cents,
    subtotal_cents = v_subtotal_cents,
    discount_cents = v_discount_cents,
    tax_cents = v_tax_cents,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'converted_parts_order_id', v_order_id,
      'converted_total_cents', v_total_cents,
      'pricing_policy', 'G8.1'
    ),
    updated_at = now()
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
      'payment_rule', 'cash_up_front_including_freight',
      'pricing_policy', 'G8.1'
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
    'payment_status', v_payment_status,
    'pricing_policy', 'G8.1'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_convert_quote_to_order(uuid, uuid, text, text, uuid, text) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/669_g81_parts_pricing_engine_counter_discount_cap.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §4 ADR-018') ||
      ' | supabase/migrations/669_g81_parts_pricing_engine_counter_discount_cap.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G8.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G8.1 shipped: Parts pricing resolver now enforces list/customer/volume precedence, 35% target metadata, 25% floor, 5% counter discount cap, and Parts Manager approval blocking for over-cap discounts.'
  END,
  updated_at = now()
WHERE task_id = 'G8.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G8.1',
  'update',
  jsonb_build_object(
    'reason', 'g81_parts_pricing_engine_counter_discount_cap_shipped',
    'migration', '669_g81_parts_pricing_engine_counter_discount_cap.sql',
    'mission_alignment', 'pass: counter staff get fast server-priced parts lines while Parts Manager retains authority over customer/volume prices and over-5-percent discounts'
  ),
  'codex'
);

COMMIT;
