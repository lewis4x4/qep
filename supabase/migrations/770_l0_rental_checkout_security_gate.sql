-- ============================================================================
-- Migration 770: Stream L / L0 — check-out security gate (deposit OR credit)
--
-- Charter §2.7 frames deposit and credit as alternative security instruments.
-- 769's gate hard-required a settled deposit state, which would wall off
-- credit-approved national accounts. Decided semantics (owner review 2026-07-06):
--
--   Company-anchored contracts, at → on_rent:
--     PASS when deposit_status = 'paid'
--       OR a manager security override is recorded on the contract
--       OR (deposit_required = false AND the company has no standing AR credit
--           block — an unexpired apply_ar_override() ALSO passes, reusing the
--           existing AR override machinery rather than inventing a new one)
--     BLOCK when deposit_required = true and unpaid and no override
--       (the dealer explicitly demanded a deposit for this contract)
--   Portal-anchored contracts keep the legacy rule (portal flow owns deposit
--   collection): deposit_status in ('not_required','paid').
-- ============================================================================

BEGIN;

ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS checkout_security_override_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_security_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_security_override_reason text;

COMMENT ON COLUMN public.rental_contracts.checkout_security_override_by IS
  'Manager who waived check-out security (deposit/credit) for this contract. Audited alternative to deposit-paid or clean-credit paths.';

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

        -- Check-out security: deposit OR credit OR audited manager override.
        IF NEW.checkout_security_override_by IS NOT NULL THEN
          NEW.checkout_security_override_at := COALESCE(NEW.checkout_security_override_at, now());
        ELSIF NEW.qrm_company_id IS NOT NULL THEN
          IF COALESCE(NEW.deposit_status, '') = 'paid' THEN
            NULL;  -- deposit posted
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
          END IF;  -- clean credit stands in for the deposit
        ELSIF COALESCE(NEW.deposit_status, 'not_required') NOT IN ('not_required', 'paid') THEN
          RAISE EXCEPTION 'rental contract % deposit must be settled (or not required) before going on rent', OLD.id;
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

COMMIT;
