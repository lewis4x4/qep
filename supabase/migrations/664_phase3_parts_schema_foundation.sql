-- ============================================================================
-- Migration 664: G1.1 Phase 3 Parts schema foundation
--
-- Purpose:
--   Add the literal Phase 3 Parts foundation objects from the Stream G roadmap
--   without replacing the existing parts_catalog / parts_orders /
--   parts_inventory / fulfillment spines. Existing production tables remain the
--   operational source for their current surfaces; these tables provide the
--   normalized foundation for the remaining G-slices.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Role helpers used by the new Phase 3 policies.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.qep_parts_staff_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (select auth.role()) = 'service_role'
    OR COALESCE((select public.get_my_role())::text, '') IN (
      'rep',
      'admin',
      'manager',
      'owner',
      'service_writer',
      'dispatch',
      'parts_counter',
      'finance_admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.qep_parts_operator_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (select auth.role()) = 'service_role'
    OR COALESCE((select public.get_my_role())::text, '') IN (
      'admin',
      'manager',
      'owner',
      'parts_counter'
    );
$$;

CREATE OR REPLACE FUNCTION public.qep_parts_admin_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (select auth.role()) = 'service_role'
    OR COALESCE((select public.get_my_role())::text, '') IN (
      'admin',
      'manager',
      'owner'
    );
$$;

COMMENT ON FUNCTION public.qep_parts_staff_role() IS
  'True for authenticated workspace staff allowed to read Phase 3 Parts operational reference data.';
COMMENT ON FUNCTION public.qep_parts_operator_role() IS
  'True for Parts Counter and elevated staff allowed to mutate Phase 3 Parts operational rows.';
COMMENT ON FUNCTION public.qep_parts_admin_role() IS
  'True for elevated staff allowed to mutate Phase 3 Parts configuration rows.';

REVOKE EXECUTE ON FUNCTION public.qep_parts_staff_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.qep_parts_operator_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.qep_parts_admin_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qep_parts_staff_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qep_parts_operator_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qep_parts_admin_role() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Parent-child guard: copy workspace_id from the parent header into child lines.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.qep_phase3_parts_child_workspace_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_table text := TG_ARGV[0];
  v_parent_column text := TG_ARGV[1];
  v_parent_id uuid;
  v_workspace_id text;
BEGIN
  v_parent_id := NULLIF(to_jsonb(NEW) ->> v_parent_column, '')::uuid;
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'missing parent id for %', TG_TABLE_NAME;
  END IF;

  EXECUTE format('SELECT workspace_id FROM public.%I WHERE id = $1', v_parent_table)
    INTO v_workspace_id
    USING v_parent_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'parent % not found for %', v_parent_table, TG_TABLE_NAME;
  END IF;

  NEW.workspace_id := v_workspace_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.qep_phase3_parts_child_workspace_from_parent() IS
  'Trigger helper that pins Phase 3 Parts child rows to their parent workspace before RLS evaluates writes.';

-- ----------------------------------------------------------------------------
-- Canonical part identity and storage topology.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  parts_catalog_id uuid REFERENCES public.parts_catalog(id) ON DELETE SET NULL,
  part_number text NOT NULL,
  description text,
  manufacturer text,
  category text,
  default_uom text NOT NULL DEFAULT 'EA',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'superseded', 'obsolete')),
  source text NOT NULL DEFAULT 'phase3_foundation' CHECK (
    source IN ('phase3_foundation', 'parts_catalog', 'intellidealer_import', 'manual', 'oem_portal')
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_part_number_present CHECK (length(btrim(part_number)) > 0)
);

COMMENT ON TABLE public.parts IS
  'Phase 3 canonical part identity. Complements parts_catalog, which remains the DMS/catalog import surface.';

CREATE UNIQUE INDEX IF NOT EXISTS parts_workspace_part_number_uidx
  ON public.parts (workspace_id, lower(part_number))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_catalog_bridge
  ON public.parts (parts_catalog_id)
  WHERE parts_catalog_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_search
  ON public.parts USING gin (
    to_tsvector('english',
      coalesce(part_number, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' ||
      coalesce(category, '')
    )
  )
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_phase3_service_all ON public.parts;
CREATE POLICY parts_phase3_service_all
  ON public.parts FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_phase3_staff_select ON public.parts;
CREATE POLICY parts_phase3_staff_select
  ON public.parts FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_phase3_operator_mutate ON public.parts;
CREATE POLICY parts_phase3_operator_mutate
  ON public.parts FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_updated_at ON public.parts;
CREATE TRIGGER set_parts_updated_at
  BEFORE UPDATE ON public.parts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  code text NOT NULL,
  name text NOT NULL,
  location_type text NOT NULL DEFAULT 'branch' CHECK (
    location_type IN ('branch', 'warehouse', 'counter', 'truck', 'vendor', 'customer', 'other')
  ),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  branch_slug text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_locations_code_present CHECK (length(btrim(code)) > 0)
);

