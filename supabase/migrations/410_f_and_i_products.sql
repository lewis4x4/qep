-- 410_f_and_i_products.sql
--
-- Wave 1A: F&I product catalog from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment_quote.financing_scenario.
--
-- Rollback notes:
--   drop trigger if exists set_f_and_i_products_updated_at on public.f_and_i_products;
--   drop policy if exists "f_and_i_products_rep_select" on public.f_and_i_products;
--   drop policy if exists "f_and_i_products_all_elevated" on public.f_and_i_products;
--   drop policy if exists "f_and_i_products_service_all" on public.f_and_i_products;
--   drop table if exists public.f_and_i_products;

create table public.f_and_i_products (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  product_code text not null,
  product_name text not null,
  product_type text,
  cost_cents bigint,
  retail_price_cents bigint,
  commission_pct numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, product_code)
);

comment on table public.f_and_i_products is
  'Finance and insurance product catalog for quote F&I overlays such as GAP, extended warranty, tire/wheel, and credit life.';

create index idx_f_and_i_products_active
  on public.f_and_i_products (workspace_id, product_type, lower(product_code))
  where deleted_at is null;
comment on index public.idx_f_and_i_products_active is
  'Purpose: active F&I product lookup by workspace, product type, and code for quote attachment flows.';

alter table public.f_and_i_products enable row level security;

create policy "f_and_i_products_service_all"
  on public.f_and_i_products for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "f_and_i_products_all_elevated"
  on public.f_and_i_products for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "f_and_i_products_rep_select"
  on public.f_and_i_products for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_f_and_i_products_updated_at
  before update on public.f_and_i_products
  for each row execute function public.set_updated_at();
