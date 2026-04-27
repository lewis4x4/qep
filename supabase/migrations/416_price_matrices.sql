-- 416_price_matrices.sql
--
-- Wave 1B: IntelliDealer Parts Price Matrix master from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#price_matrix.matrix_code.
--
-- Rollback notes:
--   drop trigger if exists set_price_matrices_updated_at on public.price_matrices;
--   drop policy if exists "price_matrices_rep_select" on public.price_matrices;
--   drop policy if exists "price_matrices_all_elevated" on public.price_matrices;
--   drop policy if exists "price_matrices_service_all" on public.price_matrices;
--   alter table public.parts_catalog drop column if exists price_matrix_id;
--   drop table if exists public.price_matrices;

create table public.price_matrices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  matrix_code text not null,
  description text,
  pricing_method text not null,
  apply_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, matrix_code)
);

comment on table public.price_matrices is
  'Named IntelliDealer parts price matrices that compute sell prices from cost/list/level source fields.';

alter table public.parts_catalog
  add column if not exists price_matrix_id uuid references public.price_matrices(id) on delete set null;

comment on column public.parts_catalog.price_matrix_id is
  'Assigned IntelliDealer price matrix for automatic parts price calculation.';

create index idx_price_matrices_active_order
  on public.price_matrices (workspace_id, is_active, apply_order, matrix_code)
  where deleted_at is null;
comment on index public.idx_price_matrices_active_order is
  'Purpose: Price Matrix admin listing and ordered application of active matrices.';

alter table public.price_matrices enable row level security;

create policy "price_matrices_service_all"
  on public.price_matrices for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "price_matrices_all_elevated"
  on public.price_matrices for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "price_matrices_rep_select"
  on public.price_matrices for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_price_matrices_updated_at
  before update on public.price_matrices
  for each row execute function public.set_updated_at();
