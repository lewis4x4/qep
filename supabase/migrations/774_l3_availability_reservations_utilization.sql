-- ============================================================================
-- Migration 774: Stream L / L3 — availability, reservations & utilization
--
-- Blueprint §1.5 + §7.
--   1. rental_reservation_holds: reservations HOLD availability (exact-unit or
--      class/category), maintained by contract-lifecycle triggers:
--      → reserved creates holds, → on_rent converts them, cancel/decline/
--      expire releases them.
--   2. rental_check_availability + rental_availability_calendar: the single
--      deterministic availability answers counter and portal both call — no
--      client-side availability math anywhere.
--   3. Fleet-state v2: next_available_at now considers active holds; H10
--      rental-fleet service jobs drive down-for-service readiness.
--   4. Utilization: rental_compute_utilization returns the three lenses
--      (physical point-in-time, time 30d with service-down days excluded,
--      dollar = annualized invoiced revenue / Σ OEC with documented
--      precedence purchase_price → rental_insurable_amount_cents →
--      rental_amount_cents and data-quality flags for missing OEC).
--      rental_snapshot_utilization writes KPI snapshots per workspace via
--      write_kpi_snapshot; metric definitions seeded; hourly pg_cron.
--      NOTE: dollar utilization reads from rental_invoices — it stays 0 with
--      a data-quality flag until the L5 billing engine writes invoices. The
--      formula is correct from day one; the data arrives with L5.
--
-- Overbooking policy (blueprint): allowed only via explicit manager override
-- → exception_queue('rental_overbook_override'). Enforced at the action layer
-- (rental-ops consults rental_check_availability); DB-level hard enforcement
-- is an L8 hardening candidate once operational patterns settle.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Reservation holds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rental_reservation_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  rental_contract_id uuid NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  rental_contract_line_id uuid REFERENCES public.rental_contract_lines(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES public.qrm_equipment(id) ON DELETE CASCADE,
  equipment_class text,
  equipment_category text,
  hold_start date NOT NULL,
  hold_end date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT rental_holds_scope CHECK (
    equipment_id IS NOT NULL OR equipment_class IS NOT NULL OR equipment_category IS NOT NULL
  ),
  CONSTRAINT rental_holds_window CHECK (hold_end >= hold_start)
);

COMMENT ON TABLE public.rental_reservation_holds IS
  'Reservations HOLD availability (blueprint §1.5): exact-unit holds block that unit; class/category holds consume category supply. Contract lifecycle maintains status: reserved → active, on_rent → converted, cancel/decline/expire → released.';

