-- ============================================================================
-- Migration 771: Stream L / L1 — rental rate engine (SQL mirror + resolver)
--
-- Blueprint §2. The CANONICAL optimizer implementation is TypeScript
-- (shared/rental-rate-math.ts); the functions here are the VERIFIED MIRROR
-- for in-DB reporting, billing backfill, and guard-usable pricing. Both
-- implementations consume shared/rental-rate-math.vectors.json and must
-- agree — divergence fails the build gate (scripts verify via generated
-- assertions). When production disputes an amount, TS is truth.
--
-- Contract highlights mirrored here (owner pressure-test 2026-07-07):
--   * COVERAGE formulation: minimize 28m·month + 7w·week + d·day
--     subject to 28m + 7w + d ≥ D; overshoot legal.
--   * Exhaustive enumeration m ∈ [0,⌈D/28⌉], w ∈ [0,⌈D/7⌉], d determined —
--     correct for arbitrary positive rate books (inverted ladders included).
--   * Absent tiers (null/≤0) are unavailable, never enumerable.
--   * Tie-break: fewest segment lines, then largest blocks first.
--   * fired is STRICT (> 0 cents vs the greedy largest-block exact
--     partition); ties never fire.
--   * Reconciliation: final invoice = optimize(entire duration) − already
--     invoiced, floored at zero.
--
-- Also: rental_rate_rules gains the L1 columns (hourly/included-hours/
-- overage, effective dating, authorship) and rental_resolve_rates provides
-- the deterministic precedence lookup with a mandatory resolution_path.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rate-rule card extensions
-- ---------------------------------------------------------------------------

ALTER TABLE public.rental_rate_rules
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(12, 2),
  ADD COLUMN IF NOT EXISTS included_hours_per_day numeric(6, 2),
  ADD COLUMN IF NOT EXISTS overage_hourly_rate numeric(12, 2),
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON TABLE public.rental_rate_rules IS
  'Rate cards. Resolution precedence (rental_resolve_rates): exact equipment > customer-negotiated > class/subclass > category > branch > workspace default; seasonal + effective windows FILTER (never rank); ties broken by priority_rank desc, then newest effective_from.';

