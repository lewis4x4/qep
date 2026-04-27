-- 422_labor_pricing_matrix.sql
--
-- Wave 1B: IntelliDealer Labor Pricing matrix from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#labor_pricing.matrix_row.
--
-- Rollback notes:
--   drop trigger if exists set_labor_pricing_matrix_updated_at on public.labor_pricing_matrix;
--   drop policy if exists "labor_pricing_matrix_all_elevated" on public.labor_pricing_matrix;
--   drop policy if exists "labor_pricing_matrix_service_all" on public.labor_pricing_matrix;
--   drop table if exists public.labor_pricing_matrix;
--   drop type if exists public.labor_type;

create type public.labor_type as enum ('detail','parts','changes','comments','maintenance');

create table public.labor_pricing_matrix (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  branch_id uuid references public.branches(id) on delete set null,
  job_code_id uuid references public.job_codes(id) on delete set null,
  rate_code text,
  tech_level integer,
  labor_type public.labor_type not null default 'detail',
  rate_per_hour_cents bigint not null,
  cost_per_hour_cents bigint not null,
  effective_date date not null,
  expiration_date date,
  warranty_eligible boolean not null default true,
  customer_pay_eligible boolean not null default true,
  internal_eligible boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.labor_pricing_matrix is
  'Branch/job-code/tech-level labor pricing matrix for service detail, parts, changes, comments, and maintenance rates.';

create index idx_labor_pricing_matrix_lookup
  on public.labor_pricing_matrix (workspace_id, branch_id, job_code_id, rate_code, labor_type, effective_date desc);
comment on index public.idx_labor_pricing_matrix_lookup is
  'Purpose: service segment labor-rate lookup by branch, job code, rate code, labor type, and effective date.';

alter table public.labor_pricing_matrix enable row level security;

create policy "labor_pricing_matrix_service_all"
  on public.labor_pricing_matrix for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "labor_pricing_matrix_all_elevated"
  on public.labor_pricing_matrix for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_labor_pricing_matrix_updated_at
  before update on public.labor_pricing_matrix
  for each row execute function public.set_updated_at();
