-- ============================================================================
-- Migration 666: G4.1 Parts lookup engine — five paths
--
-- Purpose:
--   Add a unified Phase 3 parts lookup contract behind /v1/parts/lookup.
--   The engine searches by part number, machine make/model/serial, keyword,
--   kit, and supersession while reusing the normalized G1.1 parts foundation
--   plus the existing parts_catalog and parts_cross_references surfaces.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_parts_by_machine_serial_prefix
  ON public.parts_by_machine (workspace_id, lower(serial_prefix))
  WHERE serial_prefix IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_kits_search
  ON public.parts_kits USING gin (
    to_tsvector('english',
      coalesce(kit_number, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(description, '')
    )
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_parts_kit_items_part
  ON public.parts_kit_items (workspace_id, part_id);

CREATE INDEX IF NOT EXISTS idx_parts_xref_g41_supersession_a
  ON public.parts_cross_references (workspace_id, lower(part_number_a))
  WHERE deleted_at IS NULL
    AND is_active = true
    AND relationship IN ('supersedes', 'superseded_by');

CREATE INDEX IF NOT EXISTS idx_parts_xref_g41_supersession_b
  ON public.parts_cross_references (workspace_id, lower(part_number_b))
  WHERE deleted_at IS NULL
    AND is_active = true
    AND relationship IN ('supersedes', 'superseded_by');

ALTER TABLE public.counter_inquiries
  DROP CONSTRAINT IF EXISTS counter_inquiries_match_type_check;

ALTER TABLE public.counter_inquiries
  ADD CONSTRAINT counter_inquiries_g41_match_type_check
  CHECK (
    match_type IS NULL
    OR match_type IN (
      'exact',
      'semantic',
      'fts',
      'hybrid',
      'cross_ref',
      'machine_serial',
      'machine_model',
      'kit',
      'supersession'
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.parts_lookup_engine(
  p_query text DEFAULT NULL,
  p_lookup_path text DEFAULT 'auto',
  p_machine_make text DEFAULT NULL,
  p_machine_model text DEFAULT NULL,
  p_machine_serial text DEFAULT NULL,
  p_kit_number text DEFAULT NULL,
  p_machine_profile_id uuid DEFAULT NULL,
  p_workspace_id text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  lookup_path text,
  rank numeric,
  part_id uuid,
  parts_catalog_id uuid,
  part_number text,
  description text,
  manufacturer text,
  category text,
  kit_id uuid,
  kit_number text,
  kit_name text,
  machine_profile_id uuid,
  machine_make text,
  machine_model text,
  serial_prefix text,
  relationship text,
  source text,
  confidence numeric,
  stock_on_hand numeric,
  stock_locations jsonb,
  diagrams jsonb,
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
      nullif(lower(btrim(coalesce(p_query, ''))), '') AS query_text,
      lower(coalesce(nullif(btrim(p_lookup_path), ''), 'auto')) AS requested_path,
      nullif(lower(btrim(coalesce(p_machine_make, ''))), '') AS machine_make,
      nullif(lower(btrim(coalesce(p_machine_model, ''))), '') AS machine_model,
      nullif(lower(btrim(coalesce(p_machine_serial, ''))), '') AS machine_serial,
      nullif(lower(btrim(coalesce(p_kit_number, ''))), '') AS kit_number,
      p_machine_profile_id AS machine_profile_id,
      greatest(1, least(coalesce(p_limit, 20), 50)) AS max_rows
  ),
  base_parts AS (
    SELECT
      p.workspace_id,
      p.id AS part_id,
      p.parts_catalog_id,
      p.part_number,
      coalesce(p.description, pc.description) AS description,
      coalesce(p.manufacturer, pc.manufacturer) AS manufacturer,
      coalesce(p.category, pc.category) AS category,
      p.status
    FROM public.parts p
    LEFT JOIN public.parts_catalog pc
      ON pc.id = p.parts_catalog_id
     AND pc.workspace_id = p.workspace_id
     AND pc.deleted_at IS NULL
    JOIN args a ON a.workspace_id = p.workspace_id
    WHERE p.deleted_at IS NULL

    UNION ALL

    SELECT
      pc.workspace_id,
      NULL::uuid AS part_id,
      pc.id AS parts_catalog_id,
      pc.part_number,
      pc.description,
      pc.manufacturer,
      pc.category,
      CASE WHEN pc.is_active THEN 'active' ELSE 'inactive' END AS status
    FROM public.parts_catalog pc
    JOIN args a ON a.workspace_id = pc.workspace_id
    WHERE pc.deleted_at IS NULL
      AND pc.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.parts p
        WHERE p.parts_catalog_id = pc.id
          AND p.deleted_at IS NULL
      )
  ),
  stock AS (
    SELECT
      s.part_id,
      coalesce(sum(s.qty_on_hand), 0) AS stock_on_hand,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'location_id', s.location_id,
            'location_code', l.code,
            'location_name', l.name,
            'branch_slug', coalesce(s.branch_slug, l.branch_slug),
            'bin_id', s.bin_id,
            'qty_on_hand', s.qty_on_hand,
            'qty_reserved', s.qty_reserved,
            'qty_on_order', s.qty_on_order
          )
          ORDER BY s.qty_on_hand DESC, l.code
        ) FILTER (WHERE s.deleted_at IS NULL),
        '[]'::jsonb
      ) AS stock_locations
    FROM public.parts_stock s
    LEFT JOIN public.parts_locations l
      ON l.id = s.location_id
     AND l.workspace_id = s.workspace_id
     AND l.deleted_at IS NULL
    JOIN args a ON a.workspace_id = s.workspace_id
    WHERE s.deleted_at IS NULL
    GROUP BY s.part_id
  ),
  exact_matches AS (
    SELECT
      'part_number'::text AS lookup_path,
      CASE
        WHEN lower(b.part_number) = a.query_text THEN 1.0000::numeric
        WHEN lower(b.part_number) LIKE a.query_text || '%' THEN 0.9200::numeric
        ELSE 0.8400::numeric
      END AS rank,
      b.part_id,
      b.parts_catalog_id,
      b.part_number,
      b.description,
      b.manufacturer,
      b.category,
      NULL::uuid AS kit_id,
      NULL::text AS kit_number,
      NULL::text AS kit_name,
      NULL::uuid AS machine_profile_id,
      NULL::text AS machine_make,
      NULL::text AS machine_model,
      NULL::text AS serial_prefix,
      NULL::text AS relationship,
      'parts_catalog'::text AS source,
      1.0000::numeric AS confidence,
      coalesce(st.stock_on_hand, 0) AS stock_on_hand,
      coalesce(st.stock_locations, '[]'::jsonb) AS stock_locations,
      '[]'::jsonb AS diagrams,
      jsonb_build_object('matched_on', 'part_number', 'query', a.query_text) AS evidence
    FROM args a
    JOIN base_parts b ON true
    LEFT JOIN stock st ON st.part_id = b.part_id
    WHERE a.query_text IS NOT NULL
      AND a.requested_path IN ('auto', 'part_number')
      AND (
        lower(b.part_number) = a.query_text
        OR lower(b.part_number) LIKE a.query_text || '%'
        OR lower(b.part_number) LIKE '%' || a.query_text || '%'
      )
  ),
  keyword_matches AS (
    SELECT
      'keyword'::text AS lookup_path,
      (0.6200 + ts_rank_cd(
        to_tsvector('english',
          coalesce(b.part_number, '') || ' ' ||
          coalesce(b.description, '') || ' ' ||
          coalesce(b.manufacturer, '') || ' ' ||
          coalesce(b.category, '')
        ),
        plainto_tsquery('english', a.query_text)
      ))::numeric AS rank,
      b.part_id,
      b.parts_catalog_id,
      b.part_number,
      b.description,
      b.manufacturer,
      b.category,
      NULL::uuid AS kit_id,
      NULL::text AS kit_number,
      NULL::text AS kit_name,
      NULL::uuid AS machine_profile_id,
      NULL::text AS machine_make,
      NULL::text AS machine_model,
      NULL::text AS serial_prefix,
      NULL::text AS relationship,
      'parts_catalog'::text AS source,
      0.7200::numeric AS confidence,
      coalesce(st.stock_on_hand, 0) AS stock_on_hand,
      coalesce(st.stock_locations, '[]'::jsonb) AS stock_locations,
      '[]'::jsonb AS diagrams,
      jsonb_build_object('matched_on', 'keyword', 'query', a.query_text) AS evidence
    FROM args a
    JOIN base_parts b ON true
    LEFT JOIN stock st ON st.part_id = b.part_id
    WHERE a.query_text IS NOT NULL
      AND a.requested_path IN ('auto', 'keyword', 'description')
      AND to_tsvector('english',
        coalesce(b.part_number, '') || ' ' ||
        coalesce(b.description, '') || ' ' ||
        coalesce(b.manufacturer, '') || ' ' ||
        coalesce(b.category, '')
      ) @@ plainto_tsquery('english', a.query_text)
  ),
  machine_matches AS (
    SELECT
      CASE
        WHEN a.machine_serial IS NOT NULL THEN 'machine_serial'
        ELSE 'machine_model'
      END::text AS lookup_path,
      (0.7800 + (pbm.confidence * 0.2000))::numeric AS rank,
      b.part_id,
      b.parts_catalog_id,
      b.part_number,
      b.description,
      b.manufacturer,
      b.category,
      NULL::uuid AS kit_id,
      NULL::text AS kit_number,
      NULL::text AS kit_name,
      pbm.machine_profile_id,
      pbm.make AS machine_make,
      pbm.model AS machine_model,
      pbm.serial_prefix,
      pbm.fitment_type AS relationship,
      'parts_by_machine'::text AS source,
      pbm.confidence,
      coalesce(st.stock_on_hand, 0) AS stock_on_hand,
      coalesce(st.stock_locations, '[]'::jsonb) AS stock_locations,
      coalesce(pbm.metadata -> 'diagrams', '[]'::jsonb) AS diagrams,
      jsonb_build_object(
        'matched_on', 'machine',
        'priority_path', true,
        'fitment_type', pbm.fitment_type,
        'source', pbm.source,
        'notes', pbm.notes
      ) AS evidence
    FROM args a
    JOIN public.parts_by_machine pbm
      ON pbm.workspace_id = a.workspace_id
     AND pbm.deleted_at IS NULL
    JOIN base_parts b ON b.part_id = pbm.part_id
    LEFT JOIN stock st ON st.part_id = b.part_id
    WHERE a.requested_path IN ('auto', 'machine', 'machine_serial', 'machine_model')
      AND (
        (a.machine_profile_id IS NOT NULL AND pbm.machine_profile_id = a.machine_profile_id)
        OR (a.machine_make IS NOT NULL AND lower(coalesce(pbm.make, '')) LIKE '%' || a.machine_make || '%')
        OR (a.machine_model IS NOT NULL AND lower(coalesce(pbm.model, '')) LIKE '%' || a.machine_model || '%')
        OR (
          a.machine_serial IS NOT NULL
          AND pbm.serial_prefix IS NOT NULL
          AND a.machine_serial LIKE lower(pbm.serial_prefix) || '%'
        )
        OR (
          a.query_text IS NOT NULL
          AND (
            (pbm.make IS NOT NULL AND a.query_text LIKE '%' || lower(pbm.make) || '%')
            OR (pbm.model IS NOT NULL AND a.query_text LIKE '%' || lower(pbm.model) || '%')
            OR (pbm.serial_prefix IS NOT NULL AND a.query_text LIKE '%' || lower(pbm.serial_prefix) || '%')
          )
        )
      )
  ),
  kit_matches AS (
    SELECT
      'kit'::text AS lookup_path,
      CASE
        WHEN lower(k.kit_number) = coalesce(a.kit_number, a.query_text) THEN 0.9700::numeric
        ELSE 0.8600::numeric
      END AS rank,
      b.part_id,
      b.parts_catalog_id,
      b.part_number,
      b.description,
      b.manufacturer,
      b.category,
      k.id AS kit_id,
      k.kit_number,
      k.name AS kit_name,
      k.machine_profile_id,
      NULL::text AS machine_make,
      NULL::text AS machine_model,
      NULL::text AS serial_prefix,
      'kit_component'::text AS relationship,
      'parts_kits'::text AS source,
      1.0000::numeric AS confidence,
      coalesce(st.stock_on_hand, 0) AS stock_on_hand,
      coalesce(st.stock_locations, '[]'::jsonb) AS stock_locations,
      coalesce(k.metadata -> 'diagrams', '[]'::jsonb) AS diagrams,
      jsonb_build_object(
        'matched_on', 'kit',
        'quantity', ki.quantity,
        'required', ki.required,
        'sort_order', ki.sort_order
      ) AS evidence
    FROM args a
    JOIN public.parts_kits k
      ON k.workspace_id = a.workspace_id
     AND k.deleted_at IS NULL
     AND k.status = 'active'
    JOIN public.parts_kit_items ki
      ON ki.kit_id = k.id
     AND ki.workspace_id = k.workspace_id
    JOIN base_parts b ON b.part_id = ki.part_id
    LEFT JOIN stock st ON st.part_id = b.part_id
    WHERE a.requested_path IN ('auto', 'kit')
      AND (
        (a.kit_number IS NOT NULL AND lower(k.kit_number) = a.kit_number)
        OR (
          a.query_text IS NOT NULL
          AND (
            lower(k.kit_number) LIKE '%' || a.query_text || '%'
            OR lower(k.name) LIKE '%' || a.query_text || '%'
            OR lower(coalesce(k.description, '')) LIKE '%' || a.query_text || '%'
            OR to_tsvector('english',
              coalesce(k.kit_number, '') || ' ' ||
              coalesce(k.name, '') || ' ' ||
              coalesce(k.description, '')
            ) @@ plainto_tsquery('english', a.query_text)
          )
        )
      )
  ),
  supersession_edges AS (
    SELECT
      x.part_number_b AS candidate_part_number,
      x.part_number_a AS original_part_number,
      x.relationship::text AS relationship,
      x.confidence,
      x.source,
      x.fitment_notes
    FROM args a
    JOIN public.parts_cross_references x
      ON x.workspace_id = a.workspace_id
     AND x.deleted_at IS NULL
     AND x.is_active = true
     AND x.relationship IN ('supersedes', 'superseded_by')
    WHERE a.query_text IS NOT NULL
      AND a.requested_path IN ('auto', 'supersession', 'cross_reference')
      AND lower(x.part_number_a) LIKE '%' || a.query_text || '%'

    UNION ALL

    SELECT
      x.part_number_a AS candidate_part_number,
      x.part_number_b AS original_part_number,
      CASE x.relationship
        WHEN 'supersedes' THEN 'superseded_by'
        WHEN 'superseded_by' THEN 'supersedes'
        ELSE x.relationship::text
      END AS relationship,
      x.confidence,
      x.source,
      x.fitment_notes
    FROM args a
    JOIN public.parts_cross_references x
      ON x.workspace_id = a.workspace_id
     AND x.deleted_at IS NULL
     AND x.is_active = true
     AND x.relationship IN ('supersedes', 'superseded_by')
    WHERE a.query_text IS NOT NULL
      AND a.requested_path IN ('auto', 'supersession', 'cross_reference')
      AND lower(x.part_number_b) LIKE '%' || a.query_text || '%'
  ),
  supersession_matches AS (
    SELECT
      'supersession'::text AS lookup_path,
      (0.7400 + (se.confidence * 0.2000))::numeric AS rank,
      b.part_id,
      b.parts_catalog_id,
      b.part_number,
      b.description,
      b.manufacturer,
      b.category,
      NULL::uuid AS kit_id,
      NULL::text AS kit_number,
      NULL::text AS kit_name,
      NULL::uuid AS machine_profile_id,
      NULL::text AS machine_make,
      NULL::text AS machine_model,
      NULL::text AS serial_prefix,
      se.relationship,
      se.source,
      se.confidence,
      coalesce(st.stock_on_hand, 0) AS stock_on_hand,
      coalesce(st.stock_locations, '[]'::jsonb) AS stock_locations,
      '[]'::jsonb AS diagrams,
      jsonb_build_object(
        'matched_on', 'supersession',
        'original_part_number', se.original_part_number,
        'fitment_notes', se.fitment_notes
      ) AS evidence
    FROM supersession_edges se
    JOIN base_parts b
      ON lower(b.part_number) = lower(se.candidate_part_number)
    LEFT JOIN stock st ON st.part_id = b.part_id
  ),
  unioned AS (
    SELECT * FROM exact_matches
    UNION ALL
    SELECT * FROM machine_matches
    UNION ALL
    SELECT * FROM keyword_matches
    UNION ALL
    SELECT * FROM kit_matches
    UNION ALL
    SELECT * FROM supersession_matches
  ),
  deduped AS (
    SELECT DISTINCT ON (
      lookup_path,
      coalesce(part_id::text, parts_catalog_id::text, part_number),
      coalesce(kit_id::text, ''),
      coalesce(relationship, '')
    )
      unioned.*
    FROM unioned
    ORDER BY
      lookup_path,
      coalesce(part_id::text, parts_catalog_id::text, part_number),
      coalesce(kit_id::text, ''),
      coalesce(relationship, ''),
      rank DESC
  )
  SELECT
    deduped.lookup_path,
    deduped.rank,
    deduped.part_id,
    deduped.parts_catalog_id,
    deduped.part_number,
    deduped.description,
    deduped.manufacturer,
    deduped.category,
    deduped.kit_id,
    deduped.kit_number,
    deduped.kit_name,
    deduped.machine_profile_id,
    deduped.machine_make,
    deduped.machine_model,
    deduped.serial_prefix,
    deduped.relationship,
    deduped.source,
    deduped.confidence,
    deduped.stock_on_hand,
    deduped.stock_locations,
    deduped.diagrams,
    deduped.evidence
  FROM deduped
  ORDER BY
    deduped.rank DESC,
    CASE deduped.lookup_path
      WHEN 'machine_serial' THEN 0
      WHEN 'machine_model' THEN 1
      WHEN 'part_number' THEN 2
      WHEN 'kit' THEN 3
      WHEN 'supersession' THEN 4
      ELSE 5
    END,
    deduped.part_number
  LIMIT (SELECT max_rows FROM args);
