-- ============================================================================
-- Migration 732: C2.2 /admin/oems admin UI closeout
--
-- JAR-105 Slice 5.2 is satisfied by the manager/admin OEM cost resolver route,
-- admin entry point, UI form, RPC adapter, and focused integration coverage.
-- Parser/import/sample-file rows remain separate.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%739_c22_admin_oems_ui_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'JAR-105 packet') ||
      ' | apps/web/src/App.tsx' ||
      ' | apps/web/src/components/AdminPage.tsx' ||
      ' | apps/web/src/features/admin/pages/OemsPage.tsx' ||
      ' | apps/web/src/features/admin/lib/oems-api.ts' ||
      ' | apps/web/src/features/admin/pages/__tests__/OemsPage.integration.test.tsx' ||
      ' | apps/web/src/features/admin/lib/__tests__/oems-api.test.ts' ||
      ' | supabase/migrations/739_c22_admin_oems_ui_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] C2.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] C2.2 shipped: /admin/oems is registered in App.tsx behind admin/manager/owner routing and linked from the AdminPage OEM Cost Resolver card. OemsPage loads active, non-deleted OEM records, provides OEM/list price/effective date test inputs, calls resolveOemDealerCost/resolve_oem_cost with the selected brand key and parent OEM fallback, and renders dealer cost, discount, brand tier, parent OEM, effective window, and source reference. Focused integration coverage proves ASV resolves through parent YCENA and renders $70,000.00, 30.00%, and ASV-Price-Book.pdf. This closes only C2.2; PDF parser, ASV/Yanmar sample import, Bobcat, Vermeer, and the broader D2.3/JAR-105 decision row remain governed by their own rows and external proof requirements.'
  END,
  updated_at = now()
WHERE task_id = 'C2.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'C2.2',
  'update',
  jsonb_build_object(
    'reason', 'c22_admin_oems_ui_closeout',
    'migration', '739_c22_admin_oems_ui_closeout.sql',
    'mission_alignment', 'pass: QEP managers can test OEM list price to dealer cost through the same resolver path that equipment and rental sales quoting will depend on, reducing pricing blind spots before importer and quote repricing work expands',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/App.tsx lazy-loads OemsPage and registers /admin/oems behind admin, manager, and owner access with dashboard fallback',
      'apps/web/src/components/AdminPage.tsx links the OEM Cost Resolver card to /admin/oems with copy scoped to dealer-cost tier testing before importer publish',
      'apps/web/src/features/admin/pages/OemsPage.tsx wraps the page in RequireAdmin, loads OEM records, exposes OEM/list price/effective date test inputs, uses parent OEM fallback, and renders resolved dealer cost details',
      'apps/web/src/features/admin/lib/oems-api.ts reads active non-deleted rows from public.oems and calls public.resolve_oem_cost with p_oem_key, p_brand_key, p_list_price_cents, and p_effective_on',
      'apps/web/src/features/admin/pages/__tests__/OemsPage.integration.test.tsx proves ASV resolves through YCENA and renders $70,000.00, 30.00%, and ASV-Price-Book.pdf',
      'apps/web/src/features/admin/lib/__tests__/oems-api.test.ts covers OEM row normalization, resolver row normalization, and money parse/format behavior'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter runtime application code or database schema',
      'this closeout does not mark C2.1, C2.3, C2.4, C2.5, C2.6, or D2.3 shipped',
      'this closeout does not ingest or claim any live OEM files',
      'the page remains restricted to admin/manager/owner routing plus RequireAdmin page guard',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'Bobcat and Vermeer sample files/contracts remain external/manual blockers for their own rows',
      'live credentialed browser UAT and production RPC calls are not part of this closeout',
      'YCENA parser and ASV/Yanmar sample import evidence are governed by C2.3 and C2.4',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