CREATE INDEX IF NOT EXISTS idx_rental_holds_equipment_window
  ON public.rental_reservation_holds (equipment_id, hold_start, hold_end)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rental_holds_contract
  ON public.rental_reservation_holds (rental_contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_holds_workspace_status
  ON public.rental_reservation_holds (workspace_id, status);

ALTER TABLE public.rental_reservation_holds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.rental_reservation_holds'::regclass
      AND p.polname = 'rental_holds_internal'
  ) THEN
    CREATE POLICY rental_holds_internal ON public.rental_reservation_holds
      USING (workspace_id = (select public.get_my_workspace())
             AND (select public.get_my_role()) IN ('rep', 'admin', 'manager', 'owner'))
      WITH CHECK (workspace_id = (select public.get_my_workspace())
                  AND (select public.get_my_role()) IN ('rep', 'admin', 'manager', 'owner'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.rental_reservation_holds'::regclass
      AND p.polname = 'rental_holds_service'
  ) THEN
    CREATE POLICY rental_holds_service ON public.rental_reservation_holds
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;
END $$;

CREATE TRIGGER set_rental_reservation_holds_updated_at
  BEFORE UPDATE ON public.rental_reservation_holds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Hold lifecycle from contract transitions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_maintain_reservation_holds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_lines integer;
BEGIN
  IF NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
    RETURN NULL;
  END IF;

  IF NEW.lifecycle_state = 'reserved' THEN
    v_start := COALESCE(NEW.approved_start_date, NEW.requested_start_date);
    v_end := COALESCE(NEW.approved_end_date, NEW.requested_end_date);

    -- One hold per line with a unit; otherwise a header-level hold on the
    -- assigned unit or the requested class/category.
    SELECT count(*) INTO v_lines
    FROM public.rental_contract_lines l
    WHERE l.rental_contract_id = NEW.id AND l.deleted_at IS NULL AND l.equipment_id IS NOT NULL;

    IF v_lines > 0 THEN
      INSERT INTO public.rental_reservation_holds
        (workspace_id, rental_contract_id, rental_contract_line_id, equipment_id, hold_start, hold_end)
      SELECT NEW.workspace_id, NEW.id, l.id, l.equipment_id,
             COALESCE(l.rental_start_at::date, v_start), COALESCE(l.rental_end_at::date, v_end)
      FROM public.rental_contract_lines l
      WHERE l.rental_contract_id = NEW.id AND l.deleted_at IS NULL AND l.equipment_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.rental_reservation_holds h
          WHERE h.rental_contract_line_id = l.id AND h.status = 'active' AND h.deleted_at IS NULL
        );
    ELSIF NEW.equipment_id IS NOT NULL
          OR NEW.equipment_class IS NOT NULL
          OR NEW.requested_category IS NOT NULL THEN
      INSERT INTO public.rental_reservation_holds
        (workspace_id, rental_contract_id, equipment_id, equipment_class, equipment_category, hold_start, hold_end)
      SELECT NEW.workspace_id, NEW.id, NEW.equipment_id, NEW.equipment_class, NEW.requested_category, v_start, v_end
      WHERE NOT EXISTS (
        SELECT 1 FROM public.rental_reservation_holds h
        WHERE h.rental_contract_id = NEW.id AND h.rental_contract_line_id IS NULL
          AND h.status = 'active' AND h.deleted_at IS NULL
      );
    END IF;

  ELSIF NEW.lifecycle_state = 'on_rent' THEN
    UPDATE public.rental_reservation_holds
    SET status = 'converted'
    WHERE rental_contract_id = NEW.id AND status = 'active';

  ELSIF NEW.lifecycle_state IN ('cancelled', 'declined', 'expired') THEN
    UPDATE public.rental_reservation_holds
    SET status = 'released'
    WHERE rental_contract_id = NEW.id AND status = 'active';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_contracts_holds ON public.rental_contracts;
CREATE TRIGGER trg_rental_contracts_holds
  AFTER UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_maintain_reservation_holds();

-- ---------------------------------------------------------------------------
-- 3. Availability — the deterministic answers
-- ---------------------------------------------------------------------------

