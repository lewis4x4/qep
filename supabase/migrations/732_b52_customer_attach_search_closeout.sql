-- ============================================================================
-- Migration 725: B5.2 customer attach dropdown search closeout
--
-- HF-1 is satisfied by the existing two-tier customer picker: local rep-book
-- matching handles names, legacy Search 1/Search 2 prefixes, and phone digits;
-- when no rep-book row matches, CustomerPickerInline debounces a workspace-wide
-- ranked read-only RPC fallback.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%732_b52_customer_attach_search_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md HF-1') ||
      ' | supabase/migrations/586_qb3_customer_search_ranked.sql' ||
      ' | apps/web/src/features/sales/lib/customer-search.ts' ||
      ' | apps/web/src/features/sales/lib/customer-search.test.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api.ts' ||
      ' | apps/web/src/features/sales/lib/sales-api.search-companies-for-picker.test.ts' ||
      ' | apps/web/src/features/sales/components/CustomerPickerInline.tsx' ||
      ' | apps/web/src/features/sales/components/SmartVoiceCapture.customer-picker.test.tsx' ||
      ' | supabase/migrations/732_b52_customer_attach_search_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.2 shipped: CustomerPickerInline now searches the rep book first with matchesRepCustomerSearch, which supports company/contact/location text, Search 1/Search 2 prefix matching, and formatted or unformatted phone digits. When the rep-book result set is empty and the query has at least two characters, the picker debounces a workspace-wide fallback through searchCompaniesForPicker. That API resolves the active workspace and calls search_companies_for_picker_ranked with p_query, p_workspace_id, and p_limit. Migration 586 keeps the ranked RPC read-only, workspace-scoped, phone-first before limit, and searchable across DREC/legacy code fields. Existing tests cover DREC prefix matching, phone matching, short-query no-op behavior, ranked RPC argument mapping, and workspace fallback selection when a customer is absent from the first 100 rep-book rows.'
  END,
  updated_at = now()
WHERE task_id = 'B5.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.2',
  'update',
  jsonb_build_object(
    'reason', 'b52_customer_attach_search_closeout',
    'migration', '732_b52_customer_attach_search_closeout.sql',
    'mission_alignment', 'pass: reps can attach the correct customer from field voice and sales workflows even when a customer is outside their first visible book page, reducing orphaned activity and improving account memory',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/sales/lib/customer-search.ts matches rep-book customers by company, contact, city/state, Search 1/Search 2 prefix, and phone digits',
      'apps/web/src/features/sales/lib/customer-search.test.ts proves DREC/Search-code prefix matching, normal text matching, and formatted/unformatted phone matching',
      'apps/web/src/features/sales/components/CustomerPickerInline.tsx filters rep-book rows first and only enables workspace fallback when no book match exists and query length is at least two',
      'apps/web/src/features/sales/components/CustomerPickerInline.tsx debounces input, passes AbortSignal into searchCompanies, and labels fallback results as Workspace',
      'apps/web/src/features/sales/components/SmartVoiceCapture.customer-picker.test.tsx proves DREC prefix matches stay local and Precision Land appears through the workspace fallback when absent from the first 100 rep-book rows',
      'apps/web/src/features/sales/lib/sales-api.ts searchCompaniesForPicker resolves the active workspace and calls search_companies_for_picker_ranked with p_query, p_workspace_id, and p_limit',
      'apps/web/src/features/sales/lib/sales-api.search-companies-for-picker.test.ts proves short queries do not hit RPC and formatted phone queries pass through to the ranked RPC',
      'supabase/migrations/586_qb3_customer_search_ranked.sql defines search_companies_for_picker_ranked as a security-invoker read-only workspace-scoped function',
      'supabase/migrations/586_qb3_customer_search_ranked.test.ts proves the ranked picker orders phone matches first before limit and preserves legacy Search 1/Search 2 fields'
    ),
    'safety_bounds', jsonb_build_array(
      'workspace fallback is read-only and grants only execute to authenticated callers',
      'fallback uses the active workspace id and does not broaden across deleted companies',
      'short queries below two characters avoid workspace-wide search',
      'this closeout does not alter customer picker runtime behavior or CRM write paths'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live sales-rep UAT of customer attach was performed',
      'no external customer list import or portal credential source was used',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
