-- 417_price_matrix_pricing_details.sql
--
-- Wave 1B: IntelliDealer Price Matrix pricing-detail rules from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#price_matrix.pricing_detail.
-- Depends on 416_price_matrices.sql.
--
-- Rollback notes:
--   drop trigger if exists set_price_matrix_pricing_details_updated_at on public.price_matrix_pricing_details;
--   drop policy if exists "price_matrix_pricing_details_rep_select" on public.price_matrix_pricing_details;
--   drop policy if exists "price_matrix_pricing_details_all_elevated" on public.price_matrix_pricing_details;
--   drop policy if exists "price_matrix_pricing_details_service_all" on public.price_matrix_pricing_details;
--   drop table if exists public.price_matrix_pricing_details;

create table public.price_matrix_pricing_details (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  price_matrix_id uuid not null references public.price_matrices(id) on delete cascade,
  source_field text not null,
  operation text not null,
  operand numeric(12,4),
  priority integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.price_matrix_pricing_details is
  'Pricing-detail rows that map matrix source fields into computed parts sell prices.';

create index idx_price_matrix_pricing_details_matrix
  on public.price_matrix_pricing_details (workspace_id, price_matrix_id, priority, source_field);
comment on index public.idx_price_matrix_pricing_details_matrix is
  'Purpose: load ordered pricing-detail rows for a selected Price Matrix.';

alter table public.price_matrix_pricing_details enable row level security;

create policy "price_matrix_pricing_details_service_all"
  on public.price_matrix_pricing_details for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "price_matrix_pricing_details_all_elevated"
  on public.price_matrix_pricing_details for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "price_matrix_pricing_details_rep_select"
  on public.price_matrix_pricing_details for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_price_matrix_pricing_details_updated_at
  before update on public.price_matrix_pricing_details
  for each row execute function public.set_updated_at();
