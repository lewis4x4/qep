-- ============================================================================
-- Migration 741: E4.2 role-aware knowledge ingestion closeout
--
-- KL-2 is satisfied by migration 616, the authenticated ingest edge function,
-- and retrieval callers that enforce workspace + audience + role access before
-- ranking so restricted knowledge sources return no matches without existence
-- leakage. This migration records roadmap status only.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%741_e42_role_aware_knowledge_ingestion_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md KL-2') ||
      ' | QEP (1)/QEP-OMI-CONSOLIDATED-BUILD-PLAN.md KL-2' ||
      ' | supabase/migrations/616_kb_audience_role_access.sql' ||
      ' | scripts/verify/kb-role-aware-access.mjs' ||
      ' | supabase/functions/iron-knowledge-ingest/index.ts' ||
      ' | supabase/functions/hub-ask-brain/index.ts' ||
      ' | supabase/functions/iron-knowledge/index.ts' ||
      ' | supabase/config.toml' ||
      ' | package.json kb:role-access:verify' ||
      ' | supabase/migrations/741_e42_role_aware_knowledge_ingestion_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] E4.2 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] E4.2 shipped: KL-2 role-aware knowledge ingestion is implemented by supabase/migrations/616_kb_audience_role_access.sql, which creates kb_audience_role_access, backfills current hub knowledge sources to allowed roles, tightens hub_knowledge_source and hub_knowledge_chunk RLS to workspace/audience/role ACLs, and replaces match_hub_knowledge so ACL filtering happens in candidate_scope before similarity ranking. supabase/functions/iron-knowledge-ingest/index.ts validates admin/manager/owner authority, requires title/body/allowed_roles, writes hub_knowledge_source and hub_knowledge_chunk rows, replaces per-source ACL rows, and optionally notifies eligible users only. hub-ask-brain passes caller role/audience into match_hub_knowledge, iron-knowledge documents the no-leakage pre-retrieval requirement, and scripts/verify/kb-role-aware-access.mjs verifies the source-controlled contract. Live KB workspace-isolation fixtures, production embedding credentials, and operational upload/UAT evidence remain environment/manual gates outside this closeout.'
  END,
  updated_at = now()
WHERE task_id = 'E4.2';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'E4.2',
  'update',
  jsonb_build_object(
    'reason', 'e42_role_aware_knowledge_ingestion_closeout',
    'migration', '741_e42_role_aware_knowledge_ingestion_closeout.sql',
    'mission_alignment', 'pass: QEP can ingest and retrieve operating knowledge with role-aware boundaries for reps, admins, managers, owners, and client stakeholders, protecting sensitive equipment, sales, rental, service, parts, and management context while still making the right knowledge available to the right employee workflow',
    'implementation_evidence', jsonb_build_array(
      'QEP (1)/QEP-OMI-CONSOLIDATED-BUILD-PLAN.md contains the KL-2 role-aware knowledge ingestion acceptance criteria',
      'supabase/migrations/616_kb_audience_role_access.sql creates kb_audience_role_access with unique source/audience/role ACL rows',
      'supabase/migrations/616_kb_audience_role_access.sql grants service-role management and authenticated self-visible reads scoped by workspace, audience, and role',
      'supabase/migrations/616_kb_audience_role_access.sql replaces hub_knowledge_source and hub_knowledge_chunk read policies with ACL-aware policies',
      'supabase/migrations/616_kb_audience_role_access.sql replaces match_hub_knowledge with p_caller_role and p_caller_audience parameters and filters candidate_scope before ranking',
      'supabase/functions/iron-knowledge-ingest/index.ts validates admin/manager/owner callers and required allowed_roles before writing source, chunk, and kb_audience_role_access rows',
      'supabase/functions/hub-ask-brain/index.ts passes caller role and audience into match_hub_knowledge',
      'supabase/functions/iron-knowledge/index.ts preserves the requirement that role filtering happens inside retrieval RPCs before ranking',
      'scripts/verify/kb-role-aware-access.mjs verifies the migration, edge functions, config, and source plan anchors',
      'package.json exposes bun run kb:role-access:verify'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime KB behavior',
      'this closeout marks only E4.2 shipped and does not mark E4.1 shipped',
      'retrieval authorization is enforced before ranking so unauthorized users receive no restricted matches',
      'ingestion requires authenticated admin, manager, or owner authority even though the edge gateway uses verify_jwt = false for ES256 compatibility',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'live production embeddings require OPENAI_API_KEY and target Supabase environment secrets',
      'KB workspace-isolation eval remains skipped unless KB_ISOLATION_CASES is configured',
      'production upload/UAT evidence for specific operating documents remains outside this source-controlled closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
