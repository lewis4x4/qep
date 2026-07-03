-- ============================================================================
-- Migration 731: C2.1 OEM master schema + resolver closeout
--
-- JAR-105 Slice 5.1 is satisfied by the canonical OEM master schema, the
-- effective-dated dealer-cost tier table, qb_price_sheets OEM linkage, and the
-- resolve_oem_cost() RPC. Parser/import/sample-file rows remain separate.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%738_c21_oem_master_schema_resolver_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-105 packet') ||
      ' | supabase/migrations/287_qb_price_sheets.sql' ||
      ' | supabase/migrations/541_ycena_oem_price_book_import_tiers.sql' ||
      ' | supabase/migrations/612_oem_master_schema_resolver.sql' ||
      ' | supabase/migrations/723_a71_oem_price_sheet_schema_closeout.sql' ||
      ' | supabase/migrations/738_c21_oem_master_schema_resolver_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C2.1 shipped: the OEM master schema and dealer-cost resolver are in source-controlled migrations. Migration 612 creates public.oems with workspace-scoped canonical OEM metadata, extends qb_price_sheets with oem_id/oem_key/source_format/source_cadence/resolver_metadata, links existing dealer-cost tiers and price sheets to canonical OEM records, and exposes public.resolve_oem_cost(text,text,bigint,date,text). Migration 541 provides public.oem_dealer_cost_tiers with effective-dated discount rules, RLS policies, ASV/Yanmar YCENA seed tiers, and source references. Migration 287 provides the underlying qb_price_sheets and qb_price_sheet_items substrate. This closes only C2.1; admin UI, parser work, ASV/Yanmar sample import, Bobcat, Vermeer, and the broader D2.3/JAR-105 decision row remain governed by their own rows and external proof requirements.'
  END,
  updated_at = now()
WHERE task_id = 'C2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C2.1',
  'update',
  jsonb_build_object(
    'reason', 'c21_oem_master_schema_resolver_closeout',
    'migration', '738_c21_oem_master_schema_resolver_closeout.sql',
    'mission_alignment', 'pass: QEP now has a canonical OEM and dealer-cost foundation that lets equipment sales and rental quoting reason about price-sheet provenance and effective dealer cost without waiting on every live OEM file',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/612_oem_master_schema_resolver.sql creates public.oems with workspace_id, oem_key, parent_oem_key, display_name, category, source_format, price_sheet_cadence, active, metadata, deleted_at, unique(workspace_id,oem_key), indexes, trigger, and RLS policies',
      'supabase/migrations/612_oem_master_schema_resolver.sql extends public.qb_price_sheets with oem_id, oem_key, source_format, source_cadence, resolver_metadata, format/cadence constraints, and OEM indexes',
      'supabase/migrations/612_oem_master_schema_resolver.sql seeds canonical ASV, Yanmar, YCENA, Bandit, Develon, Barko, Prinoth, Lamtrac, Shearex, Denis Cimaf, Supertrak, CMI, Serco, and Diamond Z OEM records per workspace',
      'supabase/migrations/612_oem_master_schema_resolver.sql links oem_dealer_cost_tiers and existing qb_price_sheets to canonical OEM ids/keys where possible',
      'supabase/migrations/612_oem_master_schema_resolver.sql defines public.resolve_oem_cost(text,text,bigint,date,text) as a stable security definer RPC with explicit search_path and grants execute to authenticated and service_role',
      'supabase/migrations/541_ycena_oem_price_book_import_tiers.sql creates public.oem_dealer_cost_tiers with workspace, parent OEM, brand, discount, effective date, source_reference, RLS, indexes, and ASV/Yanmar YCENA tiers',
      'supabase/migrations/287_qb_price_sheets.sql provides public.qb_price_sheets and public.qb_price_sheet_items for sheet header and extracted line storage',
      'supabase/migrations/723_a71_oem_price_sheet_schema_closeout.sql already verifies this schema substrate for the A7 OEM price-sheet schema row'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter runtime database schema or application code',
      'this closeout does not mark C2.2 admin UI, C2.3 parser, C2.4 ASV/Yanmar sample import, C2.5 Bobcat, C2.6 Vermeer, or D2.3 JAR-105 shipped',
      'this closeout does not ingest or claim any live OEM files',
      'RLS remains enabled on oems and oem_dealer_cost_tiers, with service/elevated/member policies preserved',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'Bobcat and Vermeer sample files/contracts remain external/manual blockers for their own rows',
      'live OEM file ingestion and parser validation are not part of C2.1',
      'no production RPC call was made against live Supabase in this closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
