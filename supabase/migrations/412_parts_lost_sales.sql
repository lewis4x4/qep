-- 412_parts_lost_sales.sql
--
-- Wave 1B: IntelliDealer Parts lost-sale tracking from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#part.lost_sale_frequency.
-- Adapts audit workspace_id uuid hints to the current QEP workspace_id text
-- convention used by get_my_workspace().
--
-- Rollback notes:
--   drop trigger if exists set_parts_lost_sales_updated_at on public.parts_lost_sales;
--   drop policy if exists "parts_lost_sales_rep_scope" on public.parts_lost_sales;
--   drop policy if exists "parts_lost_sales_all_elevated" on public.parts_lost_sales;
--   drop policy if exists "parts_lost_sales_service_all" on public.parts_lost_sales;
--   drop table if exists public.parts_lost_sales;
--   alter table public.parts_catalog drop column if exists lost_sale_quantity;
--   alter table public.parts_catalog drop column if exists lost_sale_frequency;

create table public.parts_lost_sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  part_catalog_id uuid not null references public.parts_catalog(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  quantity_requested integer not null check (quantity_requested > 0),
  customer_id uuid references public.qrm_companies(id) on delete set null,
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  reason text,
  substitute_offered_part_id uuid references public.parts_catalog(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_lost_sales is
  'Lost-sale events for parts requested by customers but not filled, used for stock-mix optimization.';

alter table public.parts_catalog
  add column if not exists lost_sale_frequency integer not null default 0,
  add column if not exists lost_sale_quantity integer not null default 0;

comment on column public.parts_catalog.lost_sale_frequency is
  'Aggregate count of lost-sale events recorded for this part from IntelliDealer Parts Profile.';
comment on column public.parts_catalog.lost_sale_quantity is
  'Aggregate quantity requested across lost-sale events recorded for this part.';

create index idx_parts_lost_sales_part_recorded
  on public.parts_lost_sales (workspace_id, part_catalog_id, recorded_at desc);
comment on index public.idx_parts_lost_sales_part_recorded is
  'Purpose: Parts Profile lost-sale history by part with newest events first.';

create index idx_parts_lost_sales_customer
  on public.parts_lost_sales (workspace_id, customer_id, recorded_at desc)
  where customer_id is not null;
comment on index public.idx_parts_lost_sales_customer is
  'Purpose: customer parts-demand history for counter staff and account reviews.';

alter table public.parts_lost_sales enable row level security;

create policy "parts_lost_sales_service_all"
  on public.parts_lost_sales for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "parts_lost_sales_all_elevated"
  on public.parts_lost_sales for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "parts_lost_sales_rep_scope"
  on public.parts_lost_sales for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (customer_id is null or public.crm_rep_can_access_company(customer_id))
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (customer_id is null or public.crm_rep_can_access_company(customer_id))
  );

create trigger set_parts_lost_sales_updated_at
  before update on public.parts_lost_sales
  for each row execute function public.set_updated_at();
