-- ============================================================================
-- Migration 751: F3.3 AUTHORIZE-lane two-party signing closeout
--
-- Migration 619 already created the AUTHORIZE signature ledger, signing RPC,
-- status view, RLS, and grants. This migration records roadmap status only and
-- does not assert a live owner signing ceremony or production deployment.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%751_f33_authorize_two_party_signing_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.3') ||
      ' | supabase/migrations/597_qep_stream_f_decision_velocity.sql F3.3' ||
      ' | QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md F3.3 AUTHORIZE signing requirement' ||
      ' | QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md QEP-145 Done' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md F3.3 foundation built' ||
      ' | QEP (1)/QEP_OS_BUILD_LOG_REVIEW_2026-05-21.md Decision system test gap' ||
      ' | supabase/migrations/619_qep_authorize_two_party_signatures.sql' ||
      ' | supabase/migrations/651_qep_decision_resolution_authority.sql' ||
      ' | supabase/migrations/651_qep_decision_resolution_authority.test.ts' ||
      ' | supabase/migrations/751_f33_authorize_two_party_signing_closeout.test.ts' ||
      ' | supabase/migrations/751_f33_authorize_two_party_signing_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] F3.3 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] F3.3 shipped: migration 619 provides the AUTHORIZE-lane two-party signing foundation through qep_decision_authorizations, one active signature per required signer role, data:image signature payload checks, signature SHA-256 hashes, mandatory accepted terms, signer metadata, and revoke timestamps. record_qep_authorize_signature is security-definer, service/admin/manager/owner callable, validates AUTHORIZE lane and required signer roles from requires_two_sigs with owner_role fallback, rejects duplicate active signer roles, records the signature, returns signed/missing role state, and resolves the decision to answered only after all required roles have signed. v_qep_decision_authorize_signature_status exposes required_signers, signed_roles, missing_roles, and completion state for owner/admin surfaces. Migration 651 blocks AUTHORIZE direct answers through resolve_qep_decision so completion must flow through record_qep_authorize_signature. This slice also adds focused migration-contract tests for the previously noted Decision-system verification gap.'
  END,
  updated_at = now()
WHERE task_id = 'F3.3';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'F3.3',
  'update',
  jsonb_build_object(
    'reason', 'f33_authorize_two_party_signing_closeout',
    'migration', '751_f33_authorize_two_party_signing_closeout.sql',
    'mission_alignment', 'pass: AUTHORIZE signing gives QEP equipment, parts, rental, sales, service, and management decisions a governed multi-owner approval path for irreversible or legally weighted choices, preventing one-person silent acceptance while preserving signature evidence and downstream unblock semantics',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/597_qep_stream_f_decision_velocity.sql seeds F3.3 as AUTHORIZE-lane two-party signing with dependencies F1.4 and A3.5',
      'QEP (1)/QEP_DECISION_INBOX_MOONSHOT_V2.md defines F3.3 as the AUTHORIZE-lane two-party signing flow that reuses A3.5 e-signature',
      'QEP (1)/QEP_SERVICE_LINEAR_ROADMAP_CATALOG.md lists QEP-145 / F3.3 AUTHORIZE-lane two-party signing flow as Done on 2026-05-21',
      'QEP (1)/QEP_OS_BUILD_LOG_2026-05-21.md records F3.3 / QEP-145 as foundation built with migration reconciliation pending',
      'QEP (1)/QEP_OS_BUILD_LOG_REVIEW_2026-05-21.md called out missing Decision-system test verification; this closeout adds a focused contract test for the F3.3 implementation',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql creates qep_decision_authorizations with signer role, signer identity, data-url signature, SHA-256 hash, accepted terms, terms version, metadata, revocation, timestamps, and one-active-role uniqueness',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql defines record_qep_authorize_signature with service/admin/manager/owner authorization and AUTHORIZE-lane/status validation',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql derives required signer roles from qep_decisions.requires_two_sigs with owner_role fallback, rejects unexpected signer roles, and blocks duplicate active role signatures',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql resolves qep_decisions to answered only when missing_roles is empty and stamps ai_prep_packet.authorize_signature_status',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql exposes v_qep_decision_authorize_signature_status for required, signed, missing, and complete state',
      'supabase/migrations/619_qep_authorize_two_party_signatures.sql enables RLS, keeps writes behind the signing RPC, and grants the RPC only to authenticated and service_role',
      'supabase/migrations/651_qep_decision_resolution_authority.sql blocks AUTHORIZE decisions from being answered through resolve_qep_decision and requires record_qep_authorize_signature',
      'supabase/migrations/751_f33_authorize_two_party_signing_closeout.test.ts pins the ledger, RPC guards, completion behavior, status view, grants, and live/manual boundaries'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status and adds tests only; it does not alter runtime signing behavior',
      'this closeout marks only F3.3 shipped and does not mark F4.1, F4.2, F4.3, F4.4, F5.1, or F5.2',
      'AUTHORIZE decisions cannot be answered through resolve_qep_decision',
      'signatures require accepted terms and a data:image signature payload',
      'one active signature per signer role prevents duplicate role completion',
      'authenticated users do not receive direct table insert grants; writes flow through record_qep_authorize_signature',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'no live Tina/Ryan or owner two-party signing ceremony was run in this source-controlled closeout',
      'no production signature capture UI, signer identity proofing, or legal envelope policy was manually verified',
      'F5.1 signed PDF retention artifacts remain separate downstream audit work',
      'production deployment and supabase db push/local apply were not run because the pre-existing migration 212 pg_cron requirement remains blocked outside this slice'
    )
  ),
  'codex'
);

COMMIT;
