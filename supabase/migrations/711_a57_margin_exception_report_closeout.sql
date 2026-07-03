-- ============================================================================
-- Migration 711: A5.7 owner margin exception report closeout
--
-- QB-11 is implemented by the owner-only v_margin_exceptions view plus the
-- /owner/margin-exceptions report surface. The report enriches
-- qb_margin_exceptions with the latest quote_approval_cases context without
-- adding a second persistence store or changing draft reason logging.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/602_v_margin_exceptions.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-11') ||
      ' | supabase/migrations/602_v_margin_exceptions.sql' ||
      ' | apps/web/src/features/owner/lib/owner-api.ts' ||
      ' | apps/web/src/features/owner/pages/MarginExceptionsPage.tsx' ||
      ' | apps/web/src/App.tsx' ||
      ' | apps/web/src/lib/nav-config.ts' ||
      ' | apps/web/src/components/TopBar.tsx' ||
      ' | apps/web/src/features/owner/pages/__tests__/MarginExceptionsPage.integration.test.tsx' ||
      ' | apps/web/src/features/owner/lib/owner-api.test.ts' ||
      ' | apps/web/src/features/owner/lib/owner-api-normalizers.test.ts' ||
      ' | apps/web/src/lib/nav-config.test.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.7 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.7 shipped: migration 602 creates public.v_margin_exceptions as a security-barrier/security-invoker owner-only workspace report over qb_margin_exceptions, enriched with the latest quote_approval_cases row per quote package and rep/brand labels. The view grants authenticated select while enforcing public.get_my_workspace() and public.get_my_role() = owner inside the view predicate. owner-api fetchOwnerMarginExceptions reads v_margin_exceptions with date, rep, approval-status, no-approval, and limit filters. MarginExceptionsPage renders /owner/margin-exceptions with summary metrics for exception count, estimated gap, average delta, pending/escalated cases, search/filter controls, and a read-only ledger showing rep, customer, quote, margin/floor, gap, reason, approval status, assignee/approver, and decision context. App route, TopBar, and nav-config expose the report only through owner utility navigation. Tests cover the owner API query, row normalizers, owner-only nav visibility, and integration rendering/filtering with approval and no-approval rows.'
  END,
  updated_at = now()
WHERE task_id = 'A5.7';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.7',
  'update',
  jsonb_build_object(
    'reason', 'a57_margin_exception_report_closeout',
    'migration', '711_a57_margin_exception_report_closeout.sql',
    'mission_alignment', 'pass: QEP owners get a dedicated margin leakage ledger that ties rep exceptions to approval-loop context, protecting equipment sales margin while keeping the approval audit trail visible',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/602_v_margin_exceptions.sql v_margin_exceptions view',
      'supabase/migrations/602_v_margin_exceptions.sql joins qb_margin_exceptions to latest quote_approval_cases',
      'supabase/migrations/602_v_margin_exceptions.sql workspace and owner gating',
      'apps/web/src/features/owner/lib/owner-api.ts fetchOwnerMarginExceptions',
      'apps/web/src/features/owner/pages/MarginExceptionsPage.tsx owner margin exception report route surface',
      'apps/web/src/App.tsx /owner/margin-exceptions route',
      'apps/web/src/lib/nav-config.ts owner utility nav entry',
      'apps/web/src/components/TopBar.tsx owner route primary action mapping',
      'apps/web/src/features/owner/pages/__tests__/MarginExceptionsPage.integration.test.tsx approval context and no-approval filter coverage',
      'apps/web/src/features/owner/lib/owner-api.test.ts v_margin_exceptions query coverage',
      'apps/web/src/features/owner/lib/owner-api-normalizers.test.ts malformed-row filtering coverage',
      'apps/web/src/lib/nav-config.test.ts owner-only utility visibility coverage'
    ),
    'safety_bounds', jsonb_build_array(
      'report is read-only',
      'view uses qb_margin_exceptions as the base audit log',
      'view enriches with the latest related quote_approval_cases row only',
      'view enforces workspace scope and owner role',
      'no QB-12 draft reason logging semantics are changed',
      'no duplicate margin exception persistence store is introduced'
    ),
    'manual_boundaries', jsonb_build_array(
      'production owner review cadence and report adoption remain manual operating-process evidence',
      'exact margin floor policy tuning remains an operations decision',
      'live production row counts depend on real quote-builder margin exception volume'
    )
  ),
  'codex'
);

COMMIT;
