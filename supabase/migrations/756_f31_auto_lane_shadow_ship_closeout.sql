-- ============================================================================
-- Migration 749: F3.1 AUTO-lane shadow-ship infrastructure closeout
--
-- Migration 618 already created the flag-scoped shadow-ship ledger and RPC
-- infrastructure. This migration records roadmap status only and does not
-- assert a live production AUTO feature rollout.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%756_f31_auto_lane_shadow_ship_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.1') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.1' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F3.1 AUTO-lane shadow-ship requirement' ||
      ' | QEP (1)/QEP_DECISION_INBOX_GO_LIVE.md F3.1/F3.2 shadow-ship infrastructure handoff' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-147 Done' ||
      ' | supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql' ||
      ' | supabase/migrations/629_rls_initplan_corrective_reapply.sql qep_shadow_ship_flags policy' ||
      ' | supabase/migrations/651_qep_decision_resolution_authority.sql resolver guard' ||
      ' | supabase/migrations/651_qep_decision_resolution_authority.test.ts' ||
      ' | supabase/migrations/756_f31_auto_lane_shadow_ship_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F3.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F3.1 shipped: migration 618 provides AUTO-lane shadow-ship infrastructure through qep_shadow_ship_flags, a feature_flag + rep_scope ledger, active-scope uniqueness, activation metadata, silence deadlines, ratified/reverted lifecycle state, touch-updated trigger, RLS, and grants. activate_qep_auto_shadow_ship validates caller role, AUTO lane, open/escalated status, recommended_option parity, optional roadmap task existence, inserts the ledger row, flips the decision to shadow_ship, records auto_shadow_ship metadata in ai_prep_packet, and writes qep_roadmap_sync_events. ratify_expired_qep_auto_shadow_ship is service-role-only and marks expired AUTO shadow-ship rows ratified while stamping qep_decisions answered metadata and sync events. Later resolution-authority guards preserve lane-aware resolved-state semantics.'
  END,
  updated_at = now()
WHERE task_id = 'F3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F3.1',
  'update',
  jsonb_build_object(
    'reason', 'f31_auto_lane_shadow_ship_closeout',
    'migration', '756_f31_auto_lane_shadow_ship_closeout.sql',
    'mission_alignment', 'pass: AUTO shadow-ship infrastructure lets reversible QEP equipment, parts, rental, sales, service, and management decisions advance behind scoped flags for one rep, reducing stalled work while preserving auditability and ratification/revert state',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F3.1 as AUTO-lane shadow-ship infrastructure with dependency F1.4',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines F3.1 as flag-scoped AUTO-lane shadow-ship infrastructure',
      'QEP (1)/QEP_DECISION_INBOX_GO_LIVE.md calls out F3.1/F3.2 as the infrastructure needed before silence-based promotion can run automatically',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-147 / F3.1 AUTO-lane shadow-ship infrastructure as Done on 2026-05-21',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql creates qep_shadow_ship_status with shadow_ship, ratified, and reverted lifecycle states',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql creates qep_shadow_ship_flags with decision, task, feature_flag, rep_scope, recommendation, silence threshold, deadline, activation, ratification, reversion, and metadata columns',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql enforces active decision + feature_flag + rep_scope + task uniqueness while status is shadow_ship',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql defines activate_qep_auto_shadow_ship for service/admin/manager/owner callers and validates AUTO lane, open/escalated status, recommended_option parity, task existence, and nonblank flag/scope/recommendation inputs',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql activates a scoped ledger row, flips the decision to shadow_ship, writes ai_prep_packet.auto_shadow_ship metadata, and records qep_roadmap_sync_events',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql defines service-role-only ratify_expired_qep_auto_shadow_ship to ratify expired shadow-ship ledger rows and stamp qep_decisions answered metadata',
      'supabase/migrations/618_qep_auto_lane_shadow_ship_flags.sql enables RLS, grants activate_qep_auto_shadow_ship to authenticated/service_role, and grants the ratifier only to service_role',
      'supabase/migrations/629_rls_initplan_corrective_reapply.sql reapplies qep_shadow_ship_flags authenticated write policy using initplan-safe get_my_role',
      'supabase/migrations/651_qep_decision_resolution_authority.sql adds a resolution authority guard and audit ledger for answered, shadow_ship, and superseded transitions'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime shadow-ship behavior',
      'this closeout marks only F3.1 shipped and does not mark F3.2, F3.3, F4.1, F4.2, F4.3, F4.4, F5.1, or F5.2',
      'activation is scoped by feature_flag and rep_scope rather than a global rollout',
      'activation requires the provided recommendation to match qep_decisions.recommended_option',
      'active scoped duplicate ledger rows are blocked by a partial unique index',
      'ratification is service-role-only and bounded to expired AUTO shadow_ship ledger rows',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live AUTO decision was activated behind a production feature flag in this source-controlled closeout',
      'no production rep-scope rollout or owner silence window was exercised',
      'F3.2 RATIFY-lane silence cron remains a separate downstream row',
      'actual application feature-flag consumers for a specific product path remain per-feature implementation work outside this infrastructure closeout',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
