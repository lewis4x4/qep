-- ============================================================================
-- Migration 740: E2.1 UI brand-guide compliance audit closeout
--
-- E2.1 is an audit-baseline row. The source-controlled review and verifier
-- prove QEP brand-token coverage and record raw-color remediation follow-ups
-- without mixing broad visual remediation into this closeout.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%740_e21_ui_brand_guide_compliance_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'qep_brand_guide.pdf') ||
      ' | docs/qep_brand_guide.pdf' ||
      ' | docs/Brand Guide QEP.pdf' ||
      ' | docs/reviews/QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md' ||
      ' | scripts/verify/brand-guide-compliance-audit.mjs' ||
      ' | apps/web/src/index.css' ||
      ' | apps/web/tailwind.config.js' ||
      ' | package.json brand:guide:audit' ||
      ' | supabase/migrations/740_e21_ui_brand_guide_compliance_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] E2.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] E2.1 shipped: docs/reviews/QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md records the UI brand-guide compliance baseline for QEP-124. The audit validates customer-facing, operational, admin/internal, and shared shell/component surface classes against the canonical docs/qep_brand_guide.pdf alias, the tracked docs/Brand Guide QEP.pdf source artifact, apps/web/src/index.css brand tokens, and apps/web/tailwind.config.js token bridge. scripts/verify/brand-guide-compliance-audit.mjs is wired through bun run brand:guide:audit and inventories production .tsx/.css surfaces while excluding tests. The audit intentionally keeps raw-color remediation as a follow-up queue so broad visual tokenization work is not mixed into this closeout.'
  END,
  updated_at = now()
WHERE task_id = 'E2.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'E2.1',
  'update',
  jsonb_build_object(
    'reason', 'e21_ui_brand_guide_compliance_closeout',
    'migration', '740_e21_ui_brand_guide_compliance_closeout.sql',
    'mission_alignment', 'pass: QEP has a source-controlled brand compliance baseline for customer, sales, rental, service, parts, operations, management, and admin surfaces, giving future superintelligence-era UI work a governed visual system instead of ad hoc surface drift',
    'implementation_evidence', jsonb_build_array(
      'docs/qep_brand_guide.pdf is the canonical roadmap evidence alias for the tracked brand guide',
      'docs/Brand Guide QEP.pdf is the source-controlled brand guide artifact',
      'docs/reviews/QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md records E2.1 / QEP-124 audit scope, surface inventory, token baseline, raw-color exceptions, follow-up remediation queue, and completion criteria',
      'scripts/verify/brand-guide-compliance-audit.mjs verifies required audit phrases, canonical artifacts, CSS tokens, Tailwind token bridge, production UI surface inventory, and raw-color exception accounting',
      'package.json exposes bun run brand:guide:audit',
      'apps/web/src/index.css defines QEP semantic brand tokens including orange, accessible orange, dark navy, charcoal, slate, gray, light gray, app background, and operational signal colors',
      'apps/web/tailwind.config.js exposes qep-* color utilities that map to the CSS token source of truth'
    ),
    'safety_bounds', jsonb_build_array(
      'this closeout changes roadmap status only and does not alter runtime UI behavior',
      'this closeout marks only E2.1 shipped',
      'the audit baseline does not claim all raw colors are remediated',
      'raw-color remediation remains intentionally queued for separate small visual implementation slices',
      'no new dependencies are added'
    ),
    'manual_boundaries', jsonb_build_array(
      'Ryan or owner visual signoff remains a separate workshop/signoff row and is not claimed by this audit closeout',
      'future raw-color tokenization requires separate visual QA after each scoped remediation slice',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
