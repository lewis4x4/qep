-- ============================================================================
-- Migration 724: B5.1 one-tap activity logging closeout
--
-- DH-3 is satisfied by the existing sales activity logging path:
-- logSalesActivity writes authenticated, workspace-scoped crm_activities rows,
-- deal taps prefer deal_id over company_id, customer taps write company_id, and
-- QuickLogSheet blocks subjectless writes before any insert attempt.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%731_b51_one_tap_activity_logging_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md DH-3') ||
      ' | apps/web/src/features/sales/lib/sales-api.ts' ||
      ' | apps/web/src/features/sales/lib/__tests__/sales-api.log-sales-activity.test.ts' ||
      ' | apps/web/src/features/sales/components/SalesDealCard.tsx' ||
      ' | apps/web/src/features/sales/components/SalesCustomerCard.tsx' ||
      ' | apps/web/src/features/sales/components/ActionItemCard.tsx' ||
      ' | apps/web/src/features/sales/components/QuickLogSheet.tsx' ||
      ' | supabase/migrations/731_b51_one_tap_activity_logging_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.1 shipped: logSalesActivity authenticates the current rep, resolves the active workspace, and inserts crm_activities through buildSalesActivityInsertPayload. Existing tests prove deal quick taps persist deal_id while clearing company_id, customer taps persist company_id with no deal_id, unauthenticated reps fail before insert, subjectless writes fail before insert, and visit quick logs normalize to the DB meeting activity type. SalesDealCard logs call taps with both dealId and companyId so the helper applies deal precedence, SalesCustomerCard logs call/email taps with companyId, ActionItemCard logs the computed call/email channel against the deal subject, and QuickLogSheet gates call/email/visit/note actions behind an existing deal or company subject.'
  END,
  updated_at = now()
WHERE task_id = 'B5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.1',
  'update',
  jsonb_build_object(
    'reason', 'b51_one_tap_activity_logging_closeout',
    'migration', '731_b51_one_tap_activity_logging_closeout.sql',
    'mission_alignment', 'pass: reps can capture calls, emails, visits, and notes from the active sales workflow with one tap, turning field activity into auditable CRM memory instead of after-the-fact manual data entry',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/features/sales/lib/sales-api.ts logSalesActivity requires an authenticated user and active workspace before insert',
      'apps/web/src/features/sales/lib/sales-api.ts writes crm_activities through buildSalesActivityInsertPayload',
      'apps/web/src/features/sales/lib/__tests__/sales-api.log-sales-activity.test.ts proves deal taps persist deal_id and clear company_id',
      'apps/web/src/features/sales/lib/__tests__/sales-api.log-sales-activity.test.ts proves customer taps persist company_id without deal_id',
      'apps/web/src/features/sales/lib/__tests__/sales-api.log-sales-activity.test.ts proves unauthenticated and subjectless quick actions throw before insert',
      'apps/web/src/features/sales/lib/__tests__/sales-api.log-sales-activity.test.ts proves visit quick actions normalize to the DB meeting activity type',
      'apps/web/src/features/sales/components/SalesDealCard.tsx logs call taps with dealId and companyId so deal precedence is preserved',
      'apps/web/src/features/sales/components/SalesCustomerCard.tsx logs call/email taps with companyId before opening tel/mailto',
      'apps/web/src/features/sales/components/ActionItemCard.tsx logs the computed call/email channel against the deal subject',
      'apps/web/src/features/sales/components/QuickLogSheet.tsx disables and rejects subjectless quick logs before calling logSalesActivity'
    ),
    'safety_bounds', jsonb_build_array(
      'one-tap UI actions do not bypass existing Supabase auth or crm_activities RLS',
      'deal-linked activity intentionally clears company_id in the insert payload to avoid ambiguous subject ownership',
      'QuickLogSheet requires an existing deal or company subject for all quick activity types',
      'this closeout does not alter telephony, email, routing, or crm_activities runtime behavior'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live phone call, email client launch, or field visit was performed',
      'no manual sales-rep UAT was performed',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
