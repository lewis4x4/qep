-- ============================================================================
-- Migration 717: A7.8 price-lock customer attribute closeout
--
-- OEM-DP6 is satisfied by the customer/account price-lock hook added in
-- migration 611. The hook is intentionally schema-first: no customers are
-- locked by default, and downstream repricing behavior remains review-only
-- until the OEM reprice workflow reaches the gated action slices.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%717_a78_price_lock_customer_attribute_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OEM-Price-Feeds-Discovery-FILLED.docx') ||
      ' | supabase/migrations/611_customer_price_lock_attribute.sql' ||
      ' | supabase/migrations/627_qep_oem_price_feed_wave.sql OEM-DP6' ||
      ' | supabase/migrations/717_a78_price_lock_customer_attribute_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A7.8 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A7.8 shipped: migration 611 adds qrm_companies.price_lock_active default false, price_lock_reason, and price_lock_expires_at so national-account, government-contract, or annual price-lock agreements can be represented without another schema change. It also adds idx_qrm_companies_price_lock_active for active lock lookup and projects the three fields through the security-invoker crm_companies compatibility view. OEM-DP6 explicitly says no customers are under price lock today; this slice does not seed any locked customers and does not promote parser/upload/reprice action rows that still depend on external OEM sample sheets and review-policy work.'
  END,
  updated_at = now()
WHERE task_id = 'A7.8';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A7.8',
  'update',
  jsonb_build_object(
    'reason', 'a78_price_lock_customer_attribute_closeout',
    'migration', '717_a78_price_lock_customer_attribute_closeout.sql',
    'mission_alignment', 'pass: QEP can now model customer-specific equipment price-lock promises directly on the customer record, giving future OEM repricing workflows a durable account-level control instead of relying on rep memory or spreadsheet exceptions',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/611_customer_price_lock_attribute.sql adds qrm_companies.price_lock_active boolean not null default false',
      'supabase/migrations/611_customer_price_lock_attribute.sql adds price_lock_reason for human-readable contract context',
      'supabase/migrations/611_customer_price_lock_attribute.sql adds price_lock_expires_at for optional expiration',
      'supabase/migrations/611_customer_price_lock_attribute.sql creates idx_qrm_companies_price_lock_active for active lock lookup',
      'supabase/migrations/611_customer_price_lock_attribute.sql projects price-lock fields through the crm_companies security-invoker view',
      'supabase/migrations/627_qep_oem_price_feed_wave.sql records OEM-DP6 answer: no locked customers today, but build the future hook'
    ),
    'safety_bounds', jsonb_build_array(
      'all existing customers default to price_lock_active=false',
      'this slice does not seed or infer any customer price-lock contracts',
      'crm_companies remains security_invoker and keeps existing EIN/financial masking behavior',
      'A7 parser/upload/reprice actions remain separately gated by their dependencies'
    ),
    'manual_boundaries', jsonb_build_array(
      'actual price-lock contract proof remains a future owner/customer-specific input',
      'no live customer list was audited for price-lock contracts',
      'no OEM sample sheet, portal credential, or legal/NDA decision is changed here',
      'supabase db push/local apply remains blocked by the pre-existing migration 212 pg_cron requirement outside this slice'
    )
  ),
  'codex'
);

COMMIT;
