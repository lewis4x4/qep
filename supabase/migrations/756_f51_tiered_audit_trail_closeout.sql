-- ============================================================================
-- Migration 756: F5.1 tiered audit trail closeout
--
-- Migration 622 and the decision-audit-artifact edge function already added
-- the source-controlled audit ledger and artifact generation path. This
-- migration records roadmap status only and does not claim production DB apply.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%756_f51_tiered_audit_trail_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F5.1') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F5.1' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F5.1 tiered audit requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-150 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F5.1 foundation built' ||
      ' | supabase/migrations/622_qep_decision_audit_artifacts.sql' ||
      ' | supabase/migrations/622_qep_decision_audit_artifacts.test.ts' ||
      ' | supabase/functions/decision-audit-artifact/index.ts' ||
      ' | supabase/functions/decision-audit-artifact/logic.ts' ||
      ' | supabase/functions/decision-audit-artifact/logic.test.ts' ||
      ' | supabase/migrations/756_f51_tiered_audit_trail_closeout.test.ts' ||
      ' | supabase/migrations/756_f51_tiered_audit_trail_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F5.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F5.1 shipped: migration 622 creates qep_decision_audit_artifacts with lane-derived audit grades auto, ratify, and authorize; artifact kinds row, html, and pdf; checksum, byte size, R2 bucket/key, generated metadata, failed/stored/row_only status, and 7-year retention enforcement for AUTHORIZE PDFs. RLS permits service_role writes and admin/manager/owner reads. The decision-audit-artifact edge function is registered in Supabase config, accepts service-role callers or authenticated admin/manager/owner callers, requires a resolved decision, maps AUTO to row-only ledger, RATIFY to rendered HTML, AUTHORIZE to a minimal signed-evidence PDF with active signer validation and 7-year retention, uploads non-row artifacts to R2, records failed R2 attempts in the ledger, optionally returns short-lived download URLs, and writes qep_roadmap_sync_events audit evidence. Focused migration and Deno tests pin the ledger constraints, tier mapping, storage keys, HTML/PDF rendering, signer checks, and deterministic checksum behavior.'
  END,
  updated_at = now()
WHERE task_id = 'F5.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F5.1',
  'update',
  jsonb_build_object(
    'reason', 'f51_tiered_audit_trail_closeout',
    'migration', '756_f51_tiered_audit_trail_closeout.sql',
    'mission_alignment', 'pass: tiered audit artifacts give QEP sales, rental, service, parts, finance, and management decisions lane-appropriate proof without forcing legal-grade PDF overhead onto every low-risk decision',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F5.1 as Tiered audit trail with dependency F3.3',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines AUTO row-only, RATIFY HTML-in-R2, and AUTHORIZE signed PDF-in-R2 with 7-year retention',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-150 / F5.1 Tiered audit trail as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records F5.1 / QEP-150 as audit-artifact storage plus edge function foundation',
      'supabase/migrations/622_qep_decision_audit_artifacts.sql creates qep_decision_audit_artifacts with audit_grade, artifact_kind, storage, checksum, byte_size, retention, status, and metadata columns',
      'supabase/migrations/622_qep_decision_audit_artifacts.sql enforces AUTO row-only, RATIFY HTML, AUTHORIZE PDF, and AUTHORIZE retention constraints',
      'supabase/migrations/622_qep_decision_audit_artifacts.sql enables RLS with service_role write access and authenticated admin/manager/owner read access',
      'supabase/functions/decision-audit-artifact/logic.ts maps lanes to row/html/pdf audit plans and adds 7-year AUTHORIZE retention',
      'supabase/functions/decision-audit-artifact/logic.ts renders RATIFY HTML and AUTHORIZE PDF bytes with decision card, citations, and authorization signature evidence',
      'supabase/functions/decision-audit-artifact/index.ts requires resolved decisions, validates active AUTHORIZE signer roles, writes row-only AUTO artifacts, uploads RATIFY/AUTHORIZE artifacts to R2, records failed uploads, and logs roadmap sync evidence',
      'supabase/functions/decision-audit-artifact/logic.test.ts covers lane plans, storage keys, missing signer detection, HTML rendering, PDF rendering, and deterministic SHA-256 checksums'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime audit artifact behavior',
      'this closeout marks only F5.1 shipped and does not mark F5.2',
      'AUTO decisions remain row-only and do not require R2 objects',
      'AUTHORIZE artifacts require active signer evidence before generation',
      'failed R2 uploads are recorded as failed ledger rows rather than hidden',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'production R2 credentials, bucket policy, CORS, and lifecycle/retention configuration remain environment setup tasks outside git',
      'no live Supabase database apply, production R2 upload, or production audit artifact generation was run in this source-controlled closeout',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
