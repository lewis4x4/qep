-- ============================================================================
-- Migration 769: Stream L / L0.1 — Rental structural refactor
--
-- Fixes the contract-origination anchor and installs the rental lifecycle
-- trunk per docs/rental/BLUEPRINT.md §1 (discovery: docs/rental/DISCOVERY.md).
--
-- What changes:
--   1. rental_contracts anchors on EITHER a portal customer OR a QRM company:
--      portal_customer_id becomes nullable; qrm_company_id/qrm_contact_id FKs,
--      origination_channel (counter|voice|iron|portal), originated_by.
--   2. contract_type (reservation|rental|rpo|demo|loaner|rerent).
--   3. lifecycle_state trunk with owned timestamps + trigger-guarded
--      transitions. The legacy portal `status` machine keeps working through
--      a sync trigger (compat window; portal reads are unaffected because
--      portal RLS only exposes portal-anchored rows).
--   4. Typed line return codes (returned|off_rent|exchange|hold) + line
--      status labels for off-rent and held units. NOTE: existing line status
--      'active' IS the on-rent state — we do not add a synonym 'on_rent'
--      label at line level to avoid dual semantics.
--   5. Fleet-state activation: qrm_equipment.availability, readiness_status,
--      and next_available_at maintained from contract lines (targets
--      qrm_equipment directly — the crm_equipment compat view is frozen and
--      does not surface post-rename columns).
--   6. Human contract numbers (RC-YYYY-NNNNN) auto-assigned on insert.
--
-- Idempotent and re-runnable: additive DDL guarded by IF NOT EXISTS / DO
-- blocks; production rental tables carry zero rows (discovery §5), so no
-- backfill is required.
-- ============================================================================

-- Enum label additions must commit before use; keep them outside the txn.
ALTER TYPE public.rental_contract_line_status ADD VALUE IF NOT EXISTS 'off_rent' AFTER 'active';
ALTER TYPE public.rental_contract_line_status ADD VALUE IF NOT EXISTS 'held' AFTER 'off_rent';

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Customer anchoring + origination + contract type + lifecycle columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.rental_contracts
  ALTER COLUMN portal_customer_id DROP NOT NULL;

