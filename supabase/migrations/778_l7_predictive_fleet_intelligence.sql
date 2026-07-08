-- ============================================================================
-- Migration 778: Stream L / L7 — predictive fleet intelligence, yield,
--                telematics/geofence seams
--
-- Blueprint §8. Advisory-first throughout: every signal carries its drivers
-- (the AI-confidence rule), and nothing changes a price or a contract on its
-- own — yield writes INACTIVE draft rate rules requiring human activation.
--
--   1. rental_demand_forecasts (parts_demand_forecasts clone, category-keyed)
--      + rental_forecast_demand(): peak concurrent demand (active holds +
--      on-rent lines) vs fleet supply per category over the next 60 days →
--      shortfall forecasts ("short N units of class X in <month>") with
--      drivers + confidence; daily cron.
--   2. rental_disposal_signals(): per-unit advisory joining trailing-365
--      attributed rental revenue, H10 internal service cost postings, OEC,
--      and age → 'consider_disposal' recommendations. Function-only (cards
--      read it live); no table, no side effects.
--   3. rental_yield_suggestions(p_write): utilization-conditioned rate
--      suggestions (>80% category time-util → premium; <40% with idle iron →
--      discount). p_write=true persists them as INACTIVE rental_rate_rules
--      drafts ('YIELD DRAFT: …'). NO cron registers the write path — the
--      rollout flag is a human turning it on.
--   4. rental_telematics_overage_check(): telematics last_hours vs outbound
--      meters + included-hours allowance on live lines → early-warning
--      rental.telematics.overage events (20h dedup).
--   5. Geofence seam: AFTER INSERT trigger on geofence_events — an 'exited'
--      event for an on-rent unit enqueues exception_queue('geofence_conflict')
--      and emits rental.geofence.exit (the off-rent inspection prompt the
--      April master roadmap specced).
--   6. rental_intelligence_scan() wrapper + daily 04:10 UTC cron.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Demand forecasts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rental_demand_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  category text NOT NULL,
  forecast_month date NOT NULL,
  predicted_demand numeric,
  fleet_count_at_forecast integer,
  shortfall numeric,
  shortage_risk text CHECK (shortage_risk IN ('none', 'tight', 'short')),
  recommendation text,
  drivers jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL DEFAULT 'v1-peak-concurrency',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, category, forecast_month)
);

