-- ============================================================================
-- Migration 692: I3.1 accessory installs closeout
--
-- Migration 644 created tank/cooler/extension install rows and an idempotent
-- seeding RPC. The web dashboard now exposes controls to create the standard
-- rows and mark each install complete on the grapple build.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/644_grapple_build_child_entities.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Section 1.1, Section 5 ADD (Stream I)') ||
      ' | supabase/migrations/644_grapple_build_child_entities.sql' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.ts' ||
      ' | apps/web/src/features/service/lib/grapple-production-api.test.ts' ||
      ' | apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] I3.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] I3.1 shipped: migration 644 created grapple_build_accessory_installs, the ensure_grapple_build_accessory_install_steps RPC, RLS, and v_grapple_build_accessory_installs for tank/cooler/extension rows; the dashboard now lets eligible build operators create the standard install steps and mark each accessory install completed with installer and verification timestamps.'
  END,
  updated_at = now()
WHERE task_id = 'I3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'I3.1',
  'update',
  jsonb_build_object(
    'reason', 'i31_accessory_installs_closeout',
    'migration', '692_i31_accessory_installs_closeout.sql',
    'mission_alignment', 'pass: production managers can see and complete tank, cooler, and extension install steps directly on the grapple build, giving sales/service current production evidence without turning accessory work into a service work order',
    'implementation_evidence', jsonb_build_array(
      'public.grapple_build_accessory_installs',
      'public.ensure_grapple_build_accessory_install_steps',
      'public.v_grapple_build_accessory_installs',
      'apps/web/src/features/service/lib/grapple-production-api.ts ensureGrappleAccessoryInstallSteps',
      'apps/web/src/features/service/lib/grapple-production-api.ts completeGrappleAccessoryInstall',
      'apps/web/src/features/service/pages/GrappleProductionDashboardPage.tsx accessory installs card'
    )
  ),
  'codex'
);

COMMIT;
