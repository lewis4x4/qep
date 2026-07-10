-- Migration 813: A7.7 + A7.9 atomic OEM reprice apply, audit, and reversal
--
-- Apply and reversal are one release unit. Both mutations are service-only,
-- transaction-scoped RPCs called after Edge authentication. Every caller is
-- re-authorized against current profile/workspace/rep truth inside Postgres.

BEGIN;

-- Normalize the version and approval snapshots that were previously carried
-- only inside proposed_patch / before_snapshot JSON.
ALTER TABLE public.qb_quote_reprice_drafts
  ADD COLUMN IF NOT EXISTS draft_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quote_package_version_id uuid,
  ADD COLUMN IF NOT EXISTS quote_version_number integer,
  ADD COLUMN IF NOT EXISTS quote_pricing_epoch_snapshot bigint,
  ADD COLUMN IF NOT EXISTS quote_updated_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS impact_updated_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS approved_draft_updated_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

ALTER TABLE public.quote_approval_cases
  ADD COLUMN IF NOT EXISTS oem_reprice_draft_id uuid,
  ADD COLUMN IF NOT EXISTS oem_reprice_draft_version integer,
  ADD COLUMN IF NOT EXISTS oem_reprice_draft_updated_at timestamptz;

ALTER TABLE public.qb_quote_reprice_drafts
  DROP CONSTRAINT IF EXISTS qb_quote_reprice_drafts_status_check;
