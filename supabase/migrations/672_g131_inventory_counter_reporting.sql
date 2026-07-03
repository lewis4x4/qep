-- ============================================================================
-- Migration 672: G13.1 Inventory + counter reporting
--
-- Purpose:
--   Expose the Phase 3 Parts reporting contracts for inventory and counter
--   operations. Inventory reports surface value on hand by location, turns,
--   fill rate, margin versus the 35 percent target, and ADR-019 dead stock.
--   Counter reports surface customer-experience fill rate, special-order mix,
--   quote-to-sale conversion, time to serve, and counterperson coaching context
--   without ranking employees.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qep_parts_reporting_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (select auth.role()) = 'service_role'
    OR COALESCE((select public.get_my_role())::text, '') IN (
      'admin',
      'manager',
      'owner',
      'finance_admin'
    );
$$;

COMMENT ON FUNCTION public.qep_parts_reporting_role() IS
  'True for Parts reporting consumers allowed to see aggregate cost, margin, inventory, and counter coaching metrics.';

REVOKE EXECUTE ON FUNCTION public.qep_parts_reporting_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qep_parts_reporting_role() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_reporting_margin_target_pct()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 35.00::numeric;
$$;

COMMENT ON FUNCTION public.parts_reporting_margin_target_pct() IS
  'G13.1 reporting constant: Parts margin target is 35 percent.';

REVOKE EXECUTE ON FUNCTION public.parts_reporting_margin_target_pct() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_reporting_margin_target_pct() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_parts_orders_g131_counter_reporting
  ON public.parts_orders (workspace_id, order_source, created_at DESC, created_by)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_parts_order_lines_g131_part_workspace
  ON public.parts_order_lines (workspace_id, part_id, parts_order_id)
  WHERE part_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parts_fulfillment_events_g131_counter
  ON public.parts_fulfillment_events (workspace_id, fulfillment_run_id, created_at)
  WHERE event_type IN (
    'counter_order_picked',
    'order_status_processing',
    'order_status_shipped',
    'order_status_delivered'
  );

CREATE INDEX IF NOT EXISTS idx_parts_order_events_g131_pick
  ON public.parts_order_events (workspace_id, parts_order_id, created_at)
  WHERE event_type = 'pick_completed';

