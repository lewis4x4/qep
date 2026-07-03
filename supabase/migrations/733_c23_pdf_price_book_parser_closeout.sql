-- ============================================================================
-- Migration 733: C2.3 PDF price book parser closeout
--
-- JAR-105 Slice 5.3 is satisfied by the source-controlled YCENA PDF/text
-- parser and regression coverage. ASV/Yanmar sample import plus Bobcat/Vermeer
-- fixture-gated templates remain separate rows.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%733_c23_pdf_price_book_parser_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-105 packet') ||
      ' | scripts/oem/ycena-price-book-parser.mjs' ||
      ' | scripts/oem/__tests__/ycena-price-book-parser.test.ts' ||
      ' | scripts/oem/__fixtures__/ycena-tl25rp-sample.txt' ||
      ' | docs/IntelliDealer/_Manifests/QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md' ||
      ' | docs/IntelliDealer/_Manifests/QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md' ||
      ' | supabase/migrations/733_c23_pdf_price_book_parser_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C2.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C2.3 shipped: scripts/oem/ycena-price-book-parser.mjs provides the YCENA price-book parser for .pdf and .txt sources, extracts PDF text through pdftotext, rejects unsupported source extensions and empty extracted text, validates dealer discount bounds, maps YCENA base rows to equipment_base_codes and option/attachment/freight rows to equipment_options, calculates dealer cost from list price and discount, preserves effective/published dates, records skipped-row diagnostics, and emits source filename/SHA-256 provenance for file parses. scripts/oem/__tests__/ycena-price-book-parser.test.ts and scripts/oem/__fixtures__/ycena-tl25rp-sample.txt cover the Yanmar TL25RP sample, 30 percent dealer-cost math, base/option target mapping, skipped unclassified part rows, empty text rejection, and unsupported extension rejection. This closes only the YCENA parser row; C2.4 ASV/Yanmar sample import, C2.5 Bobcat, C2.6 Vermeer, and D2.3/JAR-105 remain governed by their own rows and external proof requirements.'
  END,
  updated_at = now()
WHERE task_id = 'C2.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C2.3',
  'update',
  jsonb_build_object(
    'reason', 'c23_pdf_price_book_parser_closeout',
    'migration', '733_c23_pdf_price_book_parser_closeout.sql',
    'mission_alignment', 'pass: QEP now has deterministic YCENA price-book extraction for equipment base and option pricing, giving sales and rental quoting a verified path from OEM list-price evidence to dealer-cost math before broader OEM imports are authorized',
    'implementation_evidence', jsonb_build_array(
      'scripts/oem/ycena-price-book-parser.mjs exports parseYcenaPriceBookText and parseYcenaPriceBookFile for YCENA PDF/text sources',
      'scripts/oem/ycena-price-book-parser.mjs supports .pdf extraction through pdftotext and .txt fixtures while rejecting unsupported extensions',
      'scripts/oem/ycena-price-book-parser.mjs extracts brand, effective date, pricing updated date, published date, model, category, part number, description, list price, dealer discount, dealer cost, page, source type, source filename, and source SHA-256 provenance',
      'scripts/oem/ycena-price-book-parser.mjs maps standard configuration rows to equipment_base_codes and option/attachment/freight rows to equipment_options, with equipment_base_codes_import_runs declared as an import target ledger',
      'scripts/oem/ycena-price-book-parser.mjs records skipped unclassified part-like rows instead of silently dropping parser uncertainty',
      'scripts/oem/__tests__/ycena-price-book-parser.test.ts covers Yanmar TL25RP parser output, 30 percent dealer-cost math, skipped-row diagnostics, empty text rejection, and unsupported source extension rejection',
      'scripts/oem/__fixtures__/ycena-tl25rp-sample.txt provides the source-controlled YCENA sample text used by parser regression coverage'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter parser, application, or database runtime behavior',
      'this closeout does not mark C2.1, C2.2, C2.4, C2.5, C2.6, or D2.3 shipped',
      'this closeout does not import sample data or write equipment_base_codes/equipment_options',
      'this closeout does not claim Bobcat or Vermeer templates because those require external sample/API proof',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'Bobcat and Vermeer sample files/API contracts remain not supplied per QEP_D1_2_SOURCE_FIXTURE_VENDOR_CONTRACT_REGISTER_2026-05-21.md',
      'QEP_OEM_BASE_OPTIONS_IMPORT_DECISION_PACKET_2026-05-04.md requires fixture/API-backed evidence before Bobcat or Vermeer parser/import promotion',
      'C2.4 ASV/Yanmar sample import is separate from parser closeout and must provide its own import-run evidence',
      'no live production OEM file or credentialed provider contract was used in this closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
