-- ============================================================================
-- Migration 716: A7.1 OEM price-sheet schema closeout
--
-- The OEM price-sheet foundation is already represented by the quote-builder
-- price-sheet tables, OEM master records, dealer-cost tiers, sheet version
-- links, and phase-1 price-change diff substrate. This closeout records that
-- schema completion without loading live OEM files or unblocking parser/upload
-- tasks that still require external proof.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%716_a71_oem_price_sheet_schema_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OEM-Price-Feeds-Discovery-FILLED.docx') ||
      ' | supabase/migrations/287_qb_price_sheets.sql' ||
      ' | supabase/migrations/294_qb_price_sheet_columns.sql' ||
      ' | supabase/migrations/306_qb_sheet_watchdog.sql' ||
      ' | supabase/migrations/541_ycena_oem_price_book_import_tiers.sql' ||
      ' | supabase/migrations/610_oem_price_feeds_phase1.sql' ||
      ' | supabase/migrations/612_oem_master_schema_resolver.sql' ||
      ' | supabase/migrations/716_a71_oem_price_sheet_schema_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A7.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A7.1 shipped: OEM price-sheet schema is covered by qb_price_sheets and qb_price_sheet_items for uploaded sheet headers and extracted price-line rows; qb_price_sheets.effective_from/effective_to, supersedes_price_sheet_id, source_id, oem_id, oem_key, source_format, source_cadence, and resolver_metadata provide version/source/OEM linkage; oems and oem_dealer_cost_tiers provide canonical OEM metadata and effective-dated dealer-cost rules for ASV, Yanmar, Bandit, Develon, CMI, and adjacent OEMs; qb_price_change_events and qb_price_change_items provide the server-side sheet-version diff substrate with prior sheet linkage, materiality rules, approval policy, item type, normalized code, old/new price, delta cents, delta percent, and change kind. This is schema-only closeout: it does not ingest real OEM price books, does not satisfy NDA/legal clearance, and does not unblock A7.2/A7.3 parser/upload rows that still depend on external sample sheets and BLK-OEM-SHEETS.'
  END,
  updated_at = now()
WHERE task_id = 'A7.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A7.1',
  'update',
  jsonb_build_object(
    'reason', 'a71_oem_price_sheet_schema_closeout',
    'migration', '716_a71_oem_price_sheet_schema_closeout.sql',
    'mission_alignment', 'pass: equipment quote teams now have a durable OEM price-sheet data model for manufacturer list-price history, version comparison, dealer-cost policy, and future quote repricing without relying on ad hoc spreadsheet state',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/287_qb_price_sheets.sql creates qb_price_sheets and qb_price_sheet_items',
      'supabase/migrations/287_qb_price_sheets.sql stores effective dates, status, extracted rows, review status, and supersedes_price_sheet_id sheet version linkage',
      'supabase/migrations/294_qb_price_sheet_columns.sql adds sheet_type plus extracted-row metadata and diff JSON',
      'supabase/migrations/306_qb_sheet_watchdog.sql links qb_price_sheets.source_id to sheet watch sources',
      'supabase/migrations/541_ycena_oem_price_book_import_tiers.sql creates effective-dated OEM dealer-cost tiers',
      'supabase/migrations/612_oem_master_schema_resolver.sql creates canonical oems and extends qb_price_sheets with oem_id, oem_key, source_format, source_cadence, and resolver_metadata',
      'supabase/migrations/612_oem_master_schema_resolver.sql seeds ASV, Yanmar, Bandit, Develon, CMI, and adjacent OEM master records',
      'supabase/migrations/612_oem_master_schema_resolver.sql exposes resolve_oem_cost for effective dealer-cost lookup',
      'supabase/migrations/610_oem_price_feeds_phase1.sql creates qb_price_change_events and qb_price_change_items for sheet-version diff rows',
      'supabase/migrations/610_oem_price_feeds_phase1.sql persists materiality_rule and approval_policy for future quote-impact workflows'
    ),
    'safety_bounds', jsonb_build_array(
      'schema closeout only; no live OEM files are loaded',
      'no OEM portal credentials, API keys, legal approval, or provider contracts are required for this migration',
      'A7.2 and A7.3 remain blocked on BLK-OEM-SHEETS and are not promoted here',
      'D3.13 OEM price-data NDA/legal clearance and D3.14 sample sheet collection remain external/manual gates'
    ),
    'manual_boundaries', jsonb_build_array(
      'OEM sample price sheets and Bandit/CMI format confirmation remain external inputs',
      'legal/compliance clearance for storing OEM list-price data remains a manual owner decision',
      'parser accuracy and upload UI acceptance require real sample files and are outside A7.1',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