CREATE OR REPLACE VIEW public.v_parts_inventory_location_report AS
WITH movement AS (
  SELECT
    workspace_id,
    stock_id,
    part_id,
    location_id,
    max(moved_at) AS last_movement_at
  FROM public.parts_stock_movements
  GROUP BY workspace_id, stock_id, part_id, location_id
),
stock_base AS (
  SELECT
    s.workspace_id,
    s.id AS stock_id,
    s.part_id,
    s.location_id,
    l.code AS location_code,
    l.name AS location_name,
    coalesce(s.branch_slug, l.branch_slug) AS branch_slug,
    p.part_number,
    p.description,
    p.category,
    s.qty_on_hand,
    s.qty_allocated,
    s.qty_reserved,
    s.qty_on_order,
    coalesce(
      s.average_cost_cents,
      round(coalesce(pc.cost_price, 0)::numeric * 100.0)::bigint,
      0
    ) AS unit_cost_cents,
    greatest(
      coalesce(m.last_movement_at, '-infinity'::timestamptz),
      coalesce(pc.last_sale_date::timestamptz, '-infinity'::timestamptz),
      coalesce(s.updated_at, '-infinity'::timestamptz),
      coalesce(p.updated_at, '-infinity'::timestamptz)
    ) AS last_movement_at
  FROM public.parts_stock s
  JOIN public.parts p
    ON p.id = s.part_id
  LEFT JOIN public.parts_locations l
    ON l.id = s.location_id
  LEFT JOIN public.parts_catalog pc
    ON pc.id = p.parts_catalog_id
  LEFT JOIN movement m
    ON m.workspace_id = s.workspace_id
   AND m.part_id = s.part_id
   AND (m.stock_id = s.id OR m.location_id = s.location_id)
  WHERE s.deleted_at IS NULL
    AND p.deleted_at IS NULL
)
SELECT
  sb.workspace_id,
  sb.location_id,
  coalesce(sb.location_code, 'unassigned') AS location_code,
  coalesce(sb.location_name, 'Unassigned') AS location_name,
  sb.branch_slug,
  count(*)::bigint AS stock_row_count,
  count(DISTINCT sb.part_id)::bigint AS part_count,
  coalesce(sum(sb.qty_on_hand), 0)::numeric(14, 4) AS qty_on_hand_total,
  coalesce(sum(greatest(sb.qty_on_hand - sb.qty_allocated - sb.qty_reserved, 0)), 0)::numeric(14, 4) AS available_qty_total,
  coalesce(sum(sb.qty_on_order), 0)::numeric(14, 4) AS qty_on_order_total,
  coalesce(sum(round(sb.qty_on_hand * sb.unit_cost_cents)::bigint), 0)::bigint AS inventory_value_cents,
  coalesce(sum(ds.inventory_value_cents), 0)::bigint AS dead_stock_value_cents,
  count(DISTINCT ds.stock_id)::bigint AS dead_stock_count,
  round(
    100.0
      * count(*) FILTER (
          WHERE sb.qty_on_hand > 0
            AND greatest(sb.qty_on_hand - sb.qty_allocated - sb.qty_reserved, 0) > 0
        )::numeric
      / nullif(count(*)::numeric, 0),
    2
  ) AS inventory_fill_rate_pct,
  round(
    avg(
      CASE
        WHEN sb.last_movement_at = '-infinity'::timestamptz THEN NULL
        ELSE extract(epoch FROM (now() - sb.last_movement_at)) / 86400.0
      END
    )::numeric,
    2
  ) AS avg_days_since_movement,
  public.parts_dead_stock_months() AS dead_stock_months,
  public.parts_reporting_margin_target_pct() AS margin_target_pct
FROM stock_base sb
LEFT JOIN public.v_parts_dead_stock_18_months ds
  ON ds.workspace_id = sb.workspace_id
 AND ds.stock_id = sb.stock_id
WHERE (
  (select auth.role()) = 'service_role'
  OR (
    sb.workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_reporting_role()
  )
)
GROUP BY
  sb.workspace_id,
  sb.location_id,
  sb.location_code,
  sb.location_name,
  sb.branch_slug;

COMMENT ON VIEW public.v_parts_inventory_location_report IS
  'G13.1 inventory report: current value on hand by location, availability fill rate, and ADR-019 18-month dead-stock exposure.';

