-- ============================================================================
-- Migration 754: F4.3 owner delegation toggles closeout
--
-- Migration 621 already added owner/class delegation policies, immutable audit
-- evidence, seeded defaults, and the guarded delegated recommendation RPC.
-- This migration records roadmap status only and does not claim a new live DB
-- apply or owner self-service settings UI beyond the source-controlled backend.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%761_f43_owner_delegation_toggles_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.3') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F4.3' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md section 11 delegation toggle requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-161 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F4.3 foundation built' ||
      ' | docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md Q11 delegated evidence' ||
      ' | supabase/migrations/621_qep_owner_delegation_policies.sql' ||
      ' | supabase/migrations/621_qep_owner_delegation_policies.test.ts' ||
      ' | supabase/migrations/761_f43_owner_delegation_toggles_closeout.test.ts' ||
      ' | supabase/migrations/761_f43_owner_delegation_toggles_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F4.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F4.3 shipped: migration 621 adds qep_decisions.decision_class, qep_decision_delegation_policies, qep_decision_delegation_audit, fn_qep_decision_classify, and apply_qep_delegated_recommendation. Default policies match Decision Inbox V2 section 11: Rylee copy_ux enabled, Ryan non_visual enabled and visual disabled, Angela compliance_tila disabled, Norman parts_pricing_mechanics enabled and pricing_policy disabled, and Tina accounting_mechanics enabled and closed_period_policy disabled. The delegated apply RPC is security-definer, available to authenticated/service_role, restricted to service/admin/manager/owner callers, locks the decision, requires open/escalated/shadow_ship status plus recommended_option, requires an enabled owner/class/delegate policy, answers the decision with the recommendation, stamps Brian approval/delegation metadata into ai_prep_packet, writes qep_decision_delegation_audit, and records qep_roadmap_sync_events evidence. The 2026-05-21 blocker handoff records Q11 resolved through this audited delegation path with policy and audit ids.'
  END,
  updated_at = now()
WHERE task_id = 'F4.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F4.3',
  'update',
  jsonb_build_object(
    'reason', 'f43_owner_delegation_toggles_closeout',
    'migration', '761_f43_owner_delegation_toggles_closeout.sql',
    'mission_alignment', 'pass: owner delegation lets QEP equipment, parts, rental, sales, service, and management decisions keep moving when an owner has explicitly allowed Brian to answer a bounded class of work, while preserving policy and audit evidence',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F4.3 as Per-owner delegation toggles with dependency F2.5',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md section 11 defines the owner/class delegation defaults and requires delegated applies to log Brian as approver of record',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-161 / F4.3 Per-owner delegation toggles as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records F4.3 / QEP-161 as foundation built with migration reconciliation caveat',
      'supabase/migrations/621_qep_owner_delegation_policies.sql adds qep_decisions.decision_class',
      'supabase/migrations/621_qep_owner_delegation_policies.sql creates qep_decision_delegation_policies with owner_role, decision_class, delegate_role, delegate_actor, enabled, conditions, notes, author fields, timestamps, uniqueness, lookup index, and updated_at trigger',
      'supabase/migrations/621_qep_owner_delegation_policies.sql creates qep_decision_delegation_audit with decision, owner, class, delegate, policy, approved option/rationale, source recommendation, applied_by, applied_at, rationale, and policy snapshot evidence',
      'supabase/migrations/621_qep_owner_delegation_policies.sql implements fn_qep_decision_classify with explicit decision_class, ai_prep_packet class, and deterministic fallback keyword rules',
      'supabase/migrations/621_qep_owner_delegation_policies.sql implements apply_qep_delegated_recommendation with service/admin/manager/owner caller guard, decision lock, eligible status guard, recommended_option guard, enabled policy lookup, qep_decisions answer update, ai_prep_packet delegation metadata, delegation audit insert, sync-event insert, and structured JSON return',
      'supabase/migrations/621_qep_owner_delegation_policies.sql seeds enabled and disabled owner/class defaults from Decision Inbox V2 section 11',
      'supabase/migrations/621_qep_owner_delegation_policies.test.ts pins the tables, defaults, RPC guards, audit evidence, and execute grants',
      'docs/operations/QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md records Q11 resolved using apply_qep_delegated_recommendation with policy id e4f38497-92c9-41f9-8546-d11138a010f8 and audit id 61590fb6-5850-4172-b397-7d98ad133380'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime delegation behavior',
      'this closeout marks only F4.3 shipped and does not mark F4.4, F5.1, or F5.2',
      'delegated apply requires an enabled owner/class/delegate policy and an existing recommended_option',
      'disabled policy classes such as Ryan visual, Angela compliance_tila, Norman pricing_policy, and Tina closed_period_policy remain disabled by default',
      'authenticated non-elevated callers cannot use the delegated apply RPC because it checks get_my_role for admin, manager, or owner unless running as service_role',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no new live owner self-service settings session was run in this source-controlled closeout',
      'no new live production delegated decision was applied during this closeout beyond the existing Q11 evidence recorded in the 2026-05-21 handoff',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
