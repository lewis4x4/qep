-- ============================================================================
-- Migration 701: A3.2 live structured spec-sheet closeout
--
-- Manufacturer model specs now flow from qb_equipment_models.specs through the
-- catalog projection, quote metadata, proposal renderer, and customer-safe tests.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/lib/pricing/catalog-specs.ts%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M2') ||
      ' | apps/web/src/lib/pricing/catalog-specs.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-api.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-builder-page-helpers.ts' ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/lib/pricing/__tests__/catalog-specs.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-api.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-builder-page-helpers.test.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.2 shipped: projectCatalogSpecs turns manufacturer model specs from qb_equipment_models.specs into ordered structured_specs, display bullets, and spec_search_text while rejecting free-text-only fields. Catalog entries preserve spec_source = manufacturer_ingested through quote-builder metadata and saved quote-line payloads. Customer proposals prefer verified structured manufacturer specs over legacy spec_bullets and fall back to legacy bullets only when manufacturer source proof is missing.'
  END,
  updated_at = now()
WHERE task_id = 'A3.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.2',
  'update',
  jsonb_build_object(
    'reason', 'a32_live_spec_sheet_closeout',
    'migration', '701_a32_live_spec_sheet_closeout.sql',
    'mission_alignment', 'pass: sales quote configuration now uses searchable, filterable, manufacturer-ingested model specs instead of untrusted free-text bullets, improving equipment comparison quality for sales and rental operations',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/lib/pricing/catalog-specs.ts projectCatalogSpecs',
      'apps/web/src/lib/pricing/catalog-specs.ts formatCatalogStructuredSpec',
      'apps/web/src/features/quote-builder/lib/quote-api.ts structured_specs/spec_search_text/spec_source projection',
      'apps/web/src/features/quote-builder/lib/quote-builder-page-helpers.ts metadataForCatalogEntry',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts structuredSpecBullets',
      'apps/web/src/lib/pricing/__tests__/catalog-specs.test.ts catalog spec projection',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-api.test.ts saved quote-line metadata',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-builder-page-helpers.test.ts metadata preservation',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts customer proposal structured spec precedence'
    ),
    'safety_bounds', jsonb_build_array(
      'rejects free-text-only catalog spec fields',
      'requires manufacturer_ingested spec_source or qb_equipment_models.specs item source before overriding legacy bullets',
      'keeps legacy spec_bullets as fallback only when structured manufacturer proof is absent'
    )
  ),
  'codex'
);

COMMIT;
