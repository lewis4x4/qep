-- ============================================================================
-- Migration 106: Parts plan supersede, tracking tokens, internal invoice company link
-- ============================================================================

-- Soft-supersede open actions on replan instead of hard delete
alter table public.service_parts_actions
  add column if not exists superseded_at timestamptz;

alter table public.service_parts_actions
  add column if not exists plan_batch_id uuid;

comment on column public.service_parts_actions.superseded_at is
  'When set, this action was replaced by a newer plan batch — do not execute.';

-- Opaque customer tracking (replaces UUID substring PIN)
alter table public.service_jobs
  add column if not exists tracking_token text;

create unique index if not exists idx_service_jobs_tracking_token
  on public.service_jobs(tracking_token)
  where tracking_token is not null;

comment on column public.service_jobs.tracking_token is
  'Opaque token for public job status — do not derive from UUID.';

update public.service_jobs
set tracking_token = encode(gen_random_bytes(16), 'hex')
where tracking_token is null;

alter table public.service_jobs
  alter column tracking_token set default (encode(gen_random_bytes(16), 'hex'));

alter table public.service_jobs
  alter column tracking_token set not null;

-- Internal invoices: link to CRM company when no portal customer
alter table public.customer_invoices
  add column if not exists crm_company_id uuid references public.crm_companies(id) on delete set null;

create index if not exists idx_customer_invoices_crm_company
  on public.customer_invoices(crm_company_id)
  where crm_company_id is not null;

comment on column public.customer_invoices.crm_company_id is
  'Shop invoice for CRM company when portal_customer_id is null.';
