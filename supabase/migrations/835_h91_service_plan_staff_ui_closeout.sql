-- ============================================================================
-- Migration 835: H9.1 staff-facing service-plan UI closeout
--
-- Migration 829 delivered the guarded service-plan data model and automation.
-- This migration records the reviewed catalog, separate activation, equipment
-- enrollment, and PM prompt-handling staff workflows as shipped.
--
-- Rollback notes:
--   1. Restore the prior workspace-scoped `svc_agreements_insert` and
--      `svc_agreements_update` policies from migration 349 only if rep-level
--      contract writes are intentionally being reinstated.
--   2. Restore the H9.1 roadmap row and append a compensating
--      `qep_roadmap_sync_events` record; do not delete audit history.
--   3. This migration creates no tables, columns, functions, or edge runtime
--      dependencies, so no destructive schema rollback is required.
-- ============================================================================

begin;

-- Agreement reads remain available to the service surface, but customer-live
-- contract creation and mutation must use the same elevated-role boundary as
-- catalog review, activation, and enrollment.
drop policy if exists "svc_agreements_insert" on public.service_agreements;
create policy "svc_agreements_insert"
  on public.service_agreements for insert to authenticated
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

drop policy if exists "svc_agreements_update" on public.service_agreements;
create policy "svc_agreements_update"
  on public.service_agreements for update to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

update public.qep_roadmap_tasks
set
  ship_state = 'shipped',
  blocking_decision = null,
  evidence_link = case
    when coalesce(evidence_link, '') like '%835_h91_service_plan_staff_ui_closeout.sql%'
      then evidence_link
    else coalesce(nullif(evidence_link, ''), 'supabase/migrations/829_service_plan_pm_automation_and_entitlement_ledger.sql') ||
      ' | apps/web/src/features/service/pages/ServicePlansPage.tsx' ||
      ' | apps/web/src/features/service/pages/ServiceAgreementDetailPage.tsx' ||
      ' | apps/web/src/features/service/lib/service-plan-api.ts' ||
      ' | apps/web/src/features/service/lib/service-plan-utils.ts' ||
      ' | apps/web/src/features/service/pages/__tests__/ServicePlansPage.integration.test.tsx' ||
      ' | apps/web/src/features/service/pages/__tests__/ServiceAgreementDetailPage.integration.test.tsx' ||
      ' | docs/operations/H9_1_SERVICE_PLAN_STAFF_UI_HANDOFF_2026-08-12.md' ||
      ' | supabase/migrations/835_h91_service_plan_staff_ui_closeout.sql'
  end,
  notes = case
    when coalesce(notes, '') like '%[2026-08-12] H9.1 shipped%'
      then notes
    else coalesce(notes, '') || E'\n[2026-08-12] H9.1 shipped: elevated QEP operators can review an inactive provisional program with immutable notes, activate it only in a later action after complete recorded-review evidence exists, bind reviewed programs to agreements, enroll covered equipment with an explicit or authoritative meter baseline, inspect cadence and entitlement state, open generated PM work, and cancel due work only through the controlled reason-bearing RPC. Client readiness remains fail closed while catalog evidence is unresolved, and migration 829 remains the database authority for inactive drafts, recorded-review activation, enrollment, append-only prompts, and entitlement integrity.'
  end,
  updated_at = now()
where task_id = 'H9.1';

insert into public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
values (
  'reconcile',
  'H9.1',
  'update',
  jsonb_build_object(
    'reason', 'h91_service_plan_staff_ui_closeout',
    'migration', '835_h91_service_plan_staff_ui_closeout.sql',
    'mission_alignment', 'pass: reviewed preventive-maintenance intent now becomes auditable equipment enrollment, schedule action, and entitlement truth for QEP service staff without allowing provisional catalog assumptions to become customer-live',
    'implementation_evidence', jsonb_build_array(
      'ServicePlansPage separates review from activation, displays recorded notes and timestamp, and blocks activation without complete recorded-review evidence and an active interval',
      'ServiceAgreementDetailPage binds catalog programs, fails closed until reviewed active non-provisional program evidence resolves, and enrolls equipment through migration 829 RPCs',
      'ServicePlansPage lists append-only PM prompts, opens generated jobs, and routes reason-bearing cancellation through service_plan_cancel_pm_due_event',
      'focused unit and integration regressions cover inactive drafts, recorded review, guarded activation, unresolved enrollment evidence, successful enrollment, and controlled prompt cancellation',
      'the required H9.1 UI segment gate chain completed with QA, migration, build, test, chaos, and design gates passing'
    ),
    'safety_bounds', jsonb_build_array(
      'the BlackRock seed catalog remains inactive and provisional until an elevated QEP operator records review notes',
      'review and activation remain separate database writes and activation requires pre-existing immutable review evidence',
      'equipment enrollment remains restricted to elevated operators and reviewed active non-provisional programs',
      'PM prompt records and entitlement entries remain append-only; generated PM work is cancelled only through the migration 829 RPC',
      'service agreement insert and update RLS require an authenticated admin, manager, or owner in the active workspace',
      'no OEM kit, price, labor time, or commercial term is fabricated by the UI'
    ),
    'manual_boundaries', jsonb_build_array(
      'QEP service leadership must validate OEM/model fit, kit, labor, and commercial terms before recording a catalog review',
      'production operators remain responsible for scheduling or cancelling each generated PM job from the prompt inbox',
      'this closeout does not claim that any provisional BlackRock seed program has been reviewed or activated'
    )
  ),
  'codex'
);

commit;