COMMENT ON TABLE public.parts_locations IS
  'Physical or logical locations that can hold Phase 3 Parts stock: branches, counters, warehouses, trucks, vendors, or customers.';

CREATE UNIQUE INDEX IF NOT EXISTS parts_locations_workspace_code_uidx
  ON public.parts_locations (workspace_id, lower(code))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_locations_branch
  ON public.parts_locations (workspace_id, branch_slug)
  WHERE branch_slug IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.parts_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_locations_service_all ON public.parts_locations;
CREATE POLICY parts_locations_service_all
  ON public.parts_locations FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_locations_staff_select ON public.parts_locations;
CREATE POLICY parts_locations_staff_select
  ON public.parts_locations FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_locations_admin_mutate ON public.parts_locations;
CREATE POLICY parts_locations_admin_mutate
  ON public.parts_locations FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_admin_role()
  );

DROP TRIGGER IF EXISTS set_parts_locations_updated_at ON public.parts_locations;
CREATE TRIGGER set_parts_locations_updated_at
  BEFORE UPDATE ON public.parts_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_bins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  location_id uuid NOT NULL REFERENCES public.parts_locations(id) ON DELETE CASCADE,
  bin_code text NOT NULL,
  zone text,
  aisle text,
  shelf text,
  sequence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'locked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_bins_code_present CHECK (length(btrim(bin_code)) > 0),
  UNIQUE (location_id, bin_code)
);

COMMENT ON TABLE public.parts_bins IS
  'Bin-level storage map for Phase 3 Parts stock and cycle counting.';

CREATE INDEX IF NOT EXISTS idx_parts_bins_workspace_location
  ON public.parts_bins (workspace_id, location_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_bins_service_all ON public.parts_bins;
CREATE POLICY parts_bins_service_all
  ON public.parts_bins FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_bins_staff_select ON public.parts_bins;
CREATE POLICY parts_bins_staff_select
  ON public.parts_bins FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_bins_operator_mutate ON public.parts_bins;
CREATE POLICY parts_bins_operator_mutate
  ON public.parts_bins FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_bins_updated_at ON public.parts_bins;
CREATE TRIGGER set_parts_bins_updated_at
  BEFORE UPDATE ON public.parts_bins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.parts_locations(id) ON DELETE RESTRICT,
  bin_id uuid REFERENCES public.parts_bins(id) ON DELETE SET NULL,
  branch_slug text,
  legacy_inventory_id uuid REFERENCES public.parts_inventory(id) ON DELETE SET NULL,
  qty_on_hand numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_allocated numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_allocated >= 0),
  qty_reserved numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_on_order numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_on_order >= 0),
  qty_in_transit numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_in_transit >= 0),
  average_cost_cents bigint,
  last_counted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_stock_quantities_consistent CHECK (qty_allocated <= qty_on_hand)
);

COMMENT ON TABLE public.parts_stock IS
  'Phase 3 normalized stock position per part, location, and optional bin. Backfilled from parts_inventory when available.';