ALTER TABLE public.rental_demand_forecasts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.rental_demand_forecasts'::regclass AND p.polname = 'rental_forecasts_internal') THEN
    CREATE POLICY rental_forecasts_internal ON public.rental_demand_forecasts
      USING (workspace_id = public.get_my_workspace()
             AND public.get_my_role() IN ('rep', 'admin', 'manager', 'owner'))
      WITH CHECK (workspace_id = public.get_my_workspace()
                  AND public.get_my_role() IN ('rep', 'admin', 'manager', 'owner'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.rental_demand_forecasts'::regclass AND p.polname = 'rental_forecasts_service') THEN
    CREATE POLICY rental_forecasts_service ON public.rental_demand_forecasts
      USING ((SELECT auth.role()) = 'service_role')
      WITH CHECK ((SELECT auth.role()) = 'service_role');
  END IF;
END $$;

CREATE TRIGGER set_rental_demand_forecasts_updated_at
  BEFORE UPDATE ON public.rental_demand_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.rental_forecast_demand()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_written integer := 0;
BEGIN
  FOR v_row IN
    WITH fleet AS (
      SELECT e.workspace_id, e.category::text AS category, count(*) AS fleet_count
      FROM public.qrm_equipment e
      WHERE e.ownership = 'rental_fleet' AND e.availability <> 'decommissioned'
        AND e.category IS NOT NULL
      GROUP BY e.workspace_id, e.category
    ),
    demand_days AS (
      -- Per category per future day (next 60): concurrent holds + on-rent lines.
      SELECT f.workspace_id, f.category, d.day::date AS day,
        (SELECT count(*) FROM public.rental_reservation_holds h
          LEFT JOIN public.qrm_equipment he ON he.id = h.equipment_id
          WHERE h.workspace_id = f.workspace_id AND h.status = 'active' AND h.deleted_at IS NULL
            AND h.hold_start <= d.day::date AND h.hold_end >= d.day::date
            AND (h.equipment_category = f.category OR he.category::text = f.category))
        +
        (SELECT count(*) FROM public.rental_contract_lines l
          JOIN public.qrm_equipment le ON le.id = l.equipment_id
          WHERE l.workspace_id = f.workspace_id AND l.deleted_at IS NULL
            AND l.status IN ('active', 'held', 'off_rent')
            AND le.category::text = f.category
            AND COALESCE(l.rental_start_at::date, d.day::date) <= d.day::date
            AND COALESCE(l.rental_end_at::date, d.day::date) >= d.day::date
            AND NOT EXISTS (SELECT 1 FROM public.rental_reservation_holds h2
              WHERE h2.rental_contract_line_id = l.id AND h2.status = 'active' AND h2.deleted_at IS NULL)
        ) AS demand
      FROM fleet f
      CROSS JOIN generate_series(CURRENT_DATE, CURRENT_DATE + 60, interval '1 day') AS d(day)
    ),
    monthly AS (
      SELECT workspace_id, category, date_trunc('month', day)::date AS forecast_month,
             max(demand) AS peak_demand, count(*) FILTER (WHERE demand > 0) AS demand_days
      FROM demand_days
      GROUP BY workspace_id, category, date_trunc('month', day)
    )
    SELECT m.workspace_id, m.category, m.forecast_month, m.peak_demand, m.demand_days,
           f.fleet_count, GREATEST(0, m.peak_demand - f.fleet_count) AS shortfall
    FROM monthly m JOIN fleet f USING (workspace_id, category)
  LOOP
    INSERT INTO public.rental_demand_forecasts AS rdf
      (workspace_id, category, forecast_month, predicted_demand, fleet_count_at_forecast,
       shortfall, shortage_risk, recommendation, drivers, computed_at)
    VALUES (
      v_row.workspace_id, v_row.category, v_row.forecast_month, v_row.peak_demand,
      v_row.fleet_count, v_row.shortfall,
      CASE WHEN v_row.shortfall > 0 THEN 'short'
           WHEN v_row.peak_demand >= v_row.fleet_count THEN 'tight'
           ELSE 'none' END,
      CASE WHEN v_row.shortfall > 0 THEN
        format('Short %s unit(s) of %s in %s — acquire or pre-source re-rent (sub_rental_vendors).',
               v_row.shortfall, v_row.category, to_char(v_row.forecast_month, 'FMMonth'))
      ELSE NULL END,
      jsonb_build_object(
        'peak_concurrent_demand', v_row.peak_demand,
        'fleet_count', v_row.fleet_count,
        'days_with_demand', v_row.demand_days,
        'window', '60d holds + on-rent lines',
        'confidence', CASE WHEN v_row.demand_days >= 20 THEN 'medium' ELSE 'low' END),
      now())
    ON CONFLICT (workspace_id, category, forecast_month) DO UPDATE SET
      predicted_demand = EXCLUDED.predicted_demand,
      fleet_count_at_forecast = EXCLUDED.fleet_count_at_forecast,
      shortfall = EXCLUDED.shortfall,
      shortage_risk = EXCLUDED.shortage_risk,
      recommendation = EXCLUDED.recommendation,
      drivers = EXCLUDED.drivers,
      computed_at = now(),
      updated_at = now();
    v_written := v_written + 1;
  END LOOP;
  RETURN v_written;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Disposal-timing advisory (function-only; feeds the 7C.2 ambition)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_disposal_signals(p_workspace_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'equipment_id', u.id,
    'label', concat_ws(' ', u.year::text, u.make, u.model),
    'oec_cents', u.oec_cents,
    'revenue_365_cents', u.revenue_365_cents,
    'internal_cost_365_cents', u.internal_cost_365_cents,
    'dollar_utilization_pct', CASE WHEN u.oec_cents > 0
      THEN round(100.0 * u.revenue_365_cents / u.oec_cents, 1) END,
    'cost_ratio_pct', CASE WHEN u.oec_cents > 0
      THEN round(100.0 * u.internal_cost_365_cents / u.oec_cents, 1) END,
    'recommendation', CASE
      WHEN u.oec_cents > 0 AND u.internal_cost_365_cents > u.oec_cents * 0.15
           AND u.revenue_365_cents < u.oec_cents * 0.25
        THEN 'consider_disposal'
      WHEN u.oec_cents > 0 AND u.internal_cost_365_cents > u.oec_cents * 0.15
        THEN 'watch_maintenance_curve'
      ELSE 'hold' END,
    'drivers', jsonb_build_object(
      'rule', 'cost>15% OEC and revenue<25% OEC → consider_disposal (advisory only)',
      'window', 'trailing 365d')
  ) ORDER BY u.internal_cost_365_cents DESC), '[]'::jsonb)
  FROM (
    SELECT e.id, e.year, e.make, e.model,
      COALESCE(e.purchase_price * 100, e.rental_insurable_amount_cents, e.rental_amount_cents, 0) AS oec_cents,
      COALESCE((SELECT sum(i.total_cents) FROM public.rental_invoices i
        JOIN public.rental_contracts c ON c.id = i.rental_contract_id
        WHERE c.equipment_id = e.id AND i.deleted_at IS NULL
          AND i.status::text IN ('posted', 'sent', 'partial', 'paid')
          AND i.created_at >= now() - interval '365 days'), 0) AS revenue_365_cents,
      COALESCE((SELECT sum(j.internal_cost_posted_cents) FROM public.service_jobs j
        WHERE j.machine_id = e.id AND j.internal_cost_posted_cents IS NOT NULL
          AND j.created_at >= now() - interval '365 days'), 0) AS internal_cost_365_cents
    FROM public.qrm_equipment e
    WHERE e.workspace_id = p_workspace_id AND e.ownership = 'rental_fleet'
      AND e.availability <> 'decommissioned'
  ) u;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_disposal_signals(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_disposal_signals(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Yield suggestions (advisory-first; p_write persists INACTIVE drafts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_yield_suggestions(
  p_workspace_id text,
  p_write boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_suggestions jsonb := '[]'::jsonb;
  v_suggestion jsonb;
BEGIN
  FOR v_row IN
    SELECT e.category::text AS category, count(*) AS fleet,
      count(*) FILTER (WHERE e.availability = 'rented') AS on_rent,
      count(*) FILTER (WHERE e.availability = 'available'
        AND (e.next_available_at IS NULL OR e.next_available_at < now() - interval '14 days')) AS idle_units,
      round(avg(e.daily_rental_rate) FILTER (WHERE e.daily_rental_rate > 0), 2) AS avg_daily
    FROM public.qrm_equipment e
    WHERE e.workspace_id = p_workspace_id AND e.ownership = 'rental_fleet'
      AND e.availability <> 'decommissioned' AND e.category IS NOT NULL
    GROUP BY e.category
  LOOP
    v_suggestion := NULL;
    IF v_row.fleet > 0 AND v_row.on_rent::numeric / v_row.fleet >= 0.8 THEN
      v_suggestion := jsonb_build_object(
        'category', v_row.category, 'direction', 'premium', 'adjustment_pct', 10,
        'suggested_daily', round(v_row.avg_daily * 1.10, 2),
        'drivers', jsonb_build_object('physical_utilization_pct', round(100.0 * v_row.on_rent / v_row.fleet, 1),
                                      'rule', 'category ≥80% utilized → +10% suggestion'));
    ELSIF v_row.fleet > 0 AND v_row.on_rent::numeric / v_row.fleet < 0.4 AND v_row.idle_units > 0 THEN
      v_suggestion := jsonb_build_object(
        'category', v_row.category, 'direction', 'discount', 'adjustment_pct', -10,
        'suggested_daily', round(v_row.avg_daily * 0.90, 2),
        'drivers', jsonb_build_object('physical_utilization_pct', round(100.0 * v_row.on_rent / v_row.fleet, 1),
                                      'idle_units', v_row.idle_units,
                                      'rule', 'category <40% utilized with idle iron → −10% suggestion'));
    END IF;

    IF v_suggestion IS NOT NULL THEN
      v_suggestions := v_suggestions || v_suggestion;
      IF p_write AND v_row.avg_daily IS NOT NULL THEN
        -- The draft: an INACTIVE rate rule a human must review and activate.
        INSERT INTO public.rental_rate_rules
          (workspace_id, category, daily_rate, weekly_rate, monthly_rate,
           minimum_days, is_active, priority_rank, notes)
        SELECT p_workspace_id, v_row.category,
               (v_suggestion->>'suggested_daily')::numeric,
               round((v_suggestion->>'suggested_daily')::numeric * 3, 2),
               round((v_suggestion->>'suggested_daily')::numeric * 9, 2),
               1, false, 50,
               'YIELD DRAFT (' || (v_suggestion->>'direction') || '): ' || (v_suggestion->'drivers'->>'rule')
                 || ' · util ' || (v_suggestion->'drivers'->>'physical_utilization_pct') || '%'
                 || ' · generated ' || to_char(now(), 'YYYY-MM-DD') || ' · activate to apply'
        WHERE NOT EXISTS (
          SELECT 1 FROM public.rental_rate_rules r
          WHERE r.workspace_id = p_workspace_id AND r.category = v_row.category
            AND r.is_active = false AND r.notes LIKE 'YIELD DRAFT%'
            AND r.created_at > now() - interval '7 days');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('suggestions', v_suggestions, 'written', p_write);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_yield_suggestions(text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_yield_suggestions(text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Telematics overage early warning
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_telematics_overage_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_emitted integer := 0;
BEGIN
  FOR v_row IN
    SELECT c.id AS contract_id, c.workspace_id, c.contract_number, l.id AS line_id,
           tf.last_hours, l.outbound_meter_hours, l.included_hours,
           (tf.last_hours - l.outbound_meter_hours) AS hours_used
    FROM public.rental_contract_lines l
    JOIN public.rental_contracts c ON c.id = l.rental_contract_id
    JOIN public.telematics_feeds tf ON tf.equipment_id = l.equipment_id AND tf.is_active
    WHERE l.deleted_at IS NULL AND l.status IN ('active', 'held')
      AND c.lifecycle_state = 'on_rent'
      AND l.outbound_meter_hours IS NOT NULL
      AND l.included_hours IS NOT NULL AND l.included_hours > 0
      AND tf.last_hours IS NOT NULL
      AND tf.last_hours - l.outbound_meter_hours > l.included_hours * 1.1
      AND NOT EXISTS (
        SELECT 1 FROM public.analytics_events ae
        WHERE ae.flow_event_type = 'rental.telematics.overage'
          AND ae.entity_id = c.id::text AND ae.occurred_at > now() - interval '20 hours')
  LOOP
    PERFORM public.emit_event('rental.telematics.overage', 'rental', 'rental_contract',
      v_row.contract_id::text,
      jsonb_build_object('rental_id', v_row.contract_id, 'contract_number', v_row.contract_number,
        'line_id', v_row.line_id, 'hours_used', v_row.hours_used,
        'included_hours', v_row.included_hours,
        'source', 'telematics_feeds.last_hours'),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  END LOOP;
  RETURN v_emitted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Geofence exit seam
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_geofence_exit_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
BEGIN
  IF NEW.event_type <> 'exited' OR NEW.equipment_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id, c.workspace_id, c.contract_number INTO v_contract
  FROM public.rental_contracts c
  WHERE c.equipment_id = NEW.equipment_id AND c.deleted_at IS NULL
    AND c.lifecycle_state IN ('on_rent', 'off_rent')
  ORDER BY c.on_rent_at DESC NULLS LAST
  LIMIT 1;

  IF v_contract.id IS NULL THEN
    RETURN NULL;  -- not a rented unit; other geofence consumers own it
  END IF;

  PERFORM public.enqueue_exception(
    'geofence_conflict',
    'On-rent unit exited its geofence',
    'error',
    format('Unit on contract %s exited geofence %s at %s — possible unauthorized move or theft; confirm with the customer or dispatch.',
           COALESCE(v_contract.contract_number, v_contract.id::text), NEW.geofence_id, NEW.event_at),
    jsonb_build_object('rental_contract_id', v_contract.id, 'equipment_id', NEW.equipment_id,
                       'geofence_id', NEW.geofence_id, 'event_at', NEW.event_at,
                       'lat', NEW.reading_lat, 'lng', NEW.reading_lng),
    'rental_contracts',
    v_contract.id);

  PERFORM public.emit_event('rental.geofence.exit', 'rental', 'rental_contract',
    v_contract.id::text,
    jsonb_build_object('rental_id', v_contract.id, 'contract_number', v_contract.contract_number,
      'equipment_id', NEW.equipment_id, 'geofence_id', NEW.geofence_id, 'event_at', NEW.event_at),
    v_contract.workspace_id);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_geofence_exit ON public.geofence_events;
CREATE TRIGGER trg_rental_geofence_exit
  AFTER INSERT ON public.geofence_events
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_geofence_exit_guard();

-- ---------------------------------------------------------------------------
-- 6. Daily intelligence scan (forecasts + telematics; yield stays manual)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_intelligence_scan()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forecasts integer;
  v_overages integer;
BEGIN
  v_forecasts := public.rental_forecast_demand();
  v_overages := public.rental_telematics_overage_check();
  RETURN jsonb_build_object('forecast_rows', v_forecasts, 'overage_events', v_overages);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rental-intelligence-daily') THEN
    PERFORM cron.schedule(
      'rental-intelligence-daily',
      '10 4 * * *',
      $cron$SELECT public.rental_intelligence_scan()$cron$
    );
  END IF;
END $$;

COMMIT;
