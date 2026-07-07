-- ============================================================================
-- Migration 772: Stream L / L2 kickoff — lifecycle contract pins (owner
-- review 2026-07-07). All changes ADDITIVE against the 769/770 guard
-- semantics — the L0 counter-demo path must keep working while L2 builds.
--
--   1. Exchange chains DECLARE rate-continuity at creation: the exchange line
--      snapshots whether the swap is rate-continuous (same class: continuous
--      clock + optimization across the chain) or rate-segmenting (class
--      change: L5 optimizes per segment at the exchange timestamp). L5
--      reconciliation reads a fact, never re-derives one.
--   2. Damage disposition is a DECISION, not a default: customer_billable |
--      warranty | internal_wear, starting 'pending'. Assessed damage must not
--      hit any invoice while pending; ambiguity goes to the exception queue.
--   3. Contract trunk status is a DERIVED ROLLUP of line states on multi-line
--      contracts (partial returns are normal): rental_contract_rollup_lifecycle
--      states the rule; the enforcing trigger lands with the L2 execution
--      build (kept out of this migration so the L0 demo stays undisturbed).
--   4. Resolver id-space mitigation: rental_resolve_rates now records the id
--      space consulted at the customer stage and DETECTS the silent-miss case
--      (qrm-anchored caller, rules stored under mapped portal ids) — flagging
--      the result AND enqueueing exception_queue('rental_rate_mismatch') so a
--      national account can never silently pay sticker.
--   5. exception_queue.source gains the Stream L family (incl. the L4 set —
--      one constraint rebuild instead of two).
-- ============================================================================

BEGIN;

-- 5. exception_queue rental sources
ALTER TABLE public.exception_queue DROP CONSTRAINT IF EXISTS exception_queue_source_check;
ALTER TABLE public.exception_queue ADD CONSTRAINT exception_queue_source_check
  CHECK (source = ANY (ARRAY[
    'tax_failed', 'price_unmatched', 'health_refresh_failed', 'ar_override_pending',
    'stripe_mismatch', 'portal_reorder_approval', 'sop_evidence_mismatch',
    'geofence_conflict', 'stale_telematics', 'doc_visibility', 'data_quality',
    'analytics_alert', 'workflow_dead_letter', 'messaging_failure', 'messaging_opt_out_review',
    'rental_rate_mismatch', 'rental_overdue_return', 'rental_coi_expired',
    'rental_credit_hold', 'rental_damage_dispute', 'rental_overbook_override',
    'rental_billing_failed'
  ]));