ALTER TABLE public.qb_quote_reprice_drafts
  ADD CONSTRAINT qb_quote_reprice_drafts_status_check
  CHECK (status IN (
    'draft', 'approval_pending', 'approved', 'applied', 'reversed',
    'rejected', 'stale', 'cancelled'
  ));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_drafts_draft_version_chk'
      AND conrelid = 'public.qb_quote_reprice_drafts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_drafts
      ADD CONSTRAINT qb_quote_reprice_drafts_draft_version_chk
      CHECK (draft_version > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_drafts_pricing_epoch_chk'
      AND conrelid = 'public.qb_quote_reprice_drafts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_drafts
      ADD CONSTRAINT qb_quote_reprice_drafts_pricing_epoch_chk
      CHECK (
        quote_pricing_epoch_snapshot IS NULL
        OR quote_pricing_epoch_snapshot >= 0
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_drafts_quote_version_number_chk'
      AND conrelid = 'public.qb_quote_reprice_drafts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_drafts
      ADD CONSTRAINT qb_quote_reprice_drafts_quote_version_number_chk
      CHECK (quote_version_number IS NULL OR quote_version_number > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_drafts_quote_version_fk'
      AND conrelid = 'public.qb_quote_reprice_drafts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_drafts
      ADD CONSTRAINT qb_quote_reprice_drafts_quote_version_fk
      FOREIGN KEY (quote_package_version_id)
      REFERENCES public.quote_package_versions(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_drafts_approval_case_fk'
      AND conrelid = 'public.qb_quote_reprice_drafts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_drafts
      ADD CONSTRAINT qb_quote_reprice_drafts_approval_case_fk
      FOREIGN KEY (approval_case_id)
      REFERENCES public.quote_approval_cases(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_approval_cases_oem_reprice_draft_fk'
      AND conrelid = 'public.quote_approval_cases'::regclass
  ) THEN
    ALTER TABLE public.quote_approval_cases
      ADD CONSTRAINT quote_approval_cases_oem_reprice_draft_fk
      FOREIGN KEY (oem_reprice_draft_id)
      REFERENCES public.qb_quote_reprice_drafts(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quote_approval_cases_oem_reprice_binding_chk'
      AND conrelid = 'public.quote_approval_cases'::regclass
  ) THEN
    ALTER TABLE public.quote_approval_cases
      ADD CONSTRAINT quote_approval_cases_oem_reprice_binding_chk
      CHECK (
        (oem_reprice_draft_id IS NULL
          AND oem_reprice_draft_version IS NULL
          AND oem_reprice_draft_updated_at IS NULL)
        OR
        (oem_reprice_draft_id IS NOT NULL
          AND oem_reprice_draft_version > 0
          AND oem_reprice_draft_updated_at IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.qb_quote_reprice_drafts
  VALIDATE CONSTRAINT qb_quote_reprice_drafts_draft_version_chk;
ALTER TABLE public.qb_quote_reprice_drafts
  VALIDATE CONSTRAINT qb_quote_reprice_drafts_quote_version_number_chk;
ALTER TABLE public.qb_quote_reprice_drafts
  VALIDATE CONSTRAINT qb_quote_reprice_drafts_pricing_epoch_chk;
ALTER TABLE public.quote_approval_cases
  VALIDATE CONSTRAINT quote_approval_cases_oem_reprice_binding_chk;

CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_drafts_quote_version
  ON public.qb_quote_reprice_drafts(quote_package_version_id)
  WHERE quote_package_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_drafts_approval_case
  ON public.qb_quote_reprice_drafts(approval_case_id)
  WHERE approval_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quote_approval_cases_oem_reprice_draft
  ON public.quote_approval_cases(oem_reprice_draft_id, oem_reprice_draft_version)
  WHERE oem_reprice_draft_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_approval_cases_oem_reprice_draft_version
  ON public.quote_approval_cases(oem_reprice_draft_id, oem_reprice_draft_version)
  WHERE oem_reprice_draft_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_qb_quote_reprice_drafts_active_impact;
CREATE UNIQUE INDEX uq_qb_quote_reprice_drafts_active_impact
  ON public.qb_quote_reprice_drafts(impact_id)
  WHERE status IN ('draft', 'approval_pending', 'approved');

-- Phase 1 exposed direct authenticated writes to draft/impact/approval rows.
-- The governed create/decision/apply/reverse APIs now own every mutation;
-- clients retain RLS-scoped read access only. Revokes close the normal path,
-- while the triggers below keep the OEM invariant fail-closed if a future
-- migration accidentally restores table privileges.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qb_quote_reprice_drafts
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qb_quote_reprice_impacts
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.quote_approval_cases
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_qb_oem_reprice_service_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION '% mutations require the governed OEM reprice service', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_qb_oem_reprice_draft_service_mutation
  ON public.qb_quote_reprice_drafts;
CREATE TRIGGER trg_00_qb_oem_reprice_draft_service_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.qb_quote_reprice_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_qb_oem_reprice_service_mutation();

DROP TRIGGER IF EXISTS trg_00_qb_oem_reprice_impact_service_mutation
  ON public.qb_quote_reprice_impacts;
CREATE TRIGGER trg_00_qb_oem_reprice_impact_service_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.qb_quote_reprice_impacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_qb_oem_reprice_service_mutation();

REVOKE ALL ON FUNCTION public.guard_qb_oem_reprice_service_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_qb_oem_approval_case_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_oem boolean := TG_OP <> 'INSERT' AND
    COALESCE(OLD.policy_snapshot_json ->> 'approval_kind', '') = 'oem_reprice';
  v_new_oem boolean := TG_OP <> 'DELETE' AND
    COALESCE(NEW.policy_snapshot_json ->> 'approval_kind', '') = 'oem_reprice';
BEGIN
  IF (v_old_oem OR v_new_oem)
     AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'OEM approval identity and decisions require the governed service'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_00_guard_qb_oem_approval_case_mutation
  ON public.quote_approval_cases;
CREATE TRIGGER trg_00_guard_qb_oem_approval_case_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_approval_cases
  FOR EACH ROW EXECUTE FUNCTION public.guard_qb_oem_approval_case_mutation();

REVOKE ALL ON FUNCTION public.guard_qb_oem_approval_case_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_qb_oem_reprice_draft_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'applied', 'reversed')
     AND (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'protected OEM reprice status requires governed RPC'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.proposed_patch IS DISTINCT FROM OLD.proposed_patch
     OR NEW.before_snapshot IS DISTINCT FROM OLD.before_snapshot
     OR NEW.projected_totals IS DISTINCT FROM OLD.projected_totals
     OR NEW.impact_id IS DISTINCT FROM OLD.impact_id
     OR NEW.quote_package_id IS DISTINCT FROM OLD.quote_package_id
     OR NEW.quote_pricing_epoch_snapshot IS DISTINCT FROM
        OLD.quote_pricing_epoch_snapshot THEN
    IF OLD.status IN ('approval_pending', 'approved') THEN
      RAISE EXCEPTION 'submitted OEM reprice draft cannot be edited in place'
        USING ERRCODE = '55000';
    END IF;
    NEW.draft_version := OLD.draft_version + 1;
    NEW.approval_case_id := NULL;
    NEW.approved_draft_updated_at_snapshot := NULL;
  ELSIF NEW.draft_version IS DISTINCT FROM OLD.draft_version THEN
    RAISE EXCEPTION 'draft_version is server-managed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_qb_oem_reprice_draft_version
  ON public.qb_quote_reprice_drafts;
CREATE TRIGGER trg_guard_qb_oem_reprice_draft_version
  BEFORE UPDATE ON public.qb_quote_reprice_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_qb_oem_reprice_draft_version();

REVOKE ALL ON FUNCTION public.guard_qb_oem_reprice_draft_version() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.qb_quote_reprice_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  quote_package_id uuid NOT NULL
    REFERENCES public.quote_packages(id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL
    REFERENCES public.qb_quote_reprice_drafts(id) ON DELETE RESTRICT,
  impact_id uuid NOT NULL
    REFERENCES public.qb_quote_reprice_impacts(id) ON DELETE RESTRICT,
  apply_audit_id uuid
    REFERENCES public.qb_quote_reprice_audits(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('apply', 'reverse')),
  idempotency_key text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  actor_role text NOT NULL CHECK (actor_role IN ('rep', 'admin', 'manager', 'owner')),
  approval_case_id uuid NOT NULL
    REFERENCES public.quote_approval_cases(id) ON DELETE RESTRICT,
  source_event_id uuid NOT NULL
    REFERENCES public.qb_price_change_events(id) ON DELETE RESTRICT,
  price_sheet_id uuid NOT NULL
    REFERENCES public.qb_price_sheets(id) ON DELETE RESTRICT,
  prior_price_sheet_id uuid
    REFERENCES public.qb_price_sheets(id) ON DELETE RESTRICT,
  before_quote_version_id uuid NOT NULL
    REFERENCES public.quote_package_versions(id) ON DELETE RESTRICT,
  after_quote_version_id uuid NOT NULL
    REFERENCES public.quote_package_versions(id) ON DELETE RESTRICT,
  before_version_number integer NOT NULL CHECK (before_version_number > 0),
  after_version_number integer NOT NULL CHECK (after_version_number > before_version_number),
  before_quote_status text NOT NULL,
  after_quote_status text NOT NULL,
  before_totals jsonb NOT NULL CHECK (jsonb_typeof(before_totals) = 'object'),
  after_totals jsonb NOT NULL CHECK (jsonb_typeof(after_totals) = 'object'),
  line_changes jsonb NOT NULL CHECK (jsonb_typeof(line_changes) = 'array'),
  commission_projection jsonb NOT NULL
    CHECK (jsonb_typeof(commission_projection) = 'object'),
  margin_override jsonb,
  customer_communication_sent boolean NOT NULL DEFAULT false
    CHECK (customer_communication_sent = false),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload #>> '{side_effects,customer_communication}' = 'none'
    AND payload #>> '{commission_projection,policy}' = 'OEM-DP10'
    AND payload #> '{commission_projection,split_allocation}' = 'null'::jsonb
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qb_quote_reprice_audits_action_link_chk CHECK (
    (action = 'apply' AND apply_audit_id IS NULL)
    OR (action = 'reverse' AND apply_audit_id IS NOT NULL)
  ),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_quote_reprice_audits_apply_draft
  ON public.qb_quote_reprice_audits(workspace_id, draft_id)
  WHERE action = 'apply';
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_quote_reprice_audits_reverse_apply
  ON public.qb_quote_reprice_audits(workspace_id, apply_audit_id)
  WHERE action = 'reverse';
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_quote_created
  ON public.qb_quote_reprice_audits(workspace_id, quote_package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_quote_fk
  ON public.qb_quote_reprice_audits(quote_package_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_draft_fk
  ON public.qb_quote_reprice_audits(draft_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_impact
  ON public.qb_quote_reprice_audits(impact_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_apply_fk
  ON public.qb_quote_reprice_audits(apply_audit_id)
  WHERE apply_audit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_actor
  ON public.qb_quote_reprice_audits(actor_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_approval
  ON public.qb_quote_reprice_audits(approval_case_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_source_event
  ON public.qb_quote_reprice_audits(source_event_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_price_sheet
  ON public.qb_quote_reprice_audits(price_sheet_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_prior_sheet
  ON public.qb_quote_reprice_audits(prior_price_sheet_id)
  WHERE prior_price_sheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_before_version
  ON public.qb_quote_reprice_audits(before_quote_version_id);
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_audits_after_version
  ON public.qb_quote_reprice_audits(after_quote_version_id);

COMMENT ON TABLE public.qb_quote_reprice_audits IS
  'Append-only A7.7/A7.9 dollar-for-dollar OEM reprice apply and reversal ledger. Mutations are possible only through service-role RPCs.';
COMMENT ON COLUMN public.qb_quote_reprice_audits.customer_communication_sent IS
  'OEM-DP2 invariant. Apply and reversal never send or enqueue customer communication.';

CREATE OR REPLACE FUNCTION public.reject_qb_quote_reprice_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'qb_quote_reprice_audits is append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_qb_quote_reprice_audits_append_only
  ON public.qb_quote_reprice_audits;
CREATE TRIGGER trg_qb_quote_reprice_audits_append_only
  BEFORE UPDATE OR DELETE ON public.qb_quote_reprice_audits
  FOR EACH ROW EXECUTE FUNCTION public.reject_qb_quote_reprice_audit_mutation();

REVOKE ALL ON FUNCTION public.reject_qb_quote_reprice_audit_mutation() FROM PUBLIC;

ALTER TABLE public.qb_quote_reprice_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qb_quote_reprice_audits_service_select"
  ON public.qb_quote_reprice_audits;
CREATE POLICY "qb_quote_reprice_audits_service_select"
  ON public.qb_quote_reprice_audits
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.qb_quote_reprice_audits
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.qb_quote_reprice_audits TO service_role;

-- Cents-level mirror of quote-builder-v2 computeQuoteFinancials. Tax remains
-- the current server-side quote tax snapshot, matching the canonical builder.
CREATE OR REPLACE FUNCTION public.qb_oem_reprice_canonical_totals(
  p_quote_package_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH quote_row AS (
    SELECT
      q.id,
      COALESCE(q.commercial_discount_type, 'flat') AS discount_type,
      GREATEST(COALESCE(q.commercial_discount_value, 0), 0) AS discount_value,
      GREATEST(COALESCE(q.trade_credit, 0), 0) AS trade_credit,
      GREATEST(COALESCE(q.tax_total, 0), 0) AS tax_total,
      GREATEST(COALESCE(q.cash_down, 0), 0) AS cash_down
    FROM public.quote_packages q
    WHERE q.id = p_quote_package_id
  ), line_sums AS (
    SELECT
      q.*,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND line.line_type = 'equipment'
             THEN GREATEST(ROUND(COALESCE(
               line.extended_price,
               COALESCE(line.unit_price, line.quoted_list_price, 0)
                 * GREATEST(COALESCE(line.quantity, 1), 1)
             ), 2), 0)
             ELSE 0 END
      ), 0) AS equipment_total,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND line.line_type <> 'equipment'
                   AND line.line_type IN (
                     'attachment', 'option', 'accessory', 'part', 'warranty',
                     'financing', 'pdi', 'freight', 'good_faith', 'doc_fee',
                     'title', 'tag', 'registration', 'custom'
                   )
             THEN GREATEST(ROUND(COALESCE(
               line.extended_price,
               COALESCE(line.unit_price, line.quoted_list_price, 0)
                 * GREATEST(COALESCE(line.quantity, 1), 1)
             ), 2), 0)
             ELSE 0 END
      ), 0) AS attachment_total,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND (
                     line.line_type IN (
                       'discount', 'rebate_mfg', 'rebate_dealer',
                       'loyalty_discount'
                     )
                     OR line.metadata ->> 'misc_line_kind' = 'credit'
                   )
             THEN GREATEST(ROUND(COALESCE(
               line.extended_price,
               COALESCE(line.unit_price, line.quoted_list_price, 0)
                 * GREATEST(COALESCE(line.quantity, 1), 1)
             ), 2), 0)
             ELSE 0 END
      ), 0) AS line_discount_total,
      COALESCE(SUM(
        CASE WHEN line.line_type IN (
                     'equipment', 'attachment', 'option', 'accessory', 'part',
                     'warranty', 'financing', 'pdi', 'freight', 'good_faith',
                     'doc_fee', 'title', 'tag', 'registration', 'custom'
                   ) OR line.cost_visibility = 'internal'
             THEN (
               CASE WHEN GREATEST(COALESCE(line.quoted_dealer_cost, 0), 0) > 0
                    THEN GREATEST(ROUND(line.quoted_dealer_cost, 2), 0)
                    WHEN line.cost_visibility = 'internal'
                    THEN GREATEST(ROUND(COALESCE(
                      line.unit_price, line.quoted_list_price, 0
                    ), 2), 0)
                    ELSE 0 END
             ) * GREATEST(COALESCE(line.quantity, 1), 1)
             ELSE 0 END
      ), 0) AS dealer_cost
    FROM quote_row q
    LEFT JOIN public.quote_package_line_items line
      ON line.quote_package_id = q.id
    GROUP BY q.id, q.discount_type, q.discount_value,
             q.trade_credit, q.tax_total, q.cash_down
  ), subtotal_calc AS (
    SELECT *, ROUND(equipment_total + attachment_total, 2) AS subtotal
    FROM line_sums
  ), discount_calc AS (
    SELECT *,
      ROUND(
        line_discount_total +
        CASE WHEN discount_type = 'percent'
             THEN subtotal * LEAST(100, discount_value) / 100
             ELSE discount_value END,
        2
      ) AS discount_total
    FROM subtotal_calc
  ), net_calc AS (
    SELECT *, GREATEST(ROUND(subtotal - discount_total - trade_credit, 2), 0) AS net_total
    FROM discount_calc
  ), final_calc AS (
    SELECT *,
      ROUND(net_total + tax_total, 2) AS customer_total,
      GREATEST(ROUND(net_total + tax_total - cash_down, 2), 0) AS amount_financed,
      GREATEST(ROUND(net_total - dealer_cost, 2), 0) AS margin_amount
    FROM net_calc
  )
  SELECT jsonb_build_object(
    'equipment_total_cents', ROUND(equipment_total * 100)::bigint,
    'attachment_total_cents', ROUND(attachment_total * 100)::bigint,
    'subtotal_cents', ROUND(subtotal * 100)::bigint,
    'discount_total_cents', ROUND(discount_total * 100)::bigint,
    'trade_credit_cents', ROUND(trade_credit * 100)::bigint,
    'net_total_cents', ROUND(net_total * 100)::bigint,
    'tax_total_cents', ROUND(tax_total * 100)::bigint,
    'customer_total_cents', ROUND(customer_total * 100)::bigint,
    'cash_down_cents', ROUND(cash_down * 100)::bigint,
    'amount_financed_cents', ROUND(amount_financed * 100)::bigint,
    'dealer_cost_cents', ROUND(dealer_cost * 100)::bigint,
    'margin_amount_cents', ROUND(margin_amount * 100)::bigint,
    'margin_pct', CASE WHEN net_total > 0
      THEN ROUND((margin_amount / net_total) * 100, 2)
      ELSE 0 END
  )
  FROM final_calc;
$$;

REVOKE ALL ON FUNCTION public.qb_oem_reprice_canonical_totals(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Project the exact post-apply totals without mutating quote lines. The
-- overlay uses the same eligible-line rules as apply, then runs the complete
-- canonical discount/tax/margin calculation. In particular, a percent
-- commercial discount is recomputed from the projected subtotal rather than
-- treating raw OEM list-price delta as customer net delta.
CREATE OR REPLACE FUNCTION public.qb_oem_reprice_projected_totals(
  p_quote_package_id uuid,
  p_impact_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH quote_row AS (
    SELECT
      q.id,
      COALESCE(q.commercial_discount_type, 'flat') AS discount_type,
      GREATEST(COALESCE(q.commercial_discount_value, 0), 0) AS discount_value,
      GREATEST(COALESCE(q.trade_credit, 0), 0) AS trade_credit,
      GREATEST(COALESCE(q.tax_total, 0), 0) AS tax_total,
      GREATEST(COALESCE(q.cash_down, 0), 0) AS cash_down
    FROM public.quote_packages q
    WHERE q.id = p_quote_package_id
  ), line_context AS (
    SELECT
      line.*,
      impact_line.id AS impact_line_id,
      impact_line.new_list_price_cents,
      impact_line.suppressed_by_stock_lock,
      impact_line.is_yard_stock,
      CASE
        WHEN impact_line.id IS NOT NULL
          AND impact_line.suppressed_by_stock_lock = false
          AND impact_line.is_yard_stock = false
          AND line.source_location IS DISTINCT FROM 'yard_stock'
        THEN (impact_line.new_list_price_cents *
          GREATEST(COALESCE(line.quantity, 1), 1))::numeric / 100
        ELSE COALESCE(
          line.extended_price,
          COALESCE(line.unit_price, line.quoted_list_price, 0)
            * GREATEST(COALESCE(line.quantity, 1), 1)
        )
      END AS projected_extended_price
    FROM public.quote_package_line_items line
    LEFT JOIN public.qb_quote_reprice_impact_lines impact_line
      ON impact_line.impact_id = p_impact_id
     AND impact_line.quote_package_line_item_id = line.id
    WHERE line.quote_package_id = p_quote_package_id
  ), line_sums AS (
    SELECT
      q.*,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND line.line_type = 'equipment'
             THEN GREATEST(ROUND(line.projected_extended_price, 2), 0)
             ELSE 0 END
      ), 0) AS equipment_total,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND line.line_type <> 'equipment'
                   AND line.line_type IN (
                     'attachment', 'option', 'accessory', 'part', 'warranty',
                     'financing', 'pdi', 'freight', 'good_faith', 'doc_fee',
                     'title', 'tag', 'registration', 'custom'
                   )
             THEN GREATEST(ROUND(line.projected_extended_price, 2), 0)
             ELSE 0 END
      ), 0) AS attachment_total,
      COALESCE(SUM(
        CASE WHEN line.cost_visibility = 'customer'
                   AND (
                     line.line_type IN (
                       'discount', 'rebate_mfg', 'rebate_dealer',
                       'loyalty_discount'
                     )
                     OR line.metadata ->> 'misc_line_kind' = 'credit'
                   )
             THEN GREATEST(ROUND(line.projected_extended_price, 2), 0)
             ELSE 0 END
      ), 0) AS line_discount_total,
      COALESCE(SUM(
        CASE WHEN line.line_type IN (
                     'equipment', 'attachment', 'option', 'accessory', 'part',
                     'warranty', 'financing', 'pdi', 'freight', 'good_faith',
                     'doc_fee', 'title', 'tag', 'registration', 'custom'
                   ) OR line.cost_visibility = 'internal'
             THEN (
               CASE WHEN GREATEST(COALESCE(line.quoted_dealer_cost, 0), 0) > 0
                    THEN GREATEST(ROUND(line.quoted_dealer_cost, 2), 0)
                    WHEN line.cost_visibility = 'internal'
                    THEN GREATEST(ROUND(COALESCE(
                      line.unit_price, line.quoted_list_price, 0
                    ), 2), 0)
                    ELSE 0 END
             ) * GREATEST(COALESCE(line.quantity, 1), 1)
             ELSE 0 END
      ), 0) AS dealer_cost
    FROM quote_row q
    LEFT JOIN line_context line ON true
    GROUP BY q.id, q.discount_type, q.discount_value,
             q.trade_credit, q.tax_total, q.cash_down
  ), subtotal_calc AS (
    SELECT *, ROUND(equipment_total + attachment_total, 2) AS subtotal
    FROM line_sums
  ), discount_calc AS (
    SELECT *,
      ROUND(
        line_discount_total +
        CASE WHEN discount_type = 'percent'
             THEN subtotal * LEAST(100, discount_value) / 100
             ELSE discount_value END,
        2
      ) AS discount_total
    FROM subtotal_calc
  ), net_calc AS (
    SELECT *, GREATEST(ROUND(subtotal - discount_total - trade_credit, 2), 0) AS net_total
    FROM discount_calc
  ), final_calc AS (
    SELECT *,
      ROUND(net_total + tax_total, 2) AS customer_total,
      GREATEST(ROUND(net_total + tax_total - cash_down, 2), 0) AS amount_financed,
      GREATEST(ROUND(net_total - dealer_cost, 2), 0) AS margin_amount
    FROM net_calc
  )
  SELECT jsonb_build_object(
    'equipment_total_cents', ROUND(equipment_total * 100)::bigint,
    'attachment_total_cents', ROUND(attachment_total * 100)::bigint,
    'subtotal_cents', ROUND(subtotal * 100)::bigint,
    'discount_total_cents', ROUND(discount_total * 100)::bigint,
    'trade_credit_cents', ROUND(trade_credit * 100)::bigint,
    'net_total_cents', ROUND(net_total * 100)::bigint,
    'tax_total_cents', ROUND(tax_total * 100)::bigint,
    'customer_total_cents', ROUND(customer_total * 100)::bigint,
    'cash_down_cents', ROUND(cash_down * 100)::bigint,
    'amount_financed_cents', ROUND(amount_financed * 100)::bigint,
    'dealer_cost_cents', ROUND(dealer_cost * 100)::bigint,
    'margin_amount_cents', ROUND(margin_amount * 100)::bigint,
    'margin_pct', CASE WHEN net_total > 0
      THEN ROUND((margin_amount / net_total) * 100, 2)
      ELSE 0 END
  )
  FROM final_calc;
$$;

REVOKE ALL ON FUNCTION public.qb_oem_reprice_projected_totals(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qb_oem_reprice_recompute_quote_flag(
  p_workspace_id text,
  p_quote_package_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_active_oem_impact boolean;
  v_requote_reason constant text :=
    'OEM price update created a material reprice impact for this quote.';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.qb_quote_reprice_impacts impact
    JOIN public.qb_price_change_events event ON event.id = impact.event_id
    WHERE impact.quote_package_id = p_quote_package_id
      AND impact.workspace_id = p_workspace_id
      AND event.status = 'active'
      AND impact.state IN (
        'visible', 'draft_created', 'approval_pending', 'approved'
      )
  ) INTO v_has_active_oem_impact;

  UPDATE public.quote_packages quote
  SET
    requires_requote = CASE
      WHEN v_has_active_oem_impact THEN true
      WHEN quote.requote_reason = v_requote_reason THEN false
      ELSE quote.requires_requote
    END,
    requote_reason = CASE
      WHEN v_has_active_oem_impact
        AND (quote.requote_reason IS NULL OR quote.requote_reason = v_requote_reason)
      THEN v_requote_reason
      WHEN NOT v_has_active_oem_impact AND quote.requote_reason = v_requote_reason
      THEN NULL
      ELSE quote.requote_reason
    END
  WHERE quote.id = p_quote_package_id
    AND quote.workspace_id = p_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.qb_oem_reprice_recompute_quote_flag(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qb_oem_reprice_persisted_totals_match(
  p_quote_package_id uuid,
  p_totals jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ROUND(COALESCE(q.equipment_total, 0) * 100)::bigint =
      (p_totals ->> 'equipment_total_cents')::bigint
    AND ROUND(COALESCE(q.attachment_total, 0) * 100)::bigint =
      (p_totals ->> 'attachment_total_cents')::bigint
    AND ROUND(COALESCE(q.subtotal, 0) * 100)::bigint =
      (p_totals ->> 'subtotal_cents')::bigint
    AND ROUND(COALESCE(q.discount_total, 0) * 100)::bigint =
      (p_totals ->> 'discount_total_cents')::bigint
    AND ROUND(COALESCE(q.trade_credit, 0) * 100)::bigint =
      (p_totals ->> 'trade_credit_cents')::bigint
    AND ROUND(COALESCE(q.net_total, 0) * 100)::bigint =
      (p_totals ->> 'net_total_cents')::bigint
    AND ROUND(COALESCE(q.tax_total, 0) * 100)::bigint =
      (p_totals ->> 'tax_total_cents')::bigint
    AND ROUND(COALESCE(q.cash_down, 0) * 100)::bigint =
      (p_totals ->> 'cash_down_cents')::bigint
    AND ROUND(COALESCE(q.amount_financed, 0) * 100)::bigint =
      (p_totals ->> 'amount_financed_cents')::bigint
    AND ROUND(COALESCE(q.margin_amount, 0) * 100)::bigint =
      (p_totals ->> 'margin_amount_cents')::bigint
    AND ROUND(COALESCE(q.margin_pct, 0), 2) =
      (p_totals ->> 'margin_pct')::numeric
  FROM public.quote_packages q
  WHERE q.id = p_quote_package_id;
$$;

REVOKE ALL ON FUNCTION public.qb_oem_reprice_persisted_totals_match(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qb_oem_reprice_reversal_within_window(
  p_applied_at timestamptz,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT p_now <= p_applied_at + INTERVAL '7 days';
$$;

REVOKE ALL ON FUNCTION public.qb_oem_reprice_reversal_within_window(
  timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

-- Generic quote approval decisions are allowed to update an OEM-bound case,
-- but this trigger owns the corresponding draft/impact transition. It never
-- mutates quote delivery state, deal state, or communication records.
CREATE OR REPLACE FUNCTION public.sync_qb_oem_reprice_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_quote public.quote_packages%ROWTYPE;
  v_draft public.qb_quote_reprice_drafts%ROWTYPE;
  v_impact public.qb_quote_reprice_impacts%ROWTYPE;
  v_decider_workspace text;
  v_decider_role text;
  v_current_version public.quote_package_versions%ROWTYPE;
  v_current_pricing_epoch bigint;
BEGIN
  IF COALESCE(NEW.policy_snapshot_json ->> 'approval_kind', '') <> 'oem_reprice'
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.oem_reprice_draft_id IS NULL
     OR NEW.oem_reprice_draft_version IS NULL
     OR NEW.oem_reprice_draft_updated_at IS NULL THEN
    RAISE EXCEPTION 'OEM approval case lacks exact draft binding'
      USING ERRCODE = '40001';
  END IF;
  IF OLD.status NOT IN ('pending', 'escalated')
     AND NEW.status IN (
       'approved', 'approved_with_conditions', 'rejected',
       'changes_requested', 'cancelled'
     ) THEN
    RAISE EXCEPTION 'OEM approval decision is no longer pending'
      USING ERRCODE = '55000';
  END IF;

  -- Approval UPDATE already owns the approval row. Serialize on the same
  -- quote advisory key before taking quote/draft/impact locks. Pending apply
  -- calls refuse before touching the approval row, preventing lock inversion.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(
      'qb_oem_reprice:' || NEW.workspace_id || ':' ||
        NEW.quote_package_id::text,
      0
    )
  ) THEN
    RAISE EXCEPTION 'OEM approval raced another quote mutation; retry the decision'
      USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_quote
  FROM public.quote_packages quote
  WHERE quote.id = NEW.quote_package_id
    AND quote.workspace_id = NEW.workspace_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM approval quote is missing or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_draft
  FROM public.qb_quote_reprice_drafts draft
  WHERE draft.id = NEW.oem_reprice_draft_id
    AND draft.workspace_id = NEW.workspace_id
    AND draft.quote_package_id = NEW.quote_package_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_draft.draft_version IS DISTINCT FROM NEW.oem_reprice_draft_version
     OR v_draft.updated_at IS DISTINCT FROM NEW.oem_reprice_draft_updated_at
     OR v_draft.approval_case_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'OEM approval case points to a stale draft version'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = v_draft.impact_id
    AND impact.workspace_id = NEW.workspace_id
    AND impact.quote_package_id = NEW.quote_package_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM approval impact is missing or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.status = 'approved_with_conditions' THEN
    RAISE EXCEPTION 'OEM repricing requires unconditional manager approval'
      USING ERRCODE = '55000';
  ELSIF NEW.status = 'approved' THEN
    IF NEW.decided_by IS NULL OR NEW.decided_at IS NULL THEN
      RAISE EXCEPTION 'approved OEM case requires decision evidence'
        USING ERRCODE = '55000';
    END IF;
    SELECT p.active_workspace_id, p.role::text
      INTO v_decider_workspace, v_decider_role
    FROM public.profiles p
    WHERE p.id = NEW.decided_by;
    IF NOT FOUND
       OR v_decider_workspace IS DISTINCT FROM NEW.workspace_id
       OR v_decider_role NOT IN ('admin', 'manager', 'owner') THEN
      RAISE EXCEPTION 'OEM approval requires current elevated authority'
        USING ERRCODE = '42501';
    END IF;

    IF v_quote.updated_at IS DISTINCT FROM v_draft.quote_updated_at_snapshot
       OR v_quote.status IN (
         'accepted', 'rejected', 'expired', 'converted_to_deal', 'archived'
       ) THEN
      RAISE EXCEPTION 'quote changed before OEM approval'
      USING ERRCODE = '40001';
    END IF;

    PERFORM 1
    FROM public.quote_package_line_items quote_line
    WHERE quote_line.quote_package_id = v_quote.id
      AND quote_line.workspace_id = NEW.workspace_id
    ORDER BY quote_line.id
    FOR SHARE;
    IF v_quote.deal_id IS NOT NULL THEN
      PERFORM 1
      FROM public.qrm_deals deal
      WHERE deal.id = v_quote.deal_id
        AND deal.workspace_id = NEW.workspace_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OEM approval deal is missing or cross-workspace'
          USING ERRCODE = '40001';
      END IF;
    END IF;
    IF v_impact.customer_company_id IS NOT NULL THEN
      PERFORM 1
      FROM public.qrm_companies company
      WHERE company.id = v_impact.customer_company_id
        AND company.workspace_id = NEW.workspace_id
        AND company.deleted_at IS NULL
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OEM approval customer is inactive or cross-workspace'
          USING ERRCODE = '40001';
      END IF;
    END IF;

    SELECT * INTO v_current_version
    FROM public.quote_package_versions version
    WHERE version.quote_package_id = NEW.quote_package_id
      AND version.workspace_id = NEW.workspace_id
      AND version.superseded_at IS NULL
    ORDER BY version.version_number DESC
    LIMIT 1
    FOR SHARE;
    IF NOT FOUND
       OR v_current_version.id IS DISTINCT FROM NEW.quote_package_version_id
       OR v_current_version.version_number IS DISTINCT FROM NEW.version_number
       OR v_draft.quote_package_version_id IS DISTINCT FROM NEW.quote_package_version_id
       OR v_draft.quote_version_number IS DISTINCT FROM NEW.version_number
       OR v_draft.impact_updated_at_snapshot IS DISTINCT FROM v_impact.updated_at
       OR v_impact.state <> 'approval_pending' THEN
      RAISE EXCEPTION 'quote, impact, or draft changed before OEM approval'
      USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.qb_quote_pricing_epochs(
      workspace_id, quote_package_id
    ) VALUES (NEW.workspace_id, v_quote.id)
    ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;
    SELECT epoch INTO v_current_pricing_epoch
    FROM public.qb_quote_pricing_epochs epoch
    WHERE epoch.workspace_id = NEW.workspace_id
      AND epoch.quote_package_id = v_quote.id
    FOR SHARE;
    IF NOT FOUND
       OR v_draft.quote_pricing_epoch_snapshot IS NULL
       OR v_current_pricing_epoch IS DISTINCT FROM
          v_draft.quote_pricing_epoch_snapshot THEN
      RAISE EXCEPTION 'quote pricing changed before OEM approval'
        USING ERRCODE = '40001';
    END IF;

    IF COALESCE(
      (NEW.reason_summary_json ->> 'below_margin_floor')::boolean,
      false
    ) THEN
      IF NULLIF(btrim(NEW.decision_note), '') IS NULL THEN
        RAISE EXCEPTION 'below-floor OEM approval requires an explicit exception reason'
          USING ERRCODE = '55000';
      END IF;
      NEW.policy_snapshot_json := jsonb_set(
        NEW.policy_snapshot_json,
        '{oem_reprice}',
        COALESCE(
          NEW.policy_snapshot_json -> 'oem_reprice', '{}'::jsonb
        ) || jsonb_build_object(
          'margin_override_authorized', true,
          'margin_override_policy_id', 'OEM-DP9:below_margin_floor',
          'margin_override_approval_case_id', NEW.id,
          'margin_override_decided_by', NEW.decided_by,
          'margin_override_decided_at', NEW.decided_at,
          'margin_override_decision_note', NEW.decision_note
        ),
        true
      );
    ELSE
      NEW.policy_snapshot_json := jsonb_set(
        NEW.policy_snapshot_json,
        '{oem_reprice}',
        (
          COALESCE(
            NEW.policy_snapshot_json -> 'oem_reprice', '{}'::jsonb
          )
          - 'margin_override_policy_id'
          - 'margin_override_approval_case_id'
          - 'margin_override_decided_by'
          - 'margin_override_decided_at'
          - 'margin_override_decision_note'
        ) || jsonb_build_object('margin_override_authorized', false),
        true
      );
    END IF;

    UPDATE public.qb_quote_reprice_impacts
    SET state = 'approved'
    WHERE id = v_impact.id AND state = 'approval_pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'impact state changed before OEM approval'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.qb_quote_reprice_drafts
    SET
      status = 'approved',
      impact_updated_at_snapshot = now(),
      approved_draft_updated_at_snapshot = now()
    WHERE id = v_draft.id AND status = 'approval_pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft state changed before OEM approval'
        USING ERRCODE = '40001';
    END IF;

    -- now() is transaction-stable and matches the draft updated_at trigger.
    NEW.oem_reprice_draft_updated_at := now();
  ELSIF NEW.status IN (
    'rejected', 'changes_requested', 'cancelled', 'superseded', 'expired'
  ) THEN
    UPDATE public.qb_quote_reprice_impacts
    SET state = 'visible'
    WHERE id = v_impact.id
      AND state IN ('approval_pending', 'approved');

    UPDATE public.qb_quote_reprice_drafts
    SET status = CASE
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.status IN ('superseded', 'expired', 'changes_requested') THEN 'stale'
      ELSE 'rejected' END
    WHERE id = v_draft.id
      AND status IN ('approval_pending', 'approved');

    PERFORM public.qb_oem_reprice_recompute_quote_flag(
      NEW.workspace_id, NEW.quote_package_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_qb_oem_reprice_approval_decision
  ON public.quote_approval_cases;
CREATE TRIGGER trg_sync_qb_oem_reprice_approval_decision
  BEFORE UPDATE OF status ON public.quote_approval_cases
  FOR EACH ROW EXECUTE FUNCTION public.sync_qb_oem_reprice_approval_decision();

REVOKE ALL ON FUNCTION public.sync_qb_oem_reprice_approval_decision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_qb_oem_reprice_draft_for_approval(
  p_workspace_id text,
  p_impact_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_submission_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_quote_id uuid;
  v_quote public.quote_packages%ROWTYPE;
  v_impact public.qb_quote_reprice_impacts%ROWTYPE;
  v_event public.qb_price_change_events%ROWTYPE;
  v_deal public.qrm_deals%ROWTYPE;
  v_company public.qrm_companies%ROWTYPE;
  v_current_version public.quote_package_versions%ROWTYPE;
  v_current_pricing_epoch bigint;
  v_actor_workspace text;
  v_actor_db_role text;
  v_current_rep_id uuid;
  v_existing_draft public.qb_quote_reprice_drafts%ROWTYPE;
  v_draft public.qb_quote_reprice_drafts%ROWTYPE;
  v_approval_id uuid := gen_random_uuid();
  v_before_totals jsonb;
  v_projected_totals jsonb;
  v_projected_net_delta_cents bigint;
  v_margin_floor numeric;
  v_below_margin_floor boolean;
  v_old_commission_cents bigint;
  v_projected_commission_cents bigint;
  v_proposed_lines jsonb;
  v_policy_snapshot jsonb;
  v_reason_summary jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_qb_oem_reprice_draft_for_approval requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL
     OR p_impact_id IS NULL OR p_actor_id IS NULL
     OR p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'workspace, impact, actor, and supported role are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.active_workspace_id, p.role::text
    INTO v_actor_workspace, v_actor_db_role
  FROM public.profiles p
  WHERE p.id = p_actor_id;
  IF NOT FOUND
     OR v_actor_workspace IS DISTINCT FROM p_workspace_id
     OR v_actor_db_role IS DISTINCT FROM p_actor_role THEN
    RAISE EXCEPTION 'actor identity, role, or workspace is not current'
      USING ERRCODE = '42501';
  END IF;

  SELECT impact.quote_package_id INTO v_quote_id
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = p_impact_id AND impact.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice impact not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'qb_oem_reprice:' || p_workspace_id || ':' || v_quote_id::text,
      0
    )
  );

  SELECT * INTO v_quote
  FROM public.quote_packages quote
  WHERE quote.id = v_quote_id AND quote.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice quote not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = p_impact_id
    AND impact.workspace_id = p_workspace_id
    AND impact.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice impact moved during draft creation'
      USING ERRCODE = '40001';
  END IF;

  IF v_quote.deal_id IS NOT NULL THEN
    SELECT * INTO v_deal
    FROM public.qrm_deals deal
    WHERE deal.id = v_quote.deal_id AND deal.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote deal is stale or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
    v_current_rep_id := COALESCE(v_deal.assigned_rep_id, v_quote.created_by);
    IF v_deal.company_id IS DISTINCT FROM v_impact.customer_company_id THEN
      RAISE EXCEPTION 'quote customer changed after OEM scan'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    v_current_rep_id := v_quote.created_by;
  END IF;

  IF v_impact.customer_company_id IS NOT NULL THEN
    SELECT * INTO v_company
    FROM public.qrm_companies company
    WHERE company.id = v_impact.customer_company_id
      AND company.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND OR v_company.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'quote customer is inactive or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
    IF v_company.price_lock_active = true
       AND (
         v_company.price_lock_expires_at IS NULL
         OR v_company.price_lock_expires_at >= current_date
       ) THEN
      RAISE EXCEPTION 'customer has an active OEM price lock'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  PERFORM 1
  FROM public.qb_quote_reprice_impact_lines impact_line
  WHERE impact_line.impact_id = v_impact.id
  ORDER BY impact_line.id
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
      AND impact_line.quote_package_line_item_id IS NULL
  ) OR EXISTS (
    SELECT impact_line.quote_package_line_item_id
    FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
    GROUP BY impact_line.quote_package_line_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'OEM impact lacks unique normalized quote-line identities'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.quote_package_line_items quote_line
  WHERE quote_line.quote_package_id = v_quote.id
    AND quote_line.workspace_id = p_workspace_id
  ORDER BY quote_line.id
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM public.qb_quote_reprice_impact_lines impact_line
    LEFT JOIN public.quote_package_line_items quote_line
      ON quote_line.id = impact_line.quote_package_line_item_id
     AND quote_line.quote_package_id = v_quote.id
     AND quote_line.workspace_id = p_workspace_id
    WHERE impact_line.impact_id = v_impact.id
      AND (
        quote_line.id IS NULL
        OR impact_line.quantity IS NULL
        OR impact_line.quantity <= 0
        OR impact_line.old_list_price_cents IS NULL
        OR impact_line.new_list_price_cents IS NULL
        OR impact_line.old_list_price_cents < 0
        OR impact_line.new_list_price_cents < 0
        OR quote_line.quantity IS DISTINCT FROM impact_line.quantity
        OR ROUND(COALESCE(quote_line.quoted_list_price, 0) * 100)::bigint
           IS DISTINCT FROM impact_line.old_list_price_cents
        OR quote_line.source_location IS DISTINCT FROM impact_line.source_location
        OR (quote_line.source_location = 'yard_stock')
           IS DISTINCT FROM impact_line.is_yard_stock
        OR (
          impact_line.suppressed_by_stock_lock = false
          AND impact_line.is_yard_stock = false
          AND quote_line.source_location IS DISTINCT FROM 'yard_stock'
          AND (
            quote_line.equipment_override_price_cents IS NOT NULL
            OR ROUND(COALESCE(quote_line.unit_price, 0) * 100)::bigint
               IS DISTINCT FROM impact_line.old_list_price_cents
            OR ROUND(COALESCE(quote_line.extended_price, 0) * 100)::bigint
               IS DISTINCT FROM
                 impact_line.old_list_price_cents * impact_line.quantity
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'quote line changed before OEM approval submission'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_current_version
  FROM public.quote_package_versions version
  WHERE version.quote_package_id = v_quote.id
    AND version.workspace_id = p_workspace_id
    AND version.superseded_at IS NULL
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save the quote before requesting OEM approval'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.qb_quote_pricing_epochs(
    workspace_id, quote_package_id
  ) VALUES (p_workspace_id, v_quote.id)
  ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;
  SELECT epoch INTO v_current_pricing_epoch
  FROM public.qb_quote_pricing_epochs epoch
  WHERE epoch.workspace_id = p_workspace_id
    AND epoch.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote pricing epoch is unavailable'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_event
  FROM public.qb_price_change_events event
  WHERE event.id = v_impact.event_id AND event.workspace_id = p_workspace_id
  FOR SHARE;
  IF NOT FOUND OR v_event.status <> 'active' THEN
    RAISE EXCEPTION 'OEM source event is no longer active'
      USING ERRCODE = '40001';
  END IF;

  IF p_actor_role = 'rep' AND v_current_rep_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'OEM reprice impact belongs to another rep'
      USING ERRCODE = '42501';
  END IF;
  IF v_impact.assigned_rep_id IS DISTINCT FROM v_current_rep_id THEN
    RAISE EXCEPTION 'quote assignment changed after OEM scan'
      USING ERRCODE = '40001';
  END IF;
  IF v_quote.status IN (
    'accepted', 'rejected', 'expired', 'converted_to_deal', 'archived'
  ) THEN
    RAISE EXCEPTION 'quote has advanced to an irreversible customer state'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_existing_draft
  FROM public.qb_quote_reprice_drafts draft
  WHERE draft.impact_id = v_impact.id
    AND draft.workspace_id = p_workspace_id
    AND draft.status IN ('draft', 'approval_pending', 'approved')
  ORDER BY draft.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'draft_id', v_existing_draft.id,
      'approval_case_id', v_existing_draft.approval_case_id,
      'status', v_existing_draft.status,
      'customer_communication', 'none'
    );
  END IF;

  IF v_impact.state <> 'visible'
     OR v_impact.requires_manager_review <> true
     OR COALESCE(cardinality(v_impact.change_categories), 0) = 0 THEN
    RAISE EXCEPTION 'OEM-DP9 requires a visible categorized manager-review impact'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
      AND impact_line.quote_package_line_item_id IS NOT NULL
      AND impact_line.suppressed_by_stock_lock = false
  ) THEN
    RAISE EXCEPTION 'no unlocked normalized quote lines are available for approval'
      USING ERRCODE = '55000';
  END IF;

  v_before_totals := public.qb_oem_reprice_canonical_totals(v_quote.id);
  IF v_before_totals IS NULL
     OR NOT COALESCE(public.qb_oem_reprice_persisted_totals_match(
       v_quote.id, v_before_totals
     ), false) THEN
    RAISE EXCEPTION 'persisted quote totals do not match canonical line truth'
      USING ERRCODE = '40001';
  END IF;

  v_projected_totals := public.qb_oem_reprice_projected_totals(
    v_quote.id, v_impact.id
  );
  IF v_projected_totals IS NULL THEN
    RAISE EXCEPTION 'canonical OEM projection could not be calculated'
      USING ERRCODE = '40001';
  END IF;
  v_projected_net_delta_cents :=
    (v_projected_totals ->> 'net_total_cents')::bigint -
    (v_before_totals ->> 'net_total_cents')::bigint;

  SELECT threshold.min_margin_pct INTO v_margin_floor
  FROM public.qb_margin_thresholds threshold
  WHERE threshold.workspace_id = p_workspace_id
    AND (threshold.brand_id = v_event.brand_id OR threshold.brand_id IS NULL)
  ORDER BY (threshold.brand_id IS NOT NULL) DESC
  LIMIT 1;
  IF v_margin_floor IS NULL THEN
    RAISE EXCEPTION 'current OEM margin floor is missing'
      USING ERRCODE = '55000';
  END IF;
  v_below_margin_floor :=
    (v_projected_totals ->> 'margin_pct')::numeric < v_margin_floor;
  v_old_commission_cents := ROUND(
    (v_before_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;
  v_projected_commission_cents := ROUND(
    (v_projected_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'impactLineId', impact_line.id,
    'quotePackageLineItemId', impact_line.quote_package_line_item_id,
    'modelCode', impact_line.model_code,
    'oldPriceCents', impact_line.old_list_price_cents,
    'newPriceCents', impact_line.new_list_price_cents,
    'quantity', impact_line.quantity,
    'sourceLocation', impact_line.source_location,
    'isYardStock', impact_line.is_yard_stock,
    'suppressedByStockLock', impact_line.suppressed_by_stock_lock
  ) ORDER BY impact_line.id), '[]'::jsonb)
    INTO v_proposed_lines
  FROM public.qb_quote_reprice_impact_lines impact_line
  WHERE impact_line.impact_id = v_impact.id;

  INSERT INTO public.qb_quote_reprice_drafts (
    impact_id, quote_package_id, workspace_id, created_by, status,
    proposed_patch, before_snapshot, projected_totals,
    quote_package_version_id, quote_version_number,
    quote_pricing_epoch_snapshot, quote_updated_at_snapshot,
    impact_updated_at_snapshot
  ) VALUES (
    v_impact.id, v_quote.id, p_workspace_id, p_actor_id, 'approval_pending',
    jsonb_build_object(
      'eventId', v_impact.event_id,
      'lines', v_proposed_lines,
      'totals', jsonb_build_object(
        'projectedDeltaCents', v_projected_net_delta_cents,
        'sourceLineDeltaCents', v_impact.total_delta_cents,
        'oldMarginPct', (v_before_totals ->> 'margin_pct')::numeric,
        'projectedMarginPct', (v_projected_totals ->> 'margin_pct')::numeric,
        'oldCommissionCents', v_old_commission_cents,
        'projectedCommissionCents', v_projected_commission_cents
      )
    ),
    jsonb_build_object(
      'quote_updated_at_snapshot', v_quote.updated_at,
      'quote_status', v_quote.status,
      'quote_version_id', v_current_version.id,
      'quote_version_number', v_current_version.version_number,
      'canonical_totals', v_before_totals
    ),
    v_projected_totals,
    v_current_version.id, v_current_version.version_number,
    v_current_pricing_epoch, v_quote.updated_at, v_impact.updated_at
  ) RETURNING * INTO v_draft;

  v_policy_snapshot := jsonb_build_object(
    'approval_kind', 'oem_reprice',
    'oem_reprice', jsonb_build_object(
      'manager_review_required', true,
      'auto_send_customer', false,
      'change_categories', to_jsonb(v_impact.change_categories),
      'source_event_id', v_impact.event_id,
      'price_sheet_id', v_event.price_sheet_id,
      'margin_override_authorized', false,
      'economics', jsonb_build_object(
        'current_net_total_cents', (v_before_totals ->> 'net_total_cents')::bigint,
        'projected_net_total_cents', (v_projected_totals ->> 'net_total_cents')::bigint,
        'total_delta_cents', v_projected_net_delta_cents,
        'source_line_delta_cents', v_impact.total_delta_cents,
        'old_margin_pct', (v_before_totals ->> 'margin_pct')::numeric,
        'projected_margin_pct', (v_projected_totals ->> 'margin_pct')::numeric,
        'margin_floor_pct', v_margin_floor,
        'below_margin_floor', v_below_margin_floor,
        'old_commission_cents', v_old_commission_cents,
        'projected_commission_cents', v_projected_commission_cents,
        'commission_delta_cents',
          v_projected_commission_cents - v_old_commission_cents
      )
    )
  );
  v_reason_summary := jsonb_build_object(
    'approval_kind', 'oem_reprice',
    'reasons', to_jsonb(v_impact.approval_required_reasons),
    'change_categories', to_jsonb(v_impact.change_categories),
    'current_net_total_cents', (v_before_totals ->> 'net_total_cents')::bigint,
    'projected_net_total_cents', (v_projected_totals ->> 'net_total_cents')::bigint,
    'total_delta_cents', v_projected_net_delta_cents,
    'source_line_delta_cents', v_impact.total_delta_cents,
    'old_margin_pct', (v_before_totals ->> 'margin_pct')::numeric,
    'projected_margin_pct', (v_projected_totals ->> 'margin_pct')::numeric,
    'margin_floor_pct', v_margin_floor,
    'below_margin_floor', v_below_margin_floor,
    'old_commission_cents', v_old_commission_cents,
    'projected_commission_cents', v_projected_commission_cents,
    'commission_delta_cents',
      v_projected_commission_cents - v_old_commission_cents,
    'approval_required_reasons', to_jsonb(v_impact.approval_required_reasons),
    'customer_communication', 'none',
    'lines', v_proposed_lines
  );

  INSERT INTO public.quote_approval_cases (
    id, workspace_id, quote_package_id, quote_package_version_id,
    version_number, deal_id, net_total, margin_pct, submitted_by,
    assigned_role, route_mode, policy_snapshot_json, reason_summary_json,
    status, submission_note, oem_reprice_draft_id,
    oem_reprice_draft_version, oem_reprice_draft_updated_at,
    created_at, updated_at
  ) VALUES (
    v_approval_id, p_workspace_id, v_quote.id, v_current_version.id,
    v_current_version.version_number, v_quote.deal_id,
    (v_projected_totals ->> 'net_total_cents')::numeric / 100,
    (v_projected_totals ->> 'margin_pct')::numeric,
    p_actor_id, 'manager', 'manager_queue',
    v_policy_snapshot, v_reason_summary, 'pending',
    NULLIF(btrim(p_submission_note), ''), v_draft.id,
    v_draft.draft_version, v_now, v_now, v_now
  );

  UPDATE public.qb_quote_reprice_drafts
  SET
    approval_case_id = v_approval_id,
    quote_updated_at_snapshot = v_quote.updated_at,
    impact_updated_at_snapshot = v_now
  WHERE id = v_draft.id AND status = 'approval_pending';

  UPDATE public.qb_quote_reprice_impacts
  SET state = 'approval_pending'
  WHERE id = v_impact.id AND state = 'visible';

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'draft_id', v_draft.id,
    'approval_case_id', v_approval_id,
    'quote_package_version_id', v_current_version.id,
    'version_number', v_current_version.version_number,
    'status', 'approval_pending',
    'approval_required', true,
    'approval_kind', 'oem_reprice',
    'change_categories', to_jsonb(v_impact.change_categories),
    'customer_communication', 'none'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_qb_oem_reprice_draft_for_approval(
  text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_qb_oem_reprice_draft_for_approval(
  text, uuid, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_qb_oem_reprice_draft(
  p_workspace_id text,
  p_draft_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_quote_id uuid;
  v_quote public.quote_packages%ROWTYPE;
  v_draft public.qb_quote_reprice_drafts%ROWTYPE;
  v_impact public.qb_quote_reprice_impacts%ROWTYPE;
  v_approval public.quote_approval_cases%ROWTYPE;
  v_event public.qb_price_change_events%ROWTYPE;
  v_deal public.qrm_deals%ROWTYPE;
  v_company public.qrm_companies%ROWTYPE;
  v_current_version public.quote_package_versions%ROWTYPE;
  v_current_pricing_epoch bigint;
  v_actor_workspace text;
  v_actor_db_role text;
  v_decider_workspace text;
  v_decider_role text;
  v_current_rep_id uuid;
  v_idempotency_key text;
  v_existing_audit public.qb_quote_reprice_audits%ROWTYPE;
  v_before_totals jsonb;
  v_after_totals jsonb;
  v_line_changes jsonb := '[]'::jsonb;
  v_impact_line public.qb_quote_reprice_impact_lines%ROWTYPE;
  v_quote_line public.quote_package_line_items%ROWTYPE;
  v_current_yard boolean;
  v_before_unit_cents bigint;
  v_before_extended_cents bigint;
  v_after_unit_cents bigint;
  v_eligible_count integer := 0;
  v_affected integer;
  v_margin_floor numeric;
  v_below_floor boolean;
  v_margin_override jsonb;
  v_before_commission bigint;
  v_after_commission bigint;
  v_commission_projection jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_next_version_id uuid := gen_random_uuid();
  v_next_version_number integer;
  v_version_lines jsonb;
  v_version_snapshot jsonb;
  v_payload jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'apply_qb_oem_reprice_draft requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL
     OR p_draft_id IS NULL OR p_actor_id IS NULL
     OR p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'workspace, draft, actor, and supported role are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.active_workspace_id, p.role::text
    INTO v_actor_workspace, v_actor_db_role
  FROM public.profiles p
  WHERE p.id = p_actor_id;
  IF NOT FOUND
     OR v_actor_workspace IS DISTINCT FROM p_workspace_id
     OR v_actor_db_role IS DISTINCT FROM p_actor_role THEN
    RAISE EXCEPTION 'actor identity, role, or workspace is not current'
      USING ERRCODE = '42501';
  END IF;

  -- Read immutable routing identity before the advisory lock. The row is
  -- re-read FOR UPDATE after the quote lock, so this read is never trusted.
  SELECT draft.quote_package_id INTO v_quote_id
  FROM public.qb_quote_reprice_drafts draft
  WHERE draft.id = p_draft_id AND draft.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice draft not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'qb_oem_reprice:' || p_workspace_id || ':' || v_quote_id::text,
      0
    )
  );

  -- Stable lock order for every apply/reversal caller:
  -- quote -> draft -> impact -> approval -> deal -> company -> impact lines
  -- -> quote lines -> active quote version -> source event.
  SELECT * INTO v_quote
  FROM public.quote_packages quote
  WHERE quote.id = v_quote_id AND quote.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice quote not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_draft
  FROM public.qb_quote_reprice_drafts draft
  WHERE draft.id = p_draft_id AND draft.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR v_draft.quote_package_id IS DISTINCT FROM v_quote.id THEN
    RAISE EXCEPTION 'OEM reprice draft moved during apply'
      USING ERRCODE = '40001';
  END IF;
  -- An approval UPDATE already owns the approval row before its sync trigger
  -- can promote the draft. Refuse pending drafts here, before touching the
  -- approval row, so concurrent decision/apply cannot invert lock order.
  IF v_draft.status IN (
    'draft', 'approval_pending', 'rejected', 'stale', 'cancelled'
  ) THEN
    RAISE EXCEPTION 'only an approved current OEM reprice draft may apply'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = v_draft.impact_id
    AND impact.workspace_id = p_workspace_id
    AND impact.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice impact is stale or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_approval
  FROM public.quote_approval_cases approval
  WHERE approval.id = v_draft.approval_case_id
    AND approval.workspace_id = p_workspace_id
    AND approval.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current OEM reprice approval case is missing'
      USING ERRCODE = '55000';
  END IF;

  IF v_quote.deal_id IS NOT NULL THEN
    SELECT * INTO v_deal
    FROM public.qrm_deals deal
    WHERE deal.id = v_quote.deal_id AND deal.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote deal is stale or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
    v_current_rep_id := COALESCE(v_deal.assigned_rep_id, v_quote.created_by);
    IF v_deal.company_id IS DISTINCT FROM v_impact.customer_company_id THEN
      RAISE EXCEPTION 'quote customer changed after the OEM impact snapshot'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    v_current_rep_id := v_quote.created_by;
    IF v_impact.customer_company_id IS NOT NULL THEN
      RAISE EXCEPTION 'OEM impact customer is no longer linked to the quote'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_impact.customer_company_id IS NOT NULL THEN
    SELECT * INTO v_company
    FROM public.qrm_companies company
    WHERE company.id = v_impact.customer_company_id
      AND company.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND OR v_company.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'quote customer is inactive or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  PERFORM 1
  FROM public.qb_quote_reprice_impact_lines impact_line
  WHERE impact_line.impact_id = v_impact.id
  ORDER BY impact_line.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
      AND impact_line.quote_package_line_item_id IS NULL
  ) OR EXISTS (
    SELECT impact_line.quote_package_line_item_id
    FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
    GROUP BY impact_line.quote_package_line_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'approved impact lacks unique normalized quote-line identities'
      USING ERRCODE = '40001';
  END IF;

  PERFORM 1
  FROM public.quote_package_line_items quote_line
  WHERE quote_line.quote_package_id = v_quote.id
    AND quote_line.workspace_id = p_workspace_id
  ORDER BY quote_line.id
  FOR UPDATE;

  SELECT * INTO v_current_version
  FROM public.quote_package_versions version
  WHERE version.quote_package_id = v_quote.id
    AND version.workspace_id = p_workspace_id
    AND version.superseded_at IS NULL
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current quote version is missing' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.qb_quote_pricing_epochs(
    workspace_id, quote_package_id
  ) VALUES (p_workspace_id, v_quote.id)
  ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;
  SELECT epoch INTO v_current_pricing_epoch
  FROM public.qb_quote_pricing_epochs epoch
  WHERE epoch.workspace_id = p_workspace_id
    AND epoch.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote pricing epoch is unavailable during OEM apply'
      USING ERRCODE = '40001';
  END IF;
  IF v_draft.status = 'approved' AND (
    v_draft.quote_pricing_epoch_snapshot IS NULL
    OR v_current_pricing_epoch IS DISTINCT FROM
       v_draft.quote_pricing_epoch_snapshot
  ) THEN
    RAISE EXCEPTION 'quote pricing changed after OEM approval submission'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_event
  FROM public.qb_price_change_events event
  WHERE event.id = v_impact.event_id AND event.workspace_id = p_workspace_id
  FOR SHARE;
  IF NOT FOUND OR v_event.status <> 'active' THEN
    RAISE EXCEPTION 'OEM source event is no longer active'
      USING ERRCODE = '40001';
  END IF;

  IF v_impact.assigned_rep_id IS DISTINCT FROM v_current_rep_id THEN
    RAISE EXCEPTION 'quote assignment changed after the OEM impact snapshot'
      USING ERRCODE = '40001';
  END IF;
  IF p_actor_role = 'rep' AND (
    v_current_rep_id IS DISTINCT FROM p_actor_id
    OR v_draft.created_by IS DISTINCT FROM p_actor_id
  ) THEN
    RAISE EXCEPTION 'OEM reprice draft belongs to another rep'
      USING ERRCODE = '42501';
  END IF;

  v_idempotency_key :=
    'oem-reprice:apply:' || p_workspace_id || ':' || v_draft.id::text;
  SELECT * INTO v_existing_audit
  FROM public.qb_quote_reprice_audits audit
  WHERE audit.workspace_id = p_workspace_id
    AND audit.idempotency_key = v_idempotency_key
    AND audit.action = 'apply';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'action', 'apply',
      'audit_id', v_existing_audit.id,
      'quote_package_id', v_existing_audit.quote_package_id,
      'after_quote_version_id', v_existing_audit.after_quote_version_id,
      'customer_communication', 'none'
    );
  END IF;

  IF v_draft.status <> 'approved' OR v_impact.state <> 'approved' THEN
    RAISE EXCEPTION 'only an approved current OEM reprice draft may apply'
      USING ERRCODE = '55000';
  END IF;
  IF v_quote.status IN (
    'accepted', 'rejected', 'expired', 'converted_to_deal', 'archived'
  ) THEN
    RAISE EXCEPTION 'quote has advanced to an irreversible customer state'
      USING ERRCODE = '55000';
  END IF;
  IF v_approval.status <> 'approved'
     OR v_approval.decided_by IS NULL
     OR v_approval.decided_at IS NULL THEN
    RAISE EXCEPTION 'OEM reprice approval is not an unconditional decision'
      USING ERRCODE = '55000';
  END IF;

  SELECT p.active_workspace_id, p.role::text
    INTO v_decider_workspace, v_decider_role
  FROM public.profiles p
  WHERE p.id = v_approval.decided_by;
  IF NOT FOUND
     OR v_decider_workspace IS DISTINCT FROM p_workspace_id
     OR v_decider_role NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'OEM reprice approval lacks current elevated authority'
      USING ERRCODE = '42501';
  END IF;

  IF v_approval.oem_reprice_draft_id IS DISTINCT FROM v_draft.id
     OR v_approval.oem_reprice_draft_version IS DISTINCT FROM v_draft.draft_version
     OR v_approval.oem_reprice_draft_updated_at IS DISTINCT FROM v_draft.updated_at
     OR v_draft.approved_draft_updated_at_snapshot IS DISTINCT FROM v_draft.updated_at
     OR v_approval.quote_package_version_id IS DISTINCT FROM v_current_version.id
     OR v_approval.version_number IS DISTINCT FROM v_current_version.version_number
     OR v_draft.quote_package_version_id IS DISTINCT FROM v_current_version.id
     OR v_draft.quote_version_number IS DISTINCT FROM v_current_version.version_number
     OR v_draft.quote_updated_at_snapshot IS DISTINCT FROM v_quote.updated_at
     OR v_draft.impact_updated_at_snapshot IS DISTINCT FROM v_impact.updated_at THEN
    RAISE EXCEPTION 'OEM reprice draft, approval, quote, or impact version is stale'
      USING ERRCODE = '40001';
  END IF;

  IF v_approval.policy_snapshot_json #>> '{oem_reprice,manager_review_required}' IS DISTINCT FROM 'true'
     OR v_approval.policy_snapshot_json #>> '{oem_reprice,auto_send_customer}' IS DISTINCT FROM 'false'
     OR COALESCE(cardinality(v_impact.change_categories), 0) = 0 THEN
    RAISE EXCEPTION 'OEM-DP9/DP2 approval policy snapshot is missing'
      USING ERRCODE = '55000';
  END IF;

  IF v_company.id IS NOT NULL
     AND v_company.price_lock_active = true
     AND (
       v_company.price_lock_expires_at IS NULL
       OR v_company.price_lock_expires_at >= current_date
     ) THEN
    RAISE EXCEPTION 'customer has an active OEM price lock'
      USING ERRCODE = '55000',
            DETAIL = COALESCE(v_company.price_lock_reason, 'price lock active');
  END IF;

  v_before_totals := public.qb_oem_reprice_canonical_totals(v_quote.id);
  IF v_before_totals IS NULL
     OR NOT COALESCE(public.qb_oem_reprice_persisted_totals_match(
       v_quote.id, v_before_totals
     ), false) THEN
    RAISE EXCEPTION 'persisted quote totals do not match canonical line truth'
      USING ERRCODE = '40001';
  END IF;

  FOR v_impact_line IN
    SELECT *
    FROM public.qb_quote_reprice_impact_lines impact_line
    WHERE impact_line.impact_id = v_impact.id
    ORDER BY impact_line.id
  LOOP
    SELECT * INTO v_quote_line
    FROM public.quote_package_line_items quote_line
    WHERE quote_line.id = v_impact_line.quote_package_line_item_id
      AND quote_line.quote_package_id = v_quote.id
      AND quote_line.workspace_id = p_workspace_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'approved quote line disappeared during apply'
        USING ERRCODE = '40001';
    END IF;
    IF v_impact_line.old_list_price_cents IS NULL
       OR v_impact_line.new_list_price_cents IS NULL
       OR v_impact_line.old_list_price_cents < 0
       OR v_impact_line.new_list_price_cents < 0
       OR v_quote_line.quantity IS DISTINCT FROM v_impact_line.quantity
       OR ROUND(COALESCE(v_quote_line.quoted_list_price, 0) * 100)::bigint
          IS DISTINCT FROM v_impact_line.old_list_price_cents
       OR v_quote_line.source_location IS DISTINCT FROM v_impact_line.source_location THEN
      RAISE EXCEPTION 'quote line changed after approved OEM snapshot'
        USING ERRCODE = '40001';
    END IF;

    v_current_yard :=
      v_quote_line.source_location = 'yard_stock'
      OR v_impact_line.is_yard_stock = true;
    IF v_current_yard IS DISTINCT FROM v_impact_line.is_yard_stock THEN
      RAISE EXCEPTION 'quote line inventory source changed after OEM snapshot'
        USING ERRCODE = '40001';
    END IF;

    v_before_unit_cents :=
      ROUND(COALESCE(v_quote_line.unit_price, 0) * 100)::bigint;
    v_before_extended_cents :=
      ROUND(COALESCE(v_quote_line.extended_price, 0) * 100)::bigint;

    IF v_current_yard OR v_impact_line.suppressed_by_stock_lock THEN
      v_line_changes := v_line_changes || jsonb_build_array(jsonb_build_object(
        'impact_line_id', v_impact_line.id,
        'quote_line_id', v_quote_line.id,
        'decision', 'preserved',
        'preservation_reason', CASE WHEN v_current_yard
          THEN 'yard_stock_price_locked' ELSE 'draft_stock_lock' END,
        'quantity', v_quote_line.quantity,
        'source_location', v_quote_line.source_location,
        'is_yard_stock', v_current_yard,
        'before_quoted_list_price_cents', v_impact_line.old_list_price_cents,
        'after_quoted_list_price_cents', v_impact_line.old_list_price_cents,
        'before_unit_price_cents', v_before_unit_cents,
        'after_unit_price_cents', v_before_unit_cents,
        'before_extended_price_cents', v_before_extended_cents,
        'after_extended_price_cents', v_before_extended_cents
      ));
      CONTINUE;
    END IF;

    IF v_quote_line.equipment_override_price_cents IS NOT NULL
       OR v_before_unit_cents IS DISTINCT FROM v_impact_line.old_list_price_cents
       OR v_before_extended_cents IS DISTINCT FROM
          v_impact_line.old_list_price_cents * v_impact_line.quantity THEN
      RAISE EXCEPTION 'explicit or noncanonical line price requires a fresh approved draft'
        USING ERRCODE = '40001';
    END IF;

    v_after_unit_cents := v_impact_line.new_list_price_cents;
    UPDATE public.quote_package_line_items quote_line
    SET
      quoted_list_price = v_after_unit_cents::numeric / 100,
      unit_price = v_after_unit_cents::numeric / 100,
      extended_price =
        (v_after_unit_cents * v_impact_line.quantity)::numeric / 100
    WHERE quote_line.id = v_quote_line.id
      AND quote_line.quote_package_id = v_quote.id
      AND quote_line.workspace_id = p_workspace_id
      AND ROUND(COALESCE(quote_line.quoted_list_price, 0) * 100)::bigint =
          v_impact_line.old_list_price_cents
      AND ROUND(COALESCE(quote_line.unit_price, 0) * 100)::bigint =
          v_before_unit_cents
      AND ROUND(COALESCE(quote_line.extended_price, 0) * 100)::bigint =
          v_before_extended_cents
      AND quote_line.quantity = v_impact_line.quantity
      AND quote_line.source_location IS NOT DISTINCT FROM
          v_impact_line.source_location;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      RAISE EXCEPTION 'quote line compare-and-swap failed during OEM apply'
        USING ERRCODE = '40001';
    END IF;

    v_eligible_count := v_eligible_count + 1;
    v_line_changes := v_line_changes || jsonb_build_array(jsonb_build_object(
      'impact_line_id', v_impact_line.id,
      'quote_line_id', v_quote_line.id,
      'decision', 'applied',
      'preservation_reason', NULL,
      'quantity', v_quote_line.quantity,
      'source_location', v_quote_line.source_location,
      'is_yard_stock', false,
      'before_quoted_list_price_cents', v_impact_line.old_list_price_cents,
      'after_quoted_list_price_cents', v_impact_line.new_list_price_cents,
      'before_unit_price_cents', v_before_unit_cents,
      'after_unit_price_cents', v_after_unit_cents,
      'before_extended_price_cents', v_before_extended_cents,
      'after_extended_price_cents',
        v_after_unit_cents * v_impact_line.quantity
    ));
  END LOOP;

  IF v_eligible_count = 0 THEN
    RAISE EXCEPTION 'no approved unlocked quote lines remain eligible to apply'
      USING ERRCODE = '55000';
  END IF;

  v_after_totals := public.qb_oem_reprice_canonical_totals(v_quote.id);
  IF v_after_totals IS NULL
     OR v_after_totals IS DISTINCT FROM v_draft.projected_totals THEN
    RAISE EXCEPTION 'applied OEM totals differ from the manager-approved canonical projection'
      USING ERRCODE = '40001';
  END IF;
  SELECT threshold.min_margin_pct INTO v_margin_floor
  FROM public.qb_margin_thresholds threshold
  WHERE threshold.workspace_id = p_workspace_id
    AND (threshold.brand_id = v_event.brand_id OR threshold.brand_id IS NULL)
  ORDER BY (threshold.brand_id IS NOT NULL) DESC
  LIMIT 1;
  IF v_margin_floor IS NULL THEN
    RAISE EXCEPTION 'current OEM margin floor is missing'
      USING ERRCODE = '55000';
  END IF;

  v_below_floor :=
    (v_after_totals ->> 'margin_pct')::numeric < v_margin_floor;
  IF v_below_floor AND (
    v_approval.policy_snapshot_json #>>
      '{oem_reprice,margin_override_authorized}' IS DISTINCT FROM 'true'
    OR NULLIF(btrim(v_approval.decision_note), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'below-floor OEM reprice lacks authorized override evidence'
      USING ERRCODE = '55000';
  END IF;

  v_margin_override := CASE WHEN v_below_floor THEN jsonb_build_object(
    'authorized', true,
    'policy_id', v_approval.policy_snapshot_json #>>
      '{oem_reprice,margin_override_policy_id}',
    'approval_case_id', v_approval.id,
    'decided_by', v_approval.decided_by,
    'decided_at', v_approval.decided_at,
    'reason', v_approval.decision_note,
    'margin_floor_pct', v_margin_floor,
    'projected_margin_pct', (v_after_totals ->> 'margin_pct')::numeric
  ) ELSE NULL END;

  v_before_commission := ROUND(
    (v_before_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;
  v_after_commission := ROUND(
    (v_after_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;
  v_commission_projection := jsonb_build_object(
    'policy', 'OEM-DP10',
    'rate_of_gross_margin', 0.15,
    'gross_margin_before_cents',
      (v_before_totals ->> 'margin_amount_cents')::bigint,
    'gross_margin_after_cents',
      (v_after_totals ->> 'margin_amount_cents')::bigint,
    'commission_before_cents', v_before_commission,
    'commission_after_cents', v_after_commission,
    'commission_delta_cents', v_after_commission - v_before_commission,
    'split_allocation', NULL
  );

  -- State transitions precede shared-flag recomputation so this impact is no
  -- longer counted. A different active OEM event or non-OEM owner is preserved.
  UPDATE public.qb_quote_reprice_drafts
  SET status = 'applied', applied_at = v_now
  WHERE id = v_draft.id AND status = 'approved';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'draft state changed during OEM apply'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.qb_quote_reprice_impacts
  SET state = 'applied'
  WHERE id = v_impact.id AND state = 'approved';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'impact state changed during OEM apply'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.quote_packages quote
  SET
    equipment_total = (v_after_totals ->> 'equipment_total_cents')::numeric / 100,
    attachment_total = (v_after_totals ->> 'attachment_total_cents')::numeric / 100,
    subtotal = (v_after_totals ->> 'subtotal_cents')::numeric / 100,
    discount_total = (v_after_totals ->> 'discount_total_cents')::numeric / 100,
    net_total = (v_after_totals ->> 'net_total_cents')::numeric / 100,
    amount_financed = (v_after_totals ->> 'amount_financed_cents')::numeric / 100,
    margin_amount = (v_after_totals ->> 'margin_amount_cents')::numeric / 100,
    margin_pct = (v_after_totals ->> 'margin_pct')::numeric
  WHERE quote.id = v_quote.id
    AND quote.workspace_id = p_workspace_id
    AND quote.updated_at = v_draft.quote_updated_at_snapshot;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'quote compare-and-swap failed during OEM apply'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.qb_oem_reprice_recompute_quote_flag(
    p_workspace_id, v_quote.id
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', line.id,
    'line_type', line.line_type,
    'quantity', line.quantity,
    'quoted_list_price', line.quoted_list_price,
    'unit_price', line.unit_price,
    'extended_price', line.extended_price,
    'quoted_dealer_cost', line.quoted_dealer_cost,
    'cost_visibility', line.cost_visibility,
    'source_location', line.source_location
  ) ORDER BY line.display_order, line.id), '[]'::jsonb)
    INTO v_version_lines
  FROM public.quote_package_line_items line
  WHERE line.quote_package_id = v_quote.id;

  v_next_version_number := v_current_version.version_number + 1;
  UPDATE public.quote_package_versions
  SET superseded_at = v_now
  WHERE id = v_current_version.id AND superseded_at IS NULL;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'current quote version changed during OEM apply'
      USING ERRCODE = '40001';
  END IF;

  v_version_snapshot := jsonb_build_object(
    'source', 'oem_reprice_apply',
    'audit_id', v_audit_id,
    'quote_package_id', v_quote.id,
    'quote_status', v_quote.status,
    'saved_at', v_now,
    'line_items', v_version_lines,
    'totals', v_after_totals
  );
  INSERT INTO public.quote_package_versions (
    id, workspace_id, quote_package_id, version_number, snapshot_json,
    computed_metrics_json, created_by, created_at
  ) VALUES (
    v_next_version_id, p_workspace_id, v_quote.id, v_next_version_number,
    v_version_snapshot,
    v_after_totals || jsonb_build_object(
      'source', 'oem_reprice_apply', 'audit_id', v_audit_id
    ),
    p_actor_id, v_now
  );

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'action', 'apply',
    'idempotency_key', v_idempotency_key,
    'workspace_id', p_workspace_id,
    'quote_package_id', v_quote.id,
    'actor', jsonb_build_object('id', p_actor_id, 'role', p_actor_role),
    'approval', jsonb_build_object(
      'case_id', v_approval.id,
      'status', v_approval.status,
      'decided_by', v_approval.decided_by,
      'decided_by_role', v_decider_role,
      'decided_at', v_approval.decided_at,
      'quote_version_id', v_approval.quote_package_version_id,
      'quote_version_number', v_approval.version_number,
      'draft_version', v_approval.oem_reprice_draft_version,
      'margin_override', v_margin_override
    ),
    'source', jsonb_build_object(
      'event_id', v_event.id,
      'price_sheet_id', v_event.price_sheet_id,
      'prior_price_sheet_id', v_event.prior_price_sheet_id,
      'impact_id', v_impact.id,
      'draft_id', v_draft.id,
      'change_categories', v_impact.change_categories
    ),
    'occurred_at', v_now,
    'before', jsonb_build_object(
      'quote_version_id', v_current_version.id,
      'version_number', v_current_version.version_number,
      'quote_updated_at', v_quote.updated_at,
      'quote_status', v_quote.status,
      'totals', v_before_totals
    ),
    'after', jsonb_build_object(
      'quote_version_id', v_next_version_id,
      'version_number', v_next_version_number,
      'quote_updated_at', v_now,
      'quote_status', v_quote.status,
      'totals', v_after_totals
    ),
    'lines', v_line_changes,
    'commission_projection', v_commission_projection,
    'side_effects', jsonb_build_object(
      'customer_communication', 'none', 'email_draft_id', NULL
    )
  );

  INSERT INTO public.qb_quote_reprice_audits (
    id, workspace_id, quote_package_id, draft_id, impact_id, action,
    idempotency_key, actor_id, actor_role, approval_case_id,
    source_event_id, price_sheet_id, prior_price_sheet_id,
    before_quote_version_id, after_quote_version_id,
    before_version_number, after_version_number,
    before_quote_status, after_quote_status,
    before_totals, after_totals, line_changes, commission_projection,
    margin_override, customer_communication_sent, payload, created_at
  ) VALUES (
    v_audit_id, p_workspace_id, v_quote.id, v_draft.id, v_impact.id, 'apply',
    v_idempotency_key, p_actor_id, p_actor_role, v_approval.id,
    v_event.id, v_event.price_sheet_id, v_event.prior_price_sheet_id,
    v_current_version.id, v_next_version_id,
    v_current_version.version_number, v_next_version_number,
    v_quote.status, v_quote.status,
    v_before_totals, v_after_totals, v_line_changes, v_commission_projection,
    v_margin_override, false, v_payload, v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'action', 'apply',
    'audit_id', v_audit_id,
    'quote_package_id', v_quote.id,
    'after_quote_version_id', v_next_version_id,
    'after_version_number', v_next_version_number,
    'applied_line_count', v_eligible_count,
    'totals', v_after_totals,
    'commission_projection', v_commission_projection,
    'customer_communication', 'none'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_qb_oem_reprice_draft(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_qb_oem_reprice_draft(
  text, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.reverse_qb_oem_reprice_apply(
  p_workspace_id text,
  p_apply_audit_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_apply public.qb_quote_reprice_audits%ROWTYPE;
  v_quote public.quote_packages%ROWTYPE;
  v_draft public.qb_quote_reprice_drafts%ROWTYPE;
  v_impact public.qb_quote_reprice_impacts%ROWTYPE;
  v_approval public.quote_approval_cases%ROWTYPE;
  v_event public.qb_price_change_events%ROWTYPE;
  v_deal public.qrm_deals%ROWTYPE;
  v_company public.qrm_companies%ROWTYPE;
  v_current_version public.quote_package_versions%ROWTYPE;
  v_actor_workspace text;
  v_actor_db_role text;
  v_current_rep_id uuid;
  v_idempotency_key text;
  v_existing_audit public.qb_quote_reprice_audits%ROWTYPE;
  v_current_totals jsonb;
  v_restored_totals jsonb;
  v_line_changes jsonb := '[]'::jsonb;
  v_apply_line jsonb;
  v_quote_line public.quote_package_line_items%ROWTYPE;
  v_affected integer;
  v_reversed_count integer := 0;
  v_before_commission bigint;
  v_after_commission bigint;
  v_commission_projection jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_next_version_id uuid := gen_random_uuid();
  v_next_version_number integer;
  v_version_lines jsonb;
  v_version_snapshot jsonb;
  v_payload jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'reverse_qb_oem_reprice_apply requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL
     OR p_apply_audit_id IS NULL OR p_actor_id IS NULL
     OR p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'workspace, apply audit, actor, and supported role are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.active_workspace_id, p.role::text
    INTO v_actor_workspace, v_actor_db_role
  FROM public.profiles p
  WHERE p.id = p_actor_id;
  IF NOT FOUND
     OR v_actor_workspace IS DISTINCT FROM p_workspace_id
     OR v_actor_db_role IS DISTINCT FROM p_actor_role THEN
    RAISE EXCEPTION 'actor identity, role, or workspace is not current'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_apply
  FROM public.qb_quote_reprice_audits audit
  WHERE audit.id = p_apply_audit_id
    AND audit.workspace_id = p_workspace_id
    AND audit.action = 'apply';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM apply audit not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'qb_oem_reprice:' || p_workspace_id || ':' ||
        v_apply.quote_package_id::text,
      0
    )
  );

  -- Same stable lock order as apply.
  SELECT * INTO v_quote
  FROM public.quote_packages quote
  WHERE quote.id = v_apply.quote_package_id
    AND quote.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM reprice quote not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_draft
  FROM public.qb_quote_reprice_drafts draft
  WHERE draft.id = v_apply.draft_id
    AND draft.workspace_id = p_workspace_id
    AND draft.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'applied OEM draft is missing or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = v_apply.impact_id
    AND impact.workspace_id = p_workspace_id
    AND impact.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'applied OEM impact is missing or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_approval
  FROM public.quote_approval_cases approval
  WHERE approval.id = v_apply.approval_case_id
    AND approval.workspace_id = p_workspace_id
    AND approval.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'applied OEM approval evidence is missing'
      USING ERRCODE = '40001';
  END IF;

  IF v_quote.deal_id IS NOT NULL THEN
    SELECT * INTO v_deal
    FROM public.qrm_deals deal
    WHERE deal.id = v_quote.deal_id AND deal.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote deal is stale or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
    v_current_rep_id := COALESCE(v_deal.assigned_rep_id, v_quote.created_by);
    IF v_deal.company_id IS DISTINCT FROM v_impact.customer_company_id THEN
      RAISE EXCEPTION 'quote customer changed after OEM apply'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    v_current_rep_id := v_quote.created_by;
    IF v_impact.customer_company_id IS NOT NULL THEN
      RAISE EXCEPTION 'OEM impact customer is no longer linked to the quote'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_impact.customer_company_id IS NOT NULL THEN
    SELECT * INTO v_company
    FROM public.qrm_companies company
    WHERE company.id = v_impact.customer_company_id
      AND company.workspace_id = p_workspace_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'quote customer is cross-workspace during reversal'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  PERFORM 1
  FROM public.qb_quote_reprice_impact_lines impact_line
  WHERE impact_line.impact_id = v_impact.id
  ORDER BY impact_line.id
  FOR UPDATE;

  PERFORM 1
  FROM public.quote_package_line_items quote_line
  WHERE quote_line.quote_package_id = v_quote.id
    AND quote_line.workspace_id = p_workspace_id
  ORDER BY quote_line.id
  FOR UPDATE;

  SELECT * INTO v_current_version
  FROM public.quote_package_versions version
  WHERE version.quote_package_id = v_quote.id
    AND version.workspace_id = p_workspace_id
    AND version.superseded_at IS NULL
  ORDER BY version.version_number DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current quote version is missing' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.qb_quote_pricing_epochs(
    workspace_id, quote_package_id
  ) VALUES (p_workspace_id, v_quote.id)
  ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;
  PERFORM 1
  FROM public.qb_quote_pricing_epochs epoch
  WHERE epoch.workspace_id = p_workspace_id
    AND epoch.quote_package_id = v_quote.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quote pricing epoch is unavailable during reversal'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_event
  FROM public.qb_price_change_events event
  WHERE event.id = v_apply.source_event_id
    AND event.workspace_id = p_workspace_id
  FOR SHARE;
  IF NOT FOUND OR v_event.status <> 'active' THEN
    RAISE EXCEPTION 'OEM source event is no longer active; rebuild from current pricing before reversal'
      USING ERRCODE = '40001';
  END IF;

  IF p_actor_role = 'rep' AND v_current_rep_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'OEM reprice reversal belongs to another rep'
      USING ERRCODE = '42501';
  END IF;

  v_idempotency_key :=
    'oem-reprice:reverse:' || p_workspace_id || ':' || v_apply.id::text;
  SELECT * INTO v_existing_audit
  FROM public.qb_quote_reprice_audits audit
  WHERE audit.workspace_id = p_workspace_id
    AND audit.idempotency_key = v_idempotency_key
    AND audit.action = 'reverse';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'action', 'reverse',
      'audit_id', v_existing_audit.id,
      'apply_audit_id', v_apply.id,
      'quote_package_id', v_existing_audit.quote_package_id,
      'after_quote_version_id', v_existing_audit.after_quote_version_id,
      'customer_communication', 'none'
    );
  END IF;

  -- Inclusive at exactly seven days; the first instant after is rejected.
  IF NOT public.qb_oem_reprice_reversal_within_window(
    v_apply.created_at, v_now
  ) THEN
    RAISE EXCEPTION 'seven-day OEM reprice reversal window has expired'
      USING ERRCODE = '55000',
            DETAIL = (v_apply.created_at + INTERVAL '7 days')::text;
  END IF;
  IF v_quote.status IN (
    'accepted', 'rejected', 'expired', 'converted_to_deal', 'archived'
  ) THEN
    RAISE EXCEPTION 'quote has advanced to an irreversible customer state'
      USING ERRCODE = '55000';
  END IF;
  IF v_draft.status <> 'applied' OR v_impact.state <> 'applied' THEN
    RAISE EXCEPTION 'OEM apply state is no longer reversible'
      USING ERRCODE = '55000';
  END IF;
  IF v_current_version.id IS DISTINCT FROM v_apply.after_quote_version_id
     OR v_current_version.version_number IS DISTINCT FROM v_apply.after_version_number
     OR v_quote.updated_at IS DISTINCT FROM
        (v_apply.payload #>> '{after,quote_updated_at}')::timestamptz
     OR v_quote.status IS DISTINCT FROM v_apply.after_quote_status THEN
    RAISE EXCEPTION 'quote changed after OEM apply; reversal would overwrite later work'
      USING ERRCODE = '40001';
  END IF;

  v_current_totals := public.qb_oem_reprice_canonical_totals(v_quote.id);
  IF v_current_totals IS DISTINCT FROM v_apply.after_totals
     OR NOT COALESCE(public.qb_oem_reprice_persisted_totals_match(
       v_quote.id, v_current_totals
     ), false) THEN
    RAISE EXCEPTION 'quote totals changed after OEM apply'
      USING ERRCODE = '40001';
  END IF;

  FOR v_apply_line IN
    SELECT line_change
    FROM jsonb_array_elements(v_apply.line_changes) line_change
    WHERE line_change ->> 'decision' = 'applied'
    ORDER BY line_change ->> 'quote_line_id'
  LOOP
    SELECT * INTO v_quote_line
    FROM public.quote_package_line_items quote_line
    WHERE quote_line.id = (v_apply_line ->> 'quote_line_id')::uuid
      AND quote_line.quote_package_id = v_quote.id
      AND quote_line.workspace_id = p_workspace_id;
    IF NOT FOUND
       OR v_quote_line.quantity IS DISTINCT FROM
          (v_apply_line ->> 'quantity')::integer
       OR ROUND(COALESCE(v_quote_line.quoted_list_price, 0) * 100)::bigint
          IS DISTINCT FROM
          (v_apply_line ->> 'after_quoted_list_price_cents')::bigint
       OR ROUND(COALESCE(v_quote_line.unit_price, 0) * 100)::bigint
          IS DISTINCT FROM
          (v_apply_line ->> 'after_unit_price_cents')::bigint
       OR ROUND(COALESCE(v_quote_line.extended_price, 0) * 100)::bigint
          IS DISTINCT FROM
          (v_apply_line ->> 'after_extended_price_cents')::bigint
       OR v_quote_line.source_location IS DISTINCT FROM
          NULLIF(v_apply_line ->> 'source_location', '') THEN
      RAISE EXCEPTION 'repriced line changed after apply; reversal refused'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.quote_package_line_items quote_line
    SET
      quoted_list_price =
        (v_apply_line ->> 'before_quoted_list_price_cents')::numeric / 100,
      unit_price =
        (v_apply_line ->> 'before_unit_price_cents')::numeric / 100,
      extended_price =
        (v_apply_line ->> 'before_extended_price_cents')::numeric / 100
    WHERE quote_line.id = v_quote_line.id
      AND quote_line.quote_package_id = v_quote.id
      AND quote_line.workspace_id = p_workspace_id
      AND ROUND(COALESCE(quote_line.unit_price, 0) * 100)::bigint =
          (v_apply_line ->> 'after_unit_price_cents')::bigint
      AND ROUND(COALESCE(quote_line.extended_price, 0) * 100)::bigint =
          (v_apply_line ->> 'after_extended_price_cents')::bigint;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN
      RAISE EXCEPTION 'quote line compare-and-swap failed during OEM reversal'
        USING ERRCODE = '40001';
    END IF;

    v_reversed_count := v_reversed_count + 1;
    v_line_changes := v_line_changes || jsonb_build_array(jsonb_build_object(
      'impact_line_id', v_apply_line ->> 'impact_line_id',
      'quote_line_id', v_quote_line.id,
      'decision', 'applied',
      'preservation_reason', NULL,
      'quantity', v_quote_line.quantity,
      'source_location', v_quote_line.source_location,
      'is_yard_stock', false,
      'before_quoted_list_price_cents',
        (v_apply_line ->> 'after_quoted_list_price_cents')::bigint,
      'after_quoted_list_price_cents',
        (v_apply_line ->> 'before_quoted_list_price_cents')::bigint,
      'before_unit_price_cents',
        (v_apply_line ->> 'after_unit_price_cents')::bigint,
      'after_unit_price_cents',
        (v_apply_line ->> 'before_unit_price_cents')::bigint,
      'before_extended_price_cents',
        (v_apply_line ->> 'after_extended_price_cents')::bigint,
      'after_extended_price_cents',
        (v_apply_line ->> 'before_extended_price_cents')::bigint
    ));
  END LOOP;

  IF v_reversed_count = 0 THEN
    RAISE EXCEPTION 'apply audit has no reversible line mutations'
      USING ERRCODE = '55000';
  END IF;

  v_restored_totals := public.qb_oem_reprice_canonical_totals(v_quote.id);
  IF v_restored_totals IS DISTINCT FROM v_apply.before_totals THEN
    RAISE EXCEPTION 'reversal no longer reconstructs pre-apply totals exactly'
      USING ERRCODE = '40001';
  END IF;

  v_before_commission := ROUND(
    (v_current_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;
  v_after_commission := ROUND(
    (v_restored_totals ->> 'margin_amount_cents')::bigint * 0.15
  )::bigint;
  v_commission_projection := jsonb_build_object(
    'policy', 'OEM-DP10',
    'rate_of_gross_margin', 0.15,
    'gross_margin_before_cents',
      (v_current_totals ->> 'margin_amount_cents')::bigint,
    'gross_margin_after_cents',
      (v_restored_totals ->> 'margin_amount_cents')::bigint,
    'commission_before_cents', v_before_commission,
    'commission_after_cents', v_after_commission,
    'commission_delta_cents', v_after_commission - v_before_commission,
    'split_allocation', NULL
  );

  UPDATE public.qb_quote_reprice_drafts
  SET status = 'reversed', reversed_at = v_now
  WHERE id = v_draft.id AND status = 'applied';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'draft state changed during OEM reversal'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.qb_quote_reprice_impacts
  SET state = 'visible'
  WHERE id = v_impact.id AND state = 'applied';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'impact state changed during OEM reversal'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.quote_packages quote
  SET
    equipment_total =
      (v_restored_totals ->> 'equipment_total_cents')::numeric / 100,
    attachment_total =
      (v_restored_totals ->> 'attachment_total_cents')::numeric / 100,
    subtotal = (v_restored_totals ->> 'subtotal_cents')::numeric / 100,
    discount_total =
      (v_restored_totals ->> 'discount_total_cents')::numeric / 100,
    net_total = (v_restored_totals ->> 'net_total_cents')::numeric / 100,
    amount_financed =
      (v_restored_totals ->> 'amount_financed_cents')::numeric / 100,
    margin_amount =
      (v_restored_totals ->> 'margin_amount_cents')::numeric / 100,
    margin_pct = (v_restored_totals ->> 'margin_pct')::numeric
  WHERE quote.id = v_quote.id
    AND quote.workspace_id = p_workspace_id
    AND quote.updated_at =
      (v_apply.payload #>> '{after,quote_updated_at}')::timestamptz;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'quote compare-and-swap failed during OEM reversal'
      USING ERRCODE = '40001';
  END IF;

  PERFORM public.qb_oem_reprice_recompute_quote_flag(
    p_workspace_id, v_quote.id
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', line.id,
    'line_type', line.line_type,
    'quantity', line.quantity,
    'quoted_list_price', line.quoted_list_price,
    'unit_price', line.unit_price,
    'extended_price', line.extended_price,
    'quoted_dealer_cost', line.quoted_dealer_cost,
    'cost_visibility', line.cost_visibility,
    'source_location', line.source_location
  ) ORDER BY line.display_order, line.id), '[]'::jsonb)
    INTO v_version_lines
  FROM public.quote_package_line_items line
  WHERE line.quote_package_id = v_quote.id;

  v_next_version_number := v_current_version.version_number + 1;
  UPDATE public.quote_package_versions
  SET superseded_at = v_now
  WHERE id = v_current_version.id AND superseded_at IS NULL;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'current quote version changed during OEM reversal'
      USING ERRCODE = '40001';
  END IF;

  v_version_snapshot := jsonb_build_object(
    'source', 'oem_reprice_reversal',
    'audit_id', v_audit_id,
    'reverses_apply_audit_id', v_apply.id,
    'quote_package_id', v_quote.id,
    'quote_status', v_quote.status,
    'saved_at', v_now,
    'line_items', v_version_lines,
    'totals', v_restored_totals
  );
  INSERT INTO public.quote_package_versions (
    id, workspace_id, quote_package_id, version_number, snapshot_json,
    computed_metrics_json, created_by, created_at
  ) VALUES (
    v_next_version_id, p_workspace_id, v_quote.id, v_next_version_number,
    v_version_snapshot,
    v_restored_totals || jsonb_build_object(
      'source', 'oem_reprice_reversal', 'audit_id', v_audit_id,
      'reverses_apply_audit_id', v_apply.id
    ),
    p_actor_id, v_now
  );

  v_payload := jsonb_build_object(
    'schema_version', 1,
    'action', 'reverse',
    'idempotency_key', v_idempotency_key,
    'workspace_id', p_workspace_id,
    'quote_package_id', v_quote.id,
    'actor', jsonb_build_object('id', p_actor_id, 'role', p_actor_role),
    'approval', v_apply.payload -> 'approval',
    'source', v_apply.payload -> 'source',
    'reverses_apply_audit_id', v_apply.id,
    'occurred_at', v_now,
    'before', jsonb_build_object(
      'quote_version_id', v_current_version.id,
      'version_number', v_current_version.version_number,
      'quote_updated_at', v_quote.updated_at,
      'quote_status', v_quote.status,
      'totals', v_current_totals
    ),
    'after', jsonb_build_object(
      'quote_version_id', v_next_version_id,
      'version_number', v_next_version_number,
      'quote_updated_at', v_now,
      'quote_status', v_quote.status,
      'totals', v_restored_totals
    ),
    'lines', v_line_changes,
    'commission_projection', v_commission_projection,
    'side_effects', jsonb_build_object(
      'customer_communication', 'none', 'email_draft_id', NULL
    )
  );

  INSERT INTO public.qb_quote_reprice_audits (
    id, workspace_id, quote_package_id, draft_id, impact_id, apply_audit_id,
    action, idempotency_key, actor_id, actor_role, approval_case_id,
    source_event_id, price_sheet_id, prior_price_sheet_id,
    before_quote_version_id, after_quote_version_id,
    before_version_number, after_version_number,
    before_quote_status, after_quote_status,
    before_totals, after_totals, line_changes, commission_projection,
    margin_override, customer_communication_sent, payload, created_at
  ) VALUES (
    v_audit_id, p_workspace_id, v_quote.id, v_draft.id, v_impact.id, v_apply.id,
    'reverse', v_idempotency_key, p_actor_id, p_actor_role, v_approval.id,
    v_event.id, v_apply.price_sheet_id, v_apply.prior_price_sheet_id,
    v_current_version.id, v_next_version_id,
    v_current_version.version_number, v_next_version_number,
    v_quote.status, v_quote.status,
    v_current_totals, v_restored_totals, v_line_changes,
    v_commission_projection, v_apply.margin_override, false, v_payload, v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'action', 'reverse',
    'audit_id', v_audit_id,
    'apply_audit_id', v_apply.id,
    'quote_package_id', v_quote.id,
    'after_quote_version_id', v_next_version_id,
    'after_version_number', v_next_version_number,
    'reversed_line_count', v_reversed_count,
    'totals', v_restored_totals,
    'commission_projection', v_commission_projection,
    'customer_communication', 'none'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_qb_oem_reprice_apply(
  text, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_qb_oem_reprice_apply(
  text, uuid, uuid, text
) TO service_role;

COMMIT;
