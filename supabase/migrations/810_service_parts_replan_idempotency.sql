-- Migration 810: SP-REPLAN-PO-IDEMPOTENCY
--
-- A service requirement is the durable demand boundary. Planner replays now
-- reconcile that demand in one short, job-serialized transaction instead of
-- superseding actions, reserving stock, and inserting PO headers/lines through
-- separate HTTP statements.
--
-- Rollback (only before new planner data is relied upon): drop the RPC and
-- reservation trigger/table, drop the active-demand indexes, then drop the new
-- demand/link columns from service_parts_actions and purchase_order_lines.

BEGIN;

ALTER TABLE public.service_parts_actions
  ADD COLUMN IF NOT EXISTS service_demand_key text,
  ADD COLUMN IF NOT EXISTS demand_fingerprint text,
  ADD COLUMN IF NOT EXISTS demand_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_order_line_id uuid REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS service_demand_key text,
  ADD COLUMN IF NOT EXISTS demand_fingerprint text,
  ADD COLUMN IF NOT EXISTS demand_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_parts_actions_demand_version_positive_chk'
      AND conrelid = 'public.service_parts_actions'::regclass
  ) THEN
    ALTER TABLE public.service_parts_actions
      ADD CONSTRAINT service_parts_actions_demand_version_positive_chk
      CHECK (demand_version > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_demand_version_positive_chk'
      AND conrelid = 'public.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_demand_version_positive_chk
      CHECK (demand_version > 0) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.service_parts_actions.service_demand_key IS
  'Stable planner identity: service-requirement:<requirement UUID>. One open planner action may own this demand.';
COMMENT ON COLUMN public.service_parts_actions.demand_fingerprint IS
  'Canonical action/vendor/part/quantity/cost/route signature used to distinguish replay from replacement.';
COMMENT ON COLUMN public.service_parts_actions.demand_version IS
  'Monotonic audit version for replacements of the same service requirement demand.';
COMMENT ON COLUMN public.service_parts_actions.purchase_order_line_id IS
  'Exact surviving vendor PO line for an order action; po_reference mirrors its header po_number.';
COMMENT ON COLUMN public.purchase_order_lines.service_demand_key IS
  'Stable service-requirement demand identity. Active service PO lines are unique by workspace and this key.';
COMMENT ON COLUMN public.purchase_order_lines.superseded_at IS
  'When set, this vendor demand line was replaced or cancelled by a later service plan.';

-- Existing buggy re-plans can have several open rows. Give every historical
-- row an audit identity, then keep the newest as the canonical active demand.
WITH ranked AS (
  SELECT
    a.id,
    row_number() OVER (
      PARTITION BY a.workspace_id, a.requirement_id
      ORDER BY a.created_at, a.id
    )::integer AS demand_version
  FROM public.service_parts_actions a
  WHERE a.action_type IN ('pick', 'transfer', 'order')
)
UPDATE public.service_parts_actions a
SET service_demand_key = 'service-requirement:' || lower(a.requirement_id::text),
    demand_version = ranked.demand_version,
    demand_fingerprint = coalesce(
      nullif(a.metadata->>'demand_fingerprint', ''),
      'legacy|' || a.action_type::text || '|' || ranked.demand_version::text
    )
FROM ranked
WHERE ranked.id = a.id;

WITH ranked AS (
  SELECT
    l.id,
    row_number() OVER (
      PARTITION BY l.workspace_id, l.service_parts_requirement_id
      ORDER BY l.created_at, l.id
    )::integer AS demand_version
  FROM public.purchase_order_lines l
  WHERE l.service_parts_requirement_id IS NOT NULL
)
UPDATE public.purchase_order_lines l
SET service_demand_key = 'service-requirement:' || lower(l.service_parts_requirement_id::text),
    demand_version = ranked.demand_version,
    demand_fingerprint = coalesce(
      nullif(l.metadata->>'demand_fingerprint', ''),
      'legacy|order|' || ranked.demand_version::text
    )
FROM ranked
WHERE ranked.id = l.id;

UPDATE public.purchase_order_lines l
SET superseded_at = coalesce(l.superseded_at, now()),
    metadata = l.metadata || jsonb_build_object(
      'supersede_reason', 'migration_810_parent_po_not_active',
      'superseded_at', now()
    )
FROM public.purchase_orders p
WHERE p.id = l.purchase_order_id
  AND p.status IN ('received', 'closed', 'cancelled')
  AND l.service_demand_key IS NOT NULL
  AND l.status IN ('open', 'partial', 'backordered')
  AND l.superseded_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_parts_actions_demand_identity_chk'
      AND conrelid = 'public.service_parts_actions'::regclass
  ) THEN
    ALTER TABLE public.service_parts_actions
      ADD CONSTRAINT service_parts_actions_demand_identity_chk
      CHECK (
        action_type NOT IN ('pick', 'transfer', 'order')
        OR completed_at IS NOT NULL
        OR superseded_at IS NOT NULL
        OR (
          service_demand_key = 'service-requirement:' || lower(requirement_id::text)
          AND demand_fingerprint IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_service_demand_identity_chk'
      AND conrelid = 'public.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE public.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_service_demand_identity_chk
      CHECK (
        service_parts_requirement_id IS NULL
        OR (
          service_demand_key = 'service-requirement:' || lower(service_parts_requirement_id::text)
          AND demand_fingerprint IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.service_parts_actions
  VALIDATE CONSTRAINT service_parts_actions_demand_identity_chk;
ALTER TABLE public.purchase_order_lines
  VALIDATE CONSTRAINT purchase_order_lines_service_demand_identity_chk;

WITH duplicate_active_lines AS (
  SELECT id
  FROM (
    SELECT
      l.id,
      row_number() OVER (
        PARTITION BY l.workspace_id, l.service_demand_key
        ORDER BY
          CASE
            WHEN p.status IN ('submitted', 'acknowledged', 'partial_received', 'backordered') THEN 0
            WHEN p.status = 'draft' THEN 1
            ELSE 2
          END,
          l.created_at DESC,
          l.id DESC
      ) AS active_rank
    FROM public.purchase_order_lines l
    JOIN public.purchase_orders p ON p.id = l.purchase_order_id
    WHERE l.service_demand_key IS NOT NULL
      AND l.status IN ('open', 'partial', 'backordered')
      AND l.superseded_at IS NULL
      AND p.deleted_at IS NULL
  ) ranked
  WHERE active_rank > 1
)
UPDATE public.purchase_order_lines l
SET status = 'cancelled',
    superseded_at = now(),
    metadata = l.metadata || jsonb_build_object(
      'supersede_reason', 'migration_810_duplicate_active_demand',
      'superseded_at', now()
    )
WHERE l.id IN (SELECT id FROM duplicate_active_lines);

WITH duplicate_active_actions AS (
  SELECT id
  FROM (
    SELECT
      a.id,
      row_number() OVER (
        PARTITION BY a.workspace_id, a.requirement_id
        ORDER BY a.created_at DESC, a.id DESC
      ) AS active_rank
    FROM public.service_parts_actions a
    WHERE a.action_type IN ('pick', 'transfer', 'order')
      AND a.completed_at IS NULL
      AND a.superseded_at IS NULL
  ) ranked
  WHERE active_rank > 1
)
UPDATE public.service_parts_actions a
SET superseded_at = now(),
    metadata = a.metadata || jsonb_build_object(
      'supersede_reason', 'migration_810_duplicate_active_demand',
      'superseded_at', now()
    )
WHERE a.id IN (SELECT id FROM duplicate_active_actions);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_parts_actions_active_demand
  ON public.service_parts_actions (workspace_id, requirement_id)
  WHERE action_type IN ('pick', 'transfer', 'order')
    AND completed_at IS NULL
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_order_lines_active_service_demand
  ON public.purchase_order_lines (workspace_id, service_demand_key)
  WHERE service_demand_key IS NOT NULL
    AND status IN ('open', 'partial', 'backordered')
    AND superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_parts_actions_demand_audit
  ON public.service_parts_actions (workspace_id, service_demand_key, demand_version DESC)
  WHERE service_demand_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_demand_audit
  ON public.purchase_order_lines (workspace_id, service_demand_key, demand_version DESC)
  WHERE service_demand_key IS NOT NULL;

-- Make the surviving action point at the surviving PO line/header and keep the
-- legacy string reference synchronized for the vendor escalator.
WITH candidates AS (
  SELECT
    a.id AS action_id,
    p.id AS purchase_order_id,
    l.id AS purchase_order_line_id,
    p.po_number,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY l.created_at DESC, l.id DESC
    ) AS candidate_rank
  FROM public.service_parts_actions a
  JOIN public.purchase_order_lines l
    ON l.workspace_id = a.workspace_id
   AND l.service_parts_requirement_id = a.requirement_id
   AND l.status IN ('open', 'partial', 'backordered')
   AND l.superseded_at IS NULL
  JOIN public.purchase_orders p
    ON p.id = l.purchase_order_id
   AND p.deleted_at IS NULL
   AND p.status IN ('submitted', 'acknowledged', 'partial_received', 'backordered')
  WHERE a.action_type = 'order'
    AND a.completed_at IS NULL
    AND a.superseded_at IS NULL
)
UPDATE public.service_parts_actions a
SET purchase_order_id = candidates.purchase_order_id,
    purchase_order_line_id = candidates.purchase_order_line_id,
    po_reference = candidates.po_number
FROM candidates
WHERE candidates.action_id = a.id
  AND candidates.candidate_rank = 1;

UPDATE public.purchase_orders p
SET status = 'cancelled',
    metadata = p.metadata || jsonb_build_object(
      'cancel_reason', 'migration_810_no_surviving_service_demand',
      'cancelled_at', now()
    )
WHERE p.status IN ('draft', 'submitted', 'acknowledged', 'backordered')
  AND p.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.purchase_order_lines any_line
    WHERE any_line.purchase_order_id = p.id
      AND any_line.service_parts_requirement_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.purchase_order_lines active_line
    WHERE active_line.purchase_order_id = p.id
      AND active_line.status IN ('open', 'partial', 'backordered')
      AND active_line.superseded_at IS NULL
  );

-- m796 exposed low-level SECURITY DEFINER stock primitives directly to every
-- authenticated caller. Those functions accept a workspace argument and run
-- as their owner, so RLS cannot repair a missing tenant check. The resolver is
-- now private to trusted definer functions/service callers; the one direct
-- application primitive (strict counter pick) keeps authenticated EXECUTE but
-- validates both workspace and the canonical parts roles. Reservation
-- mutation is only reachable through the planner/fulfillment RPCs so the
-- durable ledger cannot be bypassed.
REVOKE EXECUTE ON FUNCTION public.qep_resolve_parts_stock_row(text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qep_resolve_parts_stock_row(text, text, text, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.adjust_parts_inventory_delta_strict(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_delta integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
      OR p_workspace_id IS DISTINCT FROM public.get_my_workspace()
      OR public.get_my_role()::text NOT IN (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
        'parts_counter'
      )
    THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGES' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_workspace_id IS NULL OR btrim(p_workspace_id) = ''
    OR p_branch_id IS NULL OR btrim(p_branch_id) = ''
    OR length(btrim(coalesce(p_part_number, ''))) = 0
  THEN
    RAISE EXCEPTION 'missing_workspace_branch_or_part' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_delta, 0) = 0 THEN
    RETURN;
  END IF;

  v_stock_id := public.qep_resolve_parts_stock_row(
    p_workspace_id,
    p_branch_id,
    p_part_number,
    p_delta > 0
  );
  IF v_stock_id IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  SELECT qty_on_hand, qty_reserved INTO v_on_hand, v_reserved
  FROM public.parts_stock
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;
  IF p_delta < 0 AND (v_on_hand - v_reserved + p_delta) < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.parts_stock
  SET qty_on_hand = v_on_hand + p_delta,
      updated_at = now()
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_parts_inventory_delta_strict(text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_parts_inventory_delta_strict(text, text, text, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_service_part(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
      OR p_workspace_id IS DISTINCT FROM public.get_my_workspace()
      OR public.get_my_role()::text NOT IN (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
        'parts_counter'
      )
    THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGES' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_workspace_id IS NULL OR btrim(p_workspace_id) = ''
    OR p_branch_id IS NULL OR btrim(p_branch_id) = ''
    OR length(btrim(coalesce(p_part_number, ''))) = 0
  THEN
    RAISE EXCEPTION 'missing_workspace_branch_or_part' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_qty, 0) <= 0 THEN
    RETURN false;
  END IF;

  v_stock_id := public.qep_resolve_parts_stock_row(
    p_workspace_id, p_branch_id, p_part_number, false
  );
  IF v_stock_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT qty_on_hand, qty_reserved INTO v_on_hand, v_reserved
  FROM public.parts_stock
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR (v_on_hand - v_reserved) < p_qty THEN
    RETURN false;
  END IF;

  UPDATE public.parts_stock
  SET qty_reserved = v_reserved + p_qty,
      updated_at = now()
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_service_part_reservation(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stock_id uuid;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
      OR p_workspace_id IS DISTINCT FROM public.get_my_workspace()
      OR public.get_my_role()::text NOT IN (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
        'parts_counter'
      )
    THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGES' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_workspace_id IS NULL OR btrim(p_workspace_id) = ''
    OR p_branch_id IS NULL OR btrim(p_branch_id) = ''
    OR length(btrim(coalesce(p_part_number, ''))) = 0
  THEN
    RAISE EXCEPTION 'missing_workspace_branch_or_part' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_qty, 0) <= 0 THEN
    RETURN;
  END IF;

  v_stock_id := public.qep_resolve_parts_stock_row(
    p_workspace_id, p_branch_id, p_part_number, false
  );
  IF v_stock_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.parts_stock
  SET qty_reserved = greatest(0, qty_reserved - p_qty),
      updated_at = now()
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_reserved_part(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
BEGIN
  IF (select auth.role()) IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
      OR p_workspace_id IS DISTINCT FROM public.get_my_workspace()
      OR public.get_my_role()::text NOT IN (
        'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
        'parts_counter'
      )
    THEN
      RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGES' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_workspace_id IS NULL OR btrim(p_workspace_id) = ''
    OR p_branch_id IS NULL OR btrim(p_branch_id) = ''
    OR length(btrim(coalesce(p_part_number, ''))) = 0
  THEN
    RAISE EXCEPTION 'missing_workspace_branch_or_part' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_qty, 0) <= 0 THEN
    RETURN;
  END IF;

  v_stock_id := public.qep_resolve_parts_stock_row(
    p_workspace_id, p_branch_id, p_part_number, false
  );
  IF v_stock_id IS NULL THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  SELECT qty_on_hand, qty_reserved INTO v_on_hand, v_reserved
  FROM public.parts_stock
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR v_on_hand < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.parts_stock
  SET qty_on_hand = v_on_hand - p_qty,
      qty_reserved = greatest(0, v_reserved - p_qty),
      updated_at = now()
  WHERE id = v_stock_id
    AND workspace_id = p_workspace_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_service_part(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_service_part_reservation(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_reserved_part(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_service_part(text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_service_part_reservation(text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_reserved_part(text, text, text, integer)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.service_parts_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT public.get_my_workspace(),
  requirement_id uuid NOT NULL REFERENCES public.service_parts_requirements(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  branch_id text NOT NULL,
  part_number text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  demand_fingerprint text NOT NULL,
  demand_version integer NOT NULL CHECK (demand_version > 0),
  plan_batch_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'consumed')),
  release_reason text,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_parts_reservations IS
  'Requirement-level audit ledger behind parts_stock.qty_reserved. Replans reuse, release, or replace exactly one active hold.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_parts_reservations_active_requirement
  ON public.service_parts_reservations (workspace_id, requirement_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_service_parts_reservations_job_audit
  ON public.service_parts_reservations (workspace_id, job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_parts_reservations_active_job
  ON public.service_parts_reservations (workspace_id, job_id, requirement_id)
  WHERE status = 'active';

ALTER TABLE public.service_parts_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_parts_reservations_workspace_select
  ON public.service_parts_reservations;
CREATE POLICY service_parts_reservations_workspace_select
  ON public.service_parts_reservations FOR SELECT TO authenticated
  USING (
    workspace_id = (select public.get_my_workspace())
    AND (select public.get_my_role())::text IN (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
      'parts_counter'
    )
  );

DROP POLICY IF EXISTS service_parts_reservations_service_all
  ON public.service_parts_reservations;
CREATE POLICY service_parts_reservations_service_all
  ON public.service_parts_reservations FOR ALL TO service_role
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

DROP TRIGGER IF EXISTS set_service_parts_reservations_updated_at
  ON public.service_parts_reservations;
CREATE TRIGGER set_service_parts_reservations_updated_at
  BEFORE UPDATE ON public.service_parts_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Attribute legacy open pick holds before the new planner sees them. A changed
-- plan will release this row and reserve the replacement in the same RPC.
INSERT INTO public.service_parts_reservations (
  workspace_id,
  requirement_id,
  job_id,
  branch_id,
  part_number,
  quantity,
  demand_fingerprint,
  demand_version,
  plan_batch_id,
  status
)
SELECT
  a.workspace_id,
  a.requirement_id,
  a.job_id,
  j.branch_id,
  r.part_number,
  greatest(1, r.quantity),
  a.demand_fingerprint,
  a.demand_version,
  coalesce(a.plan_batch_id, gen_random_uuid()),
  'active'
FROM public.service_parts_actions a
JOIN public.service_parts_requirements r ON r.id = a.requirement_id
JOIN public.service_jobs j ON j.id = a.job_id
WHERE a.action_type = 'pick'
  AND a.completed_at IS NULL
  AND a.superseded_at IS NULL
  AND j.branch_id IS NOT NULL
ON CONFLICT (workspace_id, requirement_id) WHERE status = 'active'
DO NOTHING;

-- m796 had no owner ledger, so repeated plans could increment qty_reserved
-- several times and completed/removed actions could leave a phantom hold. The
-- only writers in the pre-810 schema are service picks and interbranch
-- transfers. Rebuild each stock row from those two durable owners, and emit a
-- data-quality exception for every correction so the deployment is auditable.
WITH service_owned AS (
  SELECT
    resolved.stock_id,
    sum(r.quantity)::numeric AS owned_quantity
  FROM public.service_parts_reservations r
  CROSS JOIN LATERAL (
    SELECT public.qep_resolve_parts_stock_row(
      r.workspace_id,
      r.branch_id,
      r.part_number,
      false
    ) AS stock_id
  ) resolved
  WHERE r.status = 'active'
    AND resolved.stock_id IS NOT NULL
  GROUP BY resolved.stock_id
),
transfer_owned AS (
  SELECT
    (l.metadata->>'reserved_from_stock_id')::uuid AS stock_id,
    sum(l.qty_reserved)::numeric AS owned_quantity
  FROM public.parts_transfer_lines l
  JOIN public.parts_transfers t
    ON t.id = l.transfer_id
   AND t.workspace_id = l.workspace_id
   AND t.deleted_at IS NULL
   AND t.status IN ('requested', 'approved', 'picked', 'in_transit')
  WHERE l.status IN ('open', 'picked', 'in_transit')
    AND l.qty_reserved > 0
    AND (l.metadata->>'reserved_from_stock_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  GROUP BY (l.metadata->>'reserved_from_stock_id')::uuid
),
expected AS (
  SELECT
    s.id AS stock_id,
    s.workspace_id,
    s.qty_reserved AS quantity_before,
    coalesce(service_owned.owned_quantity, 0) AS service_owned_quantity,
    coalesce(transfer_owned.owned_quantity, 0) AS transfer_owned_quantity,
    coalesce(service_owned.owned_quantity, 0) +
      coalesce(transfer_owned.owned_quantity, 0) AS quantity_after
  FROM public.parts_stock s
  LEFT JOIN service_owned ON service_owned.stock_id = s.id
  LEFT JOIN transfer_owned ON transfer_owned.stock_id = s.id
  WHERE s.deleted_at IS NULL
),
adjusted AS (
  UPDATE public.parts_stock s
  SET qty_reserved = expected.quantity_after,
      updated_at = now()
  FROM expected
  WHERE s.id = expected.stock_id
    AND s.qty_reserved IS DISTINCT FROM expected.quantity_after
  RETURNING
    s.id,
    s.workspace_id,
    expected.quantity_before,
    expected.service_owned_quantity,
    expected.transfer_owned_quantity,
    expected.quantity_after
)
INSERT INTO public.exception_queue (
  workspace_id,
  source,
  severity,
  title,
  detail,
  payload,
  entity_table,
  entity_id
)
SELECT
  adjusted.workspace_id,
  'data_quality',
  'warn',
  'Parts reservation ownership reconciled during migration 810',
  format(
    'parts_stock.qty_reserved changed from %s to %s after rebuilding durable service and transfer ownership.',
    adjusted.quantity_before,
    adjusted.quantity_after
  ),
  jsonb_build_object(
    'migration', 810,
    'quantity_before', adjusted.quantity_before,
    'service_owned_quantity', adjusted.service_owned_quantity,
    'transfer_owned_quantity', adjusted.transfer_owned_quantity,
    'quantity_after', adjusted.quantity_after,
    'released_unowned_quantity', greatest(
      adjusted.quantity_before - adjusted.quantity_after,
      0
    ),
    'restored_missing_quantity', greatest(
      adjusted.quantity_after - adjusted.quantity_before,
      0
    )
  ),
  'parts_stock',
  adjusted.id
FROM adjusted;

CREATE OR REPLACE FUNCTION public.finalize_service_parts_reservation_on_pick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res public.service_parts_reservations%rowtype;
BEGIN
  IF NEW.action_type <> 'pick'
    OR NEW.completed_at IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_res
  FROM public.service_parts_reservations
  WHERE workspace_id = NEW.workspace_id
    AND requirement_id = NEW.requirement_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Normal fulfillment already decremented qty_reserved through
  -- consume_reserved_part. Manager override bypasses that path, so release its
  -- hold here before closing the audit row.
  IF NEW.metadata ? 'override_reason' THEN
    PERFORM public.release_service_part_reservation(
      v_res.workspace_id,
      v_res.branch_id,
      v_res.part_number,
      v_res.quantity
    );
  END IF;

  UPDATE public.service_parts_reservations
  SET status = 'consumed',
      consumed_at = now(),
      release_reason = CASE
        WHEN NEW.metadata ? 'override_reason' THEN 'manager_override_pick'
        ELSE 'fulfilled_pick'
      END
  WHERE id = v_res.id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_service_parts_reservation_on_pick()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS service_parts_reservation_completed_pick_trg
  ON public.service_parts_actions;
CREATE TRIGGER service_parts_reservation_completed_pick_trg
  AFTER INSERT ON public.service_parts_actions
  FOR EACH ROW EXECUTE FUNCTION public.finalize_service_parts_reservation_on_pick();

CREATE OR REPLACE FUNCTION public.reconcile_service_parts_plan(
  p_workspace_id text,
  p_job_id uuid,
  p_actor_id uuid,
  p_plan_batch_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job record;
  v_item jsonb;
  v_transfer_item jsonb;
  v_req public.service_parts_requirements%rowtype;
  v_existing_action public.service_parts_actions%rowtype;
  v_res public.service_parts_reservations%rowtype;
  v_existing_found boolean;
  v_reuse boolean;
  v_reserved boolean;
  v_requirement_id uuid;
  v_action_type text;
  v_next_status text;
  v_from_branch text;
  v_to_branch text;
  v_expected_at timestamptz;
  v_need_by timestamptz;
  v_quantity integer;
  v_unit_cost_cents bigint;
  v_demand_key text;
  v_fingerprint text;
  v_version integer;
  v_metadata jsonb;
  v_po_id uuid;
  v_po_line_id uuid;
  v_action_id uuid;
  v_po_number text;
  v_line_number integer;
  v_stock_id uuid;
  v_traffic_ticket_id uuid;
  v_latest_arrival timestamptz;
  v_rows integer;
  v_actions_created integer := 0;
  v_actions_reused integer := 0;
  v_actions_superseded integer := 0;
  v_requirements_updated integer := 0;
  v_pos_created integer := 0;
  v_po_lines_created integer := 0;
  v_reservations_created integer := 0;
  v_reservations_released integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
    OR btrim(p_workspace_id) = ''
    OR p_workspace_id IS DISTINCT FROM public.get_my_workspace()
  THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.get_my_role()::text NOT IN (
    'rep', 'admin', 'manager', 'owner', 'service_writer', 'dispatch',
    'parts_counter'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL OR p_plan_batch_id IS NULL THEN
    RAISE EXCEPTION 'job_id and plan_batch_id are required' USING ERRCODE = '22023';
  END IF;
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'array' THEN
    RAISE EXCEPTION 'plan must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_plan) > 1000 THEN
    RAISE EXCEPTION 'plan exceeds 1000 requirements' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_plan) item
    GROUP BY item->>'requirement_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate requirement in plan' USING ERRCODE = '22023';
  END IF;

  -- One job is the smallest useful serialization boundary. The advisory lock
  -- serializes two planners, while row locks use the same global order as the
  -- live fulfillment RPC: requirement(s) -> job -> stock. Lock every
  -- requirement in UUID order before touching the job so a concurrent
  -- fulfillment call (which already locks requirement then job in m798) cannot
  -- deadlock with a re-plan.
  PERFORM pg_advisory_xact_lock(
    hashtext('service_parts_plan:' || p_workspace_id),
    hashtext(p_job_id::text)
  );

  PERFORM r.id
  FROM public.service_parts_requirements r
  WHERE r.workspace_id = p_workspace_id
    AND r.job_id = p_job_id
  ORDER BY r.id
  FOR UPDATE;

  SELECT id, workspace_id, branch_id, scheduled_start_at
  INTO STRICT v_job
  FROM public.service_jobs
  WHERE id = p_job_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  -- The edge filters post-procurement rows for normal calls, but this definer
  -- RPC is independently callable. Refuse stale or handcrafted plans that try
  -- to reopen received/staged/consumed/returned/cancelled work.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_plan) item
    LEFT JOIN public.service_parts_requirements r
      ON r.id = (item->>'requirement_id')::uuid
     AND r.workspace_id = p_workspace_id
     AND r.job_id = p_job_id
    WHERE r.id IS NULL
      OR r.status NOT IN ('pending', 'picking', 'transferring', 'ordering')
      OR coalesce(r.intake_line_status, 'accepted') = 'suggested'
  ) THEN
    RAISE EXCEPTION 'plan contains terminal or ineligible service requirement'
      USING ERRCODE = '22023';
  END IF;

  -- Different jobs can compete for the same shelf rows. Resolve every stock
  -- row this transaction may release or reserve, then pre-lock those rows by
  -- UUID before performing any mutation. Fulfillment follows the same
  -- requirement -> job -> stock order, eliminating the inverse lock path.
  FOR v_stock_id IN
    WITH stock_keys AS (
      SELECT
        r.workspace_id,
        r.branch_id,
        r.part_number
      FROM public.service_parts_reservations r
      WHERE r.workspace_id = p_workspace_id
        AND r.job_id = p_job_id
        AND r.status = 'active'

      UNION

      SELECT
        p_workspace_id,
        v_job.branch_id::text,
        req.part_number
      FROM jsonb_array_elements(p_plan) item
      JOIN public.service_parts_requirements req
        ON req.id = (item->>'requirement_id')::uuid
       AND req.workspace_id = p_workspace_id
       AND req.job_id = p_job_id
      WHERE item->>'action_type' = 'pick'
        AND v_job.branch_id IS NOT NULL
    ),
    stock_ids AS (
      SELECT DISTINCT public.qep_resolve_parts_stock_row(
        stock_keys.workspace_id,
        stock_keys.branch_id,
        stock_keys.part_number,
        false
      ) AS id
      FROM stock_keys
      WHERE stock_keys.branch_id IS NOT NULL
        AND btrim(stock_keys.branch_id) <> ''
        AND btrim(stock_keys.part_number) <> ''
    )
    SELECT s.id
    FROM public.parts_stock s
    JOIN stock_ids ON stock_ids.id = s.id
    WHERE s.workspace_id = p_workspace_id
      AND s.deleted_at IS NULL
    ORDER BY s.id
  LOOP
    PERFORM 1
    FROM public.parts_stock s
    WHERE s.id = v_stock_id
      AND s.workspace_id = p_workspace_id
    FOR UPDATE;
  END LOOP;

  -- Reuse the active transfer ticket on a true replay. Otherwise create the
  -- replacement ticket inside this transaction so it cannot be orphaned by a
  -- later PO/action failure.
  SELECT t.id INTO v_traffic_ticket_id
  FROM public.service_parts_actions a
  JOIN public.traffic_tickets t
    ON t.id::text = a.metadata->>'traffic_ticket_id'
   AND t.workspace_id = a.workspace_id
   AND t.status <> 'completed'
  WHERE a.workspace_id = p_workspace_id
    AND a.job_id = p_job_id
    AND a.action_type = 'transfer'
    AND a.completed_at IS NULL
    AND a.superseded_at IS NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_plan) item
      WHERE item->>'action_type' = 'transfer'
        AND (item->>'requirement_id')::uuid = a.requirement_id
        AND item->>'demand_fingerprint' = a.demand_fingerprint
    )
  ORDER BY t.created_at DESC
  LIMIT 1
  FOR UPDATE OF t;

  SELECT item INTO v_transfer_item
  FROM jsonb_array_elements(p_plan) item
  WHERE item->>'action_type' = 'transfer'
  LIMIT 1;

  IF v_transfer_item IS NOT NULL AND v_traffic_ticket_id IS NULL THEN
    INSERT INTO public.traffic_tickets (
      workspace_id,
      stock_number,
      equipment_id,
      from_location,
      to_location,
      to_contact_name,
      to_contact_phone,
      shipping_date,
      department,
      billing_comments,
      ticket_type,
      status,
      requested_by,
      service_job_id
    ) VALUES (
      p_workspace_id,
      'PARTS-' || upper(left(replace(p_plan_batch_id::text, '-', ''), 10)),
      NULL,
      'Branch ' || coalesce(nullif(btrim(v_transfer_item->>'from_branch'), ''), 'unknown'),
      'Branch ' || coalesce(nullif(btrim(v_transfer_item->>'to_branch'), ''), 'unknown'),
      'Parts / Service',
      '—',
      current_date,
      'Service',
      format('Parts transfer plan %s for service job %s.', p_plan_batch_id, p_job_id),
      'location_transfer',
      'haul_pending',
      p_actor_id,
      p_job_id
    )
    RETURNING id INTO v_traffic_ticket_id;
  END IF;

  -- Demands absent from the new complete plan are explicitly released and
  -- superseded, including their PO line. This covers cancelled requirements.
  FOR v_existing_action IN
    SELECT a.*
    FROM public.service_parts_actions a
    WHERE a.workspace_id = p_workspace_id
      AND a.job_id = p_job_id
      AND a.action_type IN ('pick', 'transfer', 'order')
      AND a.completed_at IS NULL
      AND a.superseded_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_plan) item
        WHERE (item->>'requirement_id')::uuid = a.requirement_id
      )
    ORDER BY a.requirement_id
    FOR UPDATE
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.purchase_order_lines l
      WHERE l.workspace_id = p_workspace_id
        AND l.service_demand_key = v_existing_action.service_demand_key
        AND l.status IN ('open', 'partial', 'backordered')
        AND l.superseded_at IS NULL
        AND l.qty_received > 0
    ) THEN
      RAISE EXCEPTION 'SERVICE_PART_DEMAND_ALREADY_RECEIVED: %',
        v_existing_action.requirement_id USING ERRCODE = 'P0001';
    END IF;

    FOR v_res IN
      SELECT * FROM public.service_parts_reservations
      WHERE workspace_id = p_workspace_id
        AND requirement_id = v_existing_action.requirement_id
        AND status = 'active'
      FOR UPDATE
    LOOP
      PERFORM public.release_service_part_reservation(
        v_res.workspace_id, v_res.branch_id, v_res.part_number, v_res.quantity
      );
      UPDATE public.service_parts_reservations
      SET status = 'released', released_at = now(), release_reason = 'removed_from_plan'
      WHERE id = v_res.id;
      v_reservations_released := v_reservations_released + 1;
    END LOOP;

    UPDATE public.purchase_order_lines
    SET status = 'cancelled',
        superseded_at = now(),
        metadata = metadata || jsonb_build_object(
          'supersede_reason', 'removed_from_plan',
          'superseded_by_plan_batch_id', p_plan_batch_id
        )
    WHERE workspace_id = p_workspace_id
      AND service_demand_key = v_existing_action.service_demand_key
      AND status IN ('open', 'partial', 'backordered')
      AND superseded_at IS NULL;

    UPDATE public.service_parts_actions
    SET superseded_at = now(),
        metadata = metadata || jsonb_build_object(
          'supersede_reason', 'removed_from_plan',
          'superseded_by_plan_batch_id', p_plan_batch_id
        )
    WHERE id = v_existing_action.id;
    v_actions_superseded := v_actions_superseded + 1;
  END LOOP;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_plan) item
    ORDER BY item->>'requirement_id'
  LOOP
    v_requirement_id := (v_item->>'requirement_id')::uuid;
    v_action_type := lower(btrim(coalesce(v_item->>'action_type', '')));
    IF v_action_type NOT IN ('pick', 'transfer', 'order') THEN
      RAISE EXCEPTION 'invalid planner action_type' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_req
    FROM public.service_parts_requirements
    WHERE id = v_requirement_id
      AND workspace_id = p_workspace_id
      AND job_id = p_job_id
      AND status IN ('pending', 'picking', 'transferring', 'ordering')
      AND coalesce(intake_line_status, 'accepted') <> 'suggested'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid or ineligible service requirement: %', v_requirement_id
        USING ERRCODE = '22023';
    END IF;

    v_from_branch := nullif(btrim(v_item->>'from_branch'), '');
    v_to_branch := nullif(btrim(v_item->>'to_branch'), '');
    IF v_action_type = 'pick' THEN
      v_next_status := 'picking';
      v_from_branch := NULL;
      v_to_branch := NULL;
    ELSIF v_action_type = 'transfer' THEN
      v_next_status := 'transferring';
      IF v_from_branch IS NULL OR v_to_branch IS NULL THEN
        RAISE EXCEPTION 'transfer requires from_branch and to_branch'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_next_status := 'ordering';
      v_from_branch := NULL;
      v_to_branch := NULL;
    END IF;

    IF coalesce(v_item->>'next_line_status', '') <> v_next_status THEN
      RAISE EXCEPTION 'next_line_status does not match action_type'
        USING ERRCODE = '22023';
    END IF;

    v_expected_at := nullif(v_item->>'expected_date', '')::timestamptz;
    v_need_by := nullif(v_item->>'need_by_date', '')::timestamptz;
    v_quantity := greatest(1, coalesce(v_req.quantity, 1));
    v_unit_cost_cents := greatest(
      0,
      round(coalesce(v_req.unit_cost, 0) * 100)::bigint
    );
    v_demand_key := 'service-requirement:' || lower(v_requirement_id::text);
    v_fingerprint := concat_ws(
      '|',
      'v1',
      v_action_type,
      coalesce(lower(v_req.vendor_id::text), '-'),
      upper(regexp_replace(btrim(v_req.part_number), '\s+', '', 'g')),
      v_quantity::text,
      v_unit_cost_cents::text,
      coalesce(lower(v_from_branch), '-'),
      coalesce(lower(v_to_branch), '-')
    );

    IF v_item->>'demand_key' IS DISTINCT FROM v_demand_key
      OR v_item->>'demand_fingerprint' IS DISTINCT FROM v_fingerprint
      OR nullif(v_item->>'vendor_id', '')::uuid IS DISTINCT FROM v_req.vendor_id
      OR coalesce((v_item->>'quantity')::integer, -1) <> v_quantity
      OR coalesce((v_item->>'unit_cost_cents')::bigint, -1) <> v_unit_cost_cents
      OR btrim(coalesce(v_item->>'part_number', '')) <> btrim(v_req.part_number)
    THEN
      RAISE EXCEPTION 'plan demand identity does not match current requirement: %',
        v_requirement_id USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(coalesce(v_item->'metadata', '{}'::jsonb)) <> 'object' THEN
      RAISE EXCEPTION 'plan metadata must be an object' USING ERRCODE = '22023';
    END IF;
    v_metadata := coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object(
      'service_demand_key', v_demand_key,
      'demand_fingerprint', v_fingerprint,
      'plan_batch_id', p_plan_batch_id
    );
    IF v_action_type = 'transfer' AND v_traffic_ticket_id IS NOT NULL THEN
      v_metadata := v_metadata || jsonb_build_object(
        'traffic_ticket_id', v_traffic_ticket_id,
        'from_branch', v_from_branch,
        'to_branch', v_to_branch
      );
    END IF;

    v_po_id := NULL;
    v_po_line_id := NULL;
    v_action_id := NULL;
    v_po_number := NULL;
    v_reuse := false;

    SELECT * INTO v_existing_action
    FROM public.service_parts_actions a
    WHERE a.workspace_id = p_workspace_id
      AND a.requirement_id = v_requirement_id
      AND a.action_type IN ('pick', 'transfer', 'order')
      AND a.completed_at IS NULL
      AND a.superseded_at IS NULL
    LIMIT 1
    FOR UPDATE;
    v_existing_found := FOUND;

    IF v_existing_found
      AND v_existing_action.action_type::text = v_action_type
      AND v_existing_action.demand_fingerprint = v_fingerprint
    THEN
      IF v_action_type = 'pick' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.service_parts_reservations r
          WHERE r.workspace_id = p_workspace_id
            AND r.requirement_id = v_requirement_id
            AND r.status = 'active'
            AND r.branch_id = v_job.branch_id::text
            AND btrim(r.part_number) = btrim(v_req.part_number)
            AND r.quantity = v_quantity
            AND r.demand_fingerprint = v_fingerprint
        ) INTO v_reuse;
      ELSIF v_action_type = 'transfer' THEN
        v_reuse := true;
      ELSE
        SELECT l.id, p.id, p.po_number
        INTO v_po_line_id, v_po_id, v_po_number
        FROM public.purchase_order_lines l
        JOIN public.purchase_orders p ON p.id = l.purchase_order_id
        WHERE l.workspace_id = p_workspace_id
          AND l.service_demand_key = v_demand_key
          AND l.demand_fingerprint = v_fingerprint
          AND l.status IN ('open', 'partial', 'backordered')
          AND l.superseded_at IS NULL
          AND p.status IN ('submitted', 'acknowledged', 'partial_received', 'backordered')
          AND p.deleted_at IS NULL
        LIMIT 1
        FOR UPDATE OF l, p;
        v_reuse := FOUND;
      END IF;
    END IF;

    IF v_reuse THEN
      IF v_action_type = 'order' THEN
        UPDATE public.purchase_order_lines
        SET expected_at = v_expected_at,
            metadata = metadata || jsonb_build_object(
              'last_replanned_at', now(),
              'last_plan_batch_id', p_plan_batch_id
            )
        WHERE id = v_po_line_id;
      END IF;

      UPDATE public.service_parts_actions
      SET expected_date = v_expected_at,
          po_reference = CASE WHEN v_action_type = 'order' THEN v_po_number ELSE NULL END,
          purchase_order_id = CASE WHEN v_action_type = 'order' THEN v_po_id ELSE NULL END,
          purchase_order_line_id = CASE WHEN v_action_type = 'order' THEN v_po_line_id ELSE NULL END,
          metadata = metadata || jsonb_build_object(
            'last_replanned_at', now(),
            'last_plan_batch_id', p_plan_batch_id
          ) || CASE
            WHEN v_action_type = 'transfer' AND v_traffic_ticket_id IS NOT NULL
              THEN jsonb_build_object('traffic_ticket_id', v_traffic_ticket_id)
            ELSE '{}'::jsonb
          END
      WHERE id = v_existing_action.id;

      UPDATE public.service_parts_requirements
      SET status = v_next_status,
          need_by_date = v_need_by,
          intake_line_status = 'planned',
          updated_at = now()
      WHERE id = v_requirement_id;

      v_actions_reused := v_actions_reused + 1;
      v_requirements_updated := v_requirements_updated + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.purchase_order_lines l
      WHERE l.workspace_id = p_workspace_id
        AND l.service_demand_key = v_demand_key
        AND l.status IN ('open', 'partial', 'backordered')
        AND l.superseded_at IS NULL
        AND l.qty_received > 0
    ) THEN
      RAISE EXCEPTION 'SERVICE_PART_DEMAND_ALREADY_RECEIVED: %', v_requirement_id
        USING ERRCODE = 'P0001';
    END IF;

    SELECT greatest(
      coalesce((
        SELECT max(a.demand_version)
        FROM public.service_parts_actions a
        WHERE a.workspace_id = p_workspace_id
          AND a.requirement_id = v_requirement_id
      ), 0),
      coalesce((
        SELECT max(l.demand_version)
        FROM public.purchase_order_lines l
        WHERE l.workspace_id = p_workspace_id
          AND l.service_demand_key = v_demand_key
      ), 0)
    ) + 1 INTO v_version;

    FOR v_res IN
      SELECT * FROM public.service_parts_reservations
      WHERE workspace_id = p_workspace_id
        AND requirement_id = v_requirement_id
        AND status = 'active'
      FOR UPDATE
    LOOP
      PERFORM public.release_service_part_reservation(
        v_res.workspace_id, v_res.branch_id, v_res.part_number, v_res.quantity
      );
      UPDATE public.service_parts_reservations
      SET status = 'released',
          released_at = now(),
          release_reason = 'replanned_demand_replacement'
      WHERE id = v_res.id;
      v_reservations_released := v_reservations_released + 1;
    END LOOP;

    UPDATE public.purchase_order_lines
    SET status = 'cancelled',
        superseded_at = now(),
        metadata = metadata || jsonb_build_object(
          'supersede_reason', 'replanned_demand_replacement',
          'replacement_fingerprint', v_fingerprint,
          'superseded_by_plan_batch_id', p_plan_batch_id
        )
    WHERE workspace_id = p_workspace_id
      AND service_demand_key = v_demand_key
      AND status IN ('open', 'partial', 'backordered')
      AND superseded_at IS NULL;

    UPDATE public.service_parts_actions
    SET superseded_at = now(),
        metadata = metadata || jsonb_build_object(
          'supersede_reason', 'replanned_demand_replacement',
          'replacement_fingerprint', v_fingerprint,
          'superseded_by_plan_batch_id', p_plan_batch_id
        )
    WHERE workspace_id = p_workspace_id
      AND requirement_id = v_requirement_id
      AND action_type IN ('pick', 'transfer', 'order')
      AND completed_at IS NULL
      AND superseded_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_actions_superseded := v_actions_superseded + v_rows;

    IF v_action_type = 'pick' THEN
      IF v_job.branch_id IS NULL THEN
        RAISE EXCEPTION 'SERVICE_PART_RESERVATION_UNAVAILABLE: job branch is required'
          USING ERRCODE = 'P0001';
      END IF;
      SELECT public.reserve_service_part(
        p_workspace_id,
        v_job.branch_id::text,
        v_req.part_number,
        v_quantity
      ) INTO v_reserved;
      IF v_reserved IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'SERVICE_PART_RESERVATION_UNAVAILABLE: %', v_requirement_id
          USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.service_parts_reservations (
        workspace_id, requirement_id, job_id, branch_id, part_number,
        quantity, demand_fingerprint, demand_version, plan_batch_id, status
      ) VALUES (
        p_workspace_id, v_requirement_id, p_job_id, v_job.branch_id::text,
        v_req.part_number, v_quantity, v_fingerprint, v_version,
        p_plan_batch_id, 'active'
      )
      ON CONFLICT (workspace_id, requirement_id) WHERE status = 'active'
      DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        part_number = EXCLUDED.part_number,
        quantity = EXCLUDED.quantity,
        demand_fingerprint = EXCLUDED.demand_fingerprint,
        demand_version = EXCLUDED.demand_version,
        plan_batch_id = EXCLUDED.plan_batch_id,
        updated_at = now();
      v_reservations_created := v_reservations_created + 1;
    ELSIF v_action_type = 'order' THEN
      SELECT p.id, p.po_number INTO v_po_id, v_po_number
      FROM public.purchase_orders p
      WHERE p.workspace_id = p_workspace_id
        AND p.status = 'submitted'
        AND p.order_type = 'special_order'
        AND p.deleted_at IS NULL
        AND p.vendor_id IS NOT DISTINCT FROM v_req.vendor_id
        AND p.metadata->>'source' = 'service_parts_planner'
        AND p.metadata->>'service_job_id' = p_job_id::text
      ORDER BY p.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        v_po_number := 'SP-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
          upper(left(replace(gen_random_uuid()::text, '-', ''), 10));
        INSERT INTO public.purchase_orders (
          workspace_id, po_number, vendor_id, status, order_type, ordered_by,
          ordered_at, expected_at, metadata
        ) VALUES (
          p_workspace_id, v_po_number, v_req.vendor_id, 'submitted',
          'special_order', p_actor_id, now(), v_expected_at,
          jsonb_build_object(
            'source', 'service_parts_planner',
            'service_job_id', p_job_id,
            'created_by_plan_batch_id', p_plan_batch_id
          )
        ) RETURNING id INTO v_po_id;
        v_pos_created := v_pos_created + 1;
      END IF;

      -- The header row is locked before selecting max(line_number), keeping
      -- this allocation safe even if another trusted path adds a line.
      SELECT coalesce(max(line_number), 0) + 1 INTO v_line_number
      FROM public.purchase_order_lines
      WHERE purchase_order_id = v_po_id;

      INSERT INTO public.purchase_order_lines (
        workspace_id, purchase_order_id, line_number, part_number,
        qty_ordered, unit_cost_cents, expected_at, status,
        service_parts_requirement_id, service_demand_key,
        demand_fingerprint, demand_version, metadata
      ) VALUES (
        p_workspace_id, v_po_id, v_line_number, v_req.part_number,
        v_quantity, v_unit_cost_cents, v_expected_at, 'open',
        v_requirement_id, v_demand_key, v_fingerprint, v_version,
        jsonb_build_object(
          'source', 'service_parts_planner',
          'service_job_id', p_job_id,
          'plan_batch_id', p_plan_batch_id,
          'demand_fingerprint', v_fingerprint
        )
      ) RETURNING id INTO v_po_line_id;
      v_po_lines_created := v_po_lines_created + 1;
    END IF;

    INSERT INTO public.service_parts_actions (
      workspace_id, requirement_id, job_id, action_type, actor_id,
      from_branch, to_branch, vendor_id, po_reference, expected_date,
      plan_batch_id, metadata, service_demand_key, demand_fingerprint,
      demand_version, purchase_order_id, purchase_order_line_id
    ) VALUES (
      p_workspace_id, v_requirement_id, p_job_id,
      v_action_type::public.service_parts_action_type, p_actor_id,
      v_from_branch, v_to_branch, v_req.vendor_id, v_po_number, v_expected_at,
      p_plan_batch_id, v_metadata, v_demand_key, v_fingerprint, v_version,
      v_po_id, v_po_line_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_action_id;
    IF v_action_id IS NULL THEN
      RAISE EXCEPTION 'SERVICE_PART_ACTIVE_DEMAND_CONFLICT: %', v_requirement_id
        USING ERRCODE = '23505';
    END IF;

    UPDATE public.service_parts_requirements
    SET status = v_next_status,
        need_by_date = v_need_by,
        intake_line_status = 'planned',
        updated_at = now()
    WHERE id = v_requirement_id;

    v_actions_created := v_actions_created + 1;
    v_requirements_updated := v_requirements_updated + 1;
  END LOOP;

  SELECT max(nullif(item->>'expected_date', '')::timestamptz)
  INTO v_latest_arrival
  FROM jsonb_array_elements(p_plan) item
  WHERE item->>'action_type' <> 'pick';

  UPDATE public.service_jobs
  SET parts_delay_expected_at = CASE
    WHEN v_job.scheduled_start_at IS NOT NULL
      AND v_latest_arrival > v_job.scheduled_start_at
      THEN v_latest_arrival
    ELSE NULL
  END
  WHERE id = p_job_id;

  -- Headers with no surviving commitment are cancelled; surviving headers are
  -- recomputed from their active lines so action, line, and totals agree.
  UPDATE public.purchase_orders p
  SET status = 'cancelled',
      metadata = p.metadata || jsonb_build_object(
        'cancel_reason', 'service_plan_no_active_lines',
        'cancelled_by_plan_batch_id', p_plan_batch_id,
        'cancelled_at', now()
      )
  WHERE p.workspace_id = p_workspace_id
    AND p.deleted_at IS NULL
    AND p.status IN ('draft', 'submitted', 'acknowledged', 'backordered')
    AND EXISTS (
      SELECT 1
      FROM public.purchase_order_lines any_line
      JOIN public.service_parts_requirements r
        ON r.id = any_line.service_parts_requirement_id
      WHERE any_line.purchase_order_id = p.id
        AND r.job_id = p_job_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_lines active_line
      WHERE active_line.purchase_order_id = p.id
        AND active_line.status IN ('open', 'partial', 'backordered')
        AND active_line.superseded_at IS NULL
    );

  UPDATE public.purchase_orders p
  SET expected_at = summary.expected_at,
      subtotal_cents = summary.subtotal_cents,
      total_cents = summary.subtotal_cents + p.freight_cents + p.tax_cents,
      updated_at = now()
  FROM (
    SELECT
      l.purchase_order_id,
      max(l.expected_at) AS expected_at,
      round(sum(l.qty_ordered * l.unit_cost_cents))::bigint AS subtotal_cents
    FROM public.purchase_order_lines l
    WHERE l.status IN ('open', 'partial', 'backordered')
      AND l.superseded_at IS NULL
    GROUP BY l.purchase_order_id
  ) summary
  WHERE p.id = summary.purchase_order_id
    AND p.workspace_id = p_workspace_id
    AND p.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'status', CASE
      WHEN v_actions_created = 0 AND v_actions_superseded = 0
        THEN 'idempotent'
      ELSE 'reconciled'
    END,
    'plan_batch_id', p_plan_batch_id,
    'actions_created', v_actions_created,
    'actions_reused', v_actions_reused,
    'actions_superseded', v_actions_superseded,
    'requirements_updated', v_requirements_updated,
    'purchase_orders_created', v_pos_created,
    'purchase_order_lines_created', v_po_lines_created,
    'reservations_created', v_reservations_created,
    'reservations_released', v_reservations_released,
    'traffic_ticket_id', v_traffic_ticket_id
  );
END;
$$;

COMMENT ON FUNCTION public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb) IS
  'SP-REPLAN-PO-IDEMPOTENCY: authenticated, workspace-scoped, advisory-locked reconciliation of planner actions, shelf reservations, and service-linked vendor PO commitments.';

REVOKE EXECUTE ON FUNCTION public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
  TO authenticated;

COMMIT;
