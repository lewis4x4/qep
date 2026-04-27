-- 425_warranty_claims.sql
--
-- Wave 1B: IntelliDealer service-side warranty claims from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#warranty_claim.claim_number.
--
-- Rollback notes:
--   drop trigger if exists set_warranty_claims_updated_at on public.warranty_claims;
--   drop policy if exists "warranty_claims_rep_select" on public.warranty_claims;
--   drop policy if exists "warranty_claims_all_elevated" on public.warranty_claims;
--   drop policy if exists "warranty_claims_service_all" on public.warranty_claims;
--   drop table if exists public.warranty_claims;
--   drop type if exists public.warranty_claim_status;

create type public.warranty_claim_status as enum ('draft','submitted','under_review','approved','partial','rejected','paid');

create table public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  manufacturer text not null,
  claim_number text,
  submission_date date,
  status public.warranty_claim_status not null default 'draft',
  labor_hours_claimed numeric(8,2),
  labor_amount_claimed_cents bigint,
  parts_amount_claimed_cents bigint,
  total_claimed_cents bigint,
  approved_amount_cents bigint,
  rejection_reason text,
  paid_at date,
  oem_payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, manufacturer, claim_number)
);

comment on table public.warranty_claims is
  'Service-side OEM warranty claims tied to service work orders, with submission, approval, rejection, and payment details.';

create index idx_warranty_claims_status_submission
  on public.warranty_claims (workspace_id, status, submission_date desc);
comment on index public.idx_warranty_claims_status_submission is
  'Purpose: warranty claim queue by status and newest submission date.';

create index idx_warranty_claims_service_job
  on public.warranty_claims (workspace_id, service_job_id);
comment on index public.idx_warranty_claims_service_job is
  'Purpose: Work Order Detail warranty block lookup.';

alter table public.warranty_claims enable row level security;

create policy "warranty_claims_service_all"
  on public.warranty_claims for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "warranty_claims_all_elevated"
  on public.warranty_claims for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "warranty_claims_rep_select"
  on public.warranty_claims for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.service_jobs j
      where j.id = service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and (
          j.advisor_id = (select auth.uid())
          or j.technician_id = (select auth.uid())
          or j.service_manager_id = (select auth.uid())
          or public.crm_rep_can_access_company(j.customer_id)
        )
    )
  );

create trigger set_warranty_claims_updated_at
  before update on public.warranty_claims
  for each row execute function public.set_updated_at();