-- 1. Exchange rate-continuity snapshot
ALTER TABLE public.rental_contract_lines
  ADD COLUMN IF NOT EXISTS exchange_rate_continuous boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_lines_exchange_declares_continuity') THEN
    ALTER TABLE public.rental_contract_lines
      ADD CONSTRAINT rental_lines_exchange_declares_continuity
      CHECK (exchange_parent_line_id IS NULL OR exchange_rate_continuous IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.rental_contract_lines.exchange_rate_continuous IS
  'Snapshotted when the exchange line is created: true = same rate class, clock and optimization run continuously across the chain; false = class change, L5 segments the duration at the exchange timestamp and optimizes per segment. Billing reads this fact — it never re-derives it.';

-- 2. Damage disposition
ALTER TABLE public.rental_returns
  ADD COLUMN IF NOT EXISTS damage_disposition text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_returns_damage_disposition_chk') THEN
    ALTER TABLE public.rental_returns
      ADD CONSTRAINT rental_returns_damage_disposition_chk
      CHECK (damage_disposition IN ('pending', 'customer_billable', 'warranty', 'internal_wear'));
  END IF;
END $$;

COMMENT ON COLUMN public.rental_returns.damage_disposition IS
  'Who pays is a decision, not a default: customer_billable flows to the rental invoice; warranty and internal_wear post via the H10 internal seam and eat margin. Assessed damage amounts MUST NOT reach any invoice while pending; ambiguous assessments enqueue exception_queue(rental_damage_dispute).';

-- 3. Trunk-status derivation rule for multi-line contracts
CREATE OR REPLACE FUNCTION public.rental_contract_rollup_lifecycle(p_contract_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_any_open boolean;      -- reserved/quoted lines still ahead of the clock
  v_any_on_rent boolean;   -- active or held lines (clock running / suspended)
  v_any_off_rent boolean;  -- clock stopped, unit still in the field
  v_line_count integer;
BEGIN
  SELECT count(*),
         bool_or(l.status IN ('active', 'held')),
         bool_or(l.status = 'off_rent'),
         bool_or(l.status IN ('quoted', 'reserved'))
  INTO v_line_count, v_any_on_rent, v_any_off_rent, v_any_open
  FROM public.rental_contract_lines l
  WHERE l.rental_contract_id = p_contract_id AND l.deleted_at IS NULL;

  -- No lines: the header machine stands alone (single-unit legacy shape).
  IF v_line_count = 0 THEN
    RETURN NULL;
  END IF;

  -- THE derivation rule (owner review 2026-07-07): the trunk is a rollup —
  -- any running/suspended line keeps the contract on_rent (partial returns
  -- are normal, not an edge case); with none running, any off-rent line
  -- holds the contract at off_rent until physical return; only when every
  -- line is terminal is the contract returned. Pre-clock lines keep the
  -- reservation phase.
  IF COALESCE(v_any_on_rent, false) THEN
    RETURN 'on_rent';
  ELSIF COALESCE(v_any_off_rent, false) THEN
    RETURN 'off_rent';
  ELSIF COALESCE(v_any_open, false) THEN
    RETURN 'reserved';
  ELSE
    RETURN 'returned';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.rental_contract_rollup_lifecycle(uuid) IS
  'Derives the contract trunk state from line states on multi-line contracts. L2 execution wires this into the transition path; shipped function-first so the rule is stated before it is enforced (keeps the L0 demo path undisturbed).';

-- 4. Resolver v2 — id-space detection at the customer stage
CREATE OR REPLACE FUNCTION public.rental_resolve_rates(
  p_workspace_id text,
  p_equipment_id uuid DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_equipment_class text DEFAULT NULL,
  p_equipment_subclass text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_on_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_path jsonb := '[]'::jsonb;
  v_stage text;
  v_stages text[] := ARRAY['equipment', 'customer', 'class', 'category', 'branch', 'workspace_default'];
  v_book jsonb;
  v_portal_rule_ids uuid[];
  v_mismatch boolean := false;
BEGIN
  FOREACH v_stage IN ARRAY v_stages LOOP
    SELECT r.* INTO v_rule
    FROM public.rental_rate_rules r
    WHERE r.workspace_id = p_workspace_id
      AND r.is_active
      AND (r.effective_from IS NULL OR r.effective_from <= p_on_date)
      AND (r.effective_to IS NULL OR r.effective_to >= p_on_date)
      AND (r.season_start IS NULL OR r.season_end IS NULL
           OR p_on_date BETWEEN r.season_start AND r.season_end)
      AND CASE v_stage
            WHEN 'equipment' THEN r.equipment_id IS NOT NULL AND r.equipment_id = p_equipment_id
            WHEN 'customer'  THEN r.customer_id IS NOT NULL AND r.customer_id::text = p_company_id::text
            WHEN 'class'     THEN r.equipment_class IS NOT NULL
                                  AND r.equipment_class = p_equipment_class
                                  AND (r.equipment_subclass IS NULL OR r.equipment_subclass = p_equipment_subclass)
            WHEN 'category'  THEN r.category IS NOT NULL AND r.category = p_category
            WHEN 'branch'    THEN r.branch_id IS NOT NULL AND r.branch_id = p_branch_id
                                  AND r.equipment_id IS NULL AND r.customer_id IS NULL
                                  AND r.equipment_class IS NULL AND r.category IS NULL
            ELSE r.equipment_id IS NULL AND r.customer_id IS NULL AND r.branch_id IS NULL
                 AND r.equipment_class IS NULL AND r.equipment_subclass IS NULL
                 AND r.category IS NULL AND r.make IS NULL AND r.model IS NULL
          END
    ORDER BY r.priority_rank DESC NULLS LAST, r.effective_from DESC NULLS LAST, r.created_at DESC
    LIMIT 1;

    -- The customer stage records which id space it consulted so a silent
    -- non-match is visible in the path, not just absent from it.
    IF v_stage = 'customer' THEN
      v_path := v_path || jsonb_build_object(
        'stage', v_stage, 'matched', v_rule.id IS NOT NULL, 'rule_id', v_rule.id,
        'id_space', 'direct:' || COALESCE(p_company_id::text, 'none'));
    ELSE
      v_path := v_path || jsonb_build_object('stage', v_stage, 'matched', v_rule.id IS NOT NULL, 'rule_id', v_rule.id);
    END IF;

    IF v_rule.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'day',   CASE WHEN v_rule.daily_rate   > 0 THEN round(v_rule.daily_rate   * 100)::bigint END,
        'week',  CASE WHEN v_rule.weekly_rate  > 0 THEN round(v_rule.weekly_rate  * 100)::bigint END,
        'month', CASE WHEN v_rule.monthly_rate > 0 THEN round(v_rule.monthly_rate * 100)::bigint END,
        'hourly', CASE WHEN v_rule.hourly_rate > 0 THEN round(v_rule.hourly_rate * 100)::bigint END,
        'included_hours_per_day', v_rule.included_hours_per_day,
        'overage_hourly', CASE WHEN v_rule.overage_hourly_rate > 0 THEN round(v_rule.overage_hourly_rate * 100)::bigint END,
        'minimum_days', COALESCE(v_rule.minimum_days, 1),
        'source_rule_id', v_rule.id,
        'source', 'rate_rule:' || v_stage,
        'customer_rate_mismatch', false,
        'resolution_path', v_path
      );
    END IF;
  END LOOP;

  -- Id-space mismatch detection: the caller anchored on a QRM company but
  -- negotiated rules exist under the portal ids that map to that company.
  -- Without this, a national account silently pays sticker — an angry phone
  -- call, never a red test.
  IF p_company_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT r.id) INTO v_portal_rule_ids
    FROM public.portal_customers pc
    JOIN public.rental_rate_rules r
      ON r.customer_id = pc.id
    WHERE pc.crm_company_id = p_company_id
      AND pc.workspace_id = p_workspace_id
      AND r.workspace_id = p_workspace_id
      AND r.is_active;

    IF v_portal_rule_ids IS NOT NULL THEN
      v_mismatch := true;
      v_path := v_path || jsonb_build_object(
        'stage', 'customer_id_space_mismatch', 'matched', false,
        'portal_rule_ids', to_jsonb(v_portal_rule_ids));
      PERFORM public.enqueue_exception(
        'rental_rate_mismatch',
        'Negotiated rental rates exist under portal ids for this company but were not matched',
        'error',
        'rental_resolve_rates anchored on qrm_company_id ' || p_company_id::text ||
          ' fell through the customer stage while active rate rules exist under mapped portal customer ids. The account may be quoted sticker rates.',
        jsonb_build_object('company_id', p_company_id, 'portal_rule_ids', to_jsonb(v_portal_rule_ids), 'workspace_id', p_workspace_id),
        'rental_rate_rules',
        v_portal_rule_ids[1]
      );
    END IF;
  END IF;

  IF p_equipment_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'day',   CASE WHEN e.daily_rental_rate   > 0 THEN round(e.daily_rental_rate   * 100)::bigint END,
      'week',  CASE WHEN e.weekly_rental_rate  > 0 THEN round(e.weekly_rental_rate  * 100)::bigint END,
      'month', CASE WHEN e.monthly_rental_rate > 0 THEN round(e.monthly_rental_rate * 100)::bigint END,
      'hourly', NULL, 'included_hours_per_day', NULL, 'overage_hourly', NULL,
      'minimum_days', 1,
      'source_rule_id', NULL,
      'source', 'equipment_sticker',
      'customer_rate_mismatch', v_mismatch,
      'resolution_path', v_path || jsonb_build_object('stage', 'equipment_sticker', 'matched', true, 'rule_id', NULL)
    ) INTO v_book
    FROM public.qrm_equipment e
    WHERE e.id = p_equipment_id AND e.workspace_id = p_workspace_id;
    IF v_book IS NOT NULL THEN
      RETURN v_book;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'day', NULL, 'week', NULL, 'month', NULL,
    'hourly', NULL, 'included_hours_per_day', NULL, 'overage_hourly', NULL,
    'minimum_days', 1, 'source_rule_id', NULL, 'source', 'unresolved',
    'customer_rate_mismatch', v_mismatch,
    'resolution_path', v_path
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.rental_resolve_rates(text, uuid, uuid, text, text, text, uuid, date) TO authenticated, service_role;

COMMIT;