CREATE UNIQUE INDEX IF NOT EXISTS parts_stock_workspace_part_location_bin_uidx
  ON public.parts_stock (workspace_id, part_id, location_id, coalesce(bin_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS parts_stock_legacy_inventory_uidx
  ON public.parts_stock (legacy_inventory_id)
  WHERE legacy_inventory_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_stock_branch
  ON public.parts_stock (workspace_id, branch_slug, part_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_stock_service_all ON public.parts_stock;
CREATE POLICY parts_stock_service_all
  ON public.parts_stock FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_stock_staff_select ON public.parts_stock;
CREATE POLICY parts_stock_staff_select
  ON public.parts_stock FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_stock_operator_mutate ON public.parts_stock;
CREATE POLICY parts_stock_operator_mutate
  ON public.parts_stock FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_stock_updated_at ON public.parts_stock;
CREATE TRIGGER set_parts_stock_updated_at
  BEFORE UPDATE ON public.parts_stock
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Fitment and kits.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parts_by_machine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  machine_profile_id uuid REFERENCES public.machine_profiles(id) ON DELETE CASCADE,
  make text,
  model text,
  serial_prefix text,
  serial_range_start text,
  serial_range_end text,
  fitment_type text NOT NULL DEFAULT 'standard' CHECK (
    fitment_type IN ('standard', 'optional', 'service_kit', 'wear_part', 'supersession')
  ),
  confidence numeric(5, 4) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL DEFAULT 'manual',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_by_machine_target_ck CHECK (
    machine_profile_id IS NOT NULL
    OR make IS NOT NULL
    OR model IS NOT NULL
    OR serial_prefix IS NOT NULL
  )
);

COMMENT ON TABLE public.parts_by_machine IS
  'Phase 3 machine-to-part fitment map powering serial/model lookup paths.';

CREATE INDEX IF NOT EXISTS idx_parts_by_machine_profile
  ON public.parts_by_machine (workspace_id, machine_profile_id)
  WHERE machine_profile_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_by_machine_make_model
  ON public.parts_by_machine (workspace_id, lower(make), lower(model))
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_by_machine ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_by_machine_service_all ON public.parts_by_machine;
CREATE POLICY parts_by_machine_service_all
  ON public.parts_by_machine FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_by_machine_staff_select ON public.parts_by_machine;
CREATE POLICY parts_by_machine_staff_select
  ON public.parts_by_machine FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_by_machine_operator_mutate ON public.parts_by_machine;
CREATE POLICY parts_by_machine_operator_mutate
  ON public.parts_by_machine FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_by_machine_updated_at ON public.parts_by_machine;
CREATE TRIGGER set_parts_by_machine_updated_at
  BEFORE UPDATE ON public.parts_by_machine
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  kit_number text NOT NULL,
  name text NOT NULL,
  description text,
  machine_profile_id uuid REFERENCES public.machine_profiles(id) ON DELETE SET NULL,
  service_interval_hours integer,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive', 'retired')),
  curated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_kits_number_present CHECK (length(btrim(kit_number)) > 0)
);

COMMENT ON TABLE public.parts_kits IS
  'Phase 3 parts kit headers, including manager-curated PM kits and one-off kits promoted to catalog.';

CREATE UNIQUE INDEX IF NOT EXISTS parts_kits_workspace_number_uidx
  ON public.parts_kits (workspace_id, lower(kit_number))
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_kits_service_all ON public.parts_kits;
CREATE POLICY parts_kits_service_all
  ON public.parts_kits FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_kits_staff_select ON public.parts_kits;
CREATE POLICY parts_kits_staff_select
  ON public.parts_kits FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_kits_operator_mutate ON public.parts_kits;
CREATE POLICY parts_kits_operator_mutate
  ON public.parts_kits FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_kits_updated_at ON public.parts_kits;
CREATE TRIGGER set_parts_kits_updated_at
  BEFORE UPDATE ON public.parts_kits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  kit_id uuid NOT NULL REFERENCES public.parts_kits(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  quantity numeric(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_id, part_id)
);

COMMENT ON TABLE public.parts_kit_items IS
  'Line items for Phase 3 parts kits.';

CREATE INDEX IF NOT EXISTS idx_parts_kit_items_kit
  ON public.parts_kit_items (workspace_id, kit_id, sort_order);

ALTER TABLE public.parts_kit_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_kit_items_service_all ON public.parts_kit_items;
CREATE POLICY parts_kit_items_service_all
  ON public.parts_kit_items FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_kit_items_staff_select ON public.parts_kit_items;
CREATE POLICY parts_kit_items_staff_select
  ON public.parts_kit_items FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS parts_kit_items_operator_mutate ON public.parts_kit_items;
CREATE POLICY parts_kit_items_operator_mutate
  ON public.parts_kit_items FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_kit_items_updated_at ON public.parts_kit_items;
CREATE TRIGGER set_parts_kit_items_updated_at
  BEFORE UPDATE ON public.parts_kit_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS parts_kit_items_sync_workspace_trg ON public.parts_kit_items;
CREATE TRIGGER parts_kit_items_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF kit_id ON public.parts_kit_items
  FOR EACH ROW
  EXECUTE FUNCTION public.qep_phase3_parts_child_workspace_from_parent('parts_kits', 'kit_id');

-- ----------------------------------------------------------------------------
-- OEM portal compatibility. The credential vault already exists in migration 358.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.oem_portals AS
SELECT
  id,
  workspace_id,
  brand_code,
  oem_name,
  portal_name,
  segment,
  launch_url,
  status,
  access_mode,
  favorite,
  mfa_required,
  credential_owner,
  support_contact,
  notes,
  last_verified_at,
  sort_order,
  metadata,
  created_at,
  updated_at
FROM public.oem_portal_profiles;

ALTER VIEW public.oem_portals SET (security_invoker = true);

COMMENT ON VIEW public.oem_portals IS
  'Phase 3 compatibility view over oem_portal_profiles. Credentials remain in oem_portal_credentials.';

GRANT SELECT ON public.oem_portals TO authenticated, service_role;

COMMENT ON TABLE public.oem_portal_credentials IS
  'Server-sealed credential vault for OEM portals. Included in the G1.1 Phase 3 Parts foundation; plaintext stays out of Postgres.';

-- ----------------------------------------------------------------------------
-- Documents and extracted lines.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parts_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  document_type text NOT NULL CHECK (
    document_type IN (
      'oem_bulletin',
      'parts_catalog',
      'parts_quote',
      'purchase_order',
      'packing_slip',
      'vendor_invoice',
      'return_authorization',
      'warranty_claim',
      'cycle_count',
      'other'
    )
  ),
  source_name text NOT NULL,
  storage_path text,
  source_url text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('uploaded', 'extracting', 'extracted', 'needs_review', 'approved', 'rejected')
  ),
  related_part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  related_purchase_order_id uuid,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  extracted_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.parts_documents IS
  'Phase 3 parts document registry for OEM bulletins, purchase documents, returns, warranty, and cycle-count evidence.';

