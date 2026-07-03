-- ============================================================================
-- Migration 671: G12.1 Cycle counts + dead stock (18-month window)
--
-- Purpose:
--   Make the Phase 3 cycle count tables operational: weighted count-list
--   generation, variance capture/posting, stock movement evidence, and the
--   ADR-019 18-month dead-stock rule. Suggested return/discount/scrap actions
--   are intentionally deferred to a later phase.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.parts_dead_stock_months()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 18;
$$;

COMMENT ON FUNCTION public.parts_dead_stock_months() IS
  'G12.1 ADR-019 constant: dead stock is no movement in 18 months, not the earlier 12-month recommendation.';

CREATE TABLE IF NOT EXISTS public.parts_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  stock_id uuid REFERENCES public.parts_stock(id) ON DELETE SET NULL,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.parts_locations(id) ON DELETE SET NULL,
  bin_id uuid REFERENCES public.parts_bins(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN (
      'sale',
      'return',
      'purchase_receipt',
      'transfer_in',
      'transfer_out',
      'cycle_count_adjustment',
      'manual_adjustment',
      'warranty_issue',
      'core_return'
    )
  ),
  quantity_delta numeric(14, 4) NOT NULL,
  quantity_after numeric(14, 4),
  unit_cost_cents bigint,
  value_delta_cents bigint,
  source_table text,
  source_id uuid,
  moved_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parts_stock_movements_source_present CHECK (
    source_table IS NULL OR length(btrim(source_table)) > 0
  )
);

COMMENT ON TABLE public.parts_stock_movements IS
  'G12.1 stock movement ledger used by cycle count variance posting and 18-month dead-stock detection.';
COMMENT ON COLUMN public.parts_stock_movements.movement_type IS
  'Includes sale/return/receipt/transfer plus cycle_count_adjustment for posted variance evidence.';

