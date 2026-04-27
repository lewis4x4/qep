-- 505_wave4_report_indexes.sql
--
-- Wave 4 report indexes for views/materialized views created in 502-504.
-- Every index below has a concrete report/view purpose; no speculative coverage.
--
-- Rollback notes:
--   drop index if exists public.idx_wave4_tax_exemption_primary_cert;
--   drop index if exists public.idx_wave4_service_jobs_open_wip;
--   drop index if exists public.idx_wave4_service_jobs_tech_schedule;
--   drop index if exists public.idx_wave4_service_parts_req_wip;
--   drop index if exists public.idx_wave4_service_timecards_job_activity;
--   drop index if exists public.idx_wave4_customer_invoices_ar_aging;
--   drop index if exists public.idx_wave4_customer_invoices_branch_ar_aging;
--   drop index if exists public.idx_wave4_portal_payment_intents_invoice;
--   drop index if exists public.idx_wave4_qb_deals_customer_profitability;
--   drop index if exists public.idx_wave4_qrm_fiscal_periods_date;
--   drop index if exists public.idx_wave4_rental_contracts_credit_commit;

create index if not exists idx_wave4_tax_exemption_primary_cert
  on public.tax_exemption_certificates (workspace_id, crm_company_id, effective_date desc, created_at desc)
  where crm_company_id is not null
    and status in ('active', 'verified');
comment on index public.idx_wave4_tax_exemption_primary_cert is
  'Purpose: v_customer_primary_resale_cert DISTINCT ON lookup for active/verified non-expired certificates.';

create index if not exists idx_wave4_service_jobs_open_wip
  on public.service_jobs (workspace_id, branch_id, created_at)
  where closed_at is null and deleted_at is null;
comment on index public.idx_wave4_service_jobs_open_wip is
  'Purpose: mv_service_wip_aging scans open service jobs by workspace, branch, and age.';

create index if not exists idx_wave4_service_jobs_tech_schedule
  on public.service_jobs (workspace_id, technician_id, scheduled_start_at)
  where technician_id is not null
    and scheduled_start_at is not null
    and closed_at is null
    and deleted_at is null;
comment on index public.idx_wave4_service_jobs_tech_schedule is
  'Purpose: v_tech_daily_capacity joins scheduled open jobs per technician/day.';

create index if not exists idx_wave4_service_parts_req_wip
  on public.service_parts_requirements (workspace_id, job_id, created_at)
  where status not in ('cancelled', 'returned');
comment on index public.idx_wave4_service_parts_req_wip is
  'Purpose: mv_service_jobs_wip parts value rollup by service job.';

create index if not exists idx_wave4_service_timecards_job_activity
  on public.service_timecards (workspace_id, service_job_id, clocked_in_at desc)
  where clocked_in_at is not null;
comment on index public.idx_wave4_service_timecards_job_activity is
  'Purpose: mv_service_jobs_wip and v_service_jobs_last_activity timecard rollups by service job.';

create index if not exists idx_wave4_customer_invoices_ar_aging
  on public.customer_invoices (workspace_id, crm_company_id, due_date)
  where crm_company_id is not null
    and balance_due > 0
    and status not in ('paid', 'void');
comment on index public.idx_wave4_customer_invoices_ar_aging is
  'Purpose: ar_aging_view, mv_customer_ar_aging, v_customer_open_ar by customer due date.';

create index if not exists idx_wave4_customer_invoices_branch_ar_aging
  on public.customer_invoices (workspace_id, branch_id, due_date)
  where branch_id is not null
    and balance_due > 0
    and status not in ('paid', 'void');
comment on index public.idx_wave4_customer_invoices_branch_ar_aging is
  'Purpose: Finance AR outstanding branch filter and branch-bucket grouping.';

create index if not exists idx_wave4_portal_payment_intents_invoice
  on public.portal_payment_intents (workspace_id, invoice_id, succeeded_at desc)
  where invoice_id is not null;
comment on index public.idx_wave4_portal_payment_intents_invoice is
  'Purpose: customer_ar_history invoice-to-payment lookup.';

create index if not exists idx_wave4_qb_deals_customer_profitability
  on public.qb_deals (workspace_id, company_id, status, close_date)
  where deleted_at is null;
comment on index public.idx_wave4_qb_deals_customer_profitability is
  'Purpose: qrm_customer_profitability_mv rollup and v_customer_available_credit open deal commitments.';

create index if not exists idx_wave4_qrm_fiscal_periods_date
  on public.qrm_fiscal_periods (workspace_id, starts_on, ends_on, period_year)
  where deleted_at is null;
comment on index public.idx_wave4_qrm_fiscal_periods_date is
  'Purpose: mv_customer_fiscal_ytd invoice-date to IntelliDealer fiscal-year lookup.';

create index if not exists idx_wave4_rental_contracts_credit_commit
  on public.rental_contracts (workspace_id, portal_customer_id, status)
  where status in ('approved', 'awaiting_payment', 'active');
comment on index public.idx_wave4_rental_contracts_credit_commit is
  'Purpose: v_customer_available_credit rental open commitment calculation.';
