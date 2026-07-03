-- ============================================================================
-- Migration 684: H10.1 internal and rental-fleet service
--
-- Internal work orders use the normal service capture path, but customer
-- invoicing is blocked unless the job is explicitly renter-fault billable.
-- Non-billable internal cost posts to a destination ledger for used-unit
-- landed cost, rental fleet, or new-unit prep.
-- ============================================================================

BEGIN;

ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS service_internal_work_class text,
  ADD COLUMN IF NOT EXISTS service_internal_cost_destination text,
  ADD COLUMN IF NOT EXISTS renter_fault_billable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS internal_cost_posting_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS internal_cost_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_cost_posted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS internal_cost_posted_cents bigint;

COMMENT ON COLUMN public.service_jobs.service_internal_work_class IS
  'H10 internal-service class: reconditioning, rental_fleet_maintenance, pdi_new_prep, or internal_repair.';
COMMENT ON COLUMN public.service_jobs.service_internal_cost_destination IS
  'H10 non-customer cost destination: used_unit_landed_cost, rental_unit, new_unit_prep, or internal_expense.';
COMMENT ON COLUMN public.service_jobs.renter_fault_billable IS
  'H10 exception flag. True means an internal/rental-fleet job is customer-billable because damage is renter-fault.';
COMMENT ON COLUMN public.service_jobs.internal_cost_posting_status IS
  'H10 internal posting lifecycle: not_applicable, pending, posted, or void.';
COMMENT ON COLUMN public.service_jobs.internal_cost_posted_at IS
  'H10 timestamp when non-customer internal service cost was posted to the destination ledger.';
