-- ============================================================================
-- L8.d shadow cutover — full rental lifecycle through the REAL prod triggers.
--
-- Drives one contract draft → reserved → on_rent → off_rent → returned →
-- closed, asserting every gate along the way, then RAISEs SMOKE_PASS to roll
-- the whole thing back (no residue). Run against prod via the SQL editor /
-- MCP execute_sql. A clean run ends with:
--   ERROR: P0001 SMOKE_PASS: draft-created | illegal-draft->on_rent-blocked |
--   draft->reserved | inspection-gate-fired | inspection-completed |
--   reserved->on_rent | on_rent->off_rent | off_rent->returned |
--   close-before-bill-blocked | final-invoice-posted | returned->closed |
--   closed-terminal
--
-- Coverage: the lifecycle guard's legal-transition table, three illegal
-- transitions (state-skip, close-before-bill, closed-terminal), the mig-773
-- check-out inspection gate, the mig-770 check-out security path (deposit
-- not_required), and the mig-776 close-billing gate (final invoice through
-- the clock end). Swap the fixture ids for another workspace as needed.
-- ============================================================================
DO $$
DECLARE
  v_ws text := 'default';
  v_unit uuid := 'b014e000-0000-4000-8000-000000000022';       -- an available rental_fleet unit
  v_company uuid := '9bd7a266-bd72-4446-bdb6-b99ef77b54ae';     -- a workspace company (customer anchor)
  v_template uuid := 'f000000f-0000-4000-8000-000000040001';    -- rental check-out inspection template
  v_owner uuid := '10000000-0000-4000-8000-000000000001';       -- a user id (rate-override approver)
  v_cid uuid;
  v_caught text;
  v_passes text := '';
BEGIN
  INSERT INTO rental_contracts (
    workspace_id, contract_type, status, lifecycle_state, qrm_company_id,
    equipment_id, assignment_status, requested_start_date, requested_end_date,
    agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate,
    deposit_status, deposit_required, checkout_inspection_required,
    coi_required, rate_override_approved_by, dealer_notes
  ) VALUES (
    v_ws, 'rental', 'submitted', 'draft', v_company,
    v_unit, 'assigned', CURRENT_DATE - 45, CURRENT_DATE + 5,
    350, 1050, 3150,
    'not_required', false, true,
    false, v_owner, 'SHADOW-CUTOVER'
  ) RETURNING id INTO v_cid;
  v_passes := v_passes || 'draft-created ';

  BEGIN
    UPDATE rental_contracts SET lifecycle_state='on_rent' WHERE id=v_cid;
    RAISE EXCEPTION 'SMOKE_FAIL: draft->on_rent was ALLOWED';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught LIKE 'SMOKE_FAIL%' THEN RAISE; END IF;
    v_passes := v_passes || '| illegal-draft->on_rent-blocked ';
  END;

  UPDATE rental_contracts SET lifecycle_state='reserved' WHERE id=v_cid;
  v_passes := v_passes || '| draft->reserved ';

  BEGIN
    UPDATE rental_contracts SET lifecycle_state='on_rent' WHERE id=v_cid;
    RAISE EXCEPTION 'SMOKE_FAIL: on_rent allowed without inspection';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught LIKE 'SMOKE_FAIL%' THEN RAISE; END IF;
    IF v_caught NOT LIKE '%inspection%' THEN
      RAISE EXCEPTION 'SMOKE_FAIL: on_rent blocked for wrong reason: %', v_caught;
    END IF;
    v_passes := v_passes || '| inspection-gate-fired ';
  END;

  INSERT INTO inspection_runs (workspace_id, rental_contract_id, template_id, inspection_number,
    equipment_id, started_at, completed_at, machine_hours)
  VALUES (v_ws, v_cid, v_template, 'INS-SHADOW-1', v_unit, now(), now(), 1200);
  v_passes := v_passes || '| inspection-completed ';

  UPDATE rental_contracts SET lifecycle_state='on_rent' WHERE id=v_cid;
  v_passes := v_passes || '| reserved->on_rent ';

  UPDATE rental_contracts SET on_rent_at = now() - interval '40 days' WHERE id=v_cid;

  UPDATE rental_contracts SET lifecycle_state='off_rent' WHERE id=v_cid;
  v_passes := v_passes || '| on_rent->off_rent ';

  UPDATE rental_contracts SET lifecycle_state='returned' WHERE id=v_cid;
  v_passes := v_passes || '| off_rent->returned ';

  BEGIN
    UPDATE rental_contracts SET lifecycle_state='closed' WHERE id=v_cid;
    RAISE EXCEPTION 'SMOKE_FAIL: closed allowed before final billing';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught LIKE 'SMOKE_FAIL%' THEN RAISE; END IF;
    v_passes := v_passes || '| close-before-bill-blocked ';
  END;

  INSERT INTO rental_invoices (workspace_id, rental_contract_id, invoice_number,
    period_start, period_end, billing_cycle, rental_charge_cents, taxable_amount_cents,
    tax_cents, total_cents, status, posted_at, due_date)
  SELECT v_ws, v_cid, 'RENT-SHADOW-1',
    (SELECT on_rent_at::date FROM rental_contracts WHERE id=v_cid),
    (SELECT off_rent_at::date FROM rental_contracts WHERE id=v_cid),
    'cycle_28_day', 315000, 315000, 0, 315000, 'posted', now(), CURRENT_DATE;
  v_passes := v_passes || '| final-invoice-posted ';

  UPDATE rental_contracts SET lifecycle_state='closed' WHERE id=v_cid;
  v_passes := v_passes || '| returned->closed ';

  BEGIN
    UPDATE rental_contracts SET lifecycle_state='on_rent' WHERE id=v_cid;
    RAISE EXCEPTION 'SMOKE_FAIL: closed->on_rent was ALLOWED';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught LIKE 'SMOKE_FAIL%' THEN RAISE; END IF;
    v_passes := v_passes || '| closed-terminal ';
  END;

  -- Everything above is rolled back by this RAISE — the cutover leaves no data.
  RAISE EXCEPTION 'SMOKE_PASS: %', v_passes;
END $$;
