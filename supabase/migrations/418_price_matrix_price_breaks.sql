-- 418_price_matrix_price_breaks.sql
--
-- Wave 1B: IntelliDealer Price Matrix quantity price breaks from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#price_matrix.price_breaks.
-- Depends on 416_price_matrices.sql.
--
-- Rollback notes:
--   drop trigger if exists set_price_matrix_price_breaks_updated_at on public.price_matrix_price_breaks;
--   drop policy if exists "price_matrix_price_breaks_rep_select" on public.price_matrix_price_breaks;
--   drop policy if exists "price_matrix_price_breaks_all_elevated" on public.price_matrix_price_breaks;
--   drop policy if exists "price_matrix_price_breaks_service_all" on public.price_matrix_price_breaks;
--   drop table if exists public.price_matrix_price_breaks;

create table public.price_matrix_price_breaks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  price_matrix_id uuid not null references public.price_matrices(id) on delete cascade,
  min_qty integer not null check (min_qty > 0),
  max_qty integer check (max_qty is null or max_qty >= min_qty),
  markup_pct numeric(5,2),
  flat_amount_cents bigint,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.price_matrix_price_breaks is
  'Quantity-bracket price breaks for IntelliDealer parts price matrices.';

create index idx_price_matrix_price_breaks_matrix_qty
  on public.price_matrix_price_breaks (workspace_id, price_matrix_id, min_qty);
comment on index public.idx_price_matrix_price_breaks_matrix_qty is
  'Purpose: matrix price-break lookup by quantity threshold during parts price calculation.';

alter table public.price_matrix_price_breaks enable row level security;

create policy "price_matrix_price_breaks_service_all"
  on public.price_matrix_price_breaks for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "price_matrix_price_breaks_all_elevated"
  on public.price_matrix_price_breaks for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "price_matrix_price_breaks_rep_select"
  on public.price_matrix_price_breaks for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_price_matrix_price_breaks_updated_at
  before update on public.price_matrix_price_breaks
  for each row execute function public.set_updated_at();