-- ---------------------------------------------------------------------------
-- 2. Optimizer mirror
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_optimize_charge(
  p_billable_days integer,
  p_rate_book jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_month bigint := NULLIF(GREATEST(COALESCE((p_rate_book->>'month')::bigint, 0), 0), 0);
  v_week  bigint := NULLIF(GREATEST(COALESCE((p_rate_book->>'week')::bigint, 0), 0), 0);
  v_day   bigint := NULLIF(GREATEST(COALESCE((p_rate_book->>'day')::bigint, 0), 0), 0);
  v_m_max integer;
  v_w_max integer;
  m integer; w integer; d integer;
  v_total bigint; v_lines integer;
  best_total bigint; best_m integer; best_w integer; best_d integer; best_lines integer;
  g_rem integer; g_m integer; g_w integer; g_d integer; g_total bigint;
  v_partition jsonb := NULL;
  v_fired boolean := false;
  v_segments jsonb;
BEGIN
  IF p_billable_days IS NULL OR p_billable_days < 0 THEN
    RAISE EXCEPTION 'billable_days must be a non-negative integer';
  END IF;
  IF v_month IS NULL AND v_week IS NULL AND v_day IS NULL THEN
    RAISE EXCEPTION 'rate book has no usable tier (day/week/month all unavailable)';
  END IF;
  IF p_billable_days = 0 THEN
    RETURN jsonb_build_object('total', 0, 'segments', '[]'::jsonb, 'fired', false, 'beaten_alternative', NULL);
  END IF;

  v_m_max := CASE WHEN v_month IS NULL THEN 0 ELSE ceil(p_billable_days / 28.0)::integer END;
  v_w_max := CASE WHEN v_week  IS NULL THEN 0 ELSE ceil(p_billable_days / 7.0)::integer END;

  best_total := NULL;
  FOR m IN 0..v_m_max LOOP
    FOR w IN 0..v_w_max LOOP
      d := GREATEST(0, p_billable_days - 28 * m - 7 * w);
      IF d > 0 AND v_day IS NULL THEN
        CONTINUE;
      END IF;
      v_total := m * COALESCE(v_month, 0) + w * COALESCE(v_week, 0) + d * COALESCE(v_day, 0);
      v_lines := (m > 0)::int + (w > 0)::int + (d > 0)::int;
      IF best_total IS NULL
         OR v_total < best_total
         OR (v_total = best_total AND (
              v_lines < best_lines
              OR (v_lines = best_lines AND (
                   m > best_m
                   OR (m = best_m AND (w > best_w OR (w = best_w AND d > best_d)))))))
      THEN
        best_total := v_total; best_m := m; best_w := w; best_d := d; best_lines := v_lines;
      END IF;
    END LOOP;
  END LOOP;

  IF best_total IS NULL THEN
    RAISE EXCEPTION 'no covering combination exists for the given rate book';
  END IF;

  -- Greedy largest-AVAILABLE-block exact partition (the meter alternative).
  g_rem := p_billable_days;
  g_m := CASE WHEN v_month IS NULL THEN 0 ELSE g_rem / 28 END;  g_rem := g_rem - 28 * g_m;
  g_w := CASE WHEN v_week  IS NULL THEN 0 ELSE g_rem / 7  END;  g_rem := g_rem - 7 * g_w;
  g_d := g_rem;
  IF g_d = 0 OR v_day IS NOT NULL THEN
    g_total := g_m * COALESCE(v_month, 0) + g_w * COALESCE(v_week, 0) + g_d * COALESCE(v_day, 0);
    v_fired := best_total < g_total;
    IF v_fired THEN
      v_partition := jsonb_build_object(
        'total', g_total,
        'segments',
        (SELECT COALESCE(jsonb_agg(seg), '[]'::jsonb) FROM (
          SELECT jsonb_build_object('unit', 'month', 'qty', g_m, 'unit_cents', v_month) AS seg WHERE g_m > 0
          UNION ALL
          SELECT jsonb_build_object('unit', 'week', 'qty', g_w, 'unit_cents', v_week) WHERE g_w > 0
          UNION ALL
          SELECT jsonb_build_object('unit', 'day', 'qty', g_d, 'unit_cents', v_day) WHERE g_d > 0
        ) parts)
      );
    END IF;
  END IF;

  v_segments := (SELECT COALESCE(jsonb_agg(seg), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('unit', 'month', 'qty', best_m, 'unit_cents', v_month) AS seg WHERE best_m > 0
    UNION ALL
    SELECT jsonb_build_object('unit', 'week', 'qty', best_w, 'unit_cents', v_week) WHERE best_w > 0
    UNION ALL
    SELECT jsonb_build_object('unit', 'day', 'qty', best_d, 'unit_cents', v_day) WHERE best_d > 0
  ) parts);

  RETURN jsonb_build_object(
    'total', best_total,
    'segments', v_segments,
    'fired', v_fired,
    'beaten_alternative', v_partition
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_reconcile_final_invoice(
  p_entire_billable_days integer,
  p_rate_book jsonb,
  p_already_invoiced bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_entire jsonb;
BEGIN
  IF p_already_invoiced IS NULL OR p_already_invoiced < 0 THEN
    RAISE EXCEPTION 'already_invoiced must be a non-negative integer';
  END IF;
  v_entire := public.rental_optimize_charge(p_entire_billable_days, p_rate_book);
  RETURN jsonb_build_object(
    'entire', v_entire,
    'final_invoice', GREATEST(0, (v_entire->>'total')::bigint - p_already_invoiced)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rate resolver — deterministic precedence with mandatory resolution_path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_resolve_rates(
  p_workspace_id text,
  p_equipment_id uuid DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_equipment_class text DEFAULT NULL,
  p_equipment_subclass text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_on_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_path jsonb := '[]'::jsonb;
  v_stage text;
  v_stages text[] := ARRAY['equipment', 'customer', 'class', 'category', 'branch', 'workspace_default'];
  v_book jsonb;
BEGIN
  FOREACH v_stage IN ARRAY v_stages LOOP
    SELECT r.* INTO v_rule
    FROM public.rental_rate_rules r
    WHERE r.workspace_id = p_workspace_id
      AND r.is_active
      AND (r.effective_from IS NULL OR r.effective_from <= p_on_date)
      AND (r.effective_to IS NULL OR r.effective_to >= p_on_date)
      AND (r.season_start IS NULL OR r.season_end IS NULL
           OR p_on_date BETWEEN r.season_start AND r.season_end)
      AND CASE v_stage
            WHEN 'equipment' THEN r.equipment_id IS NOT NULL AND r.equipment_id = p_equipment_id
            WHEN 'customer'  THEN r.customer_id IS NOT NULL AND r.customer_id::text = p_company_id::text
            WHEN 'class'     THEN r.equipment_class IS NOT NULL
                                  AND r.equipment_class = p_equipment_class
                                  AND (r.equipment_subclass IS NULL OR r.equipment_subclass = p_equipment_subclass)
            WHEN 'category'  THEN r.category IS NOT NULL AND r.category = p_category
            WHEN 'branch'    THEN r.branch_id IS NOT NULL AND r.branch_id = p_branch_id
                                  AND r.equipment_id IS NULL AND r.customer_id IS NULL
                                  AND r.equipment_class IS NULL AND r.category IS NULL
            ELSE r.equipment_id IS NULL AND r.customer_id IS NULL AND r.branch_id IS NULL
                 AND r.equipment_class IS NULL AND r.equipment_subclass IS NULL
                 AND r.category IS NULL AND r.make IS NULL AND r.model IS NULL
          END
    ORDER BY r.priority_rank DESC NULLS LAST, r.effective_from DESC NULLS LAST, r.created_at DESC
    LIMIT 1;

    v_path := v_path || jsonb_build_object('stage', v_stage, 'matched', v_rule.id IS NOT NULL, 'rule_id', v_rule.id);
    IF v_rule.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'day',   CASE WHEN v_rule.daily_rate   > 0 THEN round(v_rule.daily_rate   * 100)::bigint END,
        'week',  CASE WHEN v_rule.weekly_rate  > 0 THEN round(v_rule.weekly_rate  * 100)::bigint END,
        'month', CASE WHEN v_rule.monthly_rate > 0 THEN round(v_rule.monthly_rate * 100)::bigint END,
        'hourly', CASE WHEN v_rule.hourly_rate > 0 THEN round(v_rule.hourly_rate * 100)::bigint END,
        'included_hours_per_day', v_rule.included_hours_per_day,
        'overage_hourly', CASE WHEN v_rule.overage_hourly_rate > 0 THEN round(v_rule.overage_hourly_rate * 100)::bigint END,
        'minimum_days', COALESCE(v_rule.minimum_days, 1),
        'source_rule_id', v_rule.id,
        'source', 'rate_rule:' || v_stage,
        'resolution_path', v_path
      );
    END IF;
  END LOOP;

  -- Fallback of last resort: the unit's sticker rates on qrm_equipment.
  IF p_equipment_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'day',   CASE WHEN e.daily_rental_rate   > 0 THEN round(e.daily_rental_rate   * 100)::bigint END,
      'week',  CASE WHEN e.weekly_rental_rate  > 0 THEN round(e.weekly_rental_rate  * 100)::bigint END,
      'month', CASE WHEN e.monthly_rental_rate > 0 THEN round(e.monthly_rental_rate * 100)::bigint END,
      'hourly', NULL, 'included_hours_per_day', NULL, 'overage_hourly', NULL,
      'minimum_days', 1,
      'source_rule_id', NULL,
      'source', 'equipment_sticker',
      'resolution_path', v_path || jsonb_build_object('stage', 'equipment_sticker', 'matched', true, 'rule_id', NULL)
    ) INTO v_book
    FROM public.qrm_equipment e
    WHERE e.id = p_equipment_id AND e.workspace_id = p_workspace_id;
    IF v_book IS NOT NULL THEN
      RETURN v_book;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'day', NULL, 'week', NULL, 'month', NULL,
    'hourly', NULL, 'included_hours_per_day', NULL, 'overage_hourly', NULL,
    'minimum_days', 1, 'source_rule_id', NULL, 'source', 'unresolved',
    'resolution_path', v_path
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) TO authenticated, service_role;

COMMIT;
