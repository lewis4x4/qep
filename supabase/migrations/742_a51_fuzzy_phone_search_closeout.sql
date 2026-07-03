-- ============================================================================
-- Migration 735: A5.1 fuzzy phone customer search closeout
--
-- QB-3 was implemented by the ranked customer/company picker in migration 586
-- and the sales picker API. B5.2/HF-1 is now shipped, so A5.1 can be reconciled
-- without changing runtime behavior.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%742_a51_fuzzy_phone_search_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-3') ||
      ' | supabase/migrations/586_qb3_customer_search_ranked.sql' ||
      ' | supabase/migrations/586_qb3_customer_search_ranked.test.ts' ||
      ' | apps/web/src/features/sales/lib/customer-search.ts' ||
      ' | apps/web/src/features/sales/lib/customer-search.test.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api.search-companies-for-picker.test.ts' ||
      ' | supabase/migrations/732_b52_customer_attach_search_closeout.sql' ||
      ' | test-results/agent-gates/20260520T230316Z-A5.1-qb-3-fuzzy-phone-customer-search.json' ||
      ' | supabase/migrations/742_a51_fuzzy_phone_search_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.1 shipped: QB-3 fuzzy phone customer search is satisfied by the existing ranked picker path. Migration 586 restores v_rep_customers to one row per company with lateral primary-contact selection, defines search_customer_picker_ranked and search_companies_for_picker_ranked as security-invoker read-only RPCs, normalizes query phone digits, searches formatted and unformatted customer/company phones, preserves Search 1/Search 2 plus legacy customer-number lookup, and orders phone matches before limit application. The sales picker API resolves the active workspace, passes formatted phone queries through to search_companies_for_picker_ranked with p_query/p_workspace_id/p_limit, and the local rep-book matcher checks phone digits before falling back to workspace search. B5.2/HF-1 is shipped by migration 725, satisfying A5.1''s dependency without re-opening customer attach runtime behavior.'
  END,
  updated_at = now()
WHERE task_id = 'A5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.1',
  'update',
  jsonb_build_object(
    'reason', 'a51_fuzzy_phone_search_closeout',
    'migration', '742_a51_fuzzy_phone_search_closeout.sql',
    'mission_alignment', 'pass: reps building quotes can identify the right customer from partial phone digits or legacy customer codes instead of creating duplicate or orphan quote/customer records, strengthening sales continuity and operator trust',
    'dependency_evidence', jsonb_build_object(
      'B5.2', 'shipped by supabase/migrations/732_b52_customer_attach_search_closeout.sql'
    ),
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/586_qb3_customer_search_ranked.sql defines phone-first ranked picker RPCs and restores v_rep_customers one-row-per-company with Search 1/Search 2 preserved',
      'supabase/migrations/586_qb3_customer_search_ranked.test.ts proves both ranked picker functions rank phone matches before limit application and remain read-only',
      'apps/web/src/features/sales/lib/customer-search.ts normalizes phone digits and matches formatted or unformatted primary_contact_phone values in the local rep-book path',
      'apps/web/src/features/sales/lib/customer-search.test.ts covers Search 1/Search 2 prefix behavior and phone matching across formatted/unformatted input',
      'apps/web/src/features/sales/lib/sales-api.ts searchCompaniesForPicker resolves the active workspace and calls search_companies_for_picker_ranked with p_query, p_workspace_id, and p_limit',
      'apps/web/src/features/sales/lib/sales-api.search-companies-for-picker.test.ts proves formatted phone queries are passed through to the ranked RPC',
      'test-results/agent-gates/20260520T230316Z-A5.1-qb-3-fuzzy-phone-customer-search.json records the historical A5.1 segment gate as PASS'
    ),
    'safety_bounds', jsonb_build_array(
      'this migration marks only A5.1 shipped and does not alter picker runtime behavior',
      'ranked search remains workspace-scoped, security-invoker, and read-only',
      'short queries below two characters avoid workspace-wide RPC search',
      'B5.2 remains governed by its own closeout record'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live sales-rep UAT or phone-call capture was performed in this closeout',
      'no external customer export, portal credential, or live provider data was used',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
