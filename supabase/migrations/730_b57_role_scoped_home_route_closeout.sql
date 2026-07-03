-- ============================================================================
-- Migration 730: B5.7 Role-scoped home route closeout
--
-- SC-2 is satisfied by the centralized home-route policy and App route guards:
-- reps land on /sales/today, manager/admin roles land on /qrm, owners land on
-- /owner, and guarded non-sales management surfaces redirect reps to homeRoute.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%730_b57_role_scoped_home_route_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md SC-2') ||
      ' | apps/web/src/lib/home-route.ts' ||
      ' | apps/web/src/lib/home-route.test.ts' ||
      ' | apps/web/src/lib/home-route-app-routing.test.ts' ||
      ' | apps/web/src/App.tsx' ||
      ' | docs/role-home-feature-audit.md' ||
      ' | supabase/migrations/730_b57_role_scoped_home_route_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] B5.7 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] B5.7 shipped: resolveHomeRoute now centralizes role-scoped home routing for first login and /dashboard redirects: reps land on /sales/today, managers/admins on /qrm, owners on /owner, parts on /parts/companion/queue, service on /service, and rentals on /rentals. App.tsx uses that homeRoute for / and /dashboard, blocks rep deep-links to /floor and /qrm with canAccessFloorSurface/canAccessQrmSurface, and guards manager/admin-only routes through resolveManagerAdminRouteRedirect so reps return to /sales/today instead of management surfaces. home-route tests and SC-2 app-routing tests lock the policy.'
  END,
  updated_at = now()
WHERE task_id = 'B5.7';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'B5.7',
  'update',
  jsonb_build_object(
    'reason', 'b57_role_scoped_home_route_closeout',
    'migration', '730_b57_role_scoped_home_route_closeout.sql',
    'mission_alignment', 'pass: sales reps now land directly in the sales execution surface while managers, owners, parts, service, and rental users land in role-appropriate operational command centers for equipment and rental workflows',
    'implementation_evidence', jsonb_build_array(
      'apps/web/src/lib/home-route.ts resolveHomeRoute maps rep to /sales/today, manager/admin to /qrm, owner to /owner, parts to /parts/companion/queue, service to /service, and rental/rentals to /rentals',
      'resolveHomeRoute keeps stakeholder audience on /brief and uses /floor only as a non-core fallback for floor mode or recognized Floor/Iron assignments',
      'apps/web/src/App.tsx sends / and /dashboard to homeRoute',
      'App.tsx guards /floor with canAccessFloorSurface(profile.role) and redirects disallowed roles to homeRoute',
      'App.tsx guards /qrm with canAccessQrmSurface(profile.role) and redirects disallowed roles to homeRoute',
      'App.tsx guards /qrm/activities/templates, /admin/sequences, and /admin/duplicates with canAccessManagerAdminRoute plus resolveManagerAdminRouteRedirect',
      'apps/web/src/lib/home-route.test.ts proves core role home targets and rep redirects for manager/admin route decisions',
      'apps/web/src/lib/home-route-app-routing.test.ts proves SC-2 app route wiring references centralized helpers and homeRoute redirects',
      'docs/role-home-feature-audit.md now documents core-role precedence and rep guard behavior'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout does not alter runtime route logic',
      'rep deep-links to floor, QRM, and manager/admin-only routes resolve to /sales/today via homeRoute',
      'manager/admin/owner access to QRM and manager surfaces remains intact',
      'stakeholder audience routing to /brief remains intact',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no credentialed browser UAT was performed for live first-login redirects in this closeout',
      'route behavior is verified through focused unit/static tests and the full segment gate',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