CREATE INDEX IF NOT EXISTS idx_parts_documents_type_status
  ON public.parts_documents (workspace_id, document_type, status, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_documents_service_all ON public.parts_documents;
CREATE POLICY parts_documents_service_all
  ON public.parts_documents FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_documents_staff_select ON public.parts_documents;
CREATE POLICY parts_documents_staff_select
  ON public.parts_documents FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_documents_operator_mutate ON public.parts_documents;
CREATE POLICY parts_documents_operator_mutate
  ON public.parts_documents FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_documents_updated_at ON public.parts_documents;
CREATE TRIGGER set_parts_documents_updated_at
  BEFORE UPDATE ON public.parts_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  document_id uuid NOT NULL REFERENCES public.parts_documents(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_number text,
  description text,
  quantity numeric(14, 4),
  unit_cost_cents bigint,
  unit_price_cents bigint,
  confidence numeric(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  raw_line jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, line_number)
);

COMMENT ON TABLE public.parts_document_lines IS
  'Extracted line-level facts from parts_documents.';

CREATE INDEX IF NOT EXISTS idx_parts_document_lines_document
  ON public.parts_document_lines (workspace_id, document_id, line_number);

ALTER TABLE public.parts_document_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_document_lines_service_all ON public.parts_document_lines;
CREATE POLICY parts_document_lines_service_all
  ON public.parts_document_lines FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_document_lines_staff_select ON public.parts_document_lines;
CREATE POLICY parts_document_lines_staff_select
  ON public.parts_document_lines FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS parts_document_lines_operator_mutate ON public.parts_document_lines;
CREATE POLICY parts_document_lines_operator_mutate
  ON public.parts_document_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_document_lines_updated_at ON public.parts_document_lines;
CREATE TRIGGER set_parts_document_lines_updated_at
  BEFORE UPDATE ON public.parts_document_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS parts_document_lines_sync_workspace_trg ON public.parts_document_lines;
CREATE TRIGGER parts_document_lines_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF document_id ON public.parts_document_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.qep_phase3_parts_child_workspace_from_parent('parts_documents', 'document_id');

-- ----------------------------------------------------------------------------
-- Parts purchase orders and inter-branch transfers.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  po_number text NOT NULL,
  vendor_id uuid REFERENCES public.vendor_profiles(id) ON DELETE RESTRICT,
  destination_location_id uuid REFERENCES public.parts_locations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'submitted', 'acknowledged', 'partial_received', 'received', 'closed', 'cancelled', 'backordered')
  ),
  order_type text NOT NULL DEFAULT 'stock' CHECK (
    order_type IN ('stock', 'emergency', 'special_order', 'warranty', 'core_return', 'other')
  ),
  customer_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  auto_replenish_queue_id uuid REFERENCES public.parts_auto_replenish_queue(id) ON DELETE SET NULL,
  ordered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ordered_at timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  freight_cents bigint NOT NULL DEFAULT 0 CHECK (freight_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT purchase_orders_number_present CHECK (length(btrim(po_number)) > 0)
);

COMMENT ON TABLE public.purchase_orders IS
  'Phase 3 parts-specific purchase orders for stock, emergency, special-order, warranty, and core-return procurement.';

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_workspace_number_uidx
  ON public.purchase_orders (workspace_id, po_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
  ON public.purchase_orders (workspace_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_service_all ON public.purchase_orders;
CREATE POLICY purchase_orders_service_all
  ON public.purchase_orders FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS purchase_orders_staff_select ON public.purchase_orders;
CREATE POLICY purchase_orders_staff_select
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS purchase_orders_operator_mutate ON public.purchase_orders;
CREATE POLICY purchase_orders_operator_mutate
  ON public.purchase_orders FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_purchase_orders_updated_at ON public.purchase_orders;
CREATE TRIGGER set_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_number text NOT NULL,
  description text,
  qty_ordered numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_ordered >= 0),
  qty_received numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_backordered numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_backordered >= 0),
  unit_cost_cents bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  expected_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'partial', 'received', 'cancelled', 'backordered')
  ),
  parts_order_line_id uuid REFERENCES public.parts_order_lines(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_order_id, line_number)
);

COMMENT ON TABLE public.purchase_order_lines IS
  'Line items for Phase 3 parts-specific purchase orders.';

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po
  ON public.purchase_order_lines (workspace_id, purchase_order_id, line_number);

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_order_lines_service_all ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_service_all
  ON public.purchase_order_lines FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS purchase_order_lines_staff_select ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_staff_select
  ON public.purchase_order_lines FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS purchase_order_lines_operator_mutate ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_operator_mutate
  ON public.purchase_order_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_purchase_order_lines_updated_at ON public.purchase_order_lines;
CREATE TRIGGER set_purchase_order_lines_updated_at
  BEFORE UPDATE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS purchase_order_lines_sync_workspace_trg ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF purchase_order_id ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.qep_phase3_parts_child_workspace_from_parent('purchase_orders', 'purchase_order_id');