CREATE OR REPLACE VIEW public.v_parts_inventory_turns_report AS
WITH stock_base AS (
  SELECT
    s.workspace_id,
    s.id AS stock_id,
    s.part_id,
    s.location_id,
    l.code AS location_code,
    l.name AS location_name,
    coalesce(s.branch_slug, l.branch_slug) AS branch_slug,
    p.part_number,
    p.description,
    p.category,
    s.qty_on_hand,
    coalesce(
      s.average_cost_cents,
      round(coalesce(pc.cost_price, 0)::numeric * 100.0)::bigint,
      0
    ) AS unit_cost_cents,
    coalesce(round(s.qty_on_hand * coalesce(
      s.average_cost_cents,
      round(coalesce(pc.cost_price, 0)::numeric * 100.0)::bigint,
      0
    ))::bigint, 0) AS inventory_value_cents
  FROM public.parts_stock s
  JOIN public.parts p
    ON p.id = s.part_id
  LEFT JOIN public.parts_locations l
    ON l.id = s.location_id
  LEFT JOIN public.parts_catalog pc
    ON pc.id = p.parts_catalog_id
  WHERE s.deleted_at IS NULL
    AND p.deleted_at IS NULL
),
sales_365 AS (
  SELECT
    o.workspace_id,
    part_match.part_id,
    sum(l.quantity)::numeric(14, 4) AS annual_sales_qty,
    coalesce(sum(round(coalesce(
      l.line_total,
      coalesce(l.final_unit_price, l.unit_price, 0) * l.quantity,
      0
    )::numeric * 100.0)::bigint), 0)::bigint AS annual_revenue_cents,
    coalesce(sum(round(coalesce(
      l.unit_cost,
      pc.cost_price,
      0
    )::numeric * l.quantity * 100.0)::bigint), 0)::bigint AS annual_cogs_cents
  FROM public.parts_orders o
  JOIN public.parts_order_lines l
    ON l.parts_order_id = o.id
   AND l.workspace_id = o.workspace_id
  LEFT JOIN LATERAL (
    SELECT p.id AS part_id, p.parts_catalog_id
    FROM public.parts p
    WHERE p.workspace_id = o.workspace_id
      AND p.deleted_at IS NULL
      AND (
        p.id = l.part_id
        OR (
          l.part_id IS NULL
          AND lower(p.part_number) = lower(l.part_number)
        )
      )
    ORDER BY CASE WHEN p.id = l.part_id THEN 0 ELSE 1 END
    LIMIT 1
  ) part_match ON true
  LEFT JOIN public.parts_catalog pc
    ON pc.id = coalesce(l.catalog_item_id, part_match.parts_catalog_id)
  WHERE o.status IN ('confirmed', 'processing', 'shipped', 'delivered')
    AND o.created_at >= now() - interval '365 days'
    AND part_match.part_id IS NOT NULL
  GROUP BY o.workspace_id, part_match.part_id
)
SELECT
  sb.workspace_id,
  sb.location_id,
  coalesce(sb.location_code, 'unassigned') AS location_code,
  coalesce(sb.location_name, 'Unassigned') AS location_name,
  sb.branch_slug,
  sb.part_id,
  sb.part_number,
  sb.description,
  sb.category,
  sb.qty_on_hand,
  sb.inventory_value_cents,
  coalesce(s.annual_sales_qty, 0)::numeric(14, 4) AS annual_sales_qty,
  coalesce(s.annual_revenue_cents, 0)::bigint AS annual_revenue_cents,
  coalesce(s.annual_cogs_cents, 0)::bigint AS annual_cogs_cents,
  (coalesce(s.annual_revenue_cents, 0) - coalesce(s.annual_cogs_cents, 0))::bigint AS annual_gross_margin_cents,
  round(coalesce(s.annual_cogs_cents, 0)::numeric / nullif(sb.inventory_value_cents::numeric, 0), 2) AS inventory_turns,
  round(
    100.0
      * (coalesce(s.annual_revenue_cents, 0) - coalesce(s.annual_cogs_cents, 0))::numeric
      / nullif(coalesce(s.annual_revenue_cents, 0)::numeric, 0),
    2
  ) AS margin_pct,
  round(
    (
      100.0
        * (coalesce(s.annual_revenue_cents, 0) - coalesce(s.annual_cogs_cents, 0))::numeric
        / nullif(coalesce(s.annual_revenue_cents, 0)::numeric, 0)
    ) - public.parts_reporting_margin_target_pct(),
    2
  ) AS margin_vs_target_pct,
  (ds.stock_id IS NOT NULL) AS is_dead_stock_18_months,
  public.parts_dead_stock_months() AS dead_stock_months
FROM stock_base sb
LEFT JOIN sales_365 s
  ON s.workspace_id = sb.workspace_id
 AND s.part_id = sb.part_id
LEFT JOIN public.v_parts_dead_stock_18_months ds
  ON ds.workspace_id = sb.workspace_id
 AND ds.stock_id = sb.stock_id
WHERE (
  (select auth.role()) = 'service_role'
  OR (
    sb.workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_reporting_role()
  )
);

COMMENT ON VIEW public.v_parts_inventory_turns_report IS
  'G13.1 inventory turns report: trailing 365-day sales, COGS, turns, margin by part/category/location, and 35 percent margin target variance.';

