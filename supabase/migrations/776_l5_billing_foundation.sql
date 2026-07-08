-- ============================================================================
-- Migration 776: Stream L / L5 — billing foundation
--
--   1. Per-workspace rental invoice numbers (RENT-YYYY-NNNNN) — retires the
--      Date.now() numbering in rental-ops deposits.
--   2. RPO accrual: rental_contracts.rpo_credit_accrued_cents accrues
--      rental_charge × rpo_rental_credit_pct when an RPO contract's invoice
--      is PAID (owner rule: RPO accrues on INVOICED amounts, never naive
--      totals), capped at the purchase price; crossing 50% of the purchase
--      price emits rental.rpo.threshold_reached (the L4 workflow listens).
--   3. Guard tightening (owner obligation 5a): returned → closed now requires
--      a POSTED/SENT/PAID final invoice covering through returned_at, or an
--      audited hard close. Nothing closes unbilled.
--   4. Nightly rental-billing-runner cron — the job command copies the
--      internal service secret from the existing flow-runner job so no
--      secret ever lands in the repo; skips with a NOTICE if absent.
-- ============================================================================

BEGIN;

-- 1. Invoice numbering
CREATE SEQUENCE IF NOT EXISTS public.rental_invoice_number_seq;

CREATE OR REPLACE FUNCTION public.next_rental_invoice_number(p_workspace_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'RENT-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.rental_invoice_number_seq')::text, 5, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_rental_invoice_number(text) FROM public;
GRANT EXECUTE ON FUNCTION public.next_rental_invoice_number(text) TO authenticated, service_role;

-- 2. RPO accrual
ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS rpo_credit_accrued_cents bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rental_contracts.rpo_credit_accrued_cents IS
  'Rental credit accrued toward the RPO purchase price — accrues on PAID invoices (rental_charge_cents × rpo_rental_credit_pct), capped at rpo_purchase_price_cents. rental.rpo.threshold_reached emits at 50% of purchase price.';

CREATE OR REPLACE FUNCTION public.rental_accrue_rpo_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
  v_accrual bigint;
  v_new_total bigint;
  v_threshold bigint;
BEGIN
  IF NEW.status::text <> 'paid' OR OLD.status::text = 'paid' THEN
    RETURN NULL;
  END IF;

  SELECT id, workspace_id, contract_number, contract_type, rpo_rental_credit_pct,
         rpo_purchase_price_cents, rpo_exercise_deadline, rpo_credit_accrued_cents
  INTO v_contract
  FROM public.rental_contracts
  WHERE id = NEW.rental_contract_id;

  IF v_contract.id IS NULL OR v_contract.contract_type <> 'rpo'
     OR COALESCE(v_contract.rpo_rental_credit_pct, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_accrual := round(COALESCE(NEW.rental_charge_cents, 0) * v_contract.rpo_rental_credit_pct);
  IF v_accrual <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_total := LEAST(
    COALESCE(v_contract.rpo_purchase_price_cents, v_contract.rpo_credit_accrued_cents + v_accrual),
    v_contract.rpo_credit_accrued_cents + v_accrual);

  UPDATE public.rental_contracts
  SET rpo_credit_accrued_cents = v_new_total
  WHERE id = v_contract.id;

  -- Threshold: crossing 50% of the purchase price fires the sales motion.
  v_threshold := COALESCE(v_contract.rpo_purchase_price_cents, 0) / 2;
  IF v_threshold > 0
     AND v_contract.rpo_credit_accrued_cents < v_threshold
     AND v_new_total >= v_threshold THEN
    PERFORM public.emit_event(
      'rental.rpo.threshold_reached', 'rental', 'rental_contract', v_contract.id::text,
      jsonb_build_object(
        'rental_id', v_contract.id,
        'contract_number', v_contract.contract_number,
        'accrued_credit', round(v_new_total / 100.0, 2),
        'purchase_price', round(COALESCE(v_contract.rpo_purchase_price_cents, 0) / 100.0, 2),
        'rpo_exercise_deadline', v_contract.rpo_exercise_deadline
      ),
      v_contract.workspace_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_accrue_rpo_credit ON public.rental_invoices;
CREATE TRIGGER trg_rental_accrue_rpo_credit
  AFTER UPDATE OF status ON public.rental_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_accrue_rpo_credit();

-- 3. Guard tightening: nothing closes unbilled (owner obligation 5a).
--    Replaces only the → closed precondition inside the guard.
CREATE OR REPLACE FUNCTION public.rental_contract_close_billing_gate(p_contract public.rental_contracts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rental_invoices i
    WHERE i.rental_contract_id = p_contract.id
      AND i.deleted_at IS NULL
      AND i.status::text IN ('posted', 'sent', 'partial', 'paid')
      AND i.period_end >= COALESCE(p_contract.off_rent_at, p_contract.returned_at)::date
  );
$$;

CREATE OR REPLACE FUNCTION public.rental_contract_guard_close_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lifecycle_state = 'closed' AND OLD.lifecycle_state IS DISTINCT FROM 'closed'
     AND NEW.hard_closed_at IS NULL
     AND NOT public.rental_contract_close_billing_gate(NEW) THEN
    RAISE EXCEPTION 'rental contract % cannot close: no final invoice posted through its clock end (post the final invoice or hard-close with reason)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Fires after the main guard (name order): trg_0_... < trg_1_...
DROP TRIGGER IF EXISTS trg_1_rental_contract_close_billing ON public.rental_contracts;
CREATE TRIGGER trg_1_rental_contract_close_billing
  BEFORE UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_contract_guard_close_check();

-- 4. Nightly billing cron (03:40 UTC) — secret copied from flow-runner's job.
DO $$
DECLARE
  v_secret text;
BEGIN
  SELECT substring(command FROM 'x-internal-service-secret''\s*,\s*''([^'']+)''')
  INTO v_secret
  FROM cron.job WHERE jobname = 'flow-runner' LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE NOTICE 'flow-runner cron not found; register rental-billing-runner-nightly manually';
  ELSIF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rental-billing-runner-nightly') THEN
    PERFORM cron.schedule(
      'rental-billing-runner-nightly',
      '40 3 * * *',
      format(
        $job$select net.http_post(
    url := 'https://iciddijgonywtxoelous.supabase.co/functions/v1/rental-billing-runner',
    headers := jsonb_build_object('x-internal-service-secret', %L, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  )$job$, v_secret));
  END IF;
END $$;

COMMIT;