CREATE TABLE IF NOT EXISTS public.parts_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  transfer_number text NOT NULL,
  from_location_id uuid NOT NULL REFERENCES public.parts_locations(id) ON DELETE RESTRICT,
  to_location_id uuid NOT NULL REFERENCES public.parts_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'requested', 'approved', 'picked', 'in_transit', 'received', 'cancelled')
  ),
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT parts_transfers_number_present CHECK (length(btrim(transfer_number)) > 0),
  CONSTRAINT parts_transfers_different_locations CHECK (from_location_id <> to_location_id)
);

COMMENT ON TABLE public.parts_transfers IS
  'Phase 3 inter-location parts transfer headers.';

CREATE UNIQUE INDEX IF NOT EXISTS parts_transfers_workspace_number_uidx
  ON public.parts_transfers (workspace_id, transfer_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_transfers_status
  ON public.parts_transfers (workspace_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.parts_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_transfers_service_all ON public.parts_transfers;
CREATE POLICY parts_transfers_service_all
  ON public.parts_transfers FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_transfers_staff_select ON public.parts_transfers;
CREATE POLICY parts_transfers_staff_select
  ON public.parts_transfers FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS parts_transfers_operator_mutate ON public.parts_transfers;
CREATE POLICY parts_transfers_operator_mutate
  ON public.parts_transfers FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_transfers_updated_at ON public.parts_transfers;
CREATE TRIGGER set_parts_transfers_updated_at
  BEFORE UPDATE ON public.parts_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.parts_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  transfer_id uuid NOT NULL REFERENCES public.parts_transfers(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  qty_requested numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_requested >= 0),
  qty_shipped numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_shipped >= 0),
  qty_received numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  from_bin_id uuid REFERENCES public.parts_bins(id) ON DELETE SET NULL,
  to_bin_id uuid REFERENCES public.parts_bins(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'picked', 'in_transit', 'received', 'cancelled')
  ),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, line_number)
);

COMMENT ON TABLE public.parts_transfer_lines IS
  'Line items for Phase 3 inter-location parts transfers.';

ALTER TABLE public.parts_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_transfer_lines_service_all ON public.parts_transfer_lines;
CREATE POLICY parts_transfer_lines_service_all
  ON public.parts_transfer_lines FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS parts_transfer_lines_staff_select ON public.parts_transfer_lines;
CREATE POLICY parts_transfer_lines_staff_select
  ON public.parts_transfer_lines FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS parts_transfer_lines_operator_mutate ON public.parts_transfer_lines;
CREATE POLICY parts_transfer_lines_operator_mutate
  ON public.parts_transfer_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_parts_transfer_lines_updated_at ON public.parts_transfer_lines;
CREATE TRIGGER set_parts_transfer_lines_updated_at
  BEFORE UPDATE ON public.parts_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS parts_transfer_lines_sync_workspace_trg ON public.parts_transfer_lines;
CREATE TRIGGER parts_transfer_lines_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF transfer_id ON public.parts_transfer_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.qep_phase3_parts_child_workspace_from_parent('parts_transfers', 'transfer_id');

-- ----------------------------------------------------------------------------
-- Returns, cores, warranty, and cycle counts.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.core_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_number text,
  customer_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendor_profiles(id) ON DELETE SET NULL,
  parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN (
      'core_sold',
      'customer_core_returned',
      'vendor_core_returned',
      'vendor_credit_received',
      'customer_credit_issued',
      'write_off',
      'adjustment'
    )
  ),
  direction text NOT NULL CHECK (
    direction IN ('customer_owes_qep', 'qep_owes_customer', 'qep_owes_vendor', 'vendor_owes_qep', 'settled')
  ),
  quantity numeric(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending_vendor_credit', 'settled', 'written_off')),
  reference_number text,
  due_at timestamptz,
  settled_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.core_ledger IS
  'Bidirectional core-charge ledger: what customers owe QEP, what QEP owes vendors, and vendor credits due back to QEP.';

CREATE INDEX IF NOT EXISTS idx_core_ledger_status
  ON public.core_ledger (workspace_id, status, created_at DESC);

ALTER TABLE public.core_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS core_ledger_service_all ON public.core_ledger;
CREATE POLICY core_ledger_service_all
  ON public.core_ledger FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS core_ledger_staff_select ON public.core_ledger;
CREATE POLICY core_ledger_staff_select
  ON public.core_ledger FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS core_ledger_operator_mutate ON public.core_ledger;
CREATE POLICY core_ledger_operator_mutate
  ON public.core_ledger FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_core_ledger_updated_at ON public.core_ledger;
CREATE TRIGGER set_core_ledger_updated_at
  BEFORE UPDATE ON public.core_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.customer_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  return_number text NOT NULL,
  customer_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  parts_order_line_id uuid REFERENCES public.parts_order_lines(id) ON DELETE SET NULL,
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_number text,
  quantity numeric(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason text,
  policy_code text NOT NULL DEFAULT 'standard_30_day' CHECK (
    policy_code IN ('standard_30_day', 'special_order', 'electrical_non_returnable', 'vendor_credit_hold', 'manager_exception')
  ),
  status text NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested', 'received', 'inspection', 'vendor_credit_hold', 'approved', 'rejected', 'credited', 'scrapped')
  ),
  restocking_fee_cents bigint NOT NULL DEFAULT 0 CHECK (restocking_fee_cents >= 0),
  refund_cents bigint NOT NULL DEFAULT 0 CHECK (refund_cents >= 0),
  received_at timestamptz,
  resolved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT customer_returns_number_present CHECK (length(btrim(return_number)) > 0)
);