CREATE OR REPLACE VIEW public.v_parts_counter_order_report AS
WITH event_rollup AS (
  SELECT
    o.workspace_id,
    o.id AS parts_order_id,
    min(fe.created_at) FILTER (
      WHERE fe.event_type IN (
        'counter_order_picked',
        'order_status_processing',
        'order_status_shipped',
        'order_status_delivered'
      )
    ) AS fulfillment_served_at,
    min(oe.created_at) FILTER (WHERE oe.event_type = 'pick_completed') AS order_pick_completed_at
  FROM public.parts_orders o
  LEFT JOIN public.parts_fulfillment_events fe
    ON fe.workspace_id = o.workspace_id
   AND fe.fulfillment_run_id = o.fulfillment_run_id
  LEFT JOIN public.parts_order_events oe
    ON oe.workspace_id = o.workspace_id
   AND oe.parts_order_id = o.id
  GROUP BY o.workspace_id, o.id
),
order_base_raw AS (
  SELECT
    o.workspace_id,
    o.id AS parts_order_id,
    o.order_source,
    o.status,
    o.po_type,
    o.created_by AS counterperson_id,
    o.originating_parts_quote_id,
    o.fulfillment_run_id,
    o.metadata,
    coalesce(
      nullif(o.metadata ->> 'location_code', ''),
      nullif(o.metadata ->> 'branch_slug', ''),
      nullif(o.metadata ->> 'location', '')
    ) AS location_key,
    o.created_at,
    o.updated_at,
    coalesce(
      er.fulfillment_served_at,
      er.order_pick_completed_at,
      CASE
        WHEN o.status IN ('processing', 'shipped', 'delivered') THEN o.updated_at
        ELSE NULL
      END
    ) AS served_at
  FROM public.parts_orders o
  LEFT JOIN event_rollup er
    ON er.workspace_id = o.workspace_id
   AND er.parts_order_id = o.id
  WHERE o.order_source IN ('counter', 'phone', 'email', 'online', 'voice', 'photo')
    AND o.status <> 'cancelled'
),
order_base AS (
  SELECT
    ob.*,
    (
      ob.served_at IS NOT NULL
      OR ob.status IN ('processing', 'shipped', 'delivered')
    ) AS customer_experienced_fill
  FROM order_base_raw ob
),
line_rollup AS (
  SELECT
    ob.workspace_id,
    ob.parts_order_id,
    count(l.id)::bigint AS line_count,
    coalesce(sum(l.quantity), 0)::numeric(14, 4) AS ordered_qty,
    coalesce(sum(round(coalesce(
      l.line_total,
      coalesce(l.final_unit_price, l.unit_price, 0) * l.quantity,
      0
    )::numeric * 100.0)::bigint), 0)::bigint AS sales_cents,
    coalesce(sum(round(coalesce(
      l.unit_cost,
      pc.cost_price,
      0
    )::numeric * l.quantity * 100.0)::bigint), 0)::bigint AS cogs_cents,
    count(l.id) FILTER (
      WHERE coalesce(l.return_is_special_order, false)
        OR lower(coalesce(l.pricing_metadata ->> 'special_order', 'false')) IN ('true', 't', '1', 'yes')
        OR lower(coalesce(ob.po_type, '')) = 'special_order'
        OR lower(coalesce(ob.metadata ->> 'special_order', 'false')) IN ('true', 't', '1', 'yes')
    )::bigint AS special_order_line_count
  FROM order_base ob
  LEFT JOIN public.parts_order_lines l
    ON l.workspace_id = ob.workspace_id
   AND l.parts_order_id = ob.parts_order_id
  LEFT JOIN LATERAL (
    SELECT p.parts_catalog_id
    FROM public.parts p
    WHERE p.workspace_id = ob.workspace_id
      AND p.deleted_at IS NULL
      AND (
        p.id = l.part_id
        OR (
          l.part_id IS NULL
          AND lower(p.part_number) = lower(l.part_number)
        )
      )
    ORDER BY CASE WHEN p.id = l.part_id THEN 0 ELSE 1 END
    LIMIT 1
  ) part_match ON true
  LEFT JOIN public.parts_catalog pc
    ON pc.id = coalesce(l.catalog_item_id, part_match.parts_catalog_id)
  GROUP BY ob.workspace_id, ob.parts_order_id
)
SELECT
  ob.workspace_id,
  ob.parts_order_id,
  ob.order_source,
  ob.status,
  ob.location_key,
  ob.counterperson_id,
  coalesce(nullif(p.full_name, ''), nullif(p.email, ''), 'Unassigned') AS counterperson_name,
  ob.originating_parts_quote_id,
  (ob.originating_parts_quote_id IS NOT NULL) AS quote_converted_to_sale,
  ob.fulfillment_run_id,
  ob.created_at,
  ob.served_at,
  CASE
    WHEN ob.served_at IS NULL OR ob.served_at < ob.created_at THEN NULL
    ELSE round((extract(epoch FROM (ob.served_at - ob.created_at)) / 60.0)::numeric, 2)
  END AS time_to_serve_minutes,
  lr.line_count,
  lr.ordered_qty,
  CASE WHEN ob.customer_experienced_fill THEN lr.line_count ELSE 0 END::bigint AS filled_line_count,
  CASE WHEN ob.customer_experienced_fill THEN lr.ordered_qty ELSE 0 END::numeric(14, 4) AS filled_qty,
  lr.sales_cents,
  lr.cogs_cents,
  (lr.sales_cents - lr.cogs_cents)::bigint AS gross_margin_cents,
  round(
    100.0 * (lr.sales_cents - lr.cogs_cents)::numeric / nullif(lr.sales_cents::numeric, 0),
    2
  ) AS margin_pct,
  round(
    100.0
      * (CASE WHEN ob.customer_experienced_fill THEN lr.ordered_qty ELSE 0 END)::numeric
      / nullif(lr.ordered_qty::numeric, 0),
    2
  ) AS counter_fill_rate_pct,
  lr.special_order_line_count,
  round(
    100.0 * lr.special_order_line_count::numeric / nullif(lr.line_count::numeric, 0),
    2
  ) AS special_order_ratio_pct,
  'customer_actual_experience'::text AS fill_rate_basis,
  public.parts_reporting_margin_target_pct() AS margin_target_pct