$$;

COMMENT ON FUNCTION public.parts_lookup_engine(text, text, text, text, text, text, uuid, text, integer) IS
  'G4.1 unified /v1/parts/lookup contract: part number, machine make/model/serial with diagram metadata, keyword, kit, and supersession paths.';

REVOKE ALL ON FUNCTION public.parts_lookup_engine(text, text, text, text, text, text, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parts_lookup_engine(text, text, text, text, text, text, uuid, text, integer) TO authenticated, service_role;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  evidence_link = 'supabase/migrations/666_g41_parts_lookup_engine.sql',
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-02] G4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-02] G4.1 shipped: Unified parts lookup engine supports part-number, machine make/model/serial with diagram metadata, keyword, kit, and supersession paths.'
  END
WHERE task_id = 'G4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'G4.1',
  'update',
  jsonb_build_object(
    'reason',
    'g41_parts_lookup_engine_shipped',
    'mission_alignment',
    'pass: counter staff can start from the customer-known machine path, then land on stocked parts, kit components, or supersession alternatives without relying on tribal memory',
    'evidence',
    jsonb_build_array(
      'supabase/migrations/666_g41_parts_lookup_engine.sql',
      'supabase/functions/ai-parts-lookup/index.ts',
      'supabase/migrations/666_g41_parts_lookup_engine.test.ts'
    ),
    'lookup_paths',
    jsonb_build_array('part_number', 'machine_serial', 'machine_model', 'keyword', 'kit', 'supersession')
  ),
  'codex'
);

COMMIT;