CREATE INDEX IF NOT EXISTS idx_parts_stock_movements_part_location
  ON public.parts_stock_movements (workspace_id, part_id, location_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_parts_stock_movements_stock
  ON public.parts_stock_movements (workspace_id, stock_id, moved_at DESC)
  WHERE stock_id IS NOT NULL;

ALTER TABLE public.parts_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_stock_movements_service_all ON public.parts_stock_movements;
CREATE POLICY parts_stock_movements_service_all
  ON public.parts_stock_movements FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_stock_movements_staff_select ON public.parts_stock_movements;
CREATE POLICY parts_stock_movements_staff_select
  ON public.parts_stock_movements FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS parts_stock_movements_operator_mutate ON public.parts_stock_movements;
CREATE POLICY parts_stock_movements_operator_mutate
  ON public.parts_stock_movements FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

ALTER TABLE public.cycle_counts
  ADD COLUMN IF NOT EXISTS selection_strategy text NOT NULL DEFAULT 'weighted_velocity_value',
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS variance_posted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS line_count integer NOT NULL DEFAULT 0 CHECK (line_count >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cycle_counts_g121_selection_strategy_ck'
      AND conrelid = 'public.cycle_counts'::regclass
  ) THEN
    ALTER TABLE public.cycle_counts
      ADD CONSTRAINT cycle_counts_g121_selection_strategy_ck CHECK (
        selection_strategy IN (
          'weighted_velocity_value',
          'dead_stock_review',
          'manual'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cycle_counts_g121_dead_stock_months_ck'
      AND conrelid = 'public.cycle_counts'::regclass
  ) THEN
    ALTER TABLE public.cycle_counts
      ADD CONSTRAINT cycle_counts_g121_dead_stock_months_ck CHECK (
        dead_stock_months = public.parts_dead_stock_months()
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.cycle_count_lines
  ADD COLUMN IF NOT EXISTS stock_id uuid REFERENCES public.parts_stock(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.parts_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_score numeric(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS velocity_class text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS unit_cost_cents bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS inventory_value_cents bigint NOT NULL DEFAULT 0 CHECK (inventory_value_cents >= 0),
  ADD COLUMN IF NOT EXISTS last_movement_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_counted_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS selection_reason text,
  ADD COLUMN IF NOT EXISTS variance_value_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_decision text NOT NULL DEFAULT 'no_variance',
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cycle_count_lines_g121_velocity_class_ck'
      AND conrelid = 'public.cycle_count_lines'::regclass
  ) THEN
    ALTER TABLE public.cycle_count_lines
      ADD CONSTRAINT cycle_count_lines_g121_velocity_class_ck CHECK (
        velocity_class IN ('dead', 'slow', 'normal', 'fast', 'high_value', 'unknown')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cycle_count_lines_g121_variance_decision_ck'
      AND conrelid = 'public.cycle_count_lines'::regclass
  ) THEN
    ALTER TABLE public.cycle_count_lines
      ADD CONSTRAINT cycle_count_lines_g121_variance_decision_ck CHECK (
        variance_decision IN (
          'no_variance',
          'accept_adjustment',
          'recount_required',
          'manager_exception'
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_g121_stock
  ON public.cycle_count_lines (workspace_id, stock_id, status)
  WHERE stock_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_g121_variance_review
  ON public.cycle_count_lines (workspace_id, review_required, status, updated_at DESC)
  WHERE review_required = true;

CREATE OR REPLACE VIEW public.v_parts_cycle_count_candidates AS
WITH movement AS (
  SELECT
    workspace_id,
    stock_id,
    part_id,
    location_id,
    max(moved_at) AS last_movement_at,
    coalesce(sum(abs(quantity_delta)) FILTER (
      WHERE moved_at >= now() - interval '12 months'
    ), 0) AS movement_qty_12mo
  FROM public.parts_stock_movements
  GROUP BY workspace_id, stock_id, part_id, location_id
),
history AS (
  SELECT
    p.workspace_id,
    p.id AS part_id,
    coalesce(sum(h.sales_qty) FILTER (WHERE h.month_offset BETWEEN 1 AND 12), 0) AS sales_qty_12mo,
    coalesce(sum(h.sales_qty) FILTER (WHERE h.month_offset BETWEEN 1 AND 18), 0) AS sales_qty_18mo,
    coalesce(sum(h.bin_trips) FILTER (WHERE h.month_offset BETWEEN 1 AND 12), 0) AS bin_trips_12mo
  FROM public.parts p
  LEFT JOIN public.parts_history_monthly h
    ON h.part_id = p.parts_catalog_id
  WHERE p.deleted_at IS NULL
  GROUP BY p.workspace_id, p.id
),
base AS (
  SELECT
    s.workspace_id,
    s.id AS stock_id,
    s.part_id,
    s.location_id,
    s.bin_id,
    l.code AS location_code,
    b.bin_code,
    p.part_number,
    p.description,
    p.category,
    s.branch_slug,
    s.qty_on_hand,
    s.qty_allocated,
    s.qty_reserved,
    coalesce(s.average_cost_cents, round(coalesce(pc.cost_price, 0)::numeric * 100.0)::bigint, 0) AS unit_cost_cents,
    greatest(
      coalesce(m.last_movement_at, '-infinity'::timestamptz),
      coalesce(pc.last_sale_date::timestamptz, '-infinity'::timestamptz),
      coalesce(s.updated_at, '-infinity'::timestamptz),
      coalesce(p.updated_at, '-infinity'::timestamptz)
    ) AS last_movement_at,
    s.last_counted_at,
    coalesce(h.sales_qty_12mo, 0) + coalesce(m.movement_qty_12mo, 0) AS velocity_qty_12mo,
    coalesce(h.sales_qty_18mo, 0) AS sales_qty_18mo,
    coalesce(h.bin_trips_12mo, 0) AS bin_trips_12mo
  FROM public.parts_stock s
  JOIN public.parts p ON p.id = s.part_id
  LEFT JOIN public.parts_locations l ON l.id = s.location_id
  LEFT JOIN public.parts_bins b ON b.id = s.bin_id
  LEFT JOIN public.parts_catalog pc ON pc.id = p.parts_catalog_id
  LEFT JOIN movement m
    ON m.workspace_id = s.workspace_id
   AND m.part_id = s.part_id
   AND (m.stock_id = s.id OR m.location_id = s.location_id)
  LEFT JOIN history h
    ON h.workspace_id = s.workspace_id
   AND h.part_id = s.part_id
  WHERE s.deleted_at IS NULL
    AND p.deleted_at IS NULL
)
SELECT
  workspace_id,
  stock_id,
  part_id,
  location_id,
  bin_id,
  location_code,
  bin_code,
  branch_slug,
  part_number,
  description,
  category,
  qty_on_hand,
  qty_allocated,
  qty_reserved,
  unit_cost_cents,
  greatest(round((qty_on_hand * unit_cost_cents)::numeric), 0)::bigint AS inventory_value_cents,
  last_movement_at,
  last_counted_at,
  velocity_qty_12mo,
  sales_qty_18mo,
  bin_trips_12mo,
  CASE
    WHEN qty_on_hand > 0
     AND sales_qty_18mo <= 0
     AND last_movement_at < now() - make_interval(months => public.parts_dead_stock_months())
      THEN true
    ELSE false
  END AS is_dead_stock_18_months,
  CASE
    WHEN greatest(round((qty_on_hand * unit_cost_cents)::numeric), 0) >= 100000 THEN 'high_value'
    WHEN coalesce(velocity_qty_12mo, 0) >= 48 OR coalesce(bin_trips_12mo, 0) >= 24 THEN 'fast'
    WHEN coalesce(velocity_qty_12mo, 0) >= 12 OR coalesce(bin_trips_12mo, 0) >= 6 THEN 'normal'
    WHEN qty_on_hand > 0
     AND sales_qty_18mo <= 0
     AND last_movement_at < now() - make_interval(months => public.parts_dead_stock_months()) THEN 'dead'
    WHEN coalesce(velocity_qty_12mo, 0) > 0 THEN 'slow'
    ELSE 'unknown'
  END AS velocity_class,
  round(least(
    100,
    (
      least(35, ln(greatest(round((qty_on_hand * unit_cost_cents)::numeric), 0) + 1) * 2.4)
      + least(35, coalesce(velocity_qty_12mo, 0) * 0.75)
      + least(15, coalesce(bin_trips_12mo, 0) * 0.6)
      + CASE
          WHEN last_counted_at IS NULL THEN 15
          WHEN last_counted_at < now() - interval '180 days' THEN 12
          WHEN last_counted_at < now() - interval '90 days' THEN 6
          ELSE 0
        END
      + CASE
          WHEN qty_on_hand > 0
           AND sales_qty_18mo <= 0
           AND last_movement_at < now() - make_interval(months => public.parts_dead_stock_months())
            THEN 10
          ELSE 0
        END
    )
  )::numeric, 2) AS priority_score,
  CASE
    WHEN qty_on_hand > 0
     AND sales_qty_18mo <= 0
     AND last_movement_at < now() - make_interval(months => public.parts_dead_stock_months())
      THEN 'dead_stock_18_months'
    WHEN greatest(round((qty_on_hand * unit_cost_cents)::numeric), 0) >= 100000 THEN 'high_value'
    WHEN coalesce(velocity_qty_12mo, 0) >= 48 OR coalesce(bin_trips_12mo, 0) >= 24 THEN 'fast_moving'
    WHEN last_counted_at IS NULL THEN 'never_counted'
    WHEN last_counted_at < now() - interval '180 days' THEN 'stale_count'
    ELSE 'weighted_rotation'
  END AS selection_reason
FROM base;

ALTER VIEW public.v_parts_cycle_count_candidates SET (security_invoker = true);

COMMENT ON VIEW public.v_parts_cycle_count_candidates IS
  'G12.1 weighted cycle-count candidates: high-value and fast-moving parts score higher, stale/never-counted parts are rotated in, and ADR-019 dead stock uses 18 months.';

GRANT SELECT ON public.v_parts_cycle_count_candidates TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_parts_dead_stock_18_months AS
SELECT
  workspace_id,
  stock_id,
  part_id,
  location_id,
  bin_id,
  location_code,
  bin_code,
  branch_slug,
  part_number,
  description,
  category,
  qty_on_hand,
  unit_cost_cents,
  inventory_value_cents,
  last_movement_at,
  public.parts_dead_stock_months() AS dead_stock_months,
  now() - make_interval(months => public.parts_dead_stock_months()) AS cutoff_at,
  selection_reason
FROM public.v_parts_cycle_count_candidates
WHERE is_dead_stock_18_months = true;

ALTER VIEW public.v_parts_dead_stock_18_months SET (security_invoker = true);

COMMENT ON VIEW public.v_parts_dead_stock_18_months IS
  'G12.1 ADR-019 dead-stock register: on-hand parts with no movement in 18 months. Suggested return/discount/scrap actions are deferred.';

GRANT SELECT ON public.v_parts_dead_stock_18_months TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_generate_cycle_count(
  p_count_number text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_count_type text DEFAULT 'cycle',
  p_assigned_to uuid DEFAULT NULL,
  p_generated_by uuid DEFAULT NULL
)
RETURNS public.cycle_counts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_count_number text := NULLIF(btrim(COALESCE(p_count_number, '')), '');
  v_limit integer := greatest(1, least(COALESCE(p_limit, 50), 500));
  v_count public.cycle_counts%ROWTYPE;
  v_line_count integer := 0;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to generate cycle counts' USING ERRCODE = '42501';
  END IF;

  IF p_count_type NOT IN ('cycle', 'full', 'spot', 'dead_stock_review') THEN
    RAISE EXCEPTION 'unsupported cycle count type %', p_count_type USING ERRCODE = '22023';
  END IF;

  v_count_number := COALESCE(
    v_count_number,
    'CC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8))
  );

  INSERT INTO public.cycle_counts (
    workspace_id,
    count_number,
    location_id,
    count_type,
    status,
    dead_stock_months,
    scheduled_at,
    assigned_to,
    generated_at,
    generated_by,
    selection_strategy,
    metadata
  )
  VALUES (
    v_workspace_id,
    v_count_number,
    p_location_id,
    p_count_type,
    'scheduled',
    public.parts_dead_stock_months(),
    now(),
    p_assigned_to,
    now(),
    COALESCE(p_generated_by, (select auth.uid())),
    CASE
      WHEN p_count_type = 'dead_stock_review' THEN 'dead_stock_review'
      ELSE 'weighted_velocity_value'
    END,
    jsonb_build_object(
      'policy_version', 'G12.1',
      'dead_stock_months', public.parts_dead_stock_months(),
      'candidate_limit', v_limit,
      'suggested_actions_deferred', true
    )
  )
  RETURNING * INTO v_count;

  WITH selected AS (
    SELECT
      c.*,
      row_number() OVER (ORDER BY
        CASE WHEN p_count_type = 'dead_stock_review' THEN c.inventory_value_cents ELSE c.priority_score END DESC,
        c.part_number
      ) AS line_number
    FROM public.v_parts_cycle_count_candidates c
    WHERE c.workspace_id = v_workspace_id
      AND (p_location_id IS NULL OR c.location_id = p_location_id)
      AND (
        p_count_type <> 'dead_stock_review'
        OR c.is_dead_stock_18_months = true
      )
    ORDER BY
      CASE WHEN p_count_type = 'dead_stock_review' THEN c.inventory_value_cents ELSE c.priority_score END DESC,
      c.part_number
    LIMIT v_limit
  )
  INSERT INTO public.cycle_count_lines (
    workspace_id,
    cycle_count_id,
    line_number,
    part_id,
    bin_id,
    stock_id,
    location_id,
    expected_qty,
    status,
    priority_score,
    velocity_class,
    unit_cost_cents,
    inventory_value_cents,
    last_movement_at,
    last_counted_at_snapshot,
    selection_reason,
    metadata
  )
  SELECT
    v_workspace_id,
    v_count.id,
    line_number::integer,
    part_id,
    bin_id,
    stock_id,
    location_id,
    qty_on_hand,
    'open',
    priority_score,
    velocity_class,
    unit_cost_cents,
    inventory_value_cents,
    last_movement_at,
    last_counted_at,
    selection_reason,
    jsonb_build_object(
      'policy_version', 'G12.1',
      'is_dead_stock_18_months', is_dead_stock_18_months,
      'velocity_qty_12mo', velocity_qty_12mo,
      'sales_qty_18mo', sales_qty_18mo,
      'bin_trips_12mo', bin_trips_12mo
    )
  FROM selected;

  GET DIAGNOSTICS v_line_count = ROW_COUNT;

  UPDATE public.cycle_counts
  SET
    line_count = v_line_count,
    status = CASE WHEN v_line_count = 0 THEN 'draft' ELSE status END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('generated_line_count', v_line_count),
    updated_at = now()
  WHERE id = v_count.id
  RETURNING * INTO v_count;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.parts_generate_cycle_count(text, uuid, integer, text, uuid, uuid) IS
  'G12.1 generates weighted cycle count lists: high-value and fast-moving parts first, stale counts rotated in, dead-stock reviews constrained to the 18-month window.';

REVOKE ALL ON FUNCTION public.parts_generate_cycle_count(text, uuid, integer, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_generate_cycle_count(text, uuid, integer, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_record_cycle_count_line(
  p_cycle_count_line_id uuid,
  p_counted_qty numeric,
  p_counted_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.cycle_count_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_line public.cycle_count_lines%ROWTYPE;
  v_counted_by uuid := COALESCE(p_counted_by, (select auth.uid()));
  v_variance numeric;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to record cycle count lines' USING ERRCODE = '42501';
  END IF;

  IF p_counted_qty IS NULL OR p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted quantity must be zero or greater' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_line
  FROM public.cycle_count_lines
  WHERE id = p_cycle_count_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cycle_count_line_id % not found', p_cycle_count_line_id USING ERRCODE = '23503';
  END IF;

  IF v_line.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'cycle count line belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  v_variance := p_counted_qty - v_line.expected_qty;

  UPDATE public.cycle_count_lines
  SET
    counted_qty = p_counted_qty,
    counted_by = v_counted_by,
    counted_at = now(),
    status = 'counted',
    review_required = v_variance <> 0,
    variance_decision = CASE
      WHEN v_variance = 0 THEN 'no_variance'
      ELSE 'accept_adjustment'
    END,
    variance_value_cents = ROUND((v_variance * unit_cost_cents)::numeric)::bigint,
    notes = CASE
      WHEN NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN notes
      ELSE COALESCE(notes || E'\n', '') || p_notes
    END,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'policy_version', 'G12.1',
      'variance_qty', v_variance,
      'variance_recorded_at', now()
    ),
    updated_at = now()
  WHERE id = p_cycle_count_line_id
  RETURNING * INTO v_line;

  UPDATE public.cycle_counts
  SET
    status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE id = v_line.cycle_count_id
    AND workspace_id = v_workspace_id;

  RETURN v_line;
END;
$$;

COMMENT ON FUNCTION public.parts_record_cycle_count_line(uuid, numeric, uuid, text) IS
  'G12.1 records counted quantity and variance value for a generated cycle count line.';

REVOKE ALL ON FUNCTION public.parts_record_cycle_count_line(uuid, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_record_cycle_count_line(uuid, numeric, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_post_cycle_count_variances(
  p_cycle_count_id uuid,
  p_posted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_posted_by uuid := COALESCE(p_posted_by, (select auth.uid()));
  v_count public.cycle_counts%ROWTYPE;
  v_line record;
  v_current_qty numeric;
  v_allocated_qty numeric;
  v_delta numeric;
  v_posted integer := 0;
BEGIN
  IF NOT public.qep_parts_operator_role() THEN
    RAISE EXCEPTION 'Parts operator role required to post cycle count variances' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_count
  FROM public.cycle_counts
  WHERE id = p_cycle_count_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cycle_count_id % not found', p_cycle_count_id USING ERRCODE = '23503';
  END IF;

  IF v_count.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'cycle count belongs to a different workspace' USING ERRCODE = '42501';
  END IF;

  FOR v_line IN
    SELECT
      l.*,
      s.qty_on_hand AS current_qty_on_hand,
      s.qty_allocated AS current_qty_allocated
    FROM public.cycle_count_lines l
    JOIN public.parts_stock s ON s.id = l.stock_id
    WHERE l.cycle_count_id = p_cycle_count_id
      AND l.workspace_id = v_workspace_id
      AND l.counted_qty IS NOT NULL
      AND l.status IN ('counted', 'approved', 'recount')
    ORDER BY l.line_number
  LOOP
    v_current_qty := COALESCE(v_line.current_qty_on_hand, 0);
    v_allocated_qty := COALESCE(v_line.current_qty_allocated, 0);
    v_delta := v_line.counted_qty - v_current_qty;

    IF v_line.counted_qty < v_allocated_qty THEN
      RAISE EXCEPTION 'counted quantity % is below allocated quantity % for cycle_count_line_id %',
        v_line.counted_qty,
        v_allocated_qty,
        v_line.id
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.parts_stock
    SET
      qty_on_hand = v_line.counted_qty,
      last_counted_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_cycle_count_id', p_cycle_count_id,
        'last_cycle_count_line_id', v_line.id,
        'last_cycle_count_variance_qty', v_delta
      ),
      updated_at = now()
    WHERE id = v_line.stock_id
      AND workspace_id = v_workspace_id;

    INSERT INTO public.parts_stock_movements (
      workspace_id,
      stock_id,
      part_id,
      location_id,
      bin_id,
      movement_type,
      quantity_delta,
      quantity_after,
      unit_cost_cents,
      value_delta_cents,
      source_table,
      source_id,
      moved_at,
      actor_id,
      notes,
      metadata
    )
    VALUES (
      v_workspace_id,
      v_line.stock_id,
      v_line.part_id,
      v_line.location_id,
      v_line.bin_id,
      'cycle_count_adjustment',
      v_delta,
      v_line.counted_qty,
      v_line.unit_cost_cents,
      ROUND((v_delta * v_line.unit_cost_cents)::numeric)::bigint,
      'cycle_count_lines',
      v_line.id,
      now(),
      v_posted_by,
      'G12.1 cycle count variance posting',
      jsonb_build_object(
        'policy_version', 'G12.1',
        'cycle_count_id', p_cycle_count_id,
        'expected_qty', v_line.expected_qty,
        'counted_qty', v_line.counted_qty,
        'variance_decision', v_line.variance_decision
      )
    );

    UPDATE public.cycle_count_lines
    SET
      status = 'posted',
      posted_at = now(),
      variance_decision = CASE
        WHEN v_line.counted_qty = v_line.expected_qty THEN 'no_variance'
        ELSE COALESCE(NULLIF(v_line.variance_decision, 'no_variance'), 'accept_adjustment')
      END,
      updated_at = now()
    WHERE id = v_line.id;

    v_posted := v_posted + 1;
  END LOOP;

  UPDATE public.cycle_counts
  SET
    status = 'posted',
    closed_at = COALESCE(closed_at, now()),
    posted_at = now(),
    variance_posted_by = v_posted_by,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'policy_version', 'G12.1',
      'posted_line_count', v_posted,
      'suggested_actions_deferred', true
    ),
    updated_at = now()
  WHERE id = p_cycle_count_id;

  RETURN jsonb_build_object(
    'cycle_count_id', p_cycle_count_id,
    'posted_line_count', v_posted,
    'dead_stock_months', public.parts_dead_stock_months(),
    'suggested_actions_deferred', true
  );
END;
$$;

COMMENT ON FUNCTION public.parts_post_cycle_count_variances(uuid, uuid) IS
  'G12.1 posts counted variances to parts_stock and records cycle_count_adjustment movements for audit/dead-stock evidence.';

REVOKE ALL ON FUNCTION public.parts_post_cycle_count_variances(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_post_cycle_count_variances(uuid, uuid) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/678_g121_cycle_counts_dead_stock.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.12, §4 ADR-019') ||
      ' | supabase/migrations/678_g121_cycle_counts_dead_stock.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G12.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G12.1 shipped: Weighted cycle count generation now prioritizes high-value and fast-moving parts, records counted variances, posts variance adjustments into a stock movement ledger, and exposes ADR-019 18-month dead stock without suggested-action automation.'
  END,
  updated_at = now()
WHERE task_id = 'G12.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G12.1',
  'update',
  jsonb_build_object(
    'reason', 'g121_cycle_counts_dead_stock_shipped',
    'migration', '678_g121_cycle_counts_dead_stock.sql',
    'mission_alignment', 'pass: parts managers and counter staff get weighted cycle-count worklists, variance posting evidence, and 18-month dead-stock visibility without prematurely automating return/discount/scrap decisions'
  ),
  'codex'
);

COMMIT;
