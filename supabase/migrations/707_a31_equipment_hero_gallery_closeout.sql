-- ============================================================================
-- Migration 700: A3.1 equipment hero photo gallery closeout
--
-- The quote proposal projection, PDF renderer, and printable fallback now build
-- customer-safe equipment cover galleries from quote line media.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QRM_QUOTE_MOONSHOT_HANDOFF M1') ||
      ' | apps/web/src/features/quote-builder/lib/quote-proposal-data.ts' ||
      ' | apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx' ||
      ' | apps/web/src/features/quote-builder/lib/quote-print-html.ts' ||
      ' | apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A3.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A3.1 shipped: quote-proposal-data projects customer-safe equipment media from photo_url/photo_urls metadata, rejects private or unsafe media URLs, builds coverGalleryUnits only from equipment lines, dedupes and limits each unit to five photos, and excludes attachment/trade/internal media from the cover. QuotePDFDocument renders the first three equipment units as an Equipment photo gallery on the cover, and quote-print-html renders the same cover-gallery fallback for browser/print preview.'
  END,
  updated_at = now()
WHERE task_id = 'A3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A3.1',
  'update',
  jsonb_build_object(
    'reason', 'a31_equipment_hero_gallery_closeout',
    'migration', '707_a31_equipment_hero_gallery_closeout.sql',
    'mission_alignment', 'pass: customer quote artifacts now show real equipment media in the proposal cover while keeping dealer economics and unsafe media out of the customer packet',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts buildLineMedia',
      'apps/web/src/features/quote-builder/lib/quote-proposal-data.ts buildCoverGalleryUnits',
      'apps/web/src/features/quote-builder/components/QuotePDFDocument.tsx CoverGallery',
      'apps/web/src/features/quote-builder/lib/quote-print-html.ts buildCoverGallery',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts customer-safe media projection',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts cover gallery units',
      'apps/web/src/features/quote-builder/lib/__tests__/quote-proposal-data.test.ts printable HTML cover gallery'
    )
  ),
  'codex'
);

COMMIT;
