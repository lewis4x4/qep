-- ============================================================================
-- Migration 773: Stream L / L2 — rollup enforcement + check-out inspection gate
--
-- L0 is formally closed (L0.1 shipped 2026-07-07), which unblocks the
-- rollup-enforcing trigger parked by the owner's sequencing note.
--
--   1. Line→trunk rollup enforcement: rental_contract_rollup_lifecycle() (the
--      rule stated in mig 772) now DRIVES the contract when lines change —
--      but only in the DOWNSTREAM, clock-stopping direction
--      (on_rent → off_rent → returned). It can never check a contract OUT:
--      reserved → on_rent stays a human action through the 770 security gate
--      (deposit OR credit OR override, signature, COI, unit assigned).
--      Clock RESUME (off_rent line reactivating) is deliberately not
--      auto-applied — the guard matrix has no off_rent → on_rent edge; a hold
--      release is an explicit operator action to be modeled with L2's
--      returns-wizard work.
--   2. Check-out condition inspection (blueprint §4): opt-in per contract via
--      checkout_inspection_required; when set, → on_rent additionally
--      requires a COMPLETED inspection_runs row anchored to the contract
--      (the rental_contract_id FK shipped with InspectionPlus). Opt-in keeps
--      existing counter/portal flows green; workspace policy can default it
--      on when the check-out UI lands.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Check-out inspection gate (opt-in per contract)
-- ---------------------------------------------------------------------------

ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS checkout_inspection_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rental_contracts.checkout_inspection_required IS
  'When true, the guard requires a completed inspection_runs row (rental_contract_id anchor) before the contract can go on rent. Opt-in during L2 rollout; flip the default via workspace policy when the check-out inspection UI ships.';

