-- ============================================================================
-- Migration 658: Margin Matrix + Segment Tags
-- Purpose: A segment-tagged margin model over the matrix
--          [Parts | Service] x [Customer | Warranty | Internal | Sublet],
--          with shop burden applied BELOW gross margin.
--
-- LOCKED formulas (all reproduced by gross_margin = sale_cents - cost_cents):
--   Equipment margin = Sale − NBV        -> cost_cents = net_book_value_cents
--   Parts margin     = Sale − Cost       -> cost_cents = part current_cost_cents
--   Service margin   = Labor Sale − Tech Cost
--                                        -> sale_cents = labor_sale_cents,
--                                           cost_cents = labor_cost_cents (tech cost)
--
-- Shop burden is modeled separately in shop_burden_cents and subtracted only
-- in net_margin_cents so it never distorts gross margin discipline.
--
-- Additive only. Does NOT recreate qb_margin_thresholds, qb_margin_exceptions,
-- or v_margin_exceptions.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Enums (guarded — CREATE TYPE has no IF NOT EXISTS)
-- ----------------------------------------------------------------------------

-- The [Parts | Service] axis. Equipment is handled by the same
-- (sale - cost) formula, so it is included here to let equipment sales be
-- tagged into the same matrix.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'margin_line_class') THEN
    CREATE TYPE public.margin_line_class AS ENUM ('parts', 'service', 'equipment');
  END IF;
END$$;

COMMENT ON TYPE public.margin_line_class IS
  'Margin matrix line axis: parts | service | equipment (equipment shares the sale-cost formula).';

-- The [Customer | Warranty | Internal | Sublet] axis.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'margin_segment') THEN
    CREATE TYPE public.margin_segment AS ENUM ('customer', 'warranty', 'internal', 'sublet');
  END IF;
END$$;

COMMENT ON TYPE public.margin_segment IS
  'Margin matrix segment axis: customer | warranty | internal | sublet.';

-- ----------------------------------------------------------------------------
-- 2. Margin matrix entries
--    cost_cents mapping (the LOCKED formulas collapse to sale - cost):
--      equipment -> cost_cents = qrm_equipment.net_book_value_cents (NBV)
--      parts     -> cost_cents = part current_cost_cents
--      service   -> sale_cents = service_labor_ledger.labor_sale_cents,
--                   cost_cents = service_labor_ledger.labor_cost_cents (tech cost)
--    gross_margin_cents = sale_cents - cost_cents reproduces all three.
--    net_margin_cents subtracts shop_burden below gross margin.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.margin_matrix_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  source_type text NOT NULL CHECK (source_type IN ('equipment', 'parts', 'service')),
  source_id uuid,
  line_class public.margin_line_class NOT NULL,
  segment public.margin_segment NOT NULL,
  sale_cents bigint NOT NULL DEFAULT 0,
  cost_cents bigint NOT NULL DEFAULT 0,
  shop_burden_cents bigint NOT NULL DEFAULT 0,
  gross_margin_cents bigint GENERATED ALWAYS AS (sale_cents - cost_cents) STORED,
  net_margin_cents bigint GENERATED ALWAYS AS (sale_cents - cost_cents - shop_burden_cents) STORED,
  margin_pct numeric(7, 4),
  occurred_on date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.margin_matrix_entries IS
  'Segment-tagged margin rows over [parts|service|equipment] x [customer|warranty|internal|sublet]. gross_margin_cents = sale - cost reproduces the locked equipment/parts/service formulas; shop_burden is subtracted only in net_margin_cents.';
COMMENT ON COLUMN public.margin_matrix_entries.cost_cents IS
  'Locked-formula cost basis: equipment=NBV (net_book_value_cents), parts=part current_cost_cents, service=tech cost (labor_cost_cents).';
COMMENT ON COLUMN public.margin_matrix_entries.shop_burden_cents IS
  'Shop burden applied BELOW gross margin — subtracted in net_margin_cents only.';

CREATE INDEX IF NOT EXISTS margin_matrix_entries_class_segment_idx
  ON public.margin_matrix_entries (workspace_id, line_class, segment);
CREATE INDEX IF NOT EXISTS margin_matrix_entries_source_idx
  ON public.margin_matrix_entries (workspace_id, source_type, source_id);

-- ----------------------------------------------------------------------------
-- 3. Matrix rollup view (2x4 / 3x4). Plain view — inherits invoker RLS from
--    the underlying table (relies on default invoker semantics, not elevated).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_margin_matrix_summary AS
SELECT
  workspace_id,
  line_class,
  segment,
  count(*) AS entry_count,
  sum(sale_cents) AS sale_cents,
  sum(cost_cents) AS cost_cents,
  sum(shop_burden_cents) AS shop_burden_cents,
  sum(gross_margin_cents) AS gross_margin_cents,
  sum(net_margin_cents) AS net_margin_cents
FROM public.margin_matrix_entries
WHERE deleted_at IS NULL
GROUP BY workspace_id, line_class, segment;

COMMENT ON VIEW public.v_margin_matrix_summary IS
  'Matrix rollup of gross_margin_cents and net_margin_cents grouped by (workspace_id, line_class, segment).';

-- ----------------------------------------------------------------------------
-- 4. Margin compute helpers
-- ----------------------------------------------------------------------------

-- Net margin below gross margin: sale - cost - shop_burden.
CREATE OR REPLACE FUNCTION public.compute_segment_margin(
  p_sale_cents bigint,
  p_cost_cents bigint,
  p_shop_burden_cents bigint DEFAULT 0
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_sale_cents - p_cost_cents - COALESCE(p_shop_burden_cents, 0);
$$;

COMMENT ON FUNCTION public.compute_segment_margin(bigint, bigint, bigint) IS
  'Net margin below gross margin: sale - cost - shop_burden.';

-- Gross margin percentage: (sale - cost) / sale * 100, guarded against /0.
CREATE OR REPLACE FUNCTION public.compute_margin_pct(
  p_sale_cents bigint,
  p_cost_cents bigint
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(((p_sale_cents - p_cost_cents)::numeric / nullif(p_sale_cents, 0)) * 100, 4);
$$;

COMMENT ON FUNCTION public.compute_margin_pct(bigint, bigint) IS
  'Gross margin percent: (sale - cost) / sale * 100, rounded to 4 dp, NULL when sale = 0.';

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.margin_matrix_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS margin_matrix_entries_select ON public.margin_matrix_entries;
CREATE POLICY margin_matrix_entries_select
  ON public.margin_matrix_entries
  FOR SELECT
  USING (workspace_id = (select public.get_my_workspace()));

DROP POLICY IF EXISTS margin_matrix_entries_insert ON public.margin_matrix_entries;
CREATE POLICY margin_matrix_entries_insert
  ON public.margin_matrix_entries
  FOR INSERT
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'manager', 'owner')
  );

DROP POLICY IF EXISTS margin_matrix_entries_update ON public.margin_matrix_entries;
CREATE POLICY margin_matrix_entries_update
  ON public.margin_matrix_entries
  FOR UPDATE
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'manager', 'owner')
  )
  WITH CHECK (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'manager', 'owner')
  );

DROP POLICY IF EXISTS margin_matrix_entries_delete ON public.margin_matrix_entries;
CREATE POLICY margin_matrix_entries_delete
  ON public.margin_matrix_entries
  FOR DELETE
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role()) IN ('admin', 'manager', 'owner')
  );

COMMIT;
