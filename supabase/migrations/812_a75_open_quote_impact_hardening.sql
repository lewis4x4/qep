-- Migration 812: A7.5 open-quote impact hardening
-- Atomic event persistence, exact OEM/customer context, deterministic locks,
-- and replay-safe quote requote ownership.

BEGIN;

ALTER TABLE public.qb_price_change_events
  ADD COLUMN IF NOT EXISTS publish_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS stream_kind text NOT NULL DEFAULT 'price_book';

ALTER TABLE public.qb_price_change_events
  DROP CONSTRAINT IF EXISTS qb_price_change_events_price_sheet_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_price_change_events_stream_kind_chk'
      AND conrelid = 'public.qb_price_change_events'::regclass
  ) THEN
    ALTER TABLE public.qb_price_change_events
      ADD CONSTRAINT qb_price_change_events_stream_kind_chk
      CHECK (stream_kind IN ('price_book', 'retail_programs'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_price_change_events_sheet_stream_key'
      AND conrelid = 'public.qb_price_change_events'::regclass
  ) THEN
    ALTER TABLE public.qb_price_change_events
      ADD CONSTRAINT qb_price_change_events_sheet_stream_key
      UNIQUE (price_sheet_id, stream_kind);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_price_change_events_active_stream
  ON public.qb_price_change_events(workspace_id, brand_id, stream_kind)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_qb_price_change_events_publish_group
  ON public.qb_price_change_events(publish_group_id, stream_kind);

COMMENT ON COLUMN public.qb_price_change_events.publish_group_id IS
  'Groups the price-book and retail-program event streams produced by one sheet publish.';
COMMENT ON COLUMN public.qb_price_change_events.stream_kind IS
  'Independent OEM lineage lane; active/superseded state is enforced per brand and lane.';

CREATE TABLE IF NOT EXISTS public.qb_price_sheet_lineage (
  price_sheet_id uuid NOT NULL REFERENCES public.qb_price_sheets(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.qb_brands(id) ON DELETE CASCADE,
  lane text NOT NULL CHECK (lane IN ('price_book', 'retail_programs')),
  predecessor_price_sheet_id uuid REFERENCES public.qb_price_sheets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (price_sheet_id, lane)
);
CREATE INDEX IF NOT EXISTS idx_qb_price_sheet_lineage_predecessor
  ON public.qb_price_sheet_lineage(predecessor_price_sheet_id)
  WHERE predecessor_price_sheet_id IS NOT NULL;

ALTER TABLE public.qb_price_sheet_lineage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qb_price_sheet_lineage_service ON public.qb_price_sheet_lineage;
CREATE POLICY qb_price_sheet_lineage_service ON public.qb_price_sheet_lineage
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
DROP POLICY IF EXISTS qb_price_sheet_lineage_elevated_select ON public.qb_price_sheet_lineage;
CREATE POLICY qb_price_sheet_lineage_elevated_select ON public.qb_price_sheet_lineage
  FOR SELECT USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'manager', 'owner')
  );
REVOKE ALL ON TABLE public.qb_price_sheet_lineage FROM anon, authenticated;
GRANT SELECT ON TABLE public.qb_price_sheet_lineage TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.qb_workspace_pricing_epochs (
  workspace_id text PRIMARY KEY,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qb_workspace_pricing_epochs IS
  'Workspace-wide mutation epoch used only to prove a full open-quote scan did not miss concurrent inserts or edits.';

CREATE TABLE IF NOT EXISTS public.qb_quote_pricing_epochs (
  workspace_id text NOT NULL,
  quote_package_id uuid NOT NULL,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, quote_package_id)
);
COMMENT ON TABLE public.qb_quote_pricing_epochs IS
  'Per-quote pricing/context epoch used by OEM draft approval, apply, and reversal CAS without invalidating unrelated quotes.';
CREATE INDEX IF NOT EXISTS idx_qb_quote_pricing_epochs_quote
  ON public.qb_quote_pricing_epochs(quote_package_id);

INSERT INTO public.qb_workspace_pricing_epochs(workspace_id)
SELECT DISTINCT workspace_id FROM public.quote_packages
ON CONFLICT (workspace_id) DO NOTHING;
INSERT INTO public.qb_quote_pricing_epochs(workspace_id, quote_package_id)
SELECT workspace_id, id FROM public.quote_packages
ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;

ALTER TABLE public.qb_workspace_pricing_epochs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qb_workspace_pricing_epochs_service ON public.qb_workspace_pricing_epochs;
CREATE POLICY qb_workspace_pricing_epochs_service ON public.qb_workspace_pricing_epochs
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
ALTER TABLE public.qb_quote_pricing_epochs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qb_quote_pricing_epochs_service ON public.qb_quote_pricing_epochs;
CREATE POLICY qb_quote_pricing_epochs_service ON public.qb_quote_pricing_epochs
  FOR ALL USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
REVOKE ALL ON TABLE public.qb_workspace_pricing_epochs,
  public.qb_quote_pricing_epochs FROM anon, authenticated;
GRANT SELECT ON TABLE public.qb_workspace_pricing_epochs,
  public.qb_quote_pricing_epochs TO service_role;

CREATE OR REPLACE FUNCTION public.bump_qb_workspace_pricing_epoch(p_workspace_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(p_workspace_id), '') IS NULL THEN RETURN; END IF;
  INSERT INTO public.qb_workspace_pricing_epochs(workspace_id, epoch, updated_at)
  VALUES (p_workspace_id, 1, clock_timestamp())
  ON CONFLICT (workspace_id) DO UPDATE
  SET epoch = public.qb_workspace_pricing_epochs.epoch + 1,
      updated_at = clock_timestamp();
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_qb_quote_pricing_epoch(
  p_workspace_id text,
  p_quote_package_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(p_workspace_id), '') IS NULL OR p_quote_package_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.qb_quote_pricing_epochs(
    workspace_id, quote_package_id, epoch, updated_at
  ) VALUES (
    p_workspace_id, p_quote_package_id, 1, clock_timestamp()
  )
  ON CONFLICT (workspace_id, quote_package_id) DO UPDATE
  SET epoch = public.qb_quote_pricing_epochs.epoch + 1,
      updated_at = clock_timestamp();
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_qb_quote_pricing_epoch_from_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity record;
  v_workspace_id text;
