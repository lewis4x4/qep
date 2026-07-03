-- ============================================================================
-- Migration 758: D3.7/D3.6 + Stream K roadmap reconciliation
--
-- Closes only the rows supported by source-controlled evidence:
-- - D3.7 ships on the documented baseline pricing ruleset plus migration 669.
-- - D3.6 remains Juan + Norman owner-review gated.
-- - K1.1 is unblocked into implementation work, K3.1 is narrowed to concrete
--   migration-path decisions, and K4.1 is closed by the finance K-stream
--   decision artifact.
--
-- D3.12 / CYBER-INS is intentionally untouched.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%758_d37_d36_stream_k_roadmap_reconciliation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/architecture/parts-pricing-ruleset.md') ||
      ' | supabase/migrations/669_g81_parts_pricing_engine_counter_discount_cap.sql' ||
      ' | supabase/migrations/758_d37_d36_stream_k_roadmap_reconciliation.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] D3.7 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] D3.7 shipped: docs/architecture/parts-pricing-ruleset.md is the canonical baseline ruleset and migration 669 enforces the G8.1 pricing engine contract: list/customer/volume precedence, 35% target metadata, 25% floor, 5% counter discount cap, Parts Manager approval for over-cap discounts, pricing snapshots, approval audit, and cost/margin access bounds. Deferred extensions remain open and are not claimed here: freight, emergency-buy, vendor-direct, special-order fee markup, core/exchange program rules beyond existing schema fields, Controller signoff for G11 internal pricing, 22-brand OEM portal list, current kit catalog export, and IntelliDealer parts usage history export.'
  END,
  updated_at = now()
WHERE task_id = 'D3.7';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'D3.7',
  'update',
  jsonb_build_object(
    'reason', 'd37_parts_pricing_ruleset_closeout',
    'migration', '758_d37_d36_stream_k_roadmap_reconciliation.sql',
    'mission_alignment', 'pass: QEP parts counter, service, sales, and management workflows now share an auditable baseline pricing policy with manager authority preserved for over-cap and customer-specific pricing',
    'implementation_evidence', jsonb_build_array(
      'docs/architecture/parts-pricing-ruleset.md documents D3.7 baseline policy and schema validation gate',
      'supabase/migrations/669_g81_parts_pricing_engine_counter_discount_cap.sql implements list/customer/volume precedence, target/floor metadata, 5 percent counter cap, approval blocking, and pricing snapshots'
    ),
    'safety_bounds', jsonb_build_array(
      'does not close freight, emergency-buy, vendor-direct, special-order fee markup, or core/exchange pricing extensions',
      'does not close Controller signoff for G11 internal-pricing launch',
      'does not close OEM portal list, kit catalog export, or IntelliDealer parts usage export gates'
    )
  ),
  'codex'
);

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'pending_decision',
  owner = 'Juan + Norman',
  blocking_decision = 'BLK-PARTS-WF-OWNER-REVIEW',
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%758_d37_d36_stream_k_roadmap_reconciliation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md') ||
      ' | supabase/migrations/758_d37_d36_stream_k_roadmap_reconciliation.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] D3.6 remains owner-review gated%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] D3.6 remains owner-review gated: the review candidate packet is refreshed, but no source-controlled Juan + Norman signed v1, dated red-line, or pass/pass-with-exceptions decision was found. Do not mark D3.6 shipped until Juan + Norman validate the workflow stages, resolve or explicitly defer the open §20 decisions, and record the signed v1 evidence path.'
  END,
  updated_at = now()
WHERE task_id = 'D3.6';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'D3.6',
  'update',
  jsonb_build_object(
    'reason', 'd36_parts_workflow_owner_review_packet_refreshed',
    'migration', '758_d37_d36_stream_k_roadmap_reconciliation.sql',
    'mission_alignment', 'pass: the parts workflow remains grounded in real operator validation instead of treating inferred code behavior as final dealership practice',
    'owner_review_packet', 'docs/designs/qep-parts-workflow-document-2026-05-29-review-candidate.md',
    'safety_bounds', jsonb_build_array(
      'does not mark D3.6 shipped',
      'requires Juan + Norman validation before promotion to signed v1',
      'keeps open workflow-stage, order-spine, quote/invoice ownership, pricing-governance, and parity-scope decisions explicit'
    )
  ),
  'codex'
);

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'not_started',
  owner = 'Engineer',
  blocking_decision = NULL,
  description = 'Implement QEP OS as the forward accounting system of record for native AR, AP, customer invoices, reporting, tax evidence, close/reopen audit, job costing, and financial source data. QuickBooks Desktop is downstream check-register/CPA-reporting output only. Remaining open finance values must stay parameterized or config-driven; do not hard-code working-session values.',
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%758_d37_d36_stream_k_roadmap_reconciliation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md') ||
      ' | supabase/migrations/655_finance_foundation_invoice_numbering.sql' ||
      ' | supabase/migrations/656_finance_foundation_quarter_close_reopen.sql' ||
      ' | supabase/migrations/657_finance_foundation_ar_dunning_cycle.sql' ||
      ' | supabase/migrations/658_finance_foundation_ap_three_way_match.sql' ||
      ' | supabase/migrations/659_finance_foundation_county_tax_rentals.sql' ||
      ' | supabase/migrations/660_finance_foundation_equipment_reversal_approvals.sql' ||
      ' | supabase/migrations/661_finance_foundation_fet_form8300.sql' ||
      ' | supabase/migrations/662_finance_foundation_margin_segments.sql' ||
      ' | supabase/migrations/663_finance_foundation_intellidealer_master_match_dry_run.sql' ||
      ' | supabase/migrations/758_d37_d36_stream_k_roadmap_reconciliation.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] K1.1 unblocked%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] K1.1 unblocked: Ryan + Tina finance evidence confirms QEP OS as the forward accounting SoR, IntelliDealer as transition SoR, and QuickBooks Desktop as downstream check-register/CPA-reporting output. Migrations 655-663 provide build-now foundation. Remaining open business values are config/working-session items, not blockers to the SoR decision; do not hard-code them.'
  END,
  updated_at = now()
