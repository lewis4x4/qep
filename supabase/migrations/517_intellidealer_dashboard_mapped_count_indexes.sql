-- ============================================================================
-- Migration 517: keep IntelliDealer import dashboard mapped counts fast
--
-- Browser-staged runs legitimately have stage rows before canonical IDs are
-- populated. The admin dashboard view counts mapped rows per run, so add
-- targeted partial indexes for those non-null canonical predicates.
-- ============================================================================

create index if not exists idx_qrm_intellidealer_customer_master_stage_run_mapped
  on public.qrm_intellidealer_customer_master_stage (run_id)
  where canonical_company_id is not null;

create index if not exists idx_qrm_intellidealer_customer_contacts_stage_run_mapped
  on public.qrm_intellidealer_customer_contacts_stage (run_id)
  where canonical_contact_id is not null;

create index if not exists idx_qrm_intellidealer_customer_ar_agency_stage_run_mapped
  on public.qrm_intellidealer_customer_ar_agency_stage (run_id)
  where canonical_company_id is not null
    and canonical_agency_id is not null;

create index if not exists idx_qrm_intellidealer_customer_profitability_stage_run_mapped
  on public.qrm_intellidealer_customer_profitability_stage (run_id)
  where canonical_company_id is not null;

create index if not exists idx_qrm_intellidealer_customer_import_runs_created_at
  on public.qrm_intellidealer_customer_import_runs (created_at desc);

-- ============================================================================
-- Migration 517 complete.
-- ============================================================================