BEGIN
  FOR v_identity IN
    SELECT DISTINCT identity.workspace_id, identity.quote_package_id
    FROM (
      SELECT OLD.workspace_id, OLD.id AS quote_package_id WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW.workspace_id, NEW.id AS quote_package_id WHERE TG_OP <> 'DELETE'
    ) identity
    WHERE identity.workspace_id IS NOT NULL AND identity.quote_package_id IS NOT NULL
    ORDER BY identity.workspace_id, identity.quote_package_id
  LOOP
    PERFORM public.bump_qb_quote_pricing_epoch(
      v_identity.workspace_id, v_identity.quote_package_id
    );
  END LOOP;
  FOR v_workspace_id IN
    SELECT DISTINCT identity.workspace_id
    FROM (
      SELECT OLD.workspace_id WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW.workspace_id WHERE TG_OP <> 'DELETE'
    ) identity
    WHERE identity.workspace_id IS NOT NULL
    ORDER BY identity.workspace_id
  LOOP
    PERFORM public.bump_qb_workspace_pricing_epoch(v_workspace_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_qb_quote_pricing_epoch_from_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity record;
  v_workspace_id text;
BEGIN
  FOR v_identity IN
    SELECT DISTINCT identity.workspace_id, identity.quote_package_id
    FROM (
      SELECT OLD.workspace_id, OLD.quote_package_id WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW.workspace_id, NEW.quote_package_id WHERE TG_OP <> 'DELETE'
    ) identity
    WHERE identity.workspace_id IS NOT NULL AND identity.quote_package_id IS NOT NULL
    ORDER BY identity.workspace_id, identity.quote_package_id
  LOOP
    PERFORM public.bump_qb_quote_pricing_epoch(
      v_identity.workspace_id, v_identity.quote_package_id
    );
  END LOOP;
  FOR v_workspace_id IN
    SELECT DISTINCT identity.workspace_id
    FROM (
      SELECT OLD.workspace_id WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW.workspace_id WHERE TG_OP <> 'DELETE'
    ) identity
    WHERE identity.workspace_id IS NOT NULL
    ORDER BY identity.workspace_id
  LOOP
    PERFORM public.bump_qb_workspace_pricing_epoch(v_workspace_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_qb_quote_pricing_epoch_from_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity record;
  v_workspace_id text;
BEGIN
  FOR v_identity IN
    SELECT quote.workspace_id, quote.id AS quote_package_id
    FROM public.quote_packages quote
    WHERE quote.deal_id IN (OLD.id, NEW.id)
    ORDER BY quote.workspace_id, quote.id
  LOOP
    PERFORM public.bump_qb_quote_pricing_epoch(
      v_identity.workspace_id, v_identity.quote_package_id
    );
  END LOOP;
  FOR v_workspace_id IN
    SELECT DISTINCT quote.workspace_id
    FROM public.quote_packages quote
    WHERE quote.deal_id IN (OLD.id, NEW.id)
    ORDER BY quote.workspace_id
  LOOP
    PERFORM public.bump_qb_workspace_pricing_epoch(v_workspace_id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_qb_quote_pricing_epoch_from_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity record;
  v_workspace_id text;
BEGIN
  FOR v_identity IN
    SELECT quote.workspace_id, quote.id AS quote_package_id
    FROM public.qrm_deals deal
    JOIN public.quote_packages quote ON quote.deal_id = deal.id
    WHERE deal.company_id IN (OLD.id, NEW.id)
    ORDER BY quote.workspace_id, quote.id
  LOOP
    PERFORM public.bump_qb_quote_pricing_epoch(
      v_identity.workspace_id, v_identity.quote_package_id
    );
  END LOOP;
  FOR v_workspace_id IN
    SELECT DISTINCT quote.workspace_id
    FROM public.qrm_deals deal
    JOIN public.quote_packages quote ON quote.deal_id = deal.id
    WHERE deal.company_id IN (OLD.id, NEW.id)
    ORDER BY quote.workspace_id
  LOOP
    PERFORM public.bump_qb_workspace_pricing_epoch(v_workspace_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qb_quote_pricing_epoch_quote_insert_delete ON public.quote_packages;
CREATE TRIGGER trg_qb_quote_pricing_epoch_quote_insert_delete
AFTER INSERT OR DELETE ON public.quote_packages
FOR EACH ROW EXECUTE FUNCTION public.touch_qb_quote_pricing_epoch_from_quote();
DROP TRIGGER IF EXISTS trg_qb_quote_pricing_epoch_quote_update ON public.quote_packages;
CREATE TRIGGER trg_qb_quote_pricing_epoch_quote_update
AFTER UPDATE OF workspace_id, deal_id, status, equipment, net_total, margin_amount,
  margin_pct, delivery_state, selected_promotion_ids, created_by
ON public.quote_packages
FOR EACH ROW EXECUTE FUNCTION public.touch_qb_quote_pricing_epoch_from_quote();

DROP TRIGGER IF EXISTS trg_qb_quote_pricing_epoch_line ON public.quote_package_line_items;
CREATE TRIGGER trg_qb_quote_pricing_epoch_line
AFTER INSERT OR UPDATE OR DELETE ON public.quote_package_line_items
FOR EACH ROW EXECUTE FUNCTION public.touch_qb_quote_pricing_epoch_from_line();

DROP TRIGGER IF EXISTS trg_qb_quote_pricing_epoch_deal ON public.qrm_deals;
CREATE TRIGGER trg_qb_quote_pricing_epoch_deal
AFTER UPDATE OF workspace_id, company_id, assigned_rep_id, deleted_at ON public.qrm_deals
FOR EACH ROW EXECUTE FUNCTION public.touch_qb_quote_pricing_epoch_from_deal();

DROP TRIGGER IF EXISTS trg_qb_quote_pricing_epoch_company ON public.qrm_companies;
CREATE TRIGGER trg_qb_quote_pricing_epoch_company
AFTER UPDATE OF workspace_id, price_lock_active, price_lock_reason,
  price_lock_expires_at, deleted_at
ON public.qrm_companies
FOR EACH ROW EXECUTE FUNCTION public.touch_qb_quote_pricing_epoch_from_company();

REVOKE EXECUTE ON FUNCTION public.bump_qb_workspace_pricing_epoch(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_qb_workspace_pricing_epoch(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.bump_qb_quote_pricing_epoch(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_qb_quote_pricing_epoch(text, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.touch_qb_quote_pricing_epoch_from_quote()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_qb_quote_pricing_epoch_from_line()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_qb_quote_pricing_epoch_from_deal()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_qb_quote_pricing_epoch_from_company()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pin_qb_price_sheet_lineage(
  p_workspace_id text,
  p_price_sheet_id uuid,
  p_lineage jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sheet public.qb_price_sheets%ROWTYPE;
  v_expected_lanes text[];
  v_entry jsonb;
  v_lane text;
  v_prior_id uuid;
  v_unique_prior_ids uuid[];
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'pin_qb_price_sheet_lineage requires service_role' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_lineage, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'lineage must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sheet FROM public.qb_price_sheets
  WHERE id = p_price_sheet_id FOR UPDATE;
  IF NOT FOUND OR v_sheet.workspace_id IS DISTINCT FROM p_workspace_id OR v_sheet.brand_id IS NULL THEN
    RAISE EXCEPTION 'price sheet is outside caller workspace' USING ERRCODE = '42501';
  END IF;
  v_expected_lanes := CASE COALESCE(v_sheet.sheet_type, 'price_book')
    WHEN 'both' THEN ARRAY['price_book', 'retail_programs']::text[]
    WHEN 'retail_programs' THEN ARRAY['retail_programs']::text[]
    ELSE ARRAY['price_book']::text[]
  END;
  IF jsonb_array_length(p_lineage) <> cardinality(v_expected_lanes)
     OR (SELECT count(DISTINCT entry ->> 'lane') FROM jsonb_array_elements(p_lineage) entry)
        <> cardinality(v_expected_lanes)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lineage) entry
       WHERE NOT ((entry ->> 'lane') = ANY(v_expected_lanes))
     ) THEN
    RAISE EXCEPTION 'lineage lanes do not match sheet type' USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_lineage)
  LOOP
    v_lane := v_entry ->> 'lane';
    v_prior_id := NULLIF(v_entry ->> 'predecessorPriceSheetId', '')::uuid;
    IF v_prior_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.qb_price_sheets prior
      WHERE prior.id = v_prior_id
        AND prior.id <> v_sheet.id
        AND prior.workspace_id = v_sheet.workspace_id
        AND prior.brand_id = v_sheet.brand_id
        AND prior.status IN ('published', 'superseded')
        AND CASE v_lane
          WHEN 'price_book' THEN COALESCE(prior.sheet_type, 'price_book') IN ('price_book', 'both', 'other')
          ELSE prior.sheet_type IN ('retail_programs', 'both')
        END
    ) THEN
      RAISE EXCEPTION 'lineage predecessor is outside the requested lane' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.qb_price_sheet_lineage(
      price_sheet_id, workspace_id, brand_id, lane, predecessor_price_sheet_id
    ) VALUES (
      v_sheet.id, v_sheet.workspace_id, v_sheet.brand_id, v_lane, v_prior_id
    ) ON CONFLICT (price_sheet_id, lane) DO NOTHING;

    IF EXISTS (
      SELECT 1 FROM public.qb_price_sheet_lineage lineage
      WHERE lineage.price_sheet_id = v_sheet.id AND lineage.lane = v_lane
        AND (
          lineage.workspace_id IS DISTINCT FROM v_sheet.workspace_id
          OR lineage.brand_id IS DISTINCT FROM v_sheet.brand_id
          OR lineage.predecessor_price_sheet_id IS DISTINCT FROM v_prior_id
        )
    ) THEN
      RAISE EXCEPTION 'price-sheet lineage changed concurrently; rebuild preview'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  SELECT array_agg(DISTINCT predecessor_price_sheet_id)
    INTO v_unique_prior_ids
  FROM public.qb_price_sheet_lineage
  WHERE price_sheet_id = v_sheet.id AND predecessor_price_sheet_id IS NOT NULL;
  IF cardinality(COALESCE(v_unique_prior_ids, '{}'::uuid[])) = 1 THEN
    IF v_sheet.supersedes_price_sheet_id IS NOT NULL
       AND v_sheet.supersedes_price_sheet_id <> v_unique_prior_ids[1] THEN
      RAISE EXCEPTION 'legacy predecessor disagrees with pinned lineage' USING ERRCODE = '40001';
    END IF;
    UPDATE public.qb_price_sheets
    SET supersedes_price_sheet_id = v_unique_prior_ids[1]
    WHERE id = v_sheet.id AND supersedes_price_sheet_id IS NULL;
  END IF;

  RETURN jsonb_build_object('price_sheet_id', v_sheet.id, 'lineage', p_lineage);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pin_qb_price_sheet_lineage(text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pin_qb_price_sheet_lineage(text, uuid, jsonb)
  TO service_role;

ALTER TABLE public.qb_quote_reprice_impacts
  ADD COLUMN IF NOT EXISTS change_categories text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS catalog_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_company_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suppressed_by_customer_lock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_price_lock_reason text,
  ADD COLUMN IF NOT EXISTS customer_price_lock_expires_at date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_impacts_change_categories_chk'
      AND conrelid = 'public.qb_quote_reprice_impacts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_impacts
      ADD CONSTRAINT qb_quote_reprice_impacts_change_categories_chk
      CHECK (
        change_categories <@ ARRAY['list_price', 'freight', 'rebate', 'incentive']::text[]
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_impacts_catalog_changes_chk'
      AND conrelid = 'public.qb_quote_reprice_impacts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_impacts
      ADD CONSTRAINT qb_quote_reprice_impacts_catalog_changes_chk
      CHECK (jsonb_typeof(catalog_changes) = 'array') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qb_quote_reprice_impacts_context_snapshot_chk'
      AND conrelid = 'public.qb_quote_reprice_impacts'::regclass
  ) THEN
    ALTER TABLE public.qb_quote_reprice_impacts
      ADD CONSTRAINT qb_quote_reprice_impacts_context_snapshot_chk
      CHECK (jsonb_typeof(context_snapshot) = 'object') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.qb_quote_reprice_impacts
  VALIDATE CONSTRAINT qb_quote_reprice_impacts_change_categories_chk;
ALTER TABLE public.qb_quote_reprice_impacts
  VALIDATE CONSTRAINT qb_quote_reprice_impacts_catalog_changes_chk;
ALTER TABLE public.qb_quote_reprice_impacts
  VALIDATE CONSTRAINT qb_quote_reprice_impacts_context_snapshot_chk;

CREATE INDEX IF NOT EXISTS idx_qb_price_change_events_prior_sheet
  ON public.qb_price_change_events(prior_price_sheet_id)
  WHERE prior_price_sheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_impact_lines_quote_line
  ON public.qb_quote_reprice_impact_lines(quote_package_line_item_id)
  WHERE quote_package_line_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_impacts_customer_company
  ON public.qb_quote_reprice_impacts(workspace_id, customer_company_id, created_at DESC)
  WHERE customer_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_quote_reprice_impacts_active_quote
  ON public.qb_quote_reprice_impacts(quote_package_id, event_id)
  WHERE state IN ('visible', 'draft_created', 'approval_pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_quote_packages_oem_open_keyset
  ON public.quote_packages(workspace_id, id)
  WHERE status IN (
    'draft', 'draft_low_margin', 'pending_approval', 'approved',
    'approved_with_conditions', 'changes_requested', 'ready', 'sent', 'viewed'
  );
CREATE INDEX IF NOT EXISTS idx_qp_line_items_oem_scan_keyset
  ON public.quote_package_line_items(workspace_id, quote_package_id, id);

COMMENT ON COLUMN public.qb_quote_reprice_impacts.change_categories IS
  'DP9 categories carried from the canonical sheet diff. Presence requires manager review, while rep visibility remains governed by strict DP5 materiality.';
COMMENT ON COLUMN public.qb_quote_reprice_impacts.catalog_changes IS
  'Catalog-level freight/rebate/incentive context. quoteDeltaCents remains null when quote context cannot support a truthful dollar result.';
COMMENT ON COLUMN public.qb_quote_reprice_impacts.suppressed_by_customer_lock IS
  'True when the linked current customer lock is active and unexpired on the persistence date. Such impacts are logged but cannot set the action flag.';

CREATE OR REPLACE FUNCTION public.qb_has_meaningful_catalog_specs(
  p_value jsonb,
  p_depth integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_entry record;
  v_key text;
  v_text text;
BEGIN
  IF p_value IS NULL OR p_value = 'null'::jsonb OR p_depth > 3 THEN
    RETURN false;
  END IF;
  CASE jsonb_typeof(p_value)
    WHEN 'array' THEN
      FOR v_entry IN SELECT value FROM jsonb_array_elements(p_value)
      LOOP
        IF jsonb_typeof(v_entry.value) = 'object'
           AND public.qb_has_meaningful_catalog_specs(v_entry.value, p_depth + 1) THEN
          RETURN true;
        END IF;
      END LOOP;
      RETURN false;
    WHEN 'object' THEN
      FOR v_entry IN SELECT key, value FROM jsonb_each(p_value)
      LOOP
        v_key := trim(both '_' FROM regexp_replace(lower(v_entry.key), '[^a-z0-9]+', '_', 'g'));
        IF v_key NOT IN (
          'ai_summary', 'bullets', 'comments', 'description', 'free_text',
          'notes', 'raw_text', 'summary', 'key', 'label', 'name', 'title',
          'unit', 'units', 'uom', 'category', 'group'
        ) AND public.qb_has_meaningful_catalog_specs(
          v_entry.value, p_depth + 1
        ) THEN
          RETURN true;
        END IF;
      END LOOP;
      RETURN false;
    WHEN 'number' THEN RETURN true;
    WHEN 'boolean' THEN RETURN true;
    WHEN 'string' THEN
      v_text := btrim(p_value #>> '{}');
      RETURN length(v_text) > 0 AND length(v_text) <= 120;
    ELSE RETURN false;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_qb_program_details_atomic(
  p_program_type text,
  p_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_details jsonb := CASE WHEN jsonb_typeof(p_details) = 'object' THEN p_details ELSE '{}'::jsonb END;
  v_primary jsonb;
  v_lender jsonb;
BEGIN
  IF p_program_type <> 'low_rate_financing'
     OR jsonb_typeof(v_details -> 'terms') <> 'array'
     OR jsonb_array_length(v_details -> 'terms') = 0 THEN
    RETURN v_details;
  END IF;
  SELECT term INTO v_primary
  FROM jsonb_array_elements(v_details -> 'terms') term
  ORDER BY COALESCE((term ->> 'rate_pct')::numeric, 0),
           abs(COALESCE((term ->> 'months')::integer, 60) - 60)
  LIMIT 1;
  v_lender := CASE
    WHEN jsonb_typeof(v_details -> 'lenders') = 'array'
      AND jsonb_array_length(v_details -> 'lenders') > 0
    THEN v_details -> 'lenders' -> 0
    ELSE '{}'::jsonb
  END;
  RETURN v_details || jsonb_build_object(
    'term_months', COALESCE((v_primary ->> 'months')::integer, 60),
    'rate_pct', COALESCE((v_primary ->> 'rate_pct')::numeric, 0),
    'dealer_participation_pct', COALESCE((v_primary ->> 'dealer_participation_pct')::numeric, 0),
    'lender_name', COALESCE(NULLIF(v_lender ->> 'name', ''), 'Manufacturer Financing'),
    'all_terms', v_details -> 'terms',
    'all_lenders', CASE WHEN jsonb_typeof(v_details -> 'lenders') = 'array'
      THEN v_details -> 'lenders' ELSE '[]'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_qb_price_sheet_atomic(
  p_workspace_id text,
  p_price_sheet_id uuid,
  p_actor_id uuid,
  p_auto_approve boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sheet public.qb_price_sheets%ROWTYPE;
  v_item public.qb_price_sheet_items%ROWTYPE;
  v_program public.qb_price_sheet_programs%ROWTYPE;
  v_extracted jsonb;
  v_details jsonb;
  v_state_codes text[];
  v_compatible_ids uuid[];
  v_target_id uuid;
  v_rows integer;
  v_items_applied integer := 0;
  v_programs_applied integer := 0;
  v_auto_items integer := 0;
  v_auto_programs integer := 0;
  v_effective_from date;
  v_effective_to date;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'publish_qb_price_sheet_atomic requires service_role' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sheet FROM public.qb_price_sheets
  WHERE id = p_price_sheet_id FOR UPDATE;
  IF NOT FOUND OR v_sheet.workspace_id IS DISTINCT FROM p_workspace_id OR v_sheet.brand_id IS NULL THEN
    RAISE EXCEPTION 'price sheet is outside caller workspace' USING ERRCODE = '42501';
  END IF;
  IF v_sheet.status = 'published' THEN
    RETURN jsonb_build_object(
      'priceSheetId', v_sheet.id,
      'status', 'published',
      'idempotent', true,
      'itemsApplied', (SELECT count(*) FROM public.qb_price_sheet_items WHERE price_sheet_id = v_sheet.id AND applied_at IS NOT NULL AND action <> 'skip'),
      'programsApplied', (SELECT count(*) FROM public.qb_price_sheet_programs WHERE price_sheet_id = v_sheet.id AND applied_at IS NOT NULL AND action <> 'skip'),
      'itemsSkipped', 0,
      'programsSkipped', 0
    );
  END IF;
  IF v_sheet.status <> 'extracted' THEN
    RAISE EXCEPTION 'price sheet must be extracted before atomic publish' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.qb_price_sheet_lineage lineage
    WHERE lineage.price_sheet_id = v_sheet.id
  ) THEN
    RAISE EXCEPTION 'price-sheet lineage must be pinned before publish' USING ERRCODE = '55000';
  END IF;

  IF p_auto_approve THEN
    UPDATE public.qb_price_sheet_items SET review_status = 'approved'
    WHERE price_sheet_id = v_sheet.id AND review_status = 'pending';
    GET DIAGNOSTICS v_auto_items = ROW_COUNT;
    UPDATE public.qb_price_sheet_programs SET review_status = 'approved'
    WHERE price_sheet_id = v_sheet.id AND review_status = 'pending';
    GET DIAGNOSTICS v_auto_programs = ROW_COUNT;
  END IF;

  FOR v_item IN
    SELECT * FROM public.qb_price_sheet_items
    WHERE price_sheet_id = v_sheet.id AND review_status = 'approved'
    ORDER BY id FOR UPDATE
  LOOP
    v_compatible_ids := NULL;
    IF v_item.action = 'skip' THEN
      UPDATE public.qb_price_sheet_items SET applied_at = v_now WHERE id = v_item.id;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_item.extracted) <> 'object' THEN
      RAISE EXCEPTION 'price-sheet item % extracted payload must be an object', v_item.id USING ERRCODE = '22023';
    END IF;
    v_extracted := v_item.extracted;

    IF v_item.item_type = 'model' AND v_item.action = 'create' THEN
      IF NULLIF(v_extracted ->> 'model_code', '') IS NULL
         OR NULLIF(v_extracted ->> 'list_price_cents', '') IS NULL THEN
        RAISE EXCEPTION 'model item % lacks model_code or list_price_cents', v_item.id USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.qb_equipment_models(
        workspace_id, brand_id, model_code, family, name_display,
        standard_config, list_price_cents, specs, active
      ) VALUES (
        v_sheet.workspace_id, v_sheet.brand_id, v_extracted ->> 'model_code',
        NULLIF(v_extracted ->> 'family', ''),
        COALESCE(NULLIF(v_extracted ->> 'name_display', ''), v_extracted ->> 'model_code'),
        NULLIF(v_extracted ->> 'standard_config', ''),
        (v_extracted ->> 'list_price_cents')::bigint,
        CASE WHEN public.qb_has_meaningful_catalog_specs(v_extracted -> 'specs')
          THEN v_extracted -> 'specs' ELSE NULL END,
        true
      );
    ELSIF v_item.item_type = 'model' AND v_item.action = 'update' THEN
      IF v_item.proposed_model_id IS NULL THEN
        RAISE EXCEPTION 'model update % has no proposed_model_id', v_item.id USING ERRCODE = '22023';
      END IF;
      UPDATE public.qb_equipment_models model SET
        list_price_cents = CASE WHEN v_extracted ? 'list_price_cents' THEN (v_extracted ->> 'list_price_cents')::bigint ELSE model.list_price_cents END,
        family = CASE WHEN v_extracted ? 'family' THEN NULLIF(v_extracted ->> 'family', '') ELSE model.family END,
        name_display = CASE WHEN v_extracted ? 'name_display' THEN COALESCE(NULLIF(v_extracted ->> 'name_display', ''), model.name_display) ELSE model.name_display END,
        standard_config = CASE WHEN v_extracted ? 'standard_config' THEN NULLIF(v_extracted ->> 'standard_config', '') ELSE model.standard_config END,
        specs = CASE WHEN public.qb_has_meaningful_catalog_specs(v_extracted -> 'specs')
          THEN v_extracted -> 'specs' ELSE model.specs END
      WHERE model.id = v_item.proposed_model_id
        AND model.workspace_id = v_sheet.workspace_id
        AND model.brand_id = v_sheet.brand_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'model update % target is outside sheet scope', v_item.id USING ERRCODE = '42501'; END IF;
    ELSIF v_item.item_type = 'attachment' AND v_item.action = 'create' THEN
      IF NULLIF(v_extracted ->> 'part_number', '') IS NULL
         OR NULLIF(v_extracted ->> 'name', '') IS NULL
         OR NULLIF(v_extracted ->> 'list_price_cents', '') IS NULL THEN
        RAISE EXCEPTION 'attachment item % lacks required catalog fields', v_item.id USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(model.id ORDER BY model.id) INTO v_compatible_ids
      FROM public.qb_equipment_models model
      WHERE model.workspace_id = v_sheet.workspace_id AND model.brand_id = v_sheet.brand_id
        AND model.model_code IN (
          SELECT value FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(v_extracted -> 'compatible_model_codes') = 'array'
              THEN v_extracted -> 'compatible_model_codes' ELSE '[]'::jsonb END
          ) value
        );
      INSERT INTO public.qb_attachments(
        workspace_id, brand_id, part_number, name, category, list_price_cents,
        compatible_model_ids, attachment_type, active
      ) VALUES (
        v_sheet.workspace_id, v_sheet.brand_id, v_extracted ->> 'part_number',
        v_extracted ->> 'name', NULLIF(v_extracted ->> 'category', ''),
        (v_extracted ->> 'list_price_cents')::bigint, v_compatible_ids,
        NULLIF(v_extracted ->> 'attachment_type', ''), true
      );
    ELSIF v_item.item_type = 'attachment' AND v_item.action = 'update' THEN
      IF v_item.proposed_attachment_id IS NULL THEN
        RAISE EXCEPTION 'attachment update % has no proposed_attachment_id', v_item.id USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_extracted -> 'compatible_model_codes') = 'array'
         AND jsonb_array_length(v_extracted -> 'compatible_model_codes') > 0 THEN
        SELECT array_agg(model.id ORDER BY model.id) INTO v_compatible_ids
        FROM public.qb_equipment_models model
        WHERE model.workspace_id = v_sheet.workspace_id AND model.brand_id = v_sheet.brand_id
          AND model.model_code IN (
            SELECT value FROM jsonb_array_elements_text(
              v_extracted -> 'compatible_model_codes'
            ) value
          );
      END IF;
      UPDATE public.qb_attachments attachment SET
        list_price_cents = CASE WHEN v_extracted ? 'list_price_cents' THEN (v_extracted ->> 'list_price_cents')::bigint ELSE attachment.list_price_cents END,
        name = CASE WHEN v_extracted ? 'name' THEN COALESCE(NULLIF(v_extracted ->> 'name', ''), attachment.name) ELSE attachment.name END,
        category = CASE WHEN v_extracted ? 'category' THEN NULLIF(v_extracted ->> 'category', '') ELSE attachment.category END,
        attachment_type = CASE WHEN v_extracted ? 'attachment_type' THEN NULLIF(v_extracted ->> 'attachment_type', '') ELSE attachment.attachment_type END,
        compatible_model_ids = CASE WHEN cardinality(v_compatible_ids) > 0
          THEN v_compatible_ids ELSE attachment.compatible_model_ids END
      WHERE attachment.id = v_item.proposed_attachment_id
        AND attachment.workspace_id = v_sheet.workspace_id
        AND attachment.brand_id = v_sheet.brand_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'attachment update % target is outside sheet scope', v_item.id USING ERRCODE = '42501'; END IF;
    ELSIF v_item.item_type = 'freight' AND v_item.action IN ('create', 'update') THEN
      v_state_codes := ARRAY(
        SELECT DISTINCT upper(btrim(value))
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_extracted -> 'state_codes') = 'array'
            THEN v_extracted -> 'state_codes' ELSE '[]'::jsonb END
        ) value
        WHERE btrim(value) <> '' ORDER BY upper(btrim(value))
      );
      IF cardinality(v_state_codes) = 0
         OR NULLIF(v_extracted ->> 'freight_large_cents', '') IS NULL
         OR NULLIF(v_extracted ->> 'freight_small_cents', '') IS NULL THEN
        RAISE EXCEPTION 'freight item % lacks state/rate context', v_item.id USING ERRCODE = '22023';
      END IF;
      IF v_item.action = 'create' THEN
        INSERT INTO public.qb_freight_zones(
          workspace_id, brand_id, zone_name, state_codes,
          freight_large_cents, freight_small_cents, effective_from, effective_to
        ) VALUES (
          v_sheet.workspace_id, v_sheet.brand_id,
          COALESCE(NULLIF(v_extracted ->> 'zone_name', ''), array_to_string(v_state_codes, '/')),
          v_state_codes, (v_extracted ->> 'freight_large_cents')::bigint,
          (v_extracted ->> 'freight_small_cents')::bigint,
          v_sheet.effective_from, v_sheet.effective_to
        );
      ELSE
        SELECT zone.id INTO v_target_id
        FROM public.qb_freight_zones zone
        WHERE zone.workspace_id = v_sheet.workspace_id AND zone.brand_id = v_sheet.brand_id
          AND zone.state_codes @> v_state_codes
        ORDER BY zone.id LIMIT 1 FOR UPDATE;
        IF v_target_id IS NULL THEN
          RAISE EXCEPTION 'freight update % has no in-scope target', v_item.id USING ERRCODE = 'P0002';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.qb_freight_zones zone
          WHERE zone.workspace_id = v_sheet.workspace_id AND zone.brand_id = v_sheet.brand_id
            AND zone.state_codes @> v_state_codes AND zone.id <> v_target_id
        ) THEN
          RAISE EXCEPTION 'freight update % has ambiguous targets', v_item.id USING ERRCODE = '21000';
        END IF;
        UPDATE public.qb_freight_zones SET
          freight_large_cents = (v_extracted ->> 'freight_large_cents')::bigint,
          freight_small_cents = (v_extracted ->> 'freight_small_cents')::bigint,
          zone_name = COALESCE(NULLIF(v_extracted ->> 'zone_name', ''), zone_name),
          effective_from = v_sheet.effective_from,
          effective_to = v_sheet.effective_to
        WHERE id = v_target_id;
      END IF;
    ELSIF v_item.item_type NOT IN ('model', 'attachment', 'freight', 'note') THEN
      RAISE EXCEPTION 'unsupported price-sheet item type %', v_item.item_type USING ERRCODE = '22023';
    END IF;

    UPDATE public.qb_price_sheet_items SET applied_at = v_now WHERE id = v_item.id;
    v_items_applied := v_items_applied + 1;
  END LOOP;

  FOR v_program IN
    SELECT * FROM public.qb_price_sheet_programs
    WHERE price_sheet_id = v_sheet.id AND review_status = 'approved'
    ORDER BY id FOR UPDATE
  LOOP
    IF v_program.action = 'skip' THEN
      UPDATE public.qb_price_sheet_programs SET applied_at = v_now WHERE id = v_program.id;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_program.extracted) <> 'object' THEN
      RAISE EXCEPTION 'program % extracted payload must be an object', v_program.id USING ERRCODE = '22023';
    END IF;
    v_extracted := v_program.extracted;
    v_details := public.normalize_qb_program_details_atomic(
      v_program.program_type,
      CASE WHEN jsonb_typeof(v_extracted -> 'details') = 'object' THEN v_extracted -> 'details' ELSE '{}'::jsonb END
    );
    v_effective_from := COALESCE(v_sheet.effective_from, current_date);
    v_effective_to := COALESCE(v_sheet.effective_to, current_date + 90);
    IF v_program.action = 'create' THEN
      INSERT INTO public.qb_programs(
        workspace_id, brand_id, program_code, program_type, name,
        effective_from, effective_to, details, active
      ) VALUES (
        v_sheet.workspace_id, v_sheet.brand_id, v_program.program_code,
        v_program.program_type,
        COALESCE(NULLIF(v_extracted ->> 'name', ''), v_program.program_code),
        v_effective_from, v_effective_to, v_details, true
      );
    ELSIF v_program.action = 'update' THEN
      IF v_program.proposed_program_id IS NULL THEN
        RAISE EXCEPTION 'program update % has no proposed_program_id', v_program.id USING ERRCODE = '22023';
      END IF;
      UPDATE public.qb_programs program SET
        name = COALESCE(NULLIF(v_extracted ->> 'name', ''), program.name),
        effective_from = v_effective_from,
        effective_to = v_effective_to,
        details = CASE WHEN jsonb_typeof(v_extracted -> 'details') = 'object'
          THEN v_details ELSE program.details END,
        active = true
      WHERE program.id = v_program.proposed_program_id
        AND program.workspace_id = v_sheet.workspace_id
        AND program.brand_id = v_sheet.brand_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'program update % target is outside sheet scope', v_program.id USING ERRCODE = '42501'; END IF;
    END IF;
    UPDATE public.qb_price_sheet_programs SET applied_at = v_now WHERE id = v_program.id;
    v_programs_applied := v_programs_applied + 1;
  END LOOP;

  UPDATE public.qb_price_sheets prior SET status = 'superseded'
  FROM public.qb_price_sheet_lineage lineage
  WHERE lineage.price_sheet_id = v_sheet.id
    AND lineage.predecessor_price_sheet_id = prior.id
    AND prior.status = 'published'
    AND (
      COALESCE(v_sheet.sheet_type, 'price_book') = 'both'
      OR COALESCE(prior.sheet_type, 'price_book') <> 'both'
    );

  UPDATE public.qb_price_sheets SET
    status = 'published', published_at = v_now,
    reviewed_by = p_actor_id, reviewed_at = v_now
  WHERE id = v_sheet.id;

  RETURN jsonb_build_object(
    'priceSheetId', v_sheet.id,
    'status', 'published',
    'idempotent', false,
    'itemsApplied', v_items_applied,
    'programsApplied', v_programs_applied,
    'itemsSkipped', 0,
    'programsSkipped', 0,
    'autoApproved', jsonb_build_object('items', v_auto_items, 'programs', v_auto_programs)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_qb_program_details_atomic(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.qb_has_meaningful_catalog_specs(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.publish_qb_price_sheet_atomic(text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_qb_price_sheet_atomic(text, uuid, uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.persist_qb_oem_price_change_event(
  p_workspace_id text,
  p_brand_id uuid,
  p_price_sheet_id uuid,
  p_publish_group_id uuid,
  p_created_by uuid,
  p_source_metadata jsonb,
  p_effective_date date,
  p_quote_pricing_epoch bigint,
  p_materiality_rule jsonb,
  p_approval_policy jsonb,
  p_streams jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sheet public.qb_price_sheets%ROWTYPE;
  v_stream jsonb;
  v_stream_kind text;
  v_prior_price_sheet_id uuid;
  v_items jsonb;
  v_impacts jsonb;
  v_event_id uuid;
  v_new_event_ids uuid[] := '{}'::uuid[];
  v_existing_event_ids uuid[] := '{}'::uuid[];
  v_prior_event_ids uuid[] := '{}'::uuid[];
  v_rebuild_quote_ids uuid[] := '{}'::uuid[];
  v_touched_quote_ids uuid[] := '{}'::uuid[];
  v_input_line_ids uuid[] := '{}'::uuid[];
  v_input_impact_count integer := 0;
  v_locked_impact_count integer := 0;
  v_brand_code text;
  v_brand_name text;
  v_brand_code_normalized text;
  v_brand_name_normalized text;
  v_item_count integer := 0;
  v_impact_count integer := 0;
  v_visible_count integer := 0;
  v_current_epoch bigint;
  v_event_ids_json jsonb := '{}'::jsonb;
  v_requote_reason constant text := 'OEM price update created a material reprice impact for this quote.';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'persist_qb_oem_price_change_event requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_workspace_id), '') IS NULL OR p_brand_id IS NULL
     OR p_price_sheet_id IS NULL OR p_publish_group_id IS NULL THEN
    RAISE EXCEPTION 'workspace, brand, price sheet, and publish group are required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_streams, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_streams) = 0 THEN
    RAISE EXCEPTION 'streams must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(p_source_metadata, '{}'::jsonb) @> '{"scan_complete": true}'::jsonb THEN
    RAISE EXCEPTION 'OEM scan is incomplete; refusing partial persistence'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE((p_materiality_rule ->> 'line_pct_gt')::numeric, 2) <> 2
     OR COALESCE((p_materiality_rule ->> 'quote_delta_cents_gt')::bigint, 100000) <> 100000 THEN
    RAISE EXCEPTION 'OEM materiality policy must remain strict >2%% OR >$1,000'
      USING ERRCODE = '22023';
  END IF;

  IF p_quote_pricing_epoch IS NULL OR p_quote_pricing_epoch < 0 THEN
    RAISE EXCEPTION 'quote-pricing epoch is required' USING ERRCODE = '22023';
  END IF;

  -- Serialize publishers for this OEM. Apply/reversal uses the quote as its
  -- first row lock; this RPC follows the same quote-before-event ordering below.
  PERFORM pg_advisory_xact_lock(
    hashtext('qb_oem_event:' || p_workspace_id),
    hashtext(p_brand_id::text)
  );

  SELECT * INTO v_sheet
  FROM public.qb_price_sheets s
  WHERE s.id = p_price_sheet_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_sheet.workspace_id IS DISTINCT FROM p_workspace_id
     OR v_sheet.brand_id IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'price sheet is outside the requested workspace/OEM scope'
      USING ERRCODE = '42501';
  END IF;
  IF v_sheet.status <> 'published' THEN
    RAISE EXCEPTION 'price sheet must be published before impact persistence'
      USING ERRCODE = '55000';
  END IF;

  IF jsonb_array_length(p_streams) <> (
    SELECT count(*) FROM public.qb_price_sheet_lineage lineage
    WHERE lineage.price_sheet_id = p_price_sheet_id
  ) OR (
    SELECT count(DISTINCT stream ->> 'streamKind')
    FROM jsonb_array_elements(p_streams) stream
  ) <> jsonb_array_length(p_streams) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_streams) stream
    LEFT JOIN public.qb_price_sheet_lineage lineage
      ON lineage.price_sheet_id = p_price_sheet_id
     AND lineage.lane = stream ->> 'streamKind'
    WHERE lineage.price_sheet_id IS NULL
       OR lineage.workspace_id IS DISTINCT FROM p_workspace_id
       OR lineage.brand_id IS DISTINCT FROM p_brand_id
       OR lineage.predecessor_price_sheet_id IS DISTINCT FROM
          NULLIF(stream ->> 'priorPriceSheetId', '')::uuid
       OR jsonb_typeof(COALESCE(stream -> 'itemDiffs', 'null'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(stream -> 'impacts', 'null'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'price-sheet stream lineage changed; rebuild the canonical diff'
      USING ERRCODE = '40001';
  END IF;

  SELECT b.code, b.name
    INTO v_brand_code, v_brand_name
  FROM public.qb_brands b
  WHERE b.id = p_brand_id AND b.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM brand is outside the requested workspace'
      USING ERRCODE = '42501';
  END IF;
  v_brand_code_normalized := regexp_replace(upper(v_brand_code), '[^A-Z0-9]+', '', 'g');
  v_brand_name_normalized := regexp_replace(upper(v_brand_name), '[^A-Z0-9]+', '', 'g');

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'itemDiffs') entry
    WHERE entry -> 'metadata' ->> 'workspace_id' IS DISTINCT FROM p_workspace_id
       OR entry -> 'metadata' ->> 'brand_id' IS DISTINCT FROM p_brand_id::text
  ) THEN
    RAISE EXCEPTION 'canonical diff item is outside the requested workspace/OEM scope'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(event.id ORDER BY event.id), '{}'::uuid[])
    INTO v_existing_event_ids
  FROM public.qb_price_change_events event
  WHERE event.workspace_id = p_workspace_id
    AND event.price_sheet_id = p_price_sheet_id;

  IF cardinality(v_existing_event_ids) > 0 THEN
    IF cardinality(v_existing_event_ids) <> jsonb_array_length(p_streams)
       OR (SELECT count(DISTINCT event.publish_group_id)
           FROM public.qb_price_change_events event
           WHERE event.id = ANY(v_existing_event_ids)) <> 1
       OR EXISTS (
         SELECT 1 FROM public.qb_price_change_events event
         WHERE event.id = ANY(v_existing_event_ids)
           AND event.stream_kind NOT IN (
             SELECT stream ->> 'streamKind' FROM jsonb_array_elements(p_streams) stream
           )
       ) OR EXISTS (
         SELECT 1
         FROM public.qb_price_change_events event
         JOIN jsonb_array_elements(p_streams) stream
           ON stream ->> 'streamKind' = event.stream_kind
         WHERE event.id = ANY(v_existing_event_ids)
           AND event.prior_price_sheet_id IS DISTINCT FROM
               NULLIF(stream ->> 'priorPriceSheetId', '')::uuid
       ) THEN
      RAISE EXCEPTION 'existing publish group has an incomplete stream set'
        USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.qb_price_change_events event
      WHERE event.id = ANY(v_existing_event_ids)
        AND event.status IN ('active', 'closed')
    ) AND EXISTS (
      SELECT 1 FROM public.qb_price_change_events event
      WHERE event.id = ANY(v_existing_event_ids)
        AND event.status IN ('building', 'failed')
    ) THEN
      RAISE EXCEPTION 'existing publish group mixes terminal and rebuildable streams'
        USING ERRCODE = '40001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.qb_price_change_events event
      WHERE event.id = ANY(v_existing_event_ids)
        AND event.status NOT IN ('active', 'closed')
    ) THEN
      SELECT jsonb_object_agg(event.stream_kind, event.id ORDER BY event.stream_kind)
        INTO v_event_ids_json
      FROM public.qb_price_change_events event
      WHERE event.id = ANY(v_existing_event_ids);
      RETURN jsonb_build_object(
        'event_id', COALESCE(v_event_ids_json ->> 'price_book', v_event_ids_json ->> 'retail_programs'),
        'event_ids', v_event_ids_json,
        'publish_group_id', (SELECT min(event.publish_group_id::text)::uuid FROM public.qb_price_change_events event WHERE event.id = ANY(v_existing_event_ids)),
        'idempotent', true,
        'status', 'active'
      );
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.qb_price_change_events event
      WHERE event.id = ANY(v_existing_event_ids) AND event.status = 'superseded'
    ) THEN
      RAISE EXCEPTION 'published event was superseded and cannot be rebuilt'
        USING ERRCODE = '55000';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT impact.quote_package_id ORDER BY impact.quote_package_id), '{}'::uuid[])
      INTO v_rebuild_quote_ids
    FROM public.qb_quote_reprice_impacts impact
    WHERE impact.event_id = ANY(v_existing_event_ids);
  END IF;

  -- Read IDs without row locks first so the shared mutation order remains
  -- quote -> child/context -> pricing epoch -> event -> impact.
  SELECT COALESCE(array_agg(event.id ORDER BY event.id), '{}'::uuid[])
    INTO v_prior_event_ids
  FROM public.qb_price_change_events event
  WHERE event.workspace_id = p_workspace_id
    AND event.brand_id = p_brand_id
    AND event.status = 'active'
    AND event.stream_kind IN (
      SELECT stream ->> 'streamKind' FROM jsonb_array_elements(p_streams) stream
    );

  SELECT count(*) INTO v_input_impact_count
  FROM jsonb_array_elements(p_streams) stream
  CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact;
  IF (
    SELECT count(*)
    FROM (
      SELECT DISTINCT stream ->> 'streamKind', (impact ->> 'quotePackageId')::uuid
      FROM jsonb_array_elements(p_streams) stream
      CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    ) distinct_impacts
  ) <> v_input_impact_count THEN
    RAISE EXCEPTION 'impact payload contains duplicate quote packages within a stream'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT quote_id ORDER BY quote_id), '{}'::uuid[])
    INTO v_touched_quote_ids
  FROM (
    SELECT (impact ->> 'quotePackageId')::uuid AS quote_id
    FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    UNION
    SELECT i.quote_package_id
    FROM public.qb_quote_reprice_impacts i
    WHERE i.event_id = ANY(v_prior_event_ids)
    UNION
    SELECT unnest(v_rebuild_quote_ids)
  ) touched;

  -- Every transaction takes quote locks in UUID order. Cross-brand scans that
  -- touch the same packages therefore queue deterministically instead of
  -- deadlocking or racing the shared requires_requote flag.
  PERFORM 1
  FROM public.quote_packages q
  WHERE q.id = ANY(v_touched_quote_ids)
  ORDER BY q.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(DISTINCT (line_input ->> 'quotePackageLineItemId')::uuid ORDER BY (line_input ->> 'quotePackageLineItemId')::uuid), '{}'::uuid[])
    INTO v_input_line_ids
  FROM jsonb_array_elements(p_streams) stream
  CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(impact -> 'lines', '[]'::jsonb)) line_input
  WHERE NULLIF(line_input ->> 'quotePackageLineItemId', '') IS NOT NULL;

  PERFORM 1 FROM public.quote_package_line_items line
  WHERE line.id = ANY(v_input_line_ids)
  ORDER BY line.id FOR SHARE;

  PERFORM 1 FROM public.qrm_deals deal
  WHERE deal.id IN (
    SELECT quote.deal_id FROM public.quote_packages quote
    WHERE quote.id = ANY(v_touched_quote_ids) AND quote.deal_id IS NOT NULL
  )
  ORDER BY deal.id FOR SHARE;

  PERFORM 1 FROM public.qrm_companies company
  WHERE company.id IN (
    SELECT deal.company_id
    FROM public.quote_packages quote
    JOIN public.qrm_deals deal ON deal.id = quote.deal_id
    WHERE quote.id = ANY(v_touched_quote_ids) AND deal.company_id IS NOT NULL
  )
  ORDER BY company.id FOR SHARE;

  INSERT INTO public.qb_quote_pricing_epochs(workspace_id, quote_package_id)
  SELECT p_workspace_id, quote_id
  FROM unnest(v_touched_quote_ids) quote_id
  ON CONFLICT (workspace_id, quote_package_id) DO NOTHING;
  PERFORM 1
  FROM public.qb_quote_pricing_epochs epoch
  WHERE epoch.workspace_id = p_workspace_id
    AND epoch.quote_package_id = ANY(v_touched_quote_ids)
  ORDER BY epoch.quote_package_id
  FOR UPDATE;

  INSERT INTO public.qb_workspace_pricing_epochs(workspace_id)
  VALUES (p_workspace_id) ON CONFLICT (workspace_id) DO NOTHING;
  SELECT epoch INTO v_current_epoch
  FROM public.qb_workspace_pricing_epochs
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;
  IF v_current_epoch IS DISTINCT FROM p_quote_pricing_epoch THEN
    RAISE EXCEPTION 'OEM_SCAN_CONFLICT: quote-pricing epoch changed from % to %',
      p_quote_pricing_epoch, v_current_epoch USING ERRCODE = '40001';
  END IF;

  -- Lock events only after quote/context rows, matching A7.7/A7.9 apply order.
  PERFORM 1 FROM public.qb_price_change_events event
  WHERE event.id = ANY(v_existing_event_ids || v_prior_event_ids)
  ORDER BY event.id FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.qb_price_change_events event
    JOIN jsonb_array_elements(p_streams) stream
      ON stream ->> 'streamKind' = event.stream_kind
    WHERE event.id = ANY(v_prior_event_ids)
      AND event.price_sheet_id IS DISTINCT FROM NULLIF(stream ->> 'priorPriceSheetId', '')::uuid
  ) THEN
    RAISE EXCEPTION 'active OEM stream changed after lineage resolution'
      USING ERRCODE = '40001';
  END IF;

  IF cardinality(v_existing_event_ids) > 0 THEN
    DELETE FROM public.qb_price_change_events event
    WHERE event.id = ANY(v_existing_event_ids)
      AND event.status IN ('building', 'failed');
  END IF;

  SELECT count(*) INTO v_locked_impact_count
  FROM public.quote_packages q
  JOIN (
    SELECT impact FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
  ) input ON q.id = (input.impact ->> 'quotePackageId')::uuid
  WHERE q.workspace_id = p_workspace_id;
  IF v_locked_impact_count <> v_input_impact_count THEN
    RAISE EXCEPTION 'one or more impacted quotes are missing or cross-workspace'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_packages q
    JOIN (
      SELECT impact FROM jsonb_array_elements(p_streams) stream
      CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    ) input ON q.id = (input.impact ->> 'quotePackageId')::uuid
    WHERE q.workspace_id = p_workspace_id
      AND (
        q.updated_at IS DISTINCT FROM (input.impact ->> 'quoteUpdatedAtSnapshot')::timestamptz
        OR q.status IS DISTINCT FROM input.impact ->> 'quoteStatusSnapshot'
      )
  ) THEN
    RAISE EXCEPTION 'OEM_SCAN_CONFLICT: quote package changed during scan'
      USING ERRCODE = '40001';
  END IF;

  -- Re-check brand scope inside the transaction. A model code alone is never
  -- sufficient: at least one current canonical/legacy line must carry the
  -- exact normalized OEM code or name.
  IF EXISTS (
    SELECT 1
    FROM public.quote_packages q
    JOIN (
      SELECT impact FROM jsonb_array_elements(p_streams) stream
      CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    ) input ON q.id = (input.impact ->> 'quotePackageId')::uuid
    WHERE NOT (
      (
        EXISTS (
          SELECT 1 FROM public.quote_package_line_items any_line
          WHERE any_line.quote_package_id = q.id
            AND any_line.workspace_id = p_workspace_id
        )
        AND EXISTS (
          SELECT 1
          FROM public.quote_package_line_items line
          WHERE line.quote_package_id = q.id
            AND line.workspace_id = p_workspace_id
            AND line.line_type = 'equipment'
            AND regexp_replace(upper(COALESCE(line.make, '')), '[^A-Z0-9]+', '', 'g')
                IN (v_brand_code_normalized, v_brand_name_normalized)
        )
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.quote_package_line_items any_line
          WHERE any_line.quote_package_id = q.id
            AND any_line.workspace_id = p_workspace_id
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(q.equipment) = 'array' THEN q.equipment ELSE '[]'::jsonb END
          ) legacy
          WHERE regexp_replace(upper(COALESCE(legacy ->> 'make', legacy ->> 'brand', '')), '[^A-Z0-9]+', '', 'g')
                IN (v_brand_code_normalized, v_brand_name_normalized)
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'one or more impacts do not match the requested OEM brand'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(impact -> 'lines', '[]'::jsonb)) line_input
    WHERE NULLIF(line_input ->> 'quotePackageLineItemId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.quote_package_line_items line
        WHERE line.id = (line_input ->> 'quotePackageLineItemId')::uuid
          AND line.quote_package_id = (impact ->> 'quotePackageId')::uuid
          AND line.workspace_id = p_workspace_id
          AND line.line_type = 'equipment'
          AND regexp_replace(upper(COALESCE(line.make, '')), '[^A-Z0-9]+', '', 'g')
              IN (v_brand_code_normalized, v_brand_name_normalized)
          AND regexp_replace(upper(COALESCE(line.model, '')), '[^A-Z0-9]+', '', 'g')
              = regexp_replace(upper(COALESCE(line_input ->> 'modelCode', '')), '[^A-Z0-9]+', '', 'g')
          AND line.quantity IS NOT DISTINCT FROM COALESCE((line_input -> 'quoteLineSnapshot' ->> 'quantity')::integer, 1)
          AND CASE WHEN NULLIF(line_input -> 'quoteLineSnapshot' ->> 'quoted_list_price_cents', '') IS NULL
                THEN line.quoted_list_price IS NULL
                ELSE round(line.quoted_list_price * 100)::bigint = (line_input -> 'quoteLineSnapshot' ->> 'quoted_list_price_cents')::bigint END
          AND CASE WHEN NULLIF(line_input -> 'quoteLineSnapshot' ->> 'quoted_dealer_cost_cents', '') IS NULL
                THEN line.quoted_dealer_cost IS NULL
                ELSE round(line.quoted_dealer_cost * 100)::bigint = (line_input -> 'quoteLineSnapshot' ->> 'quoted_dealer_cost_cents')::bigint END
          AND line.source_location IS NOT DISTINCT FROM NULLIF(line_input -> 'quoteLineSnapshot' ->> 'source_location', '')
      )
  ) THEN
    RAISE EXCEPTION 'OEM_SCAN_CONFLICT: an impacted quote line changed during scan'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    JOIN public.quote_packages quote ON quote.id = (impact ->> 'quotePackageId')::uuid
    LEFT JOIN public.qrm_deals deal
      ON deal.id = quote.deal_id AND deal.workspace_id = p_workspace_id
    WHERE (quote.deal_id IS NOT NULL AND (deal.id IS NULL OR deal.deleted_at IS NOT NULL))
       OR deal.company_id IS DISTINCT FROM NULLIF(impact ->> 'customerCompanyId', '')::uuid
       OR COALESCE(deal.assigned_rep_id, quote.created_by)
          IS DISTINCT FROM NULLIF(impact ->> 'assignedRepId', '')::uuid
  ) THEN
    RAISE EXCEPTION 'OEM_SCAN_CONFLICT: deal assignment or customer changed during scan'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_streams) stream
    CROSS JOIN LATERAL jsonb_array_elements(stream -> 'impacts') impact
    JOIN public.quote_packages quote
      ON quote.id = (impact ->> 'quotePackageId')::uuid
    JOIN public.qrm_deals deal
      ON deal.id = quote.deal_id
     AND deal.workspace_id = p_workspace_id
     AND deal.deleted_at IS NULL
    WHERE deal.company_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.qrm_companies company
        WHERE company.id = deal.company_id
          AND company.workspace_id = p_workspace_id
          AND company.deleted_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'OEM_SCAN_CONFLICT: current customer company is inactive or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  FOR v_stream IN
    SELECT value FROM jsonb_array_elements(p_streams)
    ORDER BY CASE value ->> 'streamKind' WHEN 'price_book' THEN 1 ELSE 2 END
  LOOP
    v_stream_kind := v_stream ->> 'streamKind';
    v_prior_price_sheet_id := NULLIF(v_stream ->> 'priorPriceSheetId', '')::uuid;
    v_items := v_stream -> 'itemDiffs';
    v_impacts := v_stream -> 'impacts';

    INSERT INTO public.qb_price_change_events (
      workspace_id, brand_id, price_sheet_id, prior_price_sheet_id,
      publish_group_id, stream_kind, source_type, source_metadata,
      effective_date, materiality_rule, approval_policy, status,
      created_by, published_at
    ) VALUES (
      p_workspace_id, p_brand_id, p_price_sheet_id, v_prior_price_sheet_id,
      p_publish_group_id, v_stream_kind, 'manual_upload',
      COALESCE(p_source_metadata, '{}'::jsonb) || jsonb_build_object('stream_kind', v_stream_kind),
      p_effective_date, p_materiality_rule, p_approval_policy, 'building',
      p_created_by, now()
    ) RETURNING id INTO v_event_id;
    v_new_event_ids := array_append(v_new_event_ids, v_event_id);
    v_event_ids_json := v_event_ids_json || jsonb_build_object(v_stream_kind, v_event_id);

    INSERT INTO public.qb_price_change_items (
    event_id, workspace_id, item_type, model_code, normalized_code,
    name_display, old_price_cents, new_price_cents, delta_cents,
    delta_pct, change_kind, prior_item_id, new_item_id, metadata
  )
  SELECT
    v_event_id,
    p_workspace_id,
    entry ->> 'itemType',
    NULLIF(entry ->> 'modelCode', ''),
    NULLIF(entry ->> 'normalizedCode', ''),
    NULLIF(entry ->> 'nameDisplay', ''),
    NULLIF(entry ->> 'oldPriceCents', '')::bigint,
    NULLIF(entry ->> 'newPriceCents', '')::bigint,
    COALESCE((entry ->> 'deltaCents')::bigint, 0),
    NULLIF(entry ->> 'deltaPct', '')::numeric,
    entry ->> 'changeKind',
    NULLIF(entry ->> 'priorItemId', '')::uuid,
    NULLIF(entry ->> 'newItemId', '')::uuid,
    COALESCE(entry -> 'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(v_items) entry;
    GET DIAGNOSTICS v_locked_impact_count = ROW_COUNT;
    v_item_count := v_item_count + v_locked_impact_count;

  WITH impact_input AS (
    SELECT
      entry,
      (entry ->> 'quotePackageId')::uuid AS quote_id,
      ARRAY(
        SELECT category
        FROM (
          SELECT jsonb_array_elements_text(
            COALESCE(entry -> 'changeCategories', '[]'::jsonb)
          ) AS category
          UNION ALL
          SELECT 'list_price'
          WHERE jsonb_array_length(COALESCE(entry -> 'lines', '[]'::jsonb)) > 0
          UNION ALL
          SELECT catalog_change ->> 'itemType'
          FROM jsonb_array_elements(
            COALESCE(entry -> 'catalogChanges', '[]'::jsonb)
          ) catalog_change
        ) categories
        WHERE category IN ('list_price', 'freight', 'rebate', 'incentive')
        GROUP BY category
        ORDER BY CASE category
          WHEN 'list_price' THEN 1
          WHEN 'freight' THEN 2
          WHEN 'rebate' THEN 3
          WHEN 'incentive' THEN 4
        END
      )::text[] AS categories,
      COALESCE((
        SELECT sum(COALESCE((line_input ->> 'deltaCents')::bigint, 0))
        FROM jsonb_array_elements(COALESCE(entry -> 'lines', '[]'::jsonb)) line_input
        WHERE NOT (
          COALESCE(line_input ->> 'sourceLocation' = 'yard_stock', false)
          OR COALESCE((line_input ->> 'isYardStock')::boolean, false)
        )
      ), 0) AS calculated_delta,
      COALESCE((
        SELECT max(abs(
          (
            (line_input ->> 'newListPriceCents')::numeric
            - (line_input ->> 'oldListPriceCents')::numeric
          ) / NULLIF((line_input ->> 'oldListPriceCents')::numeric, 0) * 100
        ))
        FROM jsonb_array_elements(COALESCE(entry -> 'lines', '[]'::jsonb)) line_input
        WHERE NULLIF(line_input ->> 'oldListPriceCents', '') IS NOT NULL
          AND NULLIF(line_input ->> 'newListPriceCents', '') IS NOT NULL
          AND NOT (
            COALESCE(line_input ->> 'sourceLocation' = 'yard_stock', false)
            OR COALESCE((line_input ->> 'isYardStock')::boolean, false)
          )
      ), 0) AS calculated_line_pct
    FROM jsonb_array_elements(v_impacts) entry
  ), current_context AS (
    SELECT
      input.*,
      quote.deal_id,
      quote.created_by,
      quote.status,
      quote.updated_at,
      deal.assigned_rep_id,
      deal.company_id,
      company.price_lock_reason,
      company.price_lock_expires_at,
      (
        company.id IS NOT NULL
        AND company.deleted_at IS NULL
        AND company.price_lock_active = true
        AND (company.price_lock_expires_at IS NULL OR company.price_lock_expires_at >= current_date)
      ) AS customer_lock_active
    FROM impact_input input
    JOIN public.quote_packages quote ON quote.id = input.quote_id
    LEFT JOIN public.qrm_deals deal
      ON deal.id = quote.deal_id AND deal.workspace_id = p_workspace_id
    LEFT JOIN public.qrm_companies company
      ON company.id = deal.company_id AND company.workspace_id = p_workspace_id
  ), computed AS (
    SELECT
      context.*,
      CASE WHEN context.customer_lock_active THEN 0
           ELSE context.calculated_delta
      END AS effective_delta,
      CASE WHEN context.customer_lock_active THEN 0::numeric
           ELSE context.calculated_line_pct
      END AS effective_line_pct
    FROM current_context context
  )
  INSERT INTO public.qb_quote_reprice_impacts (
    event_id, workspace_id, quote_package_id, deal_id, assigned_rep_id,
    quote_status_snapshot, quote_updated_at_snapshot, total_delta_cents,
    max_line_delta_pct, old_margin_pct, projected_margin_pct, margin_floor_pct,
    below_margin_floor, materiality_trigger, requires_manager_review,
    approval_required_reasons, old_commission_cents, projected_commission_cents,
    commission_delta_cents, state, change_categories, catalog_changes,
    context_snapshot, customer_company_id, suppressed_by_customer_lock,
    customer_price_lock_reason, customer_price_lock_expires_at
  )
  SELECT
    v_event_id,
    p_workspace_id,
    computed.quote_id,
    computed.deal_id,
    COALESCE(computed.assigned_rep_id, computed.created_by),
    computed.status,
    computed.updated_at,
    computed.effective_delta,
    NULLIF(computed.effective_line_pct, 0),
    NULLIF(computed.entry ->> 'oldMarginPct', '')::numeric,
    NULLIF(computed.entry ->> 'projectedMarginPct', '')::numeric,
    NULLIF(computed.entry ->> 'marginFloorPct', '')::numeric,
    COALESCE((computed.entry ->> 'belowMarginFloor')::boolean, false),
    CASE
      WHEN abs(computed.effective_line_pct) > 2 AND abs(computed.effective_delta) > 100000 THEN 'both'
      WHEN abs(computed.effective_line_pct) > 2 THEN 'line_pct'
      WHEN abs(computed.effective_delta) > 100000 THEN 'quote_delta'
      ELSE 'quiet'
    END,
    NOT computed.customer_lock_active AND cardinality(computed.categories) > 0,
    CASE WHEN computed.customer_lock_active THEN ARRAY['customer_price_lock']::text[]
         ELSE ARRAY(
           SELECT DISTINCT reason
           FROM jsonb_array_elements_text(
             COALESCE(computed.entry -> 'approvalRequiredReasons', '[]'::jsonb)
           ) AS reasons(reason)
           ORDER BY reason
         )
    END,
    NULLIF(computed.entry ->> 'oldCommissionCents', '')::bigint,
    NULLIF(computed.entry ->> 'projectedCommissionCents', '')::bigint,
    NULLIF(computed.entry ->> 'commissionDeltaCents', '')::bigint,
    CASE
      WHEN computed.customer_lock_active THEN 'quiet'
      WHEN abs(computed.effective_line_pct) > 2 OR abs(computed.effective_delta) > 100000 THEN 'visible'
      ELSE 'quiet'
    END,
    computed.categories,
    COALESCE(computed.entry -> 'catalogChanges', '[]'::jsonb),
    COALESCE(computed.entry -> 'contextSnapshot', '{}'::jsonb) || jsonb_build_object(
      'customer_company_id', computed.company_id,
      'customer_price_lock_active', computed.customer_lock_active,
      'customer_price_lock_reason', computed.price_lock_reason,
      'customer_price_lock_expires_at', computed.price_lock_expires_at
    ),
    computed.company_id,
    computed.customer_lock_active,
    computed.price_lock_reason,
    computed.price_lock_expires_at
  FROM computed;
    GET DIAGNOSTICS v_locked_impact_count = ROW_COUNT;
    v_impact_count := v_impact_count + v_locked_impact_count;

  INSERT INTO public.qb_quote_reprice_impact_lines (
    impact_id, quote_package_line_item_id, equipment_line_id, model_code,
    make, quantity, old_list_price_cents, new_list_price_cents, delta_cents,
    delta_pct, source_location, is_yard_stock, suppressed_by_stock_lock,
    suppression_reason, metadata
  )
  SELECT
    persisted.id,
    NULLIF(line_input ->> 'quotePackageLineItemId', '')::uuid,
    NULLIF(line_input ->> 'equipmentLineId', ''),
    line_input ->> 'modelCode',
    NULLIF(line_input ->> 'make', ''),
    GREATEST(COALESCE((line_input ->> 'quantity')::integer, 1), 1),
    NULLIF(line_input ->> 'oldListPriceCents', '')::bigint,
    NULLIF(line_input ->> 'newListPriceCents', '')::bigint,
    COALESCE((line_input ->> 'deltaCents')::bigint, 0),
    NULLIF(line_input ->> 'deltaPct', '')::numeric,
    NULLIF(line_input ->> 'sourceLocation', ''),
    (
      COALESCE(line_input ->> 'sourceLocation' = 'yard_stock', false)
      OR COALESCE((line_input ->> 'isYardStock')::boolean, false)
    ),
    (
      COALESCE(line_input ->> 'sourceLocation' = 'yard_stock', false)
      OR COALESCE((line_input ->> 'isYardStock')::boolean, false)
    ),
    CASE WHEN (
      COALESCE(line_input ->> 'sourceLocation' = 'yard_stock', false)
      OR COALESCE((line_input ->> 'isYardStock')::boolean, false)
    ) THEN 'yard_stock_price_locked' ELSE NULL END,
    COALESCE(line_input -> 'metadata', '{}'::jsonb) || jsonb_build_object(
      'quote_line_snapshot', COALESCE(line_input -> 'quoteLineSnapshot', '{}'::jsonb)
    )
  FROM jsonb_array_elements(v_impacts) impact_input
  JOIN public.qb_quote_reprice_impacts persisted
    ON persisted.event_id = v_event_id
   AND persisted.quote_package_id = (impact_input ->> 'quotePackageId')::uuid
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(impact_input -> 'lines', '[]'::jsonb)
    ) line_input;
  END LOOP;

  UPDATE public.qb_quote_reprice_impacts impact
  SET state = 'superseded'
  WHERE impact.event_id = ANY(v_prior_event_ids)
    AND impact.workspace_id = p_workspace_id
    AND impact.state IN ('visible', 'draft_created', 'approval_pending', 'approved');

  UPDATE public.qb_price_change_events event
  SET status = 'superseded'
  WHERE event.id = ANY(v_prior_event_ids);

  UPDATE public.qb_price_change_events
  SET status = 'active'
  WHERE id = ANY(v_new_event_ids);

  UPDATE public.quote_packages quote
  SET
    requires_requote = true,
    requote_reason = CASE
      WHEN quote.requires_requote = true
        AND quote.requote_reason IS NOT NULL
        AND quote.requote_reason <> v_requote_reason
      THEN quote.requote_reason
      ELSE v_requote_reason
    END
  WHERE quote.id = ANY(v_touched_quote_ids)
    AND quote.workspace_id = p_workspace_id
    AND EXISTS (
      SELECT 1
      FROM public.qb_quote_reprice_impacts impact
      JOIN public.qb_price_change_events event ON event.id = impact.event_id
      WHERE impact.quote_package_id = quote.id
        AND impact.workspace_id = p_workspace_id
        AND event.status = 'active'
        AND impact.state IN ('visible', 'draft_created', 'approval_pending', 'approved')
    );

  UPDATE public.quote_packages quote
  SET requires_requote = false, requote_reason = NULL
  WHERE quote.id = ANY(v_touched_quote_ids)
    AND quote.workspace_id = p_workspace_id
    AND quote.requote_reason = v_requote_reason
    AND NOT EXISTS (
      SELECT 1
      FROM public.qb_quote_reprice_impacts impact
      JOIN public.qb_price_change_events event ON event.id = impact.event_id
      WHERE impact.quote_package_id = quote.id
        AND impact.workspace_id = p_workspace_id
        AND event.status = 'active'
        AND impact.state IN ('visible', 'draft_created', 'approval_pending', 'approved')
    );

  SELECT count(*) INTO v_visible_count
  FROM public.qb_quote_reprice_impacts
  WHERE event_id = ANY(v_new_event_ids) AND state = 'visible';

  RETURN jsonb_build_object(
    'event_id', COALESCE(v_event_ids_json ->> 'price_book', v_event_ids_json ->> 'retail_programs'),
    'event_ids', v_event_ids_json,
    'publish_group_id', p_publish_group_id,
    'idempotent', false,
    'status', 'active',
    'item_count', v_item_count,
    'impact_count', v_impact_count,
    'visible_impact_count', v_visible_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_qb_oem_price_change_event(
  text, uuid, uuid, uuid, uuid, jsonb, date, bigint, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_qb_oem_price_change_event(
  text, uuid, uuid, uuid, uuid, jsonb, date, bigint, jsonb, jsonb, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.dismiss_qb_oem_reprice_impact(
  p_workspace_id text,
  p_impact_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_impact public.qb_quote_reprice_impacts%ROWTYPE;
  v_quote public.quote_packages%ROWTYPE;
  v_deal public.qrm_deals%ROWTYPE;
  v_current_assigned_rep_id uuid;
  v_event_status text;
  v_requote_reason constant text := 'OEM price update created a material reprice impact for this quote.';
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'dismiss_qb_oem_reprice_impact requires service_role'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = p_impact_id AND impact.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM impact not found' USING ERRCODE = 'P0002';
  END IF;

  -- Persistence takes quote locks before impact-row mutation. Dismiss follows
  -- the same order to avoid quote/impact lock inversion under concurrency.
  SELECT * INTO v_quote
  FROM public.quote_packages quote
  WHERE quote.id = v_impact.quote_package_id
    AND quote.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM impact quote is missing or cross-workspace'
      USING ERRCODE = '40001';
  END IF;

  IF v_quote.deal_id IS NOT NULL THEN
    SELECT * INTO v_deal
    FROM public.qrm_deals deal
    WHERE deal.id = v_quote.deal_id
      AND deal.workspace_id = p_workspace_id
      AND deal.deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OEM impact current deal is inactive or cross-workspace'
        USING ERRCODE = '40001';
    END IF;
    v_current_assigned_rep_id := COALESCE(
      v_deal.assigned_rep_id, v_quote.created_by
    );
  ELSE
    v_current_assigned_rep_id := v_quote.created_by;
  END IF;

  SELECT * INTO v_impact
  FROM public.qb_quote_reprice_impacts impact
  WHERE impact.id = p_impact_id AND impact.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OEM impact disappeared during dismiss'
      USING ERRCODE = '40001';
  END IF;
  SELECT status INTO v_event_status
  FROM public.qb_price_change_events
  WHERE id = v_impact.event_id;
  IF v_event_status <> 'active' THEN
    RAISE EXCEPTION 'OEM impact event is not active' USING ERRCODE = '55000';
  END IF;
  IF v_impact.quote_package_id IS DISTINCT FROM v_quote.id THEN
    RAISE EXCEPTION 'OEM impact quote changed during dismiss'
      USING ERRCODE = '40001';
  END IF;
  IF p_actor_role = 'rep'
     AND v_current_assigned_rep_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'OEM impact is assigned to another current rep'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_role NOT IN ('rep', 'admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'role cannot dismiss OEM impacts' USING ERRCODE = '42501';
  END IF;

  IF v_impact.state = 'dismissed' THEN
    RETURN jsonb_build_object('impact_id', v_impact.id, 'idempotent', true);
  END IF;
  IF v_impact.state NOT IN ('visible', 'quiet')
     AND p_actor_role NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'impact state requires an elevated dismiss override'
      USING ERRCODE = '55000';
  END IF;
  IF v_impact.state NOT IN (
    'visible', 'quiet', 'draft_created', 'approval_pending', 'approved'
  ) THEN
    RAISE EXCEPTION 'impact state cannot be dismissed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.qb_quote_reprice_impacts
  SET state = 'dismissed', dismissed_reason = NULLIF(btrim(p_reason), '')
  WHERE id = v_impact.id;

  UPDATE public.quote_packages quote
  SET requires_requote = false, requote_reason = NULL
  WHERE quote.id = v_impact.quote_package_id
    AND quote.workspace_id = p_workspace_id
    AND quote.requote_reason = v_requote_reason
    AND NOT EXISTS (
      SELECT 1
      FROM public.qb_quote_reprice_impacts impact
      JOIN public.qb_price_change_events event ON event.id = impact.event_id
      WHERE impact.quote_package_id = quote.id
        AND impact.workspace_id = p_workspace_id
        AND event.status = 'active'
        AND impact.state IN ('visible', 'draft_created', 'approval_pending', 'approved')
    );

  RETURN jsonb_build_object('impact_id', v_impact.id, 'idempotent', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_qb_oem_reprice_impact(
  text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_qb_oem_reprice_impact(
  text, uuid, uuid, text, text
) TO service_role;

COMMIT;