COMMENT ON TABLE public.customer_returns IS
  'Phase 3 customer parts return records, including policy decision, restocking fee, and vendor-credit hold state.';

CREATE UNIQUE INDEX IF NOT EXISTS customer_returns_workspace_number_uidx
  ON public.customer_returns (workspace_id, return_number)
  WHERE deleted_at IS NULL;

ALTER TABLE public.customer_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_returns_service_all ON public.customer_returns;
CREATE POLICY customer_returns_service_all
  ON public.customer_returns FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS customer_returns_staff_select ON public.customer_returns;
CREATE POLICY customer_returns_staff_select
  ON public.customer_returns FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS customer_returns_operator_mutate ON public.customer_returns;
CREATE POLICY customer_returns_operator_mutate
  ON public.customer_returns FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_customer_returns_updated_at ON public.customer_returns;
CREATE TRIGGER set_customer_returns_updated_at
  BEFORE UPDATE ON public.customer_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  return_number text NOT NULL,
  vendor_id uuid REFERENCES public.vendor_profiles(id) ON DELETE SET NULL,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  customer_return_id uuid REFERENCES public.customer_returns(id) ON DELETE SET NULL,
  part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  part_number text,
  quantity numeric(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'ra_requested', 'ra_issued', 'shipped', 'vendor_received', 'credit_pending', 'credited', 'rejected', 'closed')
  ),
  ra_number text,
  credit_expected_cents bigint NOT NULL DEFAULT 0 CHECK (credit_expected_cents >= 0),
  credit_received_cents bigint NOT NULL DEFAULT 0 CHECK (credit_received_cents >= 0),
  shipped_at timestamptz,
  credited_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT vendor_returns_number_present CHECK (length(btrim(return_number)) > 0)
);

COMMENT ON TABLE public.vendor_returns IS
  'Phase 3 vendor return / RA records that release customer-return holds when vendor credit is confirmed.';

CREATE UNIQUE INDEX IF NOT EXISTS vendor_returns_workspace_number_uidx
  ON public.vendor_returns (workspace_id, return_number)
  WHERE deleted_at IS NULL;

ALTER TABLE public.vendor_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_returns_service_all ON public.vendor_returns;
CREATE POLICY vendor_returns_service_all
  ON public.vendor_returns FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS vendor_returns_staff_select ON public.vendor_returns;
CREATE POLICY vendor_returns_staff_select
  ON public.vendor_returns FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS vendor_returns_operator_mutate ON public.vendor_returns;
CREATE POLICY vendor_returns_operator_mutate
  ON public.vendor_returns FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_vendor_returns_updated_at ON public.vendor_returns;
CREATE TRIGGER set_vendor_returns_updated_at
  BEFORE UPDATE ON public.vendor_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.warranty_claims
  ALTER COLUMN service_job_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS claim_scope text NOT NULL DEFAULT 'service' CHECK (claim_scope IN ('service', 'parts')),
  ADD COLUMN IF NOT EXISTS parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.parts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_number text,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.qrm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendor_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity numeric(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  ADD COLUMN IF NOT EXISTS evaluation_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS replacement_policy text CHECK (
    replacement_policy IS NULL OR replacement_policy IN ('paid_up_front', 'order_after_credit', 'manager_exception')
  ),
  ADD COLUMN IF NOT EXISTS customer_return_id uuid REFERENCES public.customer_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_return_id uuid REFERENCES public.vendor_returns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warranty_claims_phase3_scope_parent_ck'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_phase3_scope_parent_ck CHECK (
        (claim_scope = 'service' AND service_job_id IS NOT NULL)
        OR (
          claim_scope = 'parts'
          AND (
            parts_order_id IS NOT NULL
            OR part_id IS NOT NULL
            OR NULLIF(btrim(COALESCE(part_number, '')), '') IS NOT NULL
          )
        )
      ) NOT VALID;
  END IF;
END $$;

DROP POLICY IF EXISTS warranty_claims_parts_counter_select ON public.warranty_claims;
CREATE POLICY warranty_claims_parts_counter_select
  ON public.warranty_claims FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND claim_scope = 'parts'
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS warranty_claims_parts_operator_mutate ON public.warranty_claims;
CREATE POLICY warranty_claims_parts_operator_mutate
  ON public.warranty_claims FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND claim_scope = 'parts'
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND claim_scope = 'parts'
    AND public.qep_parts_operator_role()
  );