COMMENT ON COLUMN public.service_jobs.internal_cost_posted_cents IS
  'H10 total cents posted to the internal service cost destination.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_h10_internal_work_class_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_h10_internal_work_class_chk
      CHECK (
        service_internal_work_class IS NULL OR service_internal_work_class IN (
          'reconditioning',
          'rental_fleet_maintenance',
          'pdi_new_prep',
          'internal_repair'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_h10_internal_cost_destination_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_h10_internal_cost_destination_chk
      CHECK (
        service_internal_cost_destination IS NULL OR service_internal_cost_destination IN (
          'used_unit_landed_cost',
          'rental_unit',
          'new_unit_prep',
          'internal_expense'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_h10_internal_posting_status_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_h10_internal_posting_status_chk
      CHECK (internal_cost_posting_status IN ('not_applicable', 'pending', 'posted', 'void')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_h10_internal_posted_cents_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_h10_internal_posted_cents_chk
      CHECK (internal_cost_posted_cents IS NULL OR internal_cost_posted_cents >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_jobs_h10_internal_requires_destination_chk') THEN
    ALTER TABLE public.service_jobs
      ADD CONSTRAINT service_jobs_h10_internal_requires_destination_chk
      CHECK (
        request_type::text <> 'internal'
        OR renter_fault_billable = true
        OR (
          service_internal_work_class IS NOT NULL
          AND service_internal_cost_destination IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_jobs_h10_internal_queue
  ON public.service_jobs(workspace_id, internal_cost_posting_status, service_internal_cost_destination)
  WHERE request_type::text = 'internal'
    AND renter_fault_billable = false
    AND deleted_at IS NULL;

COMMENT ON INDEX public.idx_service_jobs_h10_internal_queue IS
  'H10 queue for internal service work that must post cost to a unit/prep destination instead of customer invoicing.';

CREATE TABLE IF NOT EXISTS public.service_internal_cost_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  service_job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES public.crm_equipment(id) ON DELETE SET NULL,
  work_class text NOT NULL CHECK (work_class IN (
    'reconditioning',
    'rental_fleet_maintenance',
    'pdi_new_prep',
    'internal_repair'
  )),
  cost_destination text NOT NULL CHECK (cost_destination IN (
    'used_unit_landed_cost',
    'rental_unit',
    'new_unit_prep',
    'internal_expense'
  )),
  labor_cost_cents bigint NOT NULL DEFAULT 0 CHECK (labor_cost_cents >= 0),
  parts_cost_cents bigint NOT NULL DEFAULT 0 CHECK (parts_cost_cents >= 0),
  other_cost_cents bigint NOT NULL DEFAULT 0 CHECK (other_cost_cents >= 0),
  total_cost_cents bigint NOT NULL DEFAULT 0 CHECK (total_cost_cents >= 0),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_job_id)
);

COMMENT ON TABLE public.service_internal_cost_postings IS
  'H10 ledger for non-customer internal service cost posted to used-unit landed cost, rental fleet units, or new-unit prep.';
COMMENT ON COLUMN public.service_internal_cost_postings.cost_destination IS
  'Destination that receives internal service cost instead of creating a customer invoice.';
COMMENT ON COLUMN public.service_internal_cost_postings.source_metadata IS
  'H10 source totals and quote/ledger fallback context used to compute the posting.';

CREATE INDEX IF NOT EXISTS idx_service_internal_cost_postings_workspace_dest
  ON public.service_internal_cost_postings(workspace_id, cost_destination, posted_at DESC);

ALTER TABLE public.service_internal_cost_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_internal_cost_postings_service_role_all
  ON public.service_internal_cost_postings;
CREATE POLICY service_internal_cost_postings_service_role_all
  ON public.service_internal_cost_postings FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS service_internal_cost_postings_staff_select
  ON public.service_internal_cost_postings;
CREATE POLICY service_internal_cost_postings_staff_select
  ON public.service_internal_cost_postings FOR SELECT
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN (
      'admin',
      'owner',
      'manager',
      'service_writer',
      'dispatch',
      'finance_admin'
    )
  );

DROP POLICY IF EXISTS service_internal_cost_postings_staff_write
  ON public.service_internal_cost_postings;
CREATE POLICY service_internal_cost_postings_staff_write
  ON public.service_internal_cost_postings FOR ALL
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'owner', 'manager', 'finance_admin')
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'owner', 'manager', 'finance_admin')
  );

DROP TRIGGER IF EXISTS set_service_internal_cost_postings_updated_at
  ON public.service_internal_cost_postings;
CREATE TRIGGER set_service_internal_cost_postings_updated_at
  BEFORE UPDATE ON public.service_internal_cost_postings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.service_jobs_apply_h10_internal_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.request_type::text = 'internal' THEN
    NEW.service_internal_work_class := COALESCE(NULLIF(TRIM(BOTH FROM NEW.service_internal_work_class), ''), 'reconditioning');

    IF COALESCE(NEW.renter_fault_billable, false) THEN
      NEW.service_internal_cost_destination := NULL;
      NEW.internal_cost_posting_status := 'not_applicable';
      NEW.revenue_type := COALESCE(NEW.revenue_type, 'customer'::public.work_order_revenue_type);
      NEW.billing_basis := COALESCE(NEW.billing_basis, 'time_and_material'::public.work_order_billing_basis);

      IF NEW.billing_hold_reason = 'H10 internal cost posting required before close' THEN
        NEW.billing_hold_reason := NULL;
      END IF;
    ELSE
      NEW.service_internal_cost_destination := COALESCE(
        NULLIF(TRIM(BOTH FROM NEW.service_internal_cost_destination), ''),
        CASE NEW.service_internal_work_class
          WHEN 'rental_fleet_maintenance' THEN 'rental_unit'
          WHEN 'pdi_new_prep' THEN 'new_unit_prep'
          WHEN 'reconditioning' THEN 'used_unit_landed_cost'
          ELSE 'internal_expense'
        END
      );
      NEW.revenue_type := 'internal'::public.work_order_revenue_type;
      NEW.billing_basis := 'internal'::public.work_order_billing_basis;

      IF NEW.internal_cost_posting_status NOT IN ('posted', 'void') THEN
        NEW.internal_cost_posting_status := 'pending';
      END IF;

      IF NEW.billed_status IN ('unbilled', 'ready_to_bill') THEN
        NEW.billed_status := 'billing_hold';
      END IF;

      NEW.billing_hold_reason := COALESCE(
        NULLIF(TRIM(BOTH FROM NEW.billing_hold_reason), ''),
        'H10 internal cost posting required before close'
      );
    END IF;
  ELSIF NEW.internal_cost_posting_status IS NULL THEN
    NEW.internal_cost_posting_status := 'not_applicable';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_jobs_apply_h10_internal_defaults() IS
  'H10 trigger: internal WOs default to non-customer cost posting unless explicitly renter-fault billable.';

DROP TRIGGER IF EXISTS service_jobs_h10_internal_defaults_trg
  ON public.service_jobs;
CREATE TRIGGER service_jobs_h10_internal_defaults_trg
  BEFORE INSERT OR UPDATE OF
    request_type,
    service_internal_work_class,
    service_internal_cost_destination,
    renter_fault_billable,
    revenue_type,
    billing_basis,
    billed_status,
    billing_hold_reason,
    internal_cost_posting_status
  ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.service_jobs_apply_h10_internal_defaults();

CREATE OR REPLACE FUNCTION public.enforce_service_customer_invoice_h10_internal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
BEGIN
  IF NEW.service_job_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    request_type::text AS request_type,
    COALESCE(renter_fault_billable, false) AS renter_fault_billable,
    service_internal_cost_destination
  INTO v_job
  FROM public.service_jobs
  WHERE id = NEW.service_job_id;

  IF v_job.request_type = 'internal' AND v_job.renter_fault_billable = false THEN
    RAISE EXCEPTION 'H10 internal service jobs post cost to %, not customer invoices',
      COALESCE(v_job.service_internal_cost_destination, 'internal destination')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_service_customer_invoice_h10_internal_guard() IS
  'H10 invoice guard: non-renter-fault internal service work cannot create a customer invoice.';

DROP TRIGGER IF EXISTS customer_invoices_h10_internal_guard_trg
  ON public.customer_invoices;
CREATE TRIGGER customer_invoices_h10_internal_guard_trg
  BEFORE INSERT OR UPDATE OF service_job_id ON public.customer_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_customer_invoice_h10_internal_guard();

CREATE OR REPLACE FUNCTION public.service_post_internal_work_order_cost(
  p_service_job_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
  v_quote_id uuid;
  v_quote_labor_cents bigint := 0;
  v_quote_parts_cents bigint := 0;
  v_quote_other_cents bigint := 0;
  v_ledger_labor_cents bigint := 0;
  v_billing_parts_cents bigint := 0;
  v_billing_other_cents bigint := 0;
  v_staging_parts_cents bigint := 0;
  v_labor_cents bigint := 0;
  v_parts_cents bigint := 0;
  v_other_cents bigint := 0;
  v_total_cents bigint := 0;
  v_posting_id uuid;
BEGIN
  IF (select auth.role()) <> 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF (select public.get_my_role()) NOT IN ('admin', 'owner', 'manager', 'finance_admin') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
  INTO STRICT v_job
  FROM public.service_jobs
  WHERE id = p_service_job_id
  FOR UPDATE;

  IF (select auth.role()) <> 'service_role'
     AND v_job.workspace_id IS DISTINCT FROM (select public.get_my_workspace()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_job.request_type::text <> 'internal' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_internal_service_job');
  END IF;

  IF COALESCE(v_job.renter_fault_billable, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'renter_fault_jobs_are_customer_billable');
  END IF;

  IF v_job.service_internal_cost_destination IS NULL OR v_job.service_internal_work_class IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_internal_cost_destination');
  END IF;

  SELECT q.id
  INTO v_quote_id
  FROM public.service_quotes q
  WHERE q.job_id = p_service_job_id
    AND q.status = 'approved'
  ORDER BY q.version DESC, q.created_at DESC
  LIMIT 1;

  IF v_quote_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(ROUND((COALESCE(l.extended_price, l.quantity * l.unit_price, 0) * 100)::numeric)) FILTER (WHERE l.line_type = 'labor'), 0)::bigint,
      COALESCE(SUM(ROUND((COALESCE(l.extended_price, l.quantity * l.unit_price, 0) * 100)::numeric)) FILTER (WHERE l.line_type = 'part'), 0)::bigint,
      COALESCE(SUM(ROUND((COALESCE(l.extended_price, l.quantity * l.unit_price, 0) * 100)::numeric)) FILTER (WHERE l.line_type NOT IN ('labor', 'part')), 0)::bigint
    INTO v_quote_labor_cents, v_quote_parts_cents, v_quote_other_cents
    FROM public.service_quote_lines l
    WHERE l.quote_id = v_quote_id;
  END IF;

  SELECT COALESCE(SUM(labor_sale_cents), 0)::bigint
  INTO v_ledger_labor_cents
  FROM public.service_labor_ledger
  WHERE service_job_id = p_service_job_id
    AND workspace_id = v_job.workspace_id;

  SELECT
    COALESCE(SUM(CASE WHEN row_type = 'part' THEN
      CASE WHEN COALESCE(extended_price_cents, 0) > 0 THEN extended_price_cents ELSE extended_cost_cents END
    ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN row_type <> 'part' THEN
      CASE WHEN COALESCE(extended_price_cents, 0) > 0 THEN extended_price_cents ELSE extended_cost_cents END
    ELSE 0 END), 0)::bigint
  INTO v_billing_parts_cents, v_billing_other_cents
  FROM public.service_billing_rows
  WHERE service_job_id = p_service_job_id
    AND workspace_id = v_job.workspace_id;

  SELECT COALESCE(SUM(ROUND(line_total * 100)), 0)::bigint
  INTO v_staging_parts_cents
  FROM public.service_internal_billing_line_staging
  WHERE service_job_id = p_service_job_id
    AND workspace_id = v_job.workspace_id
    AND status IN ('draft', 'posted');

  IF (v_quote_labor_cents + v_quote_parts_cents + v_quote_other_cents) > 0 THEN
    v_labor_cents := v_quote_labor_cents;
    v_parts_cents := v_quote_parts_cents;
    v_other_cents := v_quote_other_cents;
  ELSE
    v_labor_cents := v_ledger_labor_cents;
    v_parts_cents := GREATEST(v_billing_parts_cents, v_staging_parts_cents);
    v_other_cents := v_billing_other_cents;
  END IF;

  v_total_cents := v_labor_cents + v_parts_cents + v_other_cents;

  IF v_total_cents = 0 AND v_job.quote_total IS NOT NULL THEN
    v_total_cents := GREATEST(ROUND(v_job.quote_total * 100), 0)::bigint;
    v_other_cents := v_total_cents;
  END IF;

  INSERT INTO public.service_internal_cost_postings (
    workspace_id,
    service_job_id,
    machine_id,
    work_class,
    cost_destination,
    labor_cost_cents,
    parts_cost_cents,
    other_cost_cents,
    total_cost_cents,
    source_metadata,
    posted_by,
    posted_at
  ) VALUES (
    v_job.workspace_id,
    p_service_job_id,
    v_job.machine_id,
    v_job.service_internal_work_class,
    v_job.service_internal_cost_destination,
    v_labor_cents,
    v_parts_cents,
    v_other_cents,
    v_total_cents,
    jsonb_build_object(
      'source', CASE
        WHEN (v_quote_labor_cents + v_quote_parts_cents + v_quote_other_cents) > 0 THEN 'approved_service_quote'
        ELSE 'service_ledgers'
      END,
      'approved_quote_id', v_quote_id,
      'quote_labor_cents', v_quote_labor_cents,
      'quote_parts_cents', v_quote_parts_cents,
      'quote_other_cents', v_quote_other_cents,
      'ledger_labor_cents', v_ledger_labor_cents,
      'billing_parts_cents', v_billing_parts_cents,
      'billing_other_cents', v_billing_other_cents,
      'staging_parts_cents', v_staging_parts_cents
    ),
    p_actor_id,
    now()
  )
  ON CONFLICT (service_job_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    machine_id = EXCLUDED.machine_id,
    work_class = EXCLUDED.work_class,
    cost_destination = EXCLUDED.cost_destination,
    labor_cost_cents = EXCLUDED.labor_cost_cents,
    parts_cost_cents = EXCLUDED.parts_cost_cents,
    other_cost_cents = EXCLUDED.other_cost_cents,
    total_cost_cents = EXCLUDED.total_cost_cents,
    source_metadata = EXCLUDED.source_metadata,
    posted_by = EXCLUDED.posted_by,
    posted_at = EXCLUDED.posted_at,
    updated_at = now()
  RETURNING id INTO v_posting_id;

  UPDATE public.service_jobs
  SET
    internal_cost_posting_status = 'posted',
    internal_cost_posted_at = now(),
    internal_cost_posted_by = p_actor_id,
    internal_cost_posted_cents = v_total_cents,
    billed_status = 'billed',
    billing_hold_reason = NULL,
    updated_at = now()
  WHERE id = p_service_job_id;

  INSERT INTO public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) VALUES (
    v_job.workspace_id,
    p_service_job_id,
    'internal_cost_posted',
    p_actor_id,
    jsonb_build_object(
      'posting_id', v_posting_id,
      'work_class', v_job.service_internal_work_class,
      'cost_destination', v_job.service_internal_cost_destination,
      'total_cost_cents', v_total_cents,
      'h10_gate', 'internal_rental_fleet_service'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'posting_id', v_posting_id,
    'service_job_id', p_service_job_id,
    'cost_destination', v_job.service_internal_cost_destination,
    'total_cost_cents', v_total_cents
  );
END;
$$;

COMMENT ON FUNCTION public.service_post_internal_work_order_cost(uuid, uuid) IS
  'H10 API: posts a non-customer internal service work order to used-unit, rental-unit, or new-prep cost instead of a customer invoice.';

REVOKE EXECUTE ON FUNCTION public.service_post_internal_work_order_cost(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.service_post_internal_work_order_cost(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.service_post_internal_work_order_cost(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_service_internal_cost_posting_queue
WITH (security_invoker = on) AS
SELECT
  j.workspace_id,
  j.id AS service_job_id,
  j.wo_number,
  j.machine_id,
  e.name AS machine_name,
  e.make AS machine_make,
  e.model AS machine_model,
  e.serial_number AS machine_serial_number,
  j.service_internal_work_class,
  j.service_internal_cost_destination,
  j.internal_cost_posting_status,
  j.internal_cost_posted_at,
  j.internal_cost_posted_cents,
  p.id AS posting_id,
  p.total_cost_cents AS posted_total_cost_cents,
  j.current_stage,
  j.created_at,
  j.updated_at
FROM public.service_jobs j
LEFT JOIN public.crm_equipment e ON e.id = j.machine_id
LEFT JOIN public.service_internal_cost_postings p ON p.service_job_id = j.id
WHERE j.request_type::text = 'internal'
  AND COALESCE(j.renter_fault_billable, false) = false
  AND j.deleted_at IS NULL;

COMMENT ON VIEW public.v_service_internal_cost_posting_queue IS
  'H10 queue/report for internal service WOs that post cost to used-unit landed cost, rental fleet, or new-unit prep rather than customer invoices.';

GRANT SELECT ON public.v_service_internal_cost_posting_queue TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%684_h10_internal_rental_fleet_service.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H10') ||
      ' | supabase/migrations/684_h10_internal_rental_fleet_service.sql' ||
      ' | supabase/functions/_shared/service-invoice.ts' ||
      ' | supabase/functions/service-quote-engine/index.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H10.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H10.1 shipped: internal WOs default to internal revenue/billing basis, destination-specific cost posting, and invoice suppression; renter_fault_billable keeps the rental-damage exception customer-billable; service_post_internal_work_order_cost posts labor/parts/other cost to used-unit landed cost, rental unit, new-unit prep, or internal expense without creating a customer invoice.'
  END,
  updated_at = now()
WHERE task_id = 'H10.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H10.1',
  'update',
  jsonb_build_object(
    'reason', 'h10_internal_rental_fleet_service',
    'migration', '684_h10_internal_rental_fleet_service.sql',
    'mission_alignment', 'pass: internal service, rental-fleet maintenance, and new-unit prep can absorb cost on the correct operating asset without leaking into customer invoicing, while renter-fault work remains billable',
    'implementation_evidence', jsonb_build_array(
      'public.service_jobs.service_internal_work_class',
      'public.service_jobs.service_internal_cost_destination',
      'public.service_jobs.renter_fault_billable',
      'public.service_internal_cost_postings',
      'public.service_post_internal_work_order_cost',
      'public.enforce_service_customer_invoice_h10_internal_guard',
      'public.v_service_internal_cost_posting_queue',
      'supabase/functions/_shared/service-invoice.ts internal invoice guard',
      'supabase/functions/service-quote-engine/index.ts internal labor discount'
    )
  ),
  'codex'
);

COMMIT;