FROM order_base ob
LEFT JOIN line_rollup lr
  ON lr.workspace_id = ob.workspace_id
 AND lr.parts_order_id = ob.parts_order_id
LEFT JOIN public.profiles p
  ON p.id = ob.counterperson_id
WHERE (
  (select auth.role()) = 'service_role'
  OR (
    ob.workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_reporting_role()
  )
);

COMMENT ON VIEW public.v_parts_counter_order_report IS
  'G13.1 counter report base: customer-experience fill rate, volume, margin, special-order ratio, quote conversion, and time to serve per counter order.';

CREATE OR REPLACE VIEW public.v_parts_counterperson_coaching_report AS
SELECT
  workspace_id,
  counterperson_id,
  counterperson_name,
  count(*)::bigint AS order_count,
  coalesce(sum(line_count), 0)::bigint AS line_count,
  coalesce(sum(sales_cents), 0)::bigint AS sales_cents,
  coalesce(sum(gross_margin_cents), 0)::bigint AS gross_margin_cents,
  round(
    100.0 * coalesce(sum(gross_margin_cents), 0)::numeric / nullif(coalesce(sum(sales_cents), 0)::numeric, 0),
    2
  ) AS margin_pct,
  round(
    100.0 * coalesce(sum(filled_qty), 0)::numeric / nullif(coalesce(sum(ordered_qty), 0)::numeric, 0),
    2
  ) AS counter_fill_rate_pct,
  round(
    100.0 * coalesce(sum(special_order_line_count), 0)::numeric / nullif(coalesce(sum(line_count), 0)::numeric, 0),
    2
  ) AS special_order_ratio_pct,
  round(
    100.0
      * count(*) FILTER (WHERE quote_converted_to_sale)::numeric
      / nullif(count(*)::numeric, 0),
    2
  ) AS quote_originated_order_pct,
  round(avg(time_to_serve_minutes)::numeric, 2) AS avg_time_to_serve_minutes,
  'coaching_not_ranking'::text AS coaching_frame,
  jsonb_build_object(
    'framing', 'Per-counterperson metrics are coaching context, not rankings.',
    'headline_metric', 'counter_fill_rate_customer_actual_experience',
    'target_margin_pct', public.parts_reporting_margin_target_pct(),
    'dead_stock_months', public.parts_dead_stock_months()
  ) AS coaching_context
