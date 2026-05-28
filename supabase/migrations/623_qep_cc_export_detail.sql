-- ============================================================================
-- Migration 623: QEP Tier 1 Command Center detail contract
-- Target: QEP Supabase project (iciddijgonywtxoelous)
--
-- Run as postgres in the Supabase SQL editor. Idempotent.
-- Cockpit path only; cc_export_snapshot conversion deferred to Tier 1.5.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'command_center') THEN
    CREATE ROLE command_center NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_contract_owner') THEN
    CREATE ROLE cc_contract_owner NOLOGIN;
  END IF;
END$$;

-- Allow PostgREST to assume the JWT's role: "command_center" claim.
GRANT command_center TO authenticator;

-- Make the migrating role a member of cc_contract_owner so we can ALTER
-- FUNCTION ... OWNER TO it below. Idempotent.
GRANT cc_contract_owner TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO command_center;
GRANT USAGE ON SCHEMA public TO cc_contract_owner;

-- ---------------------------------------------------------------------------
-- 2. cc_contract_owner gets SELECT on the QEP source tables + views.
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.qep_roadmap_tasks         TO cc_contract_owner;
GRANT SELECT ON public.qep_decisions             TO cc_contract_owner;
GRANT SELECT ON public.v_qep_roadmap_sync_health TO cc_contract_owner;

-- ---------------------------------------------------------------------------
-- 3. cc_export_snapshot() — DEFERRED to Tier 1.5.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Safe views — map QEP's real columns into the cockpit's expected shape.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.cc_safe_roadmap_items
  WITH (security_invoker = on) AS
  SELECT
    id::text             AS id,
    stream,
    wave,
    title,
    ship_state           AS status,
    owner,
    sort_order::text     AS priority,
    blocking_decision    AS blocker,
    updated_at
  FROM public.qep_roadmap_tasks;

CREATE OR REPLACE VIEW public.cc_safe_decision_items
  WITH (security_invoker = on) AS
  SELECT
    id::text             AS id,
    question_plain       AS title,
    owner_role           AS owner,
    status,
    code                 AS source_ref,
    options,
    updated_at,
    CASE
      WHEN lower(coalesce(decision_class::text, ''))
        IN ('auto', 'authorize', 'destructive', 'production')
        THEN lower(decision_class::text)
      ELSE 'authorize'
    END                  AS risk_class,
    EXTRACT(DAY FROM (now() - created_at))::int AS age_days,
    CASE
      -- Client-facing decisions need QEP staff / end-customer input. Client wins
      -- over mixed owner strings like "Brian/Rylee" so Command Center does not
      -- hide customer-impacting policy decisions in the operator-only lane.
      -- Word-boundary (\y) match so these only hit whole tokens, never
      -- substrings of unrelated names ("Christina"~tina, "Davidson"~david,
      -- "Bryan"~ryan, "Juanita"~juan) which would mis-route operator
      -- decisions into the client lane.
      WHEN lower(coalesce(owner_role, '')) ~
        '\y(client|customer|qep|rylee|ryan|angela|tina|norman|juan|bobby|david)\y'
        THEN 'client'
      -- Preserve an explicit unknown bucket for intentionally ambiguous rows,
      -- but keep the general fallback operator-only as requested.
      WHEN lower(btrim(coalesce(owner_role, ''))) IN ('unknown', 'tbd', 'unassigned', 'mixed', 'shared', '-', '—')
        THEN 'unknown'
      ELSE 'operator'
    END::text             AS owner_kind
  FROM public.qep_decisions
  WHERE answered_at IS NULL;

CREATE OR REPLACE VIEW public.cc_safe_sync_items
  WITH (security_invoker = on) AS
  SELECT
    'linear'::text       AS source,
    CASE
      WHEN error_count   > 0 THEN 'error'
      WHEN pending_count > 0 THEN 'pending'
      ELSE                       'healthy'
    END                  AS status,
    total_tasks,
    mirrored_tasks,
    pending_count,
    error_count,
    last_synced_at       AS last_checked
  FROM public.v_qep_roadmap_sync_health;

