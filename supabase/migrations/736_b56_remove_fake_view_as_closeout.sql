-- ============================================================================
-- Migration 729: B5.6 Remove fake view_as / real rep test session closeout
--
-- SC-1 is satisfied by replacing fake FloorPage query impersonation with a
-- manager/owner-only Supabase magic-link flow that opens a real rep session in
-- the same workspace.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%736_b56_remove_fake_view_as_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md SC-1') ||
      ' | apps/web/src/components/TopBar.tsx' ||
      ' | apps/web/src/features/floor/pages/__tests__/view-as-removal.test.ts' ||
      ' | apps/web/src/features/floor/pages/__tests__/floor-view-as-noop.test.tsx' ||
      ' | supabase/functions/rep-test-session/index.ts' ||
      ' | supabase/functions/rep-test-session/logic.ts' ||
      ' | supabase/functions/rep-test-session/logic.test.ts' ||
      ' | supabase/config.toml' ||
      ' | supabase/migrations/736_b56_remove_fake_view_as_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.6 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.6 shipped: fake view_as query behavior is removed from TopBar/FloorPage and covered by regressions proving /floor?view_as=iron_advisor does not change the resolved role home or display read-only preview copy. Manager/owner users now open a real rep test session from TopBar through the rep-test-session edge function, which authenticates the caller with requireServiceUser, restricts access to manager/owner roles, selects an email-backed rep in the caller workspace, and uses Supabase admin.generateLink to create a magic link redirecting to /sales/today.'
  END,
  updated_at = now()
WHERE task_id = 'B5.6';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.6',
  'update',
  jsonb_build_object(
    'reason', 'b56_remove_fake_view_as_closeout',
    'migration', '736_b56_remove_fake_view_as_closeout.sql',
    'mission_alignment', 'pass: managers and owners can validate the rep sales workflow against real Supabase auth and workspace-scoped data instead of a fake UI role override, improving trust in equipment and rental sales operations',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/components/TopBar.tsx exposes Open Rep Test Session only to manager/owner roles and invokes the rep-test-session edge function',
      'TopBar opens only the returned actionLink in a noopener/noreferrer tab and reports a bounded failure message if the edge function fails',
      'apps/web/src/features/floor/pages/__tests__/view-as-removal.test.ts proves TopBar and FloorPage no longer contain view_as query behavior',
      'apps/web/src/features/floor/pages/__tests__/floor-view-as-noop.test.tsx proves /floor?view_as=iron_advisor still renders the resolved Owner Home and no Read-only preview',
      'supabase/functions/rep-test-session/index.ts requires requireServiceUser, rejects non-manager/owner callers, filters profiles to role=rep in the caller workspace, and generates a Supabase magic link for the selected rep email',
      'supabase/functions/rep-test-session/logic.ts centralizes the allowed roles, /sales/today redirect, environment origin fallback, and same-workspace rep selection',
      'supabase/functions/rep-test-session/logic.test.ts proves manager/owner authorization, redirect origin fallback, same-workspace rep filtering, and blank-email handling',
      'supabase/config.toml registers rep-test-session with verify_jwt=false so the function can perform canonical service-auth validation'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not change runtime code',
      'the edge function does not accept a requested rep id or email from the browser',
      'the selected rep must have role=rep, active_workspace_id equal to the caller workspace, profile_workspaces membership in that workspace, and a non-null email',
      'fake view_as query parameters no longer influence TopBar or FloorPage role rendering',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live manager/owner magic-link session was opened in Supabase for this closeout',
      'live verification still requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and at least one real rep email in the workspace',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