FROM public.v_parts_counter_order_report
GROUP BY workspace_id, counterperson_id, counterperson_name;

COMMENT ON VIEW public.v_parts_counterperson_coaching_report IS
  'G13.1 counterperson coaching report: volume, margin, fill rate, special-order mix, quote-originated orders, and time-to-serve without employee ranking.';

GRANT SELECT ON public.v_parts_inventory_location_report TO authenticated, service_role;
GRANT SELECT ON public.v_parts_inventory_turns_report TO authenticated, service_role;
GRANT SELECT ON public.v_parts_counter_order_report TO authenticated, service_role;
GRANT SELECT ON public.v_parts_counterperson_coaching_report TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_inventory_report(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_start_date date := coalesce(p_start_date, current_date - 365);
  v_end_date date := coalesce(p_end_date, current_date);
  v_report jsonb;
BEGIN
  IF NOT public.qep_parts_reporting_role() THEN
    RAISE EXCEPTION 'Parts reporting role required' USING ERRCODE = '42501';
  END IF;

  IF v_end_date < v_start_date THEN
    RAISE EXCEPTION 'end date must be on or after start date' USING ERRCODE = '22023';
  END IF;

  WITH location_rows AS (
    SELECT *
    FROM public.v_parts_inventory_location_report
    WHERE workspace_id = v_workspace_id
  ),
  turn_rows AS (
    SELECT *
    FROM public.v_parts_inventory_turns_report
    WHERE workspace_id = v_workspace_id
  ),
  location_totals AS (
    SELECT
      coalesce(sum(inventory_value_cents), 0)::bigint AS inventory_value_cents,
      coalesce(sum(dead_stock_value_cents), 0)::bigint AS dead_stock_value_cents,
      coalesce(sum(dead_stock_count), 0)::bigint AS dead_stock_count,
      round(avg(inventory_fill_rate_pct)::numeric, 2) AS inventory_fill_rate_pct
    FROM location_rows
  ),
  turn_totals AS (
    SELECT
      round(avg(inventory_turns)::numeric, 2) AS inventory_turns,
      coalesce(sum(annual_revenue_cents), 0)::bigint AS annual_revenue_cents,
      coalesce(sum(annual_cogs_cents), 0)::bigint AS annual_cogs_cents,
      coalesce(sum(annual_gross_margin_cents), 0)::bigint AS annual_gross_margin_cents,
      round(
        100.0
          * coalesce(sum(annual_gross_margin_cents), 0)::numeric
          / nullif(coalesce(sum(annual_revenue_cents), 0)::numeric, 0),
        2
      ) AS margin_pct
    FROM turn_rows
  )
  SELECT jsonb_build_object(
    'workspace_id', v_workspace_id,
    'report', 'inventory',
    'api_contract', '/v1/reports/inventory',
    'window', jsonb_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date,
      'turns_basis', 'trailing_365_days'
    ),
    'target_margin_pct', public.parts_reporting_margin_target_pct(),
    'dead_stock_months', public.parts_dead_stock_months(),
    'inventory_value_cents', lt.inventory_value_cents,
    'dead_stock_value_cents', lt.dead_stock_value_cents,
    'dead_stock_count', lt.dead_stock_count,
    'inventory_fill_rate_pct', lt.inventory_fill_rate_pct,
    'inventory_turns', tt.inventory_turns,
    'annual_revenue_cents', tt.annual_revenue_cents,
    'annual_cogs_cents', tt.annual_cogs_cents,
    'annual_gross_margin_cents', tt.annual_gross_margin_cents,
    'margin_pct', tt.margin_pct,
    'margin_vs_target_pct', round(tt.margin_pct - public.parts_reporting_margin_target_pct(), 2),
    'locations', coalesce(
      (
        SELECT jsonb_agg(to_jsonb(r) ORDER BY r.inventory_value_cents DESC, r.location_code)
        FROM (
          SELECT
            location_id,
            location_code,
            location_name,
            branch_slug,
            part_count,
            qty_on_hand_total,
            available_qty_total,
            inventory_value_cents,
            dead_stock_value_cents,
            dead_stock_count,
            inventory_fill_rate_pct,
            avg_days_since_movement
          FROM location_rows
          ORDER BY inventory_value_cents DESC, location_code
          LIMIT 50
        ) r
      ),
      '[]'::jsonb
    ),
    'watch_numbers', jsonb_build_object(
      'inventory_turns', tt.inventory_turns,
      'inventory_fill_rate_pct', lt.inventory_fill_rate_pct,
      'dead_stock_value_cents', lt.dead_stock_value_cents,
      'margin_vs_target_pct', round(tt.margin_pct - public.parts_reporting_margin_target_pct(), 2)
    )
  )
  INTO v_report
  FROM location_totals lt
  CROSS JOIN turn_totals tt;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.parts_inventory_report(date, date) IS
  'G13.1 /v1/reports/inventory JSON contract for inventory value, turns, fill rate, 35 percent margin target variance, and ADR-019 dead stock.';

