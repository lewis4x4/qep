-- ============================================================================
-- Migration 667: G5.1 Multi-location stock + inter-branch transfers
--
-- Purpose:
--   Extend the Phase 3 Parts stock foundation with a customer-choice transfer
--   reservation contract. The counter can compare stocked branch-transfer
--   options against an OEM-order ETA, then reserve stock on the source
--   location when the customer chooses a transfer.
-- ============================================================================

BEGIN;

ALTER TABLE public.parts_transfers
  ADD COLUMN IF NOT EXISTS parts_order_id uuid REFERENCES public.parts_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_choice text NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS oem_order_eta_days integer,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_transfers_g51_customer_choice_ck'
      AND conrelid = 'public.parts_transfers'::regclass
  ) THEN
    ALTER TABLE public.parts_transfers
      ADD CONSTRAINT parts_transfers_g51_customer_choice_ck
      CHECK (customer_choice IN ('transfer', 'oem_order')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_transfers_g51_oem_eta_ck'
      AND conrelid = 'public.parts_transfers'::regclass
  ) THEN
    ALTER TABLE public.parts_transfers
      ADD CONSTRAINT parts_transfers_g51_oem_eta_ck
      CHECK (oem_order_eta_days IS NULL OR oem_order_eta_days >= 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.parts_transfer_lines
  ADD COLUMN IF NOT EXISTS qty_reserved numeric(14, 4) NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'parts_transfer_lines_g51_qty_reserved_requested_ck'
      AND conrelid = 'public.parts_transfer_lines'::regclass
  ) THEN
    ALTER TABLE public.parts_transfer_lines
      ADD CONSTRAINT parts_transfer_lines_g51_qty_reserved_requested_ck
      CHECK (qty_reserved <= qty_requested) NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_parts_transfers_order
  ON public.parts_transfers (workspace_id, parts_order_id, created_at DESC)
  WHERE parts_order_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_transfers_route_schedule
  ON public.parts_transfers (workspace_id, from_location_id, to_location_id, scheduled_at)
  WHERE status IN ('requested', 'approved', 'picked', 'in_transit')
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_stock_available_route
  ON public.parts_stock (workspace_id, part_id, location_id, branch_slug)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.parts_location_stock_options(
  p_part_id uuid,
  p_to_location_id uuid DEFAULT NULL,
  p_to_branch_slug text DEFAULT NULL,
  p_quantity numeric DEFAULT 1,
  p_workspace_id text DEFAULT NULL,
  p_oem_order_eta_days integer DEFAULT 3
)
RETURNS TABLE (
  option_type text,
  part_id uuid,
  from_location_id uuid,
  from_location_code text,
  from_location_name text,
  from_branch_slug text,
  to_location_id uuid,
  to_branch_slug text,
  available_qty numeric,
  requested_qty numeric,
  eta_days integer,
  scheduled_at timestamptz,
  customer_choice text,
  evidence jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH args AS (
    SELECT
      coalesce(nullif(btrim(p_workspace_id), ''), public.get_my_workspace()) AS workspace_id,
      p_part_id AS part_id,
      p_to_location_id AS to_location_id,
      nullif(lower(btrim(coalesce(p_to_branch_slug, ''))), '') AS to_branch_slug,
      greatest(coalesce(p_quantity, 1), 0.0001)::numeric(14, 4) AS requested_qty,
      greatest(coalesce(p_oem_order_eta_days, 3), 0) AS oem_eta_days
  ),
  target_location AS (
    SELECT
      l.id,
      l.branch_slug
    FROM public.parts_locations l
    JOIN args a ON a.workspace_id = l.workspace_id
    WHERE l.id = a.to_location_id
      AND l.deleted_at IS NULL
  ),
  transfer_options AS (
    SELECT
      'interbranch_transfer'::text AS option_type,
      s.part_id,
      s.location_id AS from_location_id,
      l.code AS from_location_code,
      l.name AS from_location_name,
      lower(coalesce(s.branch_slug, l.branch_slug)) AS from_branch_slug,
      a.to_location_id,
      coalesce(tl.branch_slug, a.to_branch_slug) AS to_branch_slug,
      greatest(s.qty_on_hand - s.qty_allocated - s.qty_reserved, 0)::numeric(14, 4) AS available_qty,
      a.requested_qty,
      greatest(ceil(coalesce(edge.lead_time_hours, 8) / 24.0), 1)::integer AS eta_days,
      now() + make_interval(hours => coalesce(edge.lead_time_hours, 8)::integer) AS scheduled_at,
      'transfer'::text AS customer_choice,
      jsonb_build_object(
        'source', 'parts_stock',
        'transfer_edge_id', edge.id,
        'lead_time_hours', coalesce(edge.lead_time_hours, 8),
        'meets_requested_qty', (s.qty_on_hand - s.qty_allocated - s.qty_reserved) >= a.requested_qty
      ) AS evidence
    FROM args a
    JOIN public.parts_stock s
      ON s.workspace_id = a.workspace_id
     AND s.part_id = a.part_id
     AND s.deleted_at IS NULL
    JOIN public.parts_locations l
      ON l.workspace_id = s.workspace_id
     AND l.id = s.location_id
     AND l.deleted_at IS NULL
    LEFT JOIN target_location tl ON true
    LEFT JOIN public.branch_transfer_edges edge
      ON edge.workspace_id = s.workspace_id
     AND edge.active = true
     AND lower(edge.from_branch) = lower(coalesce(s.branch_slug, l.branch_slug))
     AND lower(edge.to_branch) = lower(coalesce(tl.branch_slug, a.to_branch_slug))
    WHERE greatest(s.qty_on_hand - s.qty_allocated - s.qty_reserved, 0) > 0
      AND (
        a.to_location_id IS NULL
        OR s.location_id <> a.to_location_id
      )
  ),
  oem_order_option AS (
    SELECT
      'oem_order'::text AS option_type,
      a.part_id,
      NULL::uuid AS from_location_id,
      NULL::text AS from_location_code,
      NULL::text AS from_location_name,
      NULL::text AS from_branch_slug,
      a.to_location_id,
      coalesce(tl.branch_slug, a.to_branch_slug) AS to_branch_slug,
      0::numeric(14, 4) AS available_qty,
      a.requested_qty,
      a.oem_eta_days AS eta_days,
      now() + make_interval(days => a.oem_eta_days) AS scheduled_at,
      'oem_order'::text AS customer_choice,
      jsonb_build_object(
        'source', 'oem_order_eta',
        'oem_order_eta_days', a.oem_eta_days,
        'requires_transfer_reservation', false
      ) AS evidence
    FROM args a
    LEFT JOIN target_location tl ON true
  )
  SELECT
    options.option_type,
    options.part_id,
    options.from_location_id,
    options.from_location_code,
    options.from_location_name,
    options.from_branch_slug,
    options.to_location_id,
    options.to_branch_slug,
    options.available_qty,
    options.requested_qty,
    options.eta_days,
    options.scheduled_at,
    options.customer_choice,
    options.evidence
  FROM (
    SELECT
      option_type,
      part_id,
      from_location_id,
      from_location_code,
      from_location_name,
      from_branch_slug,
      to_location_id,
      to_branch_slug,
      available_qty,
      requested_qty,
      eta_days,
      scheduled_at,
      customer_choice,
      evidence
    FROM transfer_options

    UNION ALL

    SELECT
      option_type,
      part_id,
      from_location_id,
      from_location_code,
      from_location_name,
      from_branch_slug,
      to_location_id,
      to_branch_slug,
      available_qty,
      requested_qty,
      eta_days,
      scheduled_at,
      customer_choice,
      evidence
    FROM oem_order_option
  ) options

  ORDER BY
    CASE options.option_type WHEN 'interbranch_transfer' THEN 0 ELSE 1 END,
    options.eta_days,
    options.available_qty DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.parts_location_stock_options(uuid, uuid, text, numeric, text, integer) IS
  'G5.1 counter stock-choice contract: returns inter-branch transfer options plus an OEM-order fallback ETA for a requested part and destination.';

REVOKE ALL ON FUNCTION public.parts_location_stock_options(uuid, uuid, text, numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_location_stock_options(uuid, uuid, text, numeric, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.parts_reserve_interbranch_transfer(
  p_part_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity numeric DEFAULT 1,
  p_customer_choice text DEFAULT 'transfer',
  p_parts_order_id uuid DEFAULT NULL,
  p_requested_by uuid DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_oem_order_eta_days integer DEFAULT 3,
  p_workspace_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id text := coalesce(nullif(btrim(p_workspace_id), ''), public.get_my_workspace());
  v_choice text := lower(coalesce(nullif(btrim(p_customer_choice), ''), 'transfer'));
  v_quantity numeric(14, 4) := greatest(coalesce(p_quantity, 1), 0.0001)::numeric(14, 4);
  v_oem_eta_days integer := greatest(coalesce(p_oem_order_eta_days, 3), 0);
  v_stock record;
  v_available numeric(14, 4);
  v_lead_hours numeric(8, 2);
  v_scheduled_at timestamptz;
  v_transfer_id uuid;
  v_transfer_number text;
  v_line_id uuid;
BEGIN
  IF p_part_id IS NULL THEN
    RAISE EXCEPTION 'part_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_from_location_id IS NULL THEN
    RAISE EXCEPTION 'from_location_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'to_location_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'from_location_id and to_location_id must differ' USING ERRCODE = '22023';
  END IF;
  IF v_choice NOT IN ('transfer', 'oem_order') THEN
    RAISE EXCEPTION 'customer_choice must be transfer or oem_order' USING ERRCODE = '22023';
  END IF;

  IF v_choice = 'oem_order' THEN
    RETURN jsonb_build_object(
      'choice', 'oem_order',
      'status', 'no_transfer_reserved',
      'part_id', p_part_id,
      'to_location_id', p_to_location_id,
      'requested_qty', v_quantity,
      'oem_order_eta_days', v_oem_eta_days
    );
  END IF;

  SELECT
    s.id,
    s.workspace_id,
    s.qty_on_hand,
    s.qty_allocated,
    s.qty_reserved,
    fl.branch_slug AS from_branch_slug,
    tl.branch_slug AS to_branch_slug
  INTO v_stock
  FROM public.parts_stock s
  JOIN public.parts_locations fl
    ON fl.workspace_id = s.workspace_id
   AND fl.id = s.location_id
   AND fl.deleted_at IS NULL
  JOIN public.parts_locations tl
    ON tl.workspace_id = s.workspace_id
   AND tl.id = p_to_location_id
   AND tl.deleted_at IS NULL
  WHERE s.workspace_id = v_workspace_id
    AND s.part_id = p_part_id
    AND s.location_id = p_from_location_id
    AND s.deleted_at IS NULL
  LIMIT 1
  FOR UPDATE OF s;

  IF v_stock.id IS NULL THEN
    RAISE EXCEPTION 'source stock row not found for transfer reservation' USING ERRCODE = 'P0002';
  END IF;

  v_available := greatest(v_stock.qty_on_hand - v_stock.qty_allocated - v_stock.qty_reserved, 0)::numeric(14, 4);
  IF v_available < v_quantity THEN
    RAISE EXCEPTION 'insufficient stock for transfer reservation: available %, requested %', v_available, v_quantity
      USING ERRCODE = '23514';
  END IF;

  SELECT edge.lead_time_hours
  INTO v_lead_hours
  FROM public.branch_transfer_edges edge
  WHERE edge.workspace_id = v_workspace_id
    AND edge.active = true
    AND lower(edge.from_branch) = lower(v_stock.from_branch_slug)
    AND lower(edge.to_branch) = lower(v_stock.to_branch_slug)
  LIMIT 1;

  v_scheduled_at := coalesce(
    p_scheduled_at,
    now() + make_interval(hours => coalesce(v_lead_hours, 8)::integer)
  );

  UPDATE public.parts_stock
  SET
    qty_reserved = qty_reserved + v_quantity,
    updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.parts_transfers (
    workspace_id,
    transfer_number,
    from_location_id,
    to_location_id,
    status,
    requested_by,
    scheduled_at,
    parts_order_id,
    customer_choice,
    oem_order_eta_days,
    reservation_expires_at,
    metadata
  )
  VALUES (
    v_workspace_id,
    'TRF-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    p_from_location_id,
    p_to_location_id,
    'requested',
    p_requested_by,
    v_scheduled_at,
    p_parts_order_id,
    'transfer',
    v_oem_eta_days,
    v_scheduled_at + interval '2 days',
    jsonb_build_object(
      'source', 'parts_reserve_interbranch_transfer',
      'available_before_reservation', v_available,
      'lead_time_hours', coalesce(v_lead_hours, 8),
      'customer_choice', 'transfer'
    )
  )
  RETURNING id, transfer_number INTO v_transfer_id, v_transfer_number;

  INSERT INTO public.parts_transfer_lines (
    workspace_id,
    transfer_id,
    line_number,
    part_id,
    qty_requested,
    qty_reserved,
    status,
    metadata
  )
  VALUES (
    v_workspace_id,
    v_transfer_id,
    1,
    p_part_id,
    v_quantity,
    v_quantity,
    'open',
    jsonb_build_object(
      'reserved_from_stock_id', v_stock.id,
      'available_before_reservation', v_available
    )
  )
  RETURNING id INTO v_line_id;

  RETURN jsonb_build_object(
    'choice', 'transfer',
    'status', 'reserved',
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'transfer_line_id', v_line_id,
    'part_id', p_part_id,
    'from_location_id', p_from_location_id,
    'to_location_id', p_to_location_id,
    'requested_qty', v_quantity,
    'reserved_qty', v_quantity,
    'available_before_reservation', v_available,
    'scheduled_at', v_scheduled_at,
    'oem_order_eta_days', v_oem_eta_days
  );
END;
$$;

COMMENT ON FUNCTION public.parts_reserve_interbranch_transfer(uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, integer, text) IS
  'G5.1 transactional reservation: locks source stock, increments qty_reserved, and creates requested transfer header/line when the customer chooses inter-branch transfer.';

REVOKE ALL ON FUNCTION public.parts_reserve_interbranch_transfer(uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_reserve_interbranch_transfer(uuid, uuid, uuid, numeric, text, uuid, uuid, timestamptz, integer, text) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/674_g51_multi_location_stock_transfers.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md §1.2, §1.8, §2') ||
      ' | supabase/migrations/674_g51_multi_location_stock_transfers.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] G5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] G5.1 shipped: Multi-location stock options show branch-transfer versus OEM-order timing, and inter-branch transfer choice reserves source-location stock before scheduling the next run.'
  END,
  updated_at = now()
WHERE task_id = 'G5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G5.1',
  'update',
  jsonb_build_object(
    'reason', 'g51_multi_location_stock_transfers_shipped',
    'migration', '674_g51_multi_location_stock_transfers.sql',
    'mission_alignment', 'pass: parts counter staff can compare Lake City/Belleview stock transfer timing against OEM-order timing, reserve the selected source stock, and keep corporate operations aligned on identical branch rules'
  ),
  'codex'
);

COMMIT;
