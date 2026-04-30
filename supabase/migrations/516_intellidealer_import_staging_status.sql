-- ============================================================================
-- Migration 516: allow browser-uploaded IntelliDealer runs to enter staging
-- ============================================================================

alter table public.qrm_intellidealer_customer_import_runs
  drop constraint if exists qrm_intellidealer_customer_import_runs_status_check;

alter table public.qrm_intellidealer_customer_import_runs
  add constraint qrm_intellidealer_customer_import_runs_status_check
  check (status in ('audited', 'staging', 'staged', 'committing', 'committed', 'completed_with_errors', 'failed', 'cancelled'));

-- ============================================================================
-- Migration 516 complete.
-- ============================================================================