CREATE TABLE IF NOT EXISTS public.cycle_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  count_number text NOT NULL,
  location_id uuid REFERENCES public.parts_locations(id) ON DELETE SET NULL,
  count_type text NOT NULL DEFAULT 'cycle' CHECK (count_type IN ('cycle', 'full', 'spot', 'dead_stock_review')),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'in_progress', 'review', 'approved', 'posted', 'cancelled')
  ),
  dead_stock_months integer NOT NULL DEFAULT 18 CHECK (dead_stock_months > 0),
  scheduled_at timestamptz,
  started_at timestamptz,
  closed_at timestamptz,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT cycle_counts_number_present CHECK (length(btrim(count_number)) > 0)
);

COMMENT ON TABLE public.cycle_counts IS
  'Phase 3 rolling cycle count headers; dead stock window defaults to 18 months per ADR-019.';

CREATE UNIQUE INDEX IF NOT EXISTS cycle_counts_workspace_number_uidx
  ON public.cycle_counts (workspace_id, count_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cycle_counts_status
  ON public.cycle_counts (workspace_id, status, scheduled_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.cycle_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cycle_counts_service_all ON public.cycle_counts;
CREATE POLICY cycle_counts_service_all
  ON public.cycle_counts FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS cycle_counts_staff_select ON public.cycle_counts;
CREATE POLICY cycle_counts_staff_select
  ON public.cycle_counts FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS cycle_counts_operator_mutate ON public.cycle_counts;
CREATE POLICY cycle_counts_operator_mutate
  ON public.cycle_counts FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_cycle_counts_updated_at ON public.cycle_counts;
CREATE TRIGGER set_cycle_counts_updated_at
  BEFORE UPDATE ON public.cycle_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.cycle_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  cycle_count_id uuid NOT NULL REFERENCES public.cycle_counts(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE RESTRICT,
  bin_id uuid REFERENCES public.parts_bins(id) ON DELETE SET NULL,
  expected_qty numeric(14, 4) NOT NULL DEFAULT 0 CHECK (expected_qty >= 0),
  counted_qty numeric(14, 4) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  variance_qty numeric(14, 4) GENERATED ALWAYS AS (coalesce(counted_qty, expected_qty) - expected_qty) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'counted', 'recount', 'approved', 'posted')),
  counted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  counted_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_count_id, line_number)
);

COMMENT ON TABLE public.cycle_count_lines IS
  'Line-level expected vs counted quantity for Phase 3 cycle counts.';

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_count
  ON public.cycle_count_lines (workspace_id, cycle_count_id, line_number);

ALTER TABLE public.cycle_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cycle_count_lines_service_all ON public.cycle_count_lines;
CREATE POLICY cycle_count_lines_service_all
  ON public.cycle_count_lines FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS cycle_count_lines_staff_select ON public.cycle_count_lines;
CREATE POLICY cycle_count_lines_staff_select
  ON public.cycle_count_lines FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_staff_role()
  );

DROP POLICY IF EXISTS cycle_count_lines_operator_mutate ON public.cycle_count_lines;
CREATE POLICY cycle_count_lines_operator_mutate
  ON public.cycle_count_lines FOR ALL TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND public.qep_parts_operator_role()
  );

DROP TRIGGER IF EXISTS set_cycle_count_lines_updated_at ON public.cycle_count_lines;
CREATE TRIGGER set_cycle_count_lines_updated_at
  BEFORE UPDATE ON public.cycle_count_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS cycle_count_lines_sync_workspace_trg ON public.cycle_count_lines;
CREATE TRIGGER cycle_count_lines_sync_workspace_trg
  BEFORE INSERT OR UPDATE OF cycle_count_id ON public.cycle_count_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.qep_phase3_parts_child_workspace_from_parent('cycle_counts', 'cycle_count_id');

-- ----------------------------------------------------------------------------
-- Backfill the foundation from existing catalog and inventory tables.
-- ----------------------------------------------------------------------------

INSERT INTO public.parts (
  workspace_id,
  parts_catalog_id,
  part_number,
  description,
  manufacturer,
  category,
  default_uom,
  source,
  metadata,
  created_at,
  updated_at
)
SELECT DISTINCT ON (pc.workspace_id, lower(pc.part_number))
  pc.workspace_id,
  pc.id,
  pc.part_number,
  pc.description,
  pc.manufacturer,
  pc.category,
  coalesce(nullif(pc.uom, ''), 'EA'),
  'parts_catalog',
  jsonb_build_object(
    'migration', '664_phase3_parts_schema_foundation',
    'catalog_branch_code', pc.branch_code,
    'catalog_co_code', pc.co_code,
    'catalog_div_code', pc.div_code
  ),
  pc.created_at,
  now()
FROM public.parts_catalog pc
WHERE pc.deleted_at IS NULL
  AND pc.part_number IS NOT NULL
  AND length(btrim(pc.part_number)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.parts p
    WHERE p.workspace_id = pc.workspace_id
      AND lower(p.part_number) = lower(pc.part_number)
      AND p.deleted_at IS NULL
  )