WHERE task_id = 'K1.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'K1.1',
  'update',
  jsonb_build_object(
    'reason', 'k11_sor_decision_unblocked_for_implementation',
    'migration', '758_d37_d36_stream_k_roadmap_reconciliation.sql',
    'mission_alignment', 'pass: QEP corporate operations can proceed toward a native finance SoR while keeping external accounting exports downstream instead of letting bridge tooling define the architecture',
    'decision_evidence', 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/655_finance_foundation_invoice_numbering.sql',
      'supabase/migrations/656_finance_foundation_quarter_close_reopen.sql',
      'supabase/migrations/657_finance_foundation_ar_dunning_cycle.sql',
      'supabase/migrations/658_finance_foundation_ap_three_way_match.sql',
      'supabase/migrations/659_finance_foundation_county_tax_rentals.sql',
      'supabase/migrations/660_finance_foundation_equipment_reversal_approvals.sql',
      'supabase/migrations/661_finance_foundation_fet_form8300.sql',
      'supabase/migrations/662_finance_foundation_margin_segments.sql',
      'supabase/migrations/663_finance_foundation_intellidealer_master_match_dry_run.sql'
    ),
    'safety_bounds', jsonb_build_array(
      'does not hard-code open finance values',
      'does not close K3.1 migration-path decisions',
      'does not claim production cutover complete'
    )
  ),
  'codex'
);

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'pending_decision',
  owner = 'Finance + Engineer',
  blocking_decision = 'BLK-FIN-MIGRATION-PATH',
  description = 'QuickBooks role is decided: downstream vendor-pay, cash/check-register, and CPA-reporting output only, not the ledger. This row remains open only for migration-path decisions: allocation basis, depreciation, lender floor-plan terms, IBS treatment, CPA adjustment posting target, open service-WO migration, invoice width, master-ID strategy, finance-charge basis, and missing finance exports/attachments.',
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%758_d37_d36_stream_k_roadmap_reconciliation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md') ||
      ' | supabase/migrations/758_d37_d36_stream_k_roadmap_reconciliation.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] K3.1 narrowed%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] K3.1 narrowed: QuickBooks-as-ledger is no longer an open question. Keep this row open only for migration-path decisions listed in the K-stream decision artifact: allocation basis, depreciation, lender floor-plan terms including IBS treatment, CPA adjustment posting, open service-WO migration, invoice width, master-ID strategy, finance-charge basis, and missing finance exports/attachments.'
  END,
  updated_at = now()
WHERE task_id = 'K3.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'K3.1',
  'update',
  jsonb_build_object(
    'reason', 'k31_quickbooks_role_decided_migration_path_gate_only',
    'migration', '758_d37_d36_stream_k_roadmap_reconciliation.sql',
    'mission_alignment', 'pass: finance migration planning can focus on concrete cutover mechanics instead of re-litigating the accounting SoR boundary',
    'decision_evidence', 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md',
    'remaining_gate', jsonb_build_array(
      'allocation basis',
      'depreciation',
      'lender floor-plan terms including IBS treatment',
      'CPA adjustment posting target',
      'open service-WO migration',
      'invoice width',
      'master-ID strategy',
      'finance-charge basis',
      'missing finance exports/attachments'
    ),
    'safety_bounds', jsonb_build_array(
      'does not reopen QuickBooks-as-ledger',
      'does not hard-code open finance values',
      'does not mark K3.1 shipped'
    )
  ),
  'codex'
);

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  owner = 'Architect',
  blocking_decision = NULL,
  description = 'Reconcile Build-Lock memo G5 against the accounting-system-of-record direction. Decision logged: G5 remains valid only as a bridge/outbound-feed precedent; Stream K target architecture is QEP OS as SoR and QuickBooks is downstream output.',
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%758_d37_d36_stream_k_roadmap_reconciliation.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md') ||
      ' | supabase/migrations/758_d37_d36_stream_k_roadmap_reconciliation.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] K4.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] K4.1 shipped: Build-Lock memo G5 is reconciled by the K-stream decision artifact. Native AR/AP remains the long-term target, QuickBooks API is a Phase 1-7 bridge/outbound feed, and any QuickBooks-as-ledger interpretation is superseded.'
  END,
  updated_at = now()
WHERE task_id = 'K4.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'K4.1',
  'update',
  jsonb_build_object(
    'reason', 'k41_build_lock_g5_reconciled',
    'migration', '758_d37_d36_stream_k_roadmap_reconciliation.sql',
    'mission_alignment', 'pass: finance architecture history now preserves the bridge decision without letting it block the native QEP OS accounting target',
    'decision_evidence', 'docs/operations/QEP_FINANCE_K_STREAM_DECISION_ARTIFACT_2026-07-03.md',
    'safety_bounds', jsonb_build_array(
      'does not claim finance implementation complete',
      'does not hard-code open finance values',
      'does not close K3.1 migration-path decisions'
    )
  ),
  'codex'
);

COMMIT;