ALTER TABLE public.rental_contracts
  ADD COLUMN IF NOT EXISTS qrm_company_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qrm_contact_id uuid REFERENCES public.qrm_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origination_channel text NOT NULL DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS originated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS on_rent_at timestamptz,
  ADD COLUMN IF NOT EXISTS off_rent_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contracts_customer_anchor') THEN
    ALTER TABLE public.rental_contracts
      ADD CONSTRAINT rental_contracts_customer_anchor
      CHECK (portal_customer_id IS NOT NULL OR qrm_company_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contracts_origination_channel_chk') THEN
    ALTER TABLE public.rental_contracts
      ADD CONSTRAINT rental_contracts_origination_channel_chk
      CHECK (origination_channel IN ('counter', 'voice', 'iron', 'portal'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contracts_contract_type_chk') THEN
    ALTER TABLE public.rental_contracts
      ADD CONSTRAINT rental_contracts_contract_type_chk
      CHECK (contract_type IN ('reservation', 'rental', 'rpo', 'demo', 'loaner', 'rerent'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contracts_rpo_requires_terms_chk') THEN
    ALTER TABLE public.rental_contracts
      ADD CONSTRAINT rental_contracts_rpo_requires_terms_chk
      CHECK (contract_type <> 'rpo' OR rpo_eligible IS TRUE);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contracts_lifecycle_state_chk') THEN
    ALTER TABLE public.rental_contracts
      ADD CONSTRAINT rental_contracts_lifecycle_state_chk
      CHECK (lifecycle_state IN (
        'draft', 'quoted', 'reserved', 'on_rent', 'off_rent', 'returned',
        'closed', 'cancelled', 'declined', 'expired'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.rental_contracts.origination_channel IS
  'Front door the contract came through: counter (rep walk-in/phone), voice (field capture), iron (conversational), portal (customer self-service).';
COMMENT ON COLUMN public.rental_contracts.contract_type IS
  'IntelliDealer-parity contract types: reservation converts in place to rental/rpo at check-out; demo/loaner bill $0 but meter, insure, and occupy availability; rerent requires a sub-rental line.';
COMMENT ON COLUMN public.rental_contracts.lifecycle_state IS
  'Rental lifecycle trunk: draft→quoted→reserved→on_rent→off_rent→returned→closed (+cancelled/declined/expired pre-on_rent). The legacy portal booking `status` is the reservation-phase sub-flow, sync-maintained during the L0 compat window. off_rent stops the billing clock; returned means physically back.';

-- Legacy status CHECK widened so non-portal contracts can mirror the
-- lifecycle verbatim while portal-anchored rows keep the booking vocabulary.
ALTER TABLE public.rental_contracts DROP CONSTRAINT IF EXISTS rental_contracts_status_check;
ALTER TABLE public.rental_contracts
  ADD CONSTRAINT rental_contracts_status_check
  CHECK (status IN (
    -- legacy portal booking sub-flow
    'submitted', 'reviewing', 'quoted', 'approved', 'awaiting_payment',
    'active', 'completed', 'declined', 'cancelled',
    -- lifecycle mirror values for counter/voice/iron contracts
    'draft', 'reserved', 'on_rent', 'off_rent', 'returned', 'closed', 'expired'
  ));

-- ---------------------------------------------------------------------------
-- 2. Line-level return codes (typed R/O/E/H semantics)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_contract_lines_return_code_chk') THEN
    ALTER TABLE public.rental_contract_lines
      ADD CONSTRAINT rental_contract_lines_return_code_chk
      CHECK (return_code IS NULL OR return_code IN ('returned', 'off_rent', 'exchange', 'hold'));
  END IF;
END $$;

COMMENT ON COLUMN public.rental_contract_lines.return_code IS
  'IntelliDealer return codes: returned (R — clock stops, inspection), off_rent (O — clock stops, unit still in field awaiting pickup), exchange (E — swapped, see exchange_parent_line_id chain), hold (H — hour-usage line held until hours-in recorded).';

-- ---------------------------------------------------------------------------
-- 3. Lifecycle transition guard
-- ---------------------------------------------------------------------------

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
    -- Terminal states are immutable except via hard close bookkeeping.
    IF OLD.lifecycle_state IN ('closed', 'cancelled', 'declined', 'expired') THEN
      RAISE EXCEPTION 'rental contract % is % and cannot transition to %',
        OLD.id, OLD.lifecycle_state, NEW.lifecycle_state;
    END IF;

    -- Compat window: when the legacy portal `status` drove this write (the
    -- sync trigger derived lifecycle_state from it), the legacy machine's own
    -- CHECKs govern. Strict edge validation applies to lifecycle-driven
    -- (counter/voice/iron) writes only. Timestamps are stamped either way.
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

      -- Edge preconditions (blueprint §1.3 transition matrix).
      IF NEW.lifecycle_state = 'reserved' AND NEW.portal_customer_id IS NULL AND NEW.qrm_company_id IS NULL THEN
        RAISE EXCEPTION 'rental contract % needs a customer anchor before reservation', OLD.id;
      END IF;

      IF NEW.lifecycle_state = 'on_rent' THEN
        IF NEW.equipment_id IS NULL OR NEW.assignment_status IS DISTINCT FROM 'assigned' THEN
          RAISE EXCEPTION 'rental contract % needs an assigned unit before going on rent', OLD.id;
        END IF;
        IF COALESCE(NEW.deposit_status, 'not_required') NOT IN ('not_required', 'paid') THEN
          RAISE EXCEPTION 'rental contract % deposit must be settled (or not required) before going on rent', OLD.id;
        END IF;
        IF NEW.coi_required AND NEW.coi_received_at IS NULL THEN
          RAISE EXCEPTION 'rental contract % requires a COI on file before going on rent', OLD.id;
        END IF;
        IF NEW.native_signature_id IS NULL AND NEW.rate_override_approved_by IS NULL THEN
          -- Signature, or an explicit manager override recorded via the
          -- rate_override approval trio, gates check-out.
          RAISE EXCEPTION 'rental contract % needs a signature (or logged manager override) before going on rent', OLD.id;
        END IF;
      END IF;

      IF NEW.lifecycle_state = 'closed'
         AND OLD.lifecycle_state <> 'returned' AND NEW.hard_closed_at IS NULL THEN
        -- L5 tightens this to "final invoice posted"; until the billing
        -- engine ships, closing requires a return or an audited hard close.
        RAISE EXCEPTION 'rental contract % can only close after return or via audited hard close', OLD.id;
      END IF;
    END IF;

    -- Owned timestamps stamp on every path (legacy- or lifecycle-driven).
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

-- Same-event BEFORE triggers fire in name order. The guard MUST run before
-- the status<->lifecycle sync ("trg_a_..."): it decides legacy- vs
-- lifecycle-driven by whether the CALLER changed `status`, and the sync
-- trigger itself mirrors `status` — running after it would make every
-- lifecycle write look status-driven and skip strict validation.
DROP TRIGGER IF EXISTS trg_rental_contract_guard_transition ON public.rental_contracts;
DROP TRIGGER IF EXISTS trg_0_rental_contract_guard_transition ON public.rental_contracts;
CREATE TRIGGER trg_0_rental_contract_guard_transition
  BEFORE UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_contract_guard_transition();

-- ---------------------------------------------------------------------------
-- 4. Legacy status <-> lifecycle sync (compat window)
--    Portal writers keep mutating `status`; counter/voice/iron writers mutate
--    `lifecycle_state`. Whichever side changed drives the other.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rental_contract_sync_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    -- Legacy/portal vocabulary drove the write: derive the lifecycle trunk.
    IF TG_OP = 'INSERT'
       OR NEW.lifecycle_state IS NOT DISTINCT FROM OLD.lifecycle_state THEN
      NEW.lifecycle_state := CASE NEW.status
        WHEN 'submitted'        THEN 'draft'
        WHEN 'reviewing'        THEN 'draft'
        WHEN 'quoted'           THEN 'quoted'
        WHEN 'approved'         THEN 'reserved'
        WHEN 'awaiting_payment' THEN 'reserved'
        WHEN 'active'           THEN 'on_rent'
        WHEN 'completed'        THEN 'returned'
        WHEN 'declined'         THEN 'declined'
        WHEN 'cancelled'        THEN 'cancelled'
        ELSE NEW.status  -- lifecycle mirror values pass through verbatim
      END;
      IF NEW.lifecycle_state = 'on_rent' THEN
        NEW.on_rent_at := COALESCE(NEW.on_rent_at, now());
      ELSIF NEW.lifecycle_state = 'returned' THEN
        NEW.returned_at := COALESCE(NEW.returned_at, now());
      END IF;
    END IF;
  ELSIF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    -- Lifecycle drove the write: keep `status` coherent. Portal-anchored rows
    -- keep the booking vocabulary their readers expect; counter rows mirror.
    IF NEW.portal_customer_id IS NOT NULL THEN
      NEW.status := CASE NEW.lifecycle_state
        WHEN 'draft'    THEN 'reviewing'
        WHEN 'quoted'   THEN 'quoted'
        WHEN 'reserved' THEN 'approved'
        WHEN 'on_rent'  THEN 'active'
        WHEN 'off_rent' THEN 'active'
        WHEN 'returned' THEN 'completed'
        WHEN 'closed'   THEN 'completed'
        ELSE NEW.lifecycle_state
      END;
    ELSE
      NEW.status := NEW.lifecycle_state;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_contract_sync_status ON public.rental_contracts;
DROP TRIGGER IF EXISTS trg_a_rental_contract_sync_status ON public.rental_contracts;
-- Same-event triggers fire in name order; the "a" prefix makes the sync run
-- before the guard so the guard always sees the derived lifecycle value.
CREATE TRIGGER trg_a_rental_contract_sync_status
  BEFORE INSERT OR UPDATE ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_contract_sync_status();

-- ---------------------------------------------------------------------------
-- 5. Fleet-state activation from contract lines
--    Maintains qrm_equipment.availability (legacy consumers, incl. the
--    Rental Command Center fleet board), readiness_status, next_available_at.
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
    bool_or(l.status IN ('active', 'off_rent', 'held')),
    max(l.rental_end_at)
  INTO v_on_rent, v_next_available
  FROM public.rental_contract_lines l
  WHERE l.equipment_id = p_equipment
    AND l.deleted_at IS NULL
    AND l.status IN ('reserved', 'active', 'off_rent', 'held');

  UPDATE public.qrm_equipment e
  SET
    availability = CASE
      WHEN COALESCE(v_on_rent, false) THEN 'rented'
      WHEN e.availability = 'rented' THEN 'available'
      ELSE e.availability
    END,
    readiness_status = CASE
      WHEN COALESCE(v_on_rent, false) THEN 'on_rent'
      WHEN e.readiness_status = 'on_rent' THEN 'available'
      ELSE e.readiness_status
    END,
    next_available_at = v_next_available
  WHERE e.id = p_equipment;
END;
$$;

CREATE OR REPLACE FUNCTION public.rental_sync_equipment_fleet_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NEW is unassigned on DELETE and OLD on INSERT — branch per TG_OP, and
  -- recompute BOTH units when an update moves a line between machines.
  IF TG_OP = 'INSERT' THEN
    PERFORM public.rental_recompute_equipment_fleet_state(NEW.equipment_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.rental_recompute_equipment_fleet_state(OLD.equipment_id);
  ELSE
    PERFORM public.rental_recompute_equipment_fleet_state(NEW.equipment_id);
    IF OLD.equipment_id IS DISTINCT FROM NEW.equipment_id THEN
      PERFORM public.rental_recompute_equipment_fleet_state(OLD.equipment_id);
    END IF;
  END IF;

  RETURN NULL;  -- AFTER trigger; return value ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_lines_fleet_state ON public.rental_contract_lines;
CREATE TRIGGER trg_rental_lines_fleet_state
  AFTER INSERT OR UPDATE OF status, equipment_id, rental_end_at OR DELETE
  ON public.rental_contract_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_sync_equipment_fleet_state();

-- ---------------------------------------------------------------------------
-- 6. Human contract numbers (RC-YYYY-NNNNN) for every new contract
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.rental_contract_number_seq;

CREATE OR REPLACE FUNCTION public.rental_assign_contract_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contract_number IS NULL THEN
    NEW.contract_number :=
      'RC-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.rental_contract_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_assign_contract_number ON public.rental_contracts;
CREATE TRIGGER trg_rental_assign_contract_number
  BEFORE INSERT ON public.rental_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.rental_assign_contract_number();

-- ---------------------------------------------------------------------------
-- 7. Indexes for the new spine
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_rental_contracts_lifecycle
  ON public.rental_contracts (workspace_id, lifecycle_state)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rental_contracts_qrm_company
  ON public.rental_contracts (qrm_company_id)
  WHERE qrm_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rental_contracts_contract_type
  ON public.rental_contracts (workspace_id, contract_type)
  WHERE deleted_at IS NULL;

COMMIT;