CREATE OR REPLACE FUNCTION public.rental_contract_guard_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF OLD.lifecycle_state IN ('closed', 'cancelled', 'declined', 'expired') THEN
      RAISE EXCEPTION 'rental contract % is % and cannot transition to %',
        OLD.id, OLD.lifecycle_state, NEW.lifecycle_state;
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      allowed := CASE
        WHEN OLD.lifecycle_state = 'draft'    AND NEW.lifecycle_state IN ('quoted', 'reserved', 'cancelled', 'declined') THEN true
        WHEN OLD.lifecycle_state = 'quoted'   AND NEW.lifecycle_state IN ('reserved', 'cancelled', 'declined', 'expired') THEN true
        WHEN OLD.lifecycle_state = 'reserved' AND NEW.lifecycle_state IN ('on_rent', 'cancelled', 'declined', 'expired') THEN true
        WHEN OLD.lifecycle_state = 'on_rent'  AND NEW.lifecycle_state IN ('off_rent', 'returned') THEN true
        WHEN OLD.lifecycle_state = 'off_rent' AND NEW.lifecycle_state = 'returned' THEN true
        WHEN OLD.lifecycle_state = 'returned' AND NEW.lifecycle_state = 'closed' THEN true
        ELSE false
      END;

      IF NOT allowed THEN
        RAISE EXCEPTION 'illegal rental lifecycle transition % -> % on contract %',
          OLD.lifecycle_state, NEW.lifecycle_state, OLD.id;
      END IF;

      IF NEW.lifecycle_state = 'reserved' AND NEW.portal_customer_id IS NULL AND NEW.qrm_company_id IS NULL THEN
        RAISE EXCEPTION 'rental contract % needs a customer anchor before reservation', OLD.id;
      END IF;

      IF NEW.lifecycle_state = 'on_rent' THEN
        IF NEW.equipment_id IS NULL OR NEW.assignment_status IS DISTINCT FROM 'assigned' THEN
          RAISE EXCEPTION 'rental contract % needs an assigned unit before going on rent', OLD.id;
        END IF;

        -- Check-out security (mig 770): deposit OR credit OR audited override.
        IF NEW.checkout_security_override_by IS NOT NULL THEN
          NEW.checkout_security_override_at := COALESCE(NEW.checkout_security_override_at, now());
        ELSIF NEW.qrm_company_id IS NOT NULL THEN
          IF COALESCE(NEW.deposit_status, '') = 'paid' THEN
            NULL;
          ELSIF NEW.deposit_required THEN
            RAISE EXCEPTION 'rental contract % requires its deposit posted (or a manager security override) before going on rent', OLD.id;
          ELSIF EXISTS (
            SELECT 1 FROM public.ar_credit_blocks b
            WHERE b.company_id = NEW.qrm_company_id
              AND b.status = 'active'
              AND b.cleared_at IS NULL
              AND (b.override_until IS NULL OR b.override_until < now())
          ) THEN
            RAISE EXCEPTION 'rental contract % is credit-held: post a deposit, clear/override the AR block, or record a manager security override', OLD.id;
          END IF;
        ELSIF COALESCE(NEW.deposit_status, 'not_required') NOT IN ('not_required', 'paid') THEN
          RAISE EXCEPTION 'rental contract % deposit must be settled (or not required) before going on rent', OLD.id;
        END IF;

        -- Check-out condition inspection (mig 773, opt-in per contract).
        IF NEW.checkout_inspection_required AND NOT EXISTS (
          SELECT 1 FROM public.inspection_runs ir
          WHERE ir.rental_contract_id = NEW.id AND ir.completed_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'rental contract % requires a completed check-out inspection before going on rent', OLD.id;
        END IF;

        IF NEW.coi_required AND NEW.coi_received_at IS NULL THEN
          RAISE EXCEPTION 'rental contract % requires a COI on file before going on rent', OLD.id;
        END IF;
        IF NEW.native_signature_id IS NULL AND NEW.rate_override_approved_by IS NULL THEN
          RAISE EXCEPTION 'rental contract % needs a signature (or logged manager override) before going on rent', OLD.id;
        END IF;
      END IF;

      IF NEW.lifecycle_state = 'closed'
         AND OLD.lifecycle_state <> 'returned' AND NEW.hard_closed_at IS NULL THEN
        RAISE EXCEPTION 'rental contract % can only close after return or via audited hard close', OLD.id;
      END IF;
    END IF;

    IF NEW.lifecycle_state = 'on_rent' THEN
      NEW.on_rent_at := COALESCE(NEW.on_rent_at, now());
    ELSIF NEW.lifecycle_state = 'off_rent' THEN
      NEW.off_rent_at := COALESCE(NEW.off_rent_at, now());  -- billing clock stops here
    ELSIF NEW.lifecycle_state = 'returned' THEN
      NEW.returned_at := COALESCE(NEW.returned_at, now());
    ELSIF NEW.lifecycle_state = 'closed' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rollup enforcement — lines drive the trunk, downstream only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_apply_line_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract uuid;
  v_current text;
  v_rollup text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_contract := OLD.rental_contract_id;
  ELSE
    v_contract := NEW.rental_contract_id;
  END IF;
  IF v_contract IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT lifecycle_state INTO v_current FROM public.rental_contracts WHERE id = v_contract;
  v_rollup := public.rental_contract_rollup_lifecycle(v_contract);

  -- Downstream-only enforcement: line return coding stops the clock and
  -- completes the return; it never checks a contract out (the 770 gate owns
  -- that) and never resumes a stopped clock (explicit operator action).
  IF v_rollup IS NOT NULL
     AND v_current IN ('on_rent', 'off_rent')
     AND v_rollup IN ('off_rent', 'returned')
     AND v_rollup IS DISTINCT FROM v_current THEN
    UPDATE public.rental_contracts
    SET lifecycle_state = v_rollup
    WHERE id = v_contract;
  END IF;

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_lines_rollup ON public.rental_contract_lines;
CREATE TRIGGER trg_rental_lines_rollup
  AFTER INSERT OR UPDATE OF status OR DELETE
  ON public.rental_contract_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_apply_line_rollup();

COMMIT;
