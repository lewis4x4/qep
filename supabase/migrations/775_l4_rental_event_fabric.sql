-- ============================================================================
-- Migration 775: Stream L / L4 — rental event fabric
--
-- Blueprint §5 (charter §5). The rental.* family finally emits:
--   * Row triggers (mig 174 / Flow Engine pattern) call emit_event() on the
--     lifecycle moments: reservation created, contract opened, off-rent,
--     returned (rental_contracts); exchanged, re-rent sourced
--     (rental_contract_lines); inspected, damage assessed (rental_returns);
--     cycle billed (rental_invoices — ready for the L5 writer).
--   * rental_lifecycle_scan(): the time-based scanner (pure SQL — no edge fn,
--     no service secret) emitting rental.nearing_end (feeding the workflow
--     registered since Wave 6.11), rental.overdue, rental.coi.expiring, and
--     rental.unit.idle_aging, each deduplicated per entity per 20 hours.
--     Registered on pg_cron every 15 minutes.
--
-- Payloads carry enough for flow_resolve_context-free action params
-- (contract number, equipment, customer anchors, dates, locations).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Contract lifecycle emitter
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_emit_contract_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_payload jsonb;
BEGIN
  IF NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
    RETURN NULL;
  END IF;

  v_type := CASE NEW.lifecycle_state
    WHEN 'reserved' THEN 'rental.reservation.created'
    WHEN 'on_rent'  THEN 'rental.contract.opened'
    WHEN 'off_rent' THEN 'rental.off_rent'
    WHEN 'returned' THEN 'rental.returned'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'rental_id', NEW.id,
    'contract_number', NEW.contract_number,
    'contract_type', NEW.contract_type,
    'lifecycle_state', NEW.lifecycle_state,
    'equipment_id', NEW.equipment_id,
    'qrm_company_id', NEW.qrm_company_id,
    'portal_customer_id', NEW.portal_customer_id,
    'branch_id', NEW.branch_id,
    'delivery_required', NEW.delivery_required,
    'delivery_location', NEW.delivery_location,
    'starts_at', COALESCE(NEW.approved_start_date, NEW.requested_start_date),
    'ends_at', COALESCE(NEW.approved_end_date, NEW.requested_end_date),
    'on_rent_at', NEW.on_rent_at,
    'off_rent_at', NEW.off_rent_at,
    'returned_at', NEW.returned_at
  );

  PERFORM public.emit_event(v_type, 'rental', 'rental_contract', NEW.id::text, v_payload, NEW.workspace_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_emit_contract_events ON public.rental_contracts;
CREATE TRIGGER trg_rental_emit_contract_events
  AFTER UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_emit_contract_events();

-- ---------------------------------------------------------------------------
-- 2. Line emitter — exchanges and re-rent sourcing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_emit_line_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.exchange_parent_line_id IS NOT NULL THEN
    PERFORM public.emit_event(
      'rental.contract.exchanged', 'rental', 'rental_contract', NEW.rental_contract_id::text,
      jsonb_build_object(
        'rental_id', NEW.rental_contract_id,
        'new_line_id', NEW.id,
        'parent_line_id', NEW.exchange_parent_line_id,
        'rate_continuous', NEW.exchange_rate_continuous,
        'equipment_id', NEW.equipment_id,
        'substitution_reason', NEW.substitution_reason
      ),
      NEW.workspace_id);
  END IF;

  IF NEW.is_sub_rental THEN
    PERFORM public.emit_event(
      'rental.rerent.sourced', 'rental', 'rental_contract', NEW.rental_contract_id::text,
      jsonb_build_object(
        'rental_id', NEW.rental_contract_id,
        'line_id', NEW.id,
        'sub_rental_vendor_id', NEW.sub_rental_vendor_id,
        'sub_rental_po_number', NEW.sub_rental_po_number,
        'sub_rental_cost_cents', NEW.sub_rental_cost_cents
      ),
      NEW.workspace_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_emit_line_events ON public.rental_contract_lines;
CREATE TRIGGER trg_rental_emit_line_events
  AFTER INSERT ON public.rental_contract_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_emit_line_events();

-- ---------------------------------------------------------------------------
-- 3. Return emitter — inspection completion and damage disposition
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_emit_return_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'decision_pending' AND OLD.status = 'inspection_pending' THEN
    PERFORM public.emit_event(
      'rental.inspected', 'rental', 'rental_return', NEW.id::text,
      jsonb_build_object(
        'return_id', NEW.id,
        'rental_id', NEW.rental_contract_id,
        'equipment_id', NEW.equipment_id,
        'has_charges', NEW.has_charges
      ),
      NEW.workspace_id);
  END IF;

  IF NEW.damage_disposition IS DISTINCT FROM OLD.damage_disposition
     AND OLD.damage_disposition = 'pending' THEN
    PERFORM public.emit_event(
      'rental.damage.assessed', 'rental', 'rental_return', NEW.id::text,
      jsonb_build_object(
        'return_id', NEW.id,
        'rental_id', NEW.rental_contract_id,
        'equipment_id', NEW.equipment_id,
        'disposition', NEW.damage_disposition,
        'damage_charge_cents', NEW.damage_charge_cents,
        'work_order_number', NEW.work_order_number
      ),
      NEW.workspace_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_emit_return_events ON public.rental_returns;
CREATE TRIGGER trg_rental_emit_return_events
  AFTER UPDATE ON public.rental_returns
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_emit_return_events();

-- ---------------------------------------------------------------------------
-- 4. Invoice emitter — ready for the L5 billing writer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_emit_invoice_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.emit_event(
    'rental.cycle.billed', 'rental', 'rental_invoice', NEW.id::text,
    jsonb_build_object(
      'invoice_id', NEW.id,
      'rental_id', NEW.rental_contract_id,
      'invoice_number', NEW.invoice_number,
      'period_start', NEW.period_start,
      'period_end', NEW.period_end,
      'total_cents', NEW.total_cents
    ),
    NEW.workspace_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_emit_invoice_events ON public.rental_invoices;
CREATE TRIGGER trg_rental_emit_invoice_events
  AFTER INSERT ON public.rental_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_emit_invoice_events();

-- ---------------------------------------------------------------------------
-- 5. Time-based scanner (pure SQL; pg_cron every 15 minutes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_lifecycle_scan()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emitted integer := 0;
  v_row record;
BEGIN
  -- rental.nearing_end: on-rent, due within 7 days.
  FOR v_row IN
    SELECT c.id, c.workspace_id, c.contract_number,
           COALESCE(c.approved_end_date, c.requested_end_date) AS ends_at,
           c.equipment_id, c.qrm_company_id
    FROM public.rental_contracts c
    WHERE c.deleted_at IS NULL AND c.lifecycle_state = 'on_rent'
      AND COALESCE(c.approved_end_date, c.requested_end_date)
          BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      AND NOT EXISTS (
        SELECT 1 FROM public.analytics_events ae
        WHERE ae.flow_event_type = 'rental.nearing_end'
          AND ae.entity_id = c.id::text AND ae.occurred_at > now() - interval '20 hours')
  LOOP
    PERFORM public.emit_event('rental.nearing_end', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'ends_at', v_row.ends_at, 'equipment_id', v_row.equipment_id,
        'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  END LOOP;

  -- rental.overdue: past due and the clock is still running (or unit in field).
  FOR v_row IN
    SELECT c.id, c.workspace_id, c.contract_number,
           COALESCE(c.approved_end_date, c.requested_end_date) AS ends_at,
           c.lifecycle_state, c.equipment_id, c.qrm_company_id
    FROM public.rental_contracts c
    WHERE c.deleted_at IS NULL AND c.lifecycle_state IN ('on_rent', 'off_rent')
      AND COALESCE(c.approved_end_date, c.requested_end_date) < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.analytics_events ae
        WHERE ae.flow_event_type = 'rental.overdue'
          AND ae.entity_id = c.id::text AND ae.occurred_at > now() - interval '20 hours')
  LOOP
    PERFORM public.emit_event('rental.overdue', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'ends_at', v_row.ends_at, 'lifecycle_state', v_row.lifecycle_state,
        'days_overdue', CURRENT_DATE - v_row.ends_at,
        'equipment_id', v_row.equipment_id, 'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  END LOOP;

  -- rental.coi.expiring: COI-required contracts whose certificate lapses ≤14d.
  FOR v_row IN
    SELECT c.id, c.workspace_id, c.contract_number, c.coi_expires_at,
           c.qrm_company_id
    FROM public.rental_contracts c
    WHERE c.deleted_at IS NULL AND c.lifecycle_state IN ('reserved', 'on_rent', 'off_rent')
      AND c.coi_required AND c.coi_expires_at IS NOT NULL
      AND c.coi_expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
      AND NOT EXISTS (
        SELECT 1 FROM public.analytics_events ae
        WHERE ae.flow_event_type = 'rental.coi.expiring'
          AND ae.entity_id = c.id::text AND ae.occurred_at > now() - interval '20 hours')
  LOOP
    PERFORM public.emit_event('rental.coi.expiring', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'coi_expires_at', v_row.coi_expires_at, 'qrm_company_id', v_row.qrm_company_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  END LOOP;

  -- rental.unit.idle_aging: off-rent for 3+ days — idle iron awaiting pickup.
  FOR v_row IN
    SELECT c.id, c.workspace_id, c.contract_number, c.off_rent_at, c.equipment_id
    FROM public.rental_contracts c
    WHERE c.deleted_at IS NULL AND c.lifecycle_state = 'off_rent'
      AND c.off_rent_at < now() - interval '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.analytics_events ae
        WHERE ae.flow_event_type = 'rental.unit.idle_aging'
          AND ae.entity_id = c.id::text AND ae.occurred_at > now() - interval '20 hours')
  LOOP
    PERFORM public.emit_event('rental.unit.idle_aging', 'rental', 'rental_contract', v_row.id::text,
      jsonb_build_object('rental_id', v_row.id, 'contract_number', v_row.contract_number,
        'off_rent_at', v_row.off_rent_at,
        'idle_days', EXTRACT(day FROM now() - v_row.off_rent_at)::int,
        'equipment_id', v_row.equipment_id),
      v_row.workspace_id);
    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rental-lifecycle-scan-15m') THEN
    PERFORM cron.schedule(
      'rental-lifecycle-scan-15m',
      '*/15 * * * *',
      $cron$SELECT public.rental_lifecycle_scan()$cron$
    );
  END IF;
END $$;

COMMIT;