REVOKE ALL ON FUNCTION public.parts_inventory_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_inventory_report(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_counter_report(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := public.get_my_workspace();
  v_start_date date := coalesce(p_start_date, current_date - 30);
  v_end_date date := coalesce(p_end_date, current_date);
  v_report jsonb;
BEGIN
  IF NOT public.qep_parts_reporting_role() THEN
    RAISE EXCEPTION 'Parts reporting role required' USING ERRCODE = '42501';
  END IF;

  IF v_end_date < v_start_date THEN
    RAISE EXCEPTION 'end date must be on or after start date' USING ERRCODE = '22023';
  END IF;

  WITH orders AS (
    SELECT *
    FROM public.v_parts_counter_order_report
    WHERE workspace_id = v_workspace_id
      AND created_at >= v_start_date::timestamptz
      AND created_at < (v_end_date + 1)::timestamptz
  ),
  order_totals AS (
    SELECT
      count(*)::bigint AS order_count,
      coalesce(sum(line_count), 0)::bigint AS line_count,
      coalesce(sum(sales_cents), 0)::bigint AS sales_cents,
      coalesce(sum(gross_margin_cents), 0)::bigint AS gross_margin_cents,
      coalesce(sum(filled_qty), 0)::numeric(14, 4) AS filled_qty,
      coalesce(sum(ordered_qty), 0)::numeric(14, 4) AS ordered_qty,
      coalesce(sum(special_order_line_count), 0)::bigint AS special_order_line_count,
      count(*) FILTER (WHERE quote_converted_to_sale)::bigint AS quote_originated_order_count,
      round(avg(time_to_serve_minutes)::numeric, 2) AS avg_time_to_serve_minutes
    FROM orders
  ),
  quote_totals AS (
    SELECT
      count(*)::bigint AS quote_count,
      count(*) FILTER (
        WHERE converted_parts_order_id IS NOT NULL
          OR converted_to_order_at IS NOT NULL
      )::bigint AS converted_quote_count
    FROM public.parts_quotes q
    WHERE q.workspace_id = v_workspace_id
      AND q.deleted_at IS NULL
      AND q.created_at >= v_start_date::timestamptz
      AND q.created_at < (v_end_date + 1)::timestamptz
      AND q.quote_source IN ('counter', 'phone', 'email', 'walkin', 'service', 'online')
  ),
  coaching_rows AS (
    SELECT coalesce(
      jsonb_agg(to_jsonb(c) ORDER BY c.counterperson_name),
      '[]'::jsonb
    ) AS rows
    FROM (
      SELECT
        counterperson_id,
        counterperson_name,
        count(*)::bigint AS order_count,
        coalesce(sum(sales_cents), 0)::bigint AS sales_cents,
        coalesce(sum(gross_margin_cents), 0)::bigint AS gross_margin_cents,
        round(
          100.0 * coalesce(sum(gross_margin_cents), 0)::numeric / nullif(coalesce(sum(sales_cents), 0)::numeric, 0),
          2
        ) AS margin_pct,
        round(
          100.0 * coalesce(sum(filled_qty), 0)::numeric / nullif(coalesce(sum(ordered_qty), 0)::numeric, 0),
          2
        ) AS counter_fill_rate_pct,
        round(
          100.0 * coalesce(sum(special_order_line_count), 0)::numeric / nullif(coalesce(sum(line_count), 0)::numeric, 0),
          2
        ) AS special_order_ratio_pct,
        round(avg(time_to_serve_minutes)::numeric, 2) AS avg_time_to_serve_minutes,
        'coaching_not_ranking'::text AS coaching_frame
      FROM orders
      GROUP BY counterperson_id, counterperson_name
      ORDER BY counterperson_name
    ) c
  )
  SELECT jsonb_build_object(
    'workspace_id', v_workspace_id,
    'report', 'counter',
    'api_contract', '/v1/reports/counter',
    'window', jsonb_build_object(
      'start_date', v_start_date,
      'end_date', v_end_date
    ),
    'headline_metric', 'counter_fill_rate_customer_actual_experience',
    'target_margin_pct', public.parts_reporting_margin_target_pct(),
    'order_count', ot.order_count,
    'line_count', ot.line_count,
    'sales_cents', ot.sales_cents,
    'gross_margin_cents', ot.gross_margin_cents,
    'margin_pct', round(
      100.0 * ot.gross_margin_cents::numeric / nullif(ot.sales_cents::numeric, 0),
      2
    ),
    'counter_fill_rate_pct', round(
      100.0 * ot.filled_qty::numeric / nullif(ot.ordered_qty::numeric, 0),
      2
    ),
    'special_order_ratio_pct', round(
      100.0 * ot.special_order_line_count::numeric / nullif(ot.line_count::numeric, 0),
      2
    ),
    'quote_to_sale_conversion_pct', round(
      100.0 * qt.converted_quote_count::numeric / nullif(qt.quote_count::numeric, 0),
      2
    ),
    'quote_count', qt.quote_count,
    'converted_quote_count', qt.converted_quote_count,
    'quote_originated_order_count', ot.quote_originated_order_count,
    'average_time_to_serve_minutes', ot.avg_time_to_serve_minutes,
    'coaching_rows', cr.rows,
    'coaching_frame', 'coaching_not_ranking'
  )
  INTO v_report
  FROM order_totals ot
  CROSS JOIN quote_totals qt
  CROSS JOIN coaching_rows cr;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.parts_counter_report(date, date) IS
  'G13.1 /v1/reports/counter JSON contract for counter volume, margin, customer-experience fill rate, quote conversion, special-order mix, time to serve, and coaching rows.';

REVOKE ALL ON FUNCTION public.parts_counter_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_counter_report(date, date) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/672_g131_inventory_counter_reporting.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md section 2 /v1/reports/inventory + /v1/reports/counter') ||
      ' | supabase/migrations/672_g131_inventory_counter_reporting.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G13.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G13.1 shipped: Inventory reporting now exposes value on hand by location, turns, fill rate, 35 percent margin target variance, and 18-month dead stock; counter reporting exposes customer-experience fill rate, special-order mix, quote conversion, time to serve, and coaching-not-ranking counterperson rows.'
  END,
  updated_at = now()
WHERE task_id = 'G13.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G13.1',
  'update',
  jsonb_build_object(
    'reason', 'g131_inventory_counter_reporting_shipped',
    'migration', '672_g131_inventory_counter_reporting.sql',
    'mission_alignment', 'pass: parts managers get weekly watch numbers for turns, fill rate, margin, dead stock, and counter service quality while counterperson metrics remain coaching context rather than employee rankings'
  ),
  'codex'
);

COMMIT;
