-- ============================================================================
-- Migration 687: H13.1 service roles and RLS closeout
--
-- H13 was implemented by the enum expansion and RLS foundation migrations.
-- Record the roadmap state with concrete role, policy, and API evidence.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%631_service_roles_rls_foundation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H13') ||
      ' | supabase/migrations/630_service_roles_user_role_enum.sql' ||
      ' | supabase/migrations/631_service_roles_rls_foundation.sql' ||
      ' | supabase/functions/_shared/service-auth.ts' ||
      ' | supabase/functions/service-job-router/index.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H13.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H13.1 shipped: user_role now includes service_writer, technician, parts_counter, dispatch, and finance_admin; service_jobs, job events, blockers, parts, quote, timecard, segment, billing, and service evidence policies enforce workspace-scoped service roles; technicians are limited to their own assigned jobs through technician_id = auth.uid() predicates in SQL and user-scoped service-job-router reads/mutations.'
  END,
  updated_at = now()
WHERE task_id = 'H13.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H13.1',
  'update',
  jsonb_build_object(
    'reason', 'h13_service_roles_rls_closeout',
    'migration', '694_h13_service_roles_rls_closeout.sql',
    'mission_alignment', 'pass: service, parts, dispatch, finance, and technician work can now run with explicit least-privilege roles while technician records stay constrained to assigned jobs',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/630_service_roles_user_role_enum.sql service_writer/technician/parts_counter/dispatch/finance_admin enum values',
      'supabase/migrations/631_service_roles_rls_foundation.sql svc_jobs_select technician_id = auth.uid() policy',
      'supabase/migrations/631_service_roles_rls_foundation.sql service_job_segments_technician_select assigned-job policy',
      'supabase/migrations/631_service_roles_rls_foundation.sql finance_admin billing policies',
      'supabase/functions/_shared/service-auth.ts SERVICE_DEPARTMENT_ROLES and role-specific allow lists',
      'supabase/functions/service-job-router/index.ts canRunServiceJobAction service-role API gating'
    )
  ),
  'codex'
);

COMMIT;
