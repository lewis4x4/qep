-- ============================================================================
-- Migration 159: SOP workspace-isolation hardening
--
-- (a) sop_compliance_summary view must run with the caller's RLS — it was
--     created without security_invoker and currently leaks compliance rows
--     across workspaces.
-- (b) sop_* tables default workspace_id to the literal 'default' which both
--     masks multi-tenant bugs and causes RLS WITH CHECK to fail for non-
--     default users. Switch the column default to public.get_my_workspace()
--     so the authed edge-function path picks up the caller's workspace
--     automatically.
--
-- Service-role callers (cron, admin jobs) are unaffected — they continue to
-- pass workspace_id explicitly in their inserts.
-- ============================================================================

-- (a) Honor RLS on the compliance view
alter view public.sop_compliance_summary set (security_invoker = true);

-- (b) Re-default workspace_id to the caller's workspace
alter table public.sop_templates
  alter column workspace_id set default public.get_my_workspace();
alter table public.sop_steps
  alter column workspace_id set default public.get_my_workspace();
alter table public.sop_executions
  alter column workspace_id set default public.get_my_workspace();
alter table public.sop_step_completions
  alter column workspace_id set default public.get_my_workspace();
alter table public.sop_step_skips
  alter column workspace_id set default public.get_my_workspace();

comment on view public.sop_compliance_summary is
  'SOP compliance metrics with step-level skip analysis. security_invoker=true — honors caller RLS.';