ORDER BY pc.workspace_id, lower(pc.part_number), pc.updated_at DESC NULLS LAST, pc.created_at DESC NULLS LAST;

INSERT INTO public.parts_locations (
  workspace_id,
  code,
  name,
  location_type,
  branch_id,
  branch_slug,
  metadata
)
SELECT
  b.workspace_id,
  b.slug,
  b.name,
  'branch',
  b.id,
  b.slug,
  jsonb_build_object('migration', '664_phase3_parts_schema_foundation', 'source', 'branches')
FROM public.branches b
WHERE b.slug IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.parts_locations l
    WHERE l.workspace_id = b.workspace_id
      AND lower(l.code) = lower(b.slug)
      AND l.deleted_at IS NULL
  );

INSERT INTO public.parts_locations (
  workspace_id,
  code,
  name,
  location_type,
  branch_slug,
  metadata
)
SELECT DISTINCT
  pi.workspace_id,
  pi.branch_id,
  pi.branch_id,
  'branch',
  pi.branch_id,
  jsonb_build_object('migration', '664_phase3_parts_schema_foundation', 'source', 'parts_inventory')
FROM public.parts_inventory pi
WHERE pi.deleted_at IS NULL
  AND pi.branch_id IS NOT NULL
  AND length(btrim(pi.branch_id)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.parts_locations l
    WHERE l.workspace_id = pi.workspace_id
      AND lower(l.code) = lower(pi.branch_id)
      AND l.deleted_at IS NULL
  );

INSERT INTO public.parts_bins (
  workspace_id,
  location_id,
  bin_code,
  metadata
)
SELECT DISTINCT
  pi.workspace_id,
  l.id,
  pi.bin_location,
  jsonb_build_object('migration', '664_phase3_parts_schema_foundation', 'source', 'parts_inventory')
FROM public.parts_inventory pi
JOIN public.parts_locations l
  ON l.workspace_id = pi.workspace_id
 AND lower(l.code) = lower(pi.branch_id)
 AND l.deleted_at IS NULL
WHERE pi.deleted_at IS NULL
  AND pi.bin_location IS NOT NULL
  AND length(btrim(pi.bin_location)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.parts_bins b
    WHERE b.location_id = l.id
      AND b.bin_code = pi.bin_location
      AND b.deleted_at IS NULL
  );

INSERT INTO public.parts_stock (
  workspace_id,
  part_id,
  location_id,
  bin_id,
  branch_slug,
  legacy_inventory_id,
  qty_on_hand,
  metadata
)
SELECT
  pi.workspace_id,
  p.id,
  l.id,
  b.id,
  pi.branch_id,
  pi.id,
  pi.qty_on_hand,
  jsonb_build_object('migration', '664_phase3_parts_schema_foundation', 'source', 'parts_inventory')
FROM public.parts_inventory pi
JOIN public.parts p
  ON p.workspace_id = pi.workspace_id
 AND lower(p.part_number) = lower(pi.part_number)
 AND p.deleted_at IS NULL
JOIN public.parts_locations l
  ON l.workspace_id = pi.workspace_id
 AND lower(l.code) = lower(pi.branch_id)
 AND l.deleted_at IS NULL
LEFT JOIN public.parts_bins b
  ON b.workspace_id = pi.workspace_id
 AND b.location_id = l.id
 AND b.bin_code = pi.bin_location
 AND b.deleted_at IS NULL
WHERE pi.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.parts_stock s
    WHERE s.legacy_inventory_id = pi.id
      AND s.deleted_at IS NULL
  );

-- ----------------------------------------------------------------------------
-- Roadmap source-of-truth update.
-- ----------------------------------------------------------------------------

UPDATE public.qep_roadmap_tasks
SET ship_state = 'shipped',
    blocking_decision = NULL,
    evidence_link = CASE
      WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/664_phase3_parts_schema_foundation.sql%'
        THEN evidence_link
      ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1') ||
        ' | supabase/migrations/664_phase3_parts_schema_foundation.sql'
    END,
    notes = CASE
      WHEN COALESCE(notes, '') LIKE '%[2026-07-02] G1.1 shipped%'
        THEN notes
      ELSE COALESCE(notes, '') ||
        E'\n[2026-07-02] G1.1 shipped: Phase 3 Parts foundation tables, RLS policies, compatibility OEM portal view, parts-warranty extension, and legacy catalog/inventory backfill installed.'
    END,
    updated_at = now()
WHERE task_id = 'G1.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G1.1',
  'update',
  jsonb_build_object(
    'reason', 'g11_phase3_parts_schema_foundation_shipped',
    'migration', '664_phase3_parts_schema_foundation.sql',
    'mission_alignment', 'supports parts counter, stock, procurement, transfers, returns, warranty, cores, and cycle-count operations for QEP employees and management'
  ),
  'codex'
);

COMMIT;
