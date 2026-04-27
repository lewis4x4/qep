-- 423_labor_pricing_matrix_audit.sql
--
-- Wave 1B: IntelliDealer Labor Pricing rate-change audit from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#labor_pricing.changes_history.
-- Depends on 422_labor_pricing_matrix.sql.
--
-- Rollback notes:
--   drop trigger if exists set_labor_pricing_matrix_audit_updated_at on public.labor_pricing_matrix_audit;
--   drop policy if exists "labor_pricing_matrix_audit_all_elevated" on public.labor_pricing_matrix_audit;
--   drop policy if exists "labor_pricing_matrix_audit_service_all" on public.labor_pricing_matrix_audit;
--   drop table if exists public.labor_pricing_matrix_audit;

create table public.labor_pricing_matrix_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  labor_pricing_matrix_id uuid not null references public.labor_pricing_matrix(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now(),
  prior_rate_cents bigint,
  new_rate_cents bigint,
  prior_cost_cents bigint,
  new_cost_cents bigint,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.labor_pricing_matrix_audit is
  'Append-style audit ledger for labor pricing rate and cost changes used in warranty re-submission compliance.';

create index idx_labor_pricing_matrix_audit_matrix
  on public.labor_pricing_matrix_audit (workspace_id, labor_pricing_matrix_id, changed_at desc);
comment on index public.idx_labor_pricing_matrix_audit_matrix is
  'Purpose: Labor Pricing Changes tab history for a selected matrix row.';

alter table public.labor_pricing_matrix_audit enable row level security;

create policy "labor_pricing_matrix_audit_service_all"
  on public.labor_pricing_matrix_audit for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "labor_pricing_matrix_audit_all_elevated"
  on public.labor_pricing_matrix_audit for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_labor_pricing_matrix_audit_updated_at
  before update on public.labor_pricing_matrix_audit
  for each row execute function public.set_updated_at();
