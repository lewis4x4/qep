-- ============================================================================
-- Migration 104: Link customer_invoices to internal service_jobs
-- ============================================================================

alter table public.customer_invoices
  add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null;

create index if not exists idx_customer_invoices_service_job
  on public.customer_invoices(service_job_id)
  where service_job_id is not null;

-- portal_customer_id is required on customer_invoices — allow null for internal-only invoices
alter table public.customer_invoices
  alter column portal_customer_id drop not null;

comment on column public.customer_invoices.service_job_id is
  'Internal service job that generated this invoice (shop floor).';
