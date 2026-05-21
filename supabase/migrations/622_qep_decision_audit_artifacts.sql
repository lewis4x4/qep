-- ============================================================================
-- Migration 622: QEP decision tiered audit artifacts (QEP-150 / F5.1)
-- Purpose: record lane-derived audit artifacts for answered QEP decisions.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qep_decision_audit_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.qep_decisions(id) ON DELETE CASCADE,
  audit_grade text NOT NULL,
  artifact_kind text NOT NULL,
  storage_provider text NOT NULL DEFAULT 'r2',
  storage_bucket text,
  storage_key text,
  content_type text,
  checksum_sha256 text,
  byte_size bigint,
  retention_until timestamptz,
  status text NOT NULL DEFAULT 'stored',
  error_message text,
  generated_by text NOT NULL DEFAULT 'decision-audit-artifact',
  generated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_decision_audit_artifacts_grade_ck
    CHECK (audit_grade IN ('auto', 'ratify', 'authorize')),
  CONSTRAINT qep_decision_audit_artifacts_kind_ck
    CHECK (artifact_kind IN ('row', 'html', 'pdf')),
  CONSTRAINT qep_decision_audit_artifacts_status_ck
    CHECK (status IN ('row_only', 'stored', 'failed')),
  CONSTRAINT qep_decision_audit_artifacts_checksum_ck
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT qep_decision_audit_artifacts_size_ck
    CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT qep_decision_audit_artifacts_auto_row_ck
    CHECK (
      audit_grade <> 'auto'
      OR (
        artifact_kind = 'row'
        AND storage_key IS NULL
        AND content_type IS NULL
        AND status IN ('row_only', 'failed')
      )
    ),
  CONSTRAINT qep_decision_audit_artifacts_ratify_html_ck
    CHECK (audit_grade <> 'ratify' OR artifact_kind = 'html'),
  CONSTRAINT qep_decision_audit_artifacts_authorize_pdf_ck
    CHECK (audit_grade <> 'authorize' OR artifact_kind = 'pdf'),
  CONSTRAINT qep_decision_audit_artifacts_authorize_retention_ck
    CHECK (audit_grade <> 'authorize' OR retention_until IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS qep_decision_audit_artifacts_decision_idx
  ON public.qep_decision_audit_artifacts (decision_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS qep_decision_audit_artifacts_grade_status_idx
  ON public.qep_decision_audit_artifacts (audit_grade, status, generated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS qep_decision_audit_artifacts_storage_key_uniq
  ON public.qep_decision_audit_artifacts (storage_provider, storage_bucket, storage_key)
  WHERE storage_key IS NOT NULL;

ALTER TABLE public.qep_decision_audit_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qep_decision_audit_artifacts_service_role_all ON public.qep_decision_audit_artifacts;
CREATE POLICY qep_decision_audit_artifacts_service_role_all
  ON public.qep_decision_audit_artifacts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS qep_decision_audit_artifacts_authenticated_read ON public.qep_decision_audit_artifacts;
CREATE POLICY qep_decision_audit_artifacts_authenticated_read
  ON public.qep_decision_audit_artifacts
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'manager', 'owner'));

COMMENT ON TABLE public.qep_decision_audit_artifacts IS
  'QEP-150/F5.1 ledger of tiered decision audit artifacts: AUTO row-only, RATIFY HTML snapshot in R2, AUTHORIZE signed PDF in R2 with retention.';

COMMENT ON COLUMN public.qep_decision_audit_artifacts.audit_grade IS
  'Lane-derived grade copied from qep_decisions.lane at artifact generation time: auto, ratify, or authorize.';
COMMENT ON COLUMN public.qep_decision_audit_artifacts.artifact_kind IS
  'row for AUTO ledger-only audits, html for RATIFY snapshots, pdf for AUTHORIZE legal-grade packets.';
COMMENT ON COLUMN public.qep_decision_audit_artifacts.storage_key IS
  'R2 object key. NULL for AUTO row-only audit artifacts.';
COMMENT ON COLUMN public.qep_decision_audit_artifacts.retention_until IS
  'AUTHORIZE artifacts retain until generated_at + 7 years; non-AUTHORIZE artifacts leave this NULL.';
COMMENT ON COLUMN public.qep_decision_audit_artifacts.metadata IS
  'Small structured provenance: decision_code, answered_at, signer roles, source function version, or upload status details.';

COMMIT;