GRANT SELECT ON public.cc_safe_roadmap_items  TO cc_contract_owner;
GRANT SELECT ON public.cc_safe_decision_items TO cc_contract_owner;
GRANT SELECT ON public.cc_safe_sync_items     TO cc_contract_owner;

-- ---------------------------------------------------------------------------
-- 5. cc_export_detail(text, text) — SECURITY DEFINER, owned by cc_contract_owner.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_export_detail(
  p_section text DEFAULT 'all',
  p_cursor  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_section   text    := lower(coalesce(nullif(trim(p_section), ''), 'all'));
  v_limit     integer := 50;
  v_roadmap   jsonb   := jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  v_decisions jsonb   := jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
  v_sync      jsonb   := jsonb_build_object('items', '[]'::jsonb, 'next_cursor', NULL);
BEGIN
  IF v_section NOT IN ('all', 'roadmap', 'decisions', 'sync') THEN
    RAISE EXCEPTION 'cc_export_detail: invalid section %', p_section
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_section IN ('all', 'roadmap') THEN
    SELECT jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',         id,
        'stream',     stream,
        'wave',       wave,
        'title',      title,
        'status',     status,
        'owner',      owner,
        'priority',   priority,
        'blocker',    blocker,
        'updated_at', updated_at
      ))), '[]'::jsonb),
      'next_cursor', NULL
    ) INTO v_roadmap
    FROM (
      SELECT id, stream, wave, title, status, owner, priority, blocker, updated_at
      FROM public.cc_safe_roadmap_items
      ORDER BY updated_at DESC NULLS LAST
      LIMIT v_limit
    ) r;
  END IF;

  IF v_section IN ('all', 'decisions') THEN
    SELECT jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',          id,
        'title',       title,
        'owner',       owner,
        'owner_kind',  owner_kind,
        'risk_class',  risk_class,
        'options',     options,
        'status',      status,
        'age',         age_days::text || 'd',
        'source_ref',  source_ref,
        'updated_at',  updated_at
      ))), '[]'::jsonb),
      'next_cursor', NULL
    ) INTO v_decisions
    FROM (
      SELECT id, title, owner, owner_kind, risk_class, options, status, age_days, source_ref, updated_at
      FROM public.cc_safe_decision_items
      ORDER BY age_days DESC NULLS LAST
      LIMIT v_limit
    ) d;
  END IF;

  IF v_section IN ('all', 'sync') THEN
    SELECT jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'source',         source,
        'status',         status,
        'total_tasks',    total_tasks,
        'mirrored_tasks', mirrored_tasks,
        'pending_count',  pending_count,
        'error_count',    error_count,
        'last_checked',   last_checked
      ))), '[]'::jsonb),
      'next_cursor', NULL
    ) INTO v_sync
    FROM public.cc_safe_sync_items;
  END IF;

  RETURN jsonb_build_object(
    'roadmap',   v_roadmap,
    'decisions', v_decisions,
    'sync',      v_sync
  );
END;
$fn$;

-- PostgreSQL requires the target owner to hold CREATE on the containing
-- schema during ownership transfer. Keep it temporary so cc_contract_owner
-- ends with only the narrow runtime privileges it needs.
GRANT CREATE ON SCHEMA public TO cc_contract_owner;
ALTER FUNCTION public.cc_export_detail(text, text) OWNER TO cc_contract_owner;
REVOKE CREATE ON SCHEMA public FROM cc_contract_owner;

COMMENT ON FUNCTION public.cc_export_detail(text, text) IS
  'Command Center cockpit detail contract. SECURITY DEFINER. Owned by cc_contract_owner. command_center holds EXECUTE only.';

REVOKE EXECUTE ON FUNCTION public.cc_export_detail(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cc_export_detail(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cc_export_detail(text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cc_export_detail(text, text) TO command_center;

COMMIT;