-- Category is the fleet-supply dimension (qrm_equipment has category, not
-- class); holds still carry equipment_class for contract-declared class holds,
-- which count against category demand via their contract's requested category.
CREATE OR REPLACE FUNCTION public.rental_check_availability(
  p_workspace_id text,
  p_start date,
  p_end date,
  p_equipment_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicts jsonb := '[]'::jsonb;
  v_available boolean;
  v_fleet integer;
  v_demand integer;
  v_candidates jsonb := '[]'::jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION 'valid start/end dates required';
  END IF;

  IF p_equipment_id IS NOT NULL THEN
    -- Exact unit: any overlapping active hold, any on-rent/held/off-rent line
    -- overlap, or down-for-service readiness blocks it.
    SELECT COALESCE(jsonb_agg(conflict), '[]'::jsonb) INTO v_conflicts FROM (
      SELECT jsonb_build_object('kind', 'hold', 'id', h.id, 'from', h.hold_start, 'to', h.hold_end,
                                'contract_id', h.rental_contract_id) AS conflict
      FROM public.rental_reservation_holds h
      WHERE h.equipment_id = p_equipment_id AND h.workspace_id = p_workspace_id
        AND h.status = 'active' AND h.deleted_at IS NULL
        AND h.hold_start <= p_end AND h.hold_end >= p_start
      UNION ALL
      SELECT jsonb_build_object('kind', 'on_rent_line', 'id', l.id,
                                'from', l.rental_start_at::date, 'to', COALESCE(l.rental_end_at::date, p_end),
                                'contract_id', l.rental_contract_id)
      FROM public.rental_contract_lines l
      WHERE l.equipment_id = p_equipment_id AND l.workspace_id = p_workspace_id
        AND l.deleted_at IS NULL AND l.status IN ('active', 'held', 'off_rent')
        AND COALESCE(l.rental_start_at::date, p_start) <= p_end
        AND COALESCE(l.rental_end_at::date, p_end) >= p_start
      UNION ALL
      SELECT jsonb_build_object('kind', 'down_for_service', 'id', e.id, 'from', NULL, 'to', NULL, 'contract_id', NULL)
      FROM public.qrm_equipment e
      WHERE e.id = p_equipment_id AND e.workspace_id = p_workspace_id
        AND e.readiness_status = 'in_service'
    ) conflicts;

    v_available := jsonb_array_length(v_conflicts) = 0;

    IF NOT v_available THEN
      -- Substitution candidates: available same-class fleet units.
      SELECT COALESCE(jsonb_agg(jsonb_build_object('equipment_id', c.id, 'label',
               concat_ws(' ', c.year::text, c.make, c.model))), '[]'::jsonb)
      INTO v_candidates
      FROM public.qrm_equipment c
      JOIN public.qrm_equipment target ON target.id = p_equipment_id
      WHERE c.workspace_id = p_workspace_id
        AND c.ownership = 'rental_fleet'
        AND c.id <> p_equipment_id
        AND c.availability = 'available'
        AND COALESCE(c.readiness_status, 'available') <> 'in_service'
        AND (target.category IS NULL OR c.category = target.category)
      LIMIT 5;
    END IF;

    RETURN jsonb_build_object(
      'scope', 'unit', 'available', v_available, 'conflicts', v_conflicts,
      'substitution_candidates', v_candidates);
  END IF;

  IF p_category IS NULL THEN
    RAISE EXCEPTION 'category (or equipment_id) scope required';
  END IF;

  -- Category scope: fleet supply minus overlapping demand.
  SELECT count(*) INTO v_fleet
  FROM public.qrm_equipment e
  WHERE e.workspace_id = p_workspace_id AND e.ownership = 'rental_fleet'
    AND e.availability <> 'decommissioned'
    AND e.category::text = p_category;

  SELECT count(*) INTO v_demand FROM (
    SELECT h.id FROM public.rental_reservation_holds h
    LEFT JOIN public.qrm_equipment he ON he.id = h.equipment_id
    WHERE h.workspace_id = p_workspace_id AND h.status = 'active' AND h.deleted_at IS NULL
      AND h.hold_start <= p_end AND h.hold_end >= p_start
      AND (h.equipment_category = p_category OR he.category::text = p_category)
    UNION ALL
    SELECT l.id FROM public.rental_contract_lines l
    JOIN public.qrm_equipment le ON le.id = l.equipment_id
    WHERE l.workspace_id = p_workspace_id AND l.deleted_at IS NULL
      AND l.status IN ('active', 'held', 'off_rent')
      AND COALESCE(l.rental_start_at::date, p_start) <= p_end
      AND COALESCE(l.rental_end_at::date, p_end) >= p_start
      AND le.category::text = p_category
      -- avoid double counting a line whose hold is still active
      AND NOT EXISTS (
        SELECT 1 FROM public.rental_reservation_holds h2
        WHERE h2.rental_contract_line_id = l.id AND h2.status = 'active' AND h2.deleted_at IS NULL
      )
  ) demand;

  RETURN jsonb_build_object(
    'scope', 'category', 'available', v_fleet - v_demand > 0,
    'fleet_count', v_fleet, 'overlapping_demand', v_demand,
    'headroom', v_fleet - v_demand);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_check_availability(text, date, date, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_check_availability(text, date, date, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rental_availability_calendar(
  p_workspace_id text,
  p_from date,
  p_to date,
  p_equipment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'calendar range must be 0-92 days';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'equipment_id', gs.equipment_id,
      'date', gs.day,
      'state', gs.state
    ) ORDER BY gs.equipment_id, gs.day)
    FROM (
      SELECT e.id AS equipment_id, d.day::date AS day,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.rental_contract_lines l
            WHERE l.equipment_id = e.id AND l.deleted_at IS NULL
              AND l.status IN ('active', 'held', 'off_rent')
              AND COALESCE(l.rental_start_at::date, d.day::date) <= d.day::date
              AND COALESCE(l.rental_end_at::date, d.day::date) >= d.day::date
          ) THEN 'on_rent'
          WHEN e.readiness_status = 'in_service' THEN 'down_for_service'
          WHEN EXISTS (
            SELECT 1 FROM public.rental_reservation_holds h
            WHERE h.equipment_id = e.id AND h.status = 'active' AND h.deleted_at IS NULL
              AND h.hold_start <= d.day::date AND h.hold_end >= d.day::date
          ) THEN 'reserved'
          ELSE 'available'
        END AS state
      FROM public.qrm_equipment e
      CROSS JOIN generate_series(p_from, p_to, interval '1 day') AS d(day)
      WHERE e.workspace_id = p_workspace_id
        AND e.ownership = 'rental_fleet'
        AND e.availability <> 'decommissioned'
        AND (p_equipment_id IS NULL OR e.id = p_equipment_id)
    ) gs
  ), '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_availability_calendar(text, date, date, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_availability_calendar(text, date, date, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Fleet-state v2: holds feed next_available_at; H10 drives down-for-service
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_recompute_equipment_fleet_state(p_equipment uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_available timestamptz;
  v_on_rent boolean;
BEGIN
  IF p_equipment IS NULL THEN
    RETURN;
  END IF;

  SELECT
    bool_or(src.on_rent),
    max(src.until)
  INTO v_on_rent, v_next_available
  FROM (
    SELECT l.status IN ('active', 'off_rent', 'held') AS on_rent, l.rental_end_at AS until
    FROM public.rental_contract_lines l
    WHERE l.equipment_id = p_equipment
      AND l.deleted_at IS NULL
      AND l.status IN ('reserved', 'active', 'off_rent', 'held')
    UNION ALL
    SELECT false, (h.hold_end + 1)::timestamptz
    FROM public.rental_reservation_holds h
    WHERE h.equipment_id = p_equipment AND h.status = 'active' AND h.deleted_at IS NULL
  ) src;

  UPDATE public.qrm_equipment e
  SET
    availability = CASE
      WHEN COALESCE(v_on_rent, false) THEN 'rented'
      WHEN e.availability = 'rented' THEN 'available'
      ELSE e.availability
    END,
    readiness_status = CASE
      WHEN e.readiness_status = 'in_service' THEN e.readiness_status  -- H10 owns this
      WHEN COALESCE(v_on_rent, false) THEN 'on_rent'
      WHEN e.readiness_status = 'on_rent' THEN 'available'
      ELSE e.readiness_status
    END,
    next_available_at = v_next_available
  WHERE e.id = p_equipment;
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_holds_fleet_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.rental_recompute_equipment_fleet_state(OLD.equipment_id);
  ELSE
    PERFORM public.rental_recompute_equipment_fleet_state(NEW.equipment_id);
    IF TG_OP = 'UPDATE' AND OLD.equipment_id IS DISTINCT FROM NEW.equipment_id THEN
      PERFORM public.rental_recompute_equipment_fleet_state(OLD.equipment_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_holds_fleet_state ON public.rental_reservation_holds;
CREATE TRIGGER trg_rental_holds_fleet_state
  AFTER INSERT OR UPDATE OF status, equipment_id, hold_end OR DELETE
  ON public.rental_reservation_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_holds_fleet_state();

CREATE OR REPLACE FUNCTION public.rental_h10_down_for_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine uuid;
  v_open integer;
  v_relevant boolean;
BEGIN
  -- Relevant when the row is (or WAS) rental-fleet maintenance — a
  -- reclassification away must also release down-for-service.
  IF TG_OP = 'INSERT' THEN
    v_machine := NEW.machine_id;
    v_relevant := NEW.service_internal_work_class = 'rental_fleet_maintenance';
  ELSE
    v_machine := COALESCE(NEW.machine_id, OLD.machine_id);
    v_relevant := COALESCE(NEW.service_internal_work_class, '') = 'rental_fleet_maintenance'
               OR COALESCE(OLD.service_internal_work_class, '') = 'rental_fleet_maintenance';
  END IF;
  IF v_machine IS NULL OR NOT COALESCE(v_relevant, false) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_open
  FROM public.service_jobs j
  WHERE j.machine_id = v_machine
    AND j.service_internal_work_class = 'rental_fleet_maintenance'
    AND j.closed_at IS NULL;

  IF v_open > 0 THEN
    UPDATE public.qrm_equipment
    SET readiness_status = 'in_service'
    WHERE id = v_machine AND ownership = 'rental_fleet';
  ELSE
    UPDATE public.qrm_equipment
    SET readiness_status = 'available'
    WHERE id = v_machine AND ownership = 'rental_fleet' AND readiness_status = 'in_service';
    PERFORM public.rental_recompute_equipment_fleet_state(v_machine);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_h10_down_for_service ON public.service_jobs;
CREATE TRIGGER trg_rental_h10_down_for_service
  AFTER INSERT OR UPDATE OF closed_at, service_internal_work_class
  ON public.service_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_h10_down_for_service();

-- ---------------------------------------------------------------------------
-- 5. Utilization — the three lenses + snapshots
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_compute_utilization(p_workspace_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fleet integer;
  v_on_rent integer;
  v_window_start date := CURRENT_DATE - 30;
  v_on_rent_days numeric := 0;
  v_down_days numeric := 0;
  v_available_days numeric;
  v_oec_cents numeric := 0;
  v_missing_oec integer := 0;
  v_revenue_365_cents numeric := 0;
  v_run_rate numeric := 0;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE availability = 'rented')
  INTO v_fleet, v_on_rent
  FROM public.qrm_equipment
  WHERE workspace_id = p_workspace_id AND ownership = 'rental_fleet'
    AND availability <> 'decommissioned';

  IF v_fleet = 0 THEN
    RETURN jsonb_build_object(
      'fleet_count', 0, 'physical_pct', NULL, 'time_pct_30d', NULL,
      'dollar_pct', NULL, 'on_rent_revenue_run_rate_cents', 0,
      'missing_oec_count', 0, 'notes', 'no rental fleet');
  END IF;

  -- Time utilization (trailing 30d): on-rent line-days over fleet-available
  -- days; H10 down-for-service days shrink the denominator.
  SELECT COALESCE(sum(
    GREATEST(0, LEAST(COALESCE(l.actual_returned_at::date, CURRENT_DATE), CURRENT_DATE)
                 - GREATEST(l.rental_start_at::date, v_window_start) + 1)
  ), 0)
  INTO v_on_rent_days
  FROM public.rental_contract_lines l
  JOIN public.qrm_equipment e ON e.id = l.equipment_id
  WHERE l.workspace_id = p_workspace_id AND l.deleted_at IS NULL
    AND e.ownership = 'rental_fleet'
    AND l.rental_start_at IS NOT NULL
    AND l.status IN ('active', 'held', 'off_rent', 'returned', 'exchanged')
    AND l.rental_start_at::date <= CURRENT_DATE
    AND COALESCE(l.actual_returned_at::date, CURRENT_DATE) >= v_window_start;

  SELECT COALESCE(sum(
    GREATEST(0, LEAST(COALESCE(j.closed_at::date, CURRENT_DATE), CURRENT_DATE)
                 - GREATEST(j.created_at::date, v_window_start) + 1)
  ), 0)
  INTO v_down_days
  FROM public.service_jobs j
  JOIN public.qrm_equipment e ON e.id = j.machine_id
  WHERE j.workspace_id = p_workspace_id
    AND e.ownership = 'rental_fleet'
    AND j.service_internal_work_class = 'rental_fleet_maintenance'
    AND j.created_at::date <= CURRENT_DATE
    AND COALESCE(j.closed_at::date, CURRENT_DATE) >= v_window_start;

  v_available_days := GREATEST(1, v_fleet * 30 - v_down_days);

  -- Dollar utilization: annualized invoiced rental revenue / Σ OEC.
  -- OEC precedence: purchase_price (dollars) → rental_insurable_amount_cents
  -- → rental_amount_cents; units with no OEC are excluded and counted.
  SELECT
    COALESCE(sum(COALESCE(purchase_price * 100, rental_insurable_amount_cents, rental_amount_cents)), 0),
    count(*) FILTER (WHERE COALESCE(purchase_price * 100, rental_insurable_amount_cents, rental_amount_cents) IS NULL)
  INTO v_oec_cents, v_missing_oec
  FROM public.qrm_equipment
  WHERE workspace_id = p_workspace_id AND ownership = 'rental_fleet'
    AND availability <> 'decommissioned';

  SELECT COALESCE(sum(i.total_cents), 0) INTO v_revenue_365_cents
  FROM public.rental_invoices i
  WHERE i.workspace_id = p_workspace_id AND i.deleted_at IS NULL
    AND i.status IN ('posted', 'sent', 'partial', 'paid')
    AND i.created_at >= CURRENT_DATE - 365;

  -- On-rent revenue run rate: monthly-equivalent of live contracts.
  SELECT COALESCE(sum(
    COALESCE(c.agreed_monthly_rate, c.agreed_weekly_rate * 4, c.agreed_daily_rate * 28, 0) * 100
  ), 0)
  INTO v_run_rate
  FROM public.rental_contracts c
  WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
    AND c.lifecycle_state = 'on_rent';

  RETURN jsonb_build_object(
    'fleet_count', v_fleet,
    'physical_pct', round(100.0 * v_on_rent / v_fleet, 1),
    'time_pct_30d', round(100.0 * v_on_rent_days / v_available_days, 1),
    'dollar_pct', CASE WHEN v_oec_cents > 0
      THEN round(100.0 * v_revenue_365_cents / v_oec_cents, 1) ELSE NULL END,
    'on_rent_revenue_run_rate_cents', v_run_rate,
    'on_rent_days_30d', v_on_rent_days,
    'down_days_30d', v_down_days,
    'oec_cents', v_oec_cents,
    'missing_oec_count', v_missing_oec,
    'revenue_365_cents', v_revenue_365_cents
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_compute_utilization(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_compute_utilization(text) TO authenticated, service_role;

-- Rental becomes a first-class KPI category (additive CHECK rebuild,
-- same pattern as the exception-queue source family).
ALTER TABLE public.analytics_metric_definitions DROP CONSTRAINT IF EXISTS analytics_metric_definitions_display_category_check;
ALTER TABLE public.analytics_metric_definitions ADD CONSTRAINT analytics_metric_definitions_display_category_check
  CHECK (display_category = ANY (ARRAY['financial', 'pipeline', 'operations', 'finance_controls', 'logistics', 'inventory', 'synthetic', 'data_quality', 'rental']));

INSERT INTO public.analytics_metric_definitions (metric_key, label, description, formula_text, display_category, owner_role, source_tables, refresh_cadence)
VALUES
  ('rental_physical_utilization_pct', 'Rental physical utilization',
   'Units on rent as a share of the rentable fleet, point-in-time.',
   'on-rent units ÷ rentable fleet × 100', 'rental', 'coo',
   '["qrm_equipment"]'::jsonb, 'hourly'),
  ('rental_time_utilization_pct_30d', 'Rental time utilization (30d)',
   'On-rent line-days over fleet-available days, trailing 30 days; H10 down-for-service days shrink the denominator.',
   'Σ on-rent days ÷ (fleet × 30 − service-down days) × 100', 'rental', 'coo',
   '["rental_contract_lines","service_jobs","qrm_equipment"]'::jsonb, 'hourly'),
  ('rental_dollar_utilization_pct', 'Rental dollar utilization',
   'Annualized invoiced rental revenue over the fleet''s original equipment cost. OEC precedence: purchase_price → rental_insurable_amount_cents → rental_amount_cents; units missing OEC are excluded and surfaced as a data-quality count. Reads 0 until the L5 billing engine writes invoices.',
   'trailing-365d rental invoice revenue ÷ Σ fleet OEC × 100', 'rental', 'ceo',
   '["rental_invoices","qrm_equipment"]'::jsonb, 'hourly'),
  ('rental_on_rent_revenue_run_rate', 'Rental on-rent run rate',
   'Monthly-equivalent revenue of contracts currently on rent (agreed month rate, else week×4, else day×28).',
   'Σ monthly-equivalent agreed rates on on-rent contracts', 'rental', 'ceo',
   '["rental_contracts"]'::jsonb, 'hourly')
ON CONFLICT (metric_key) DO UPDATE SET
  label = EXCLUDED.label,
  owner_role = EXCLUDED.owner_role,
  description = EXCLUDED.description,
  formula_text = EXCLUDED.formula_text,
  display_category = EXCLUDED.display_category,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.rental_snapshot_utilization()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws record;
  v_util jsonb;
  v_written integer := 0;
  v_quality numeric;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT workspace_id FROM public.qrm_equipment
    WHERE ownership = 'rental_fleet' AND availability <> 'decommissioned'
  LOOP
    v_util := public.rental_compute_utilization(v_ws.workspace_id);
    IF (v_util->>'fleet_count')::int = 0 THEN CONTINUE; END IF;

    v_quality := CASE WHEN (v_util->>'missing_oec_count')::int > 0 THEN 0.7 ELSE 1.0 END;

    PERFORM public.write_kpi_snapshot(v_ws.workspace_id, 'rental_physical_utilization_pct',
      NULLIF(v_util->>'physical_pct', '')::numeric, 1.0, CURRENT_DATE, CURRENT_DATE, 'fresh', v_util);
    PERFORM public.write_kpi_snapshot(v_ws.workspace_id, 'rental_time_utilization_pct_30d',
      NULLIF(v_util->>'time_pct_30d', '')::numeric, 1.0, CURRENT_DATE - 30, CURRENT_DATE, 'fresh', v_util);
    PERFORM public.write_kpi_snapshot(v_ws.workspace_id, 'rental_dollar_utilization_pct',
      NULLIF(v_util->>'dollar_pct', '')::numeric, v_quality, CURRENT_DATE - 365, CURRENT_DATE, 'fresh', v_util);
    PERFORM public.write_kpi_snapshot(v_ws.workspace_id, 'rental_on_rent_revenue_run_rate',
      (v_util->>'on_rent_revenue_run_rate_cents')::numeric / 100.0, 1.0, CURRENT_DATE, CURRENT_DATE, 'fresh', v_util);
    v_written := v_written + 4;
  END LOOP;
  RETURN v_written;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rental-utilization-snapshot-hourly') THEN
    PERFORM cron.schedule(
      'rental-utilization-snapshot-hourly',
      '20 * * * *',
      $cron$SELECT public.rental_snapshot_utilization()$cron$
    );
  END IF;
END $$;

COMMIT;
