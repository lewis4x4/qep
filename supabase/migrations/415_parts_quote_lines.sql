-- 415_parts_quote_lines.sql
--
-- Wave 1B: IntelliDealer Parts Quoting line grid from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#parts_quote.reference_number.
-- Depends on 414_parts_quotes.sql.
--
-- Rollback notes:
--   drop trigger if exists set_parts_quote_lines_updated_at on public.parts_quote_lines;
--   drop policy if exists "parts_quote_lines_rep_scope" on public.parts_quote_lines;
--   drop policy if exists "parts_quote_lines_all_elevated" on public.parts_quote_lines;
--   drop policy if exists "parts_quote_lines_service_all" on public.parts_quote_lines;
--   drop table if exists public.parts_quote_lines;

create table public.parts_quote_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  parts_quote_id uuid not null references public.parts_quotes(id) on delete cascade,
  sort_order integer not null,
  part_catalog_id uuid references public.parts_catalog(id) on delete set null,
  part_number text not null,
  description text,
  qty integer not null check (qty > 0),
  unit_price_cents bigint not null,
  discount_pct numeric(5,2),
  extended_price_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_quote_lines is
  'Line items for parts-only quotes with part, quantity, price, discount, and extended price.';

create index idx_parts_quote_lines_quote
  on public.parts_quote_lines (workspace_id, parts_quote_id, sort_order);
comment on index public.idx_parts_quote_lines_quote is
  'Purpose: render Parts Quote detail line grid in customer-facing order.';

alter table public.parts_quote_lines enable row level security;

create policy "parts_quote_lines_service_all"
  on public.parts_quote_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "parts_quote_lines_all_elevated"
  on public.parts_quote_lines for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "parts_quote_lines_rep_scope"
  on public.parts_quote_lines for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.parts_quotes q
      where q.id = parts_quote_id
        and q.workspace_id = (select public.get_my_workspace())
        and (
          q.salesperson_id = (select auth.uid())
          or q.assigned_salesperson_id = (select auth.uid())
          or public.crm_rep_can_access_company(q.customer_id)
        )
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.parts_quotes q
      where q.id = parts_quote_id
        and q.workspace_id = (select public.get_my_workspace())
        and (
          q.salesperson_id = (select auth.uid())
          or q.assigned_salesperson_id = (select auth.uid())
          or public.crm_rep_can_access_company(q.customer_id)
        )
    )
  );

create trigger set_parts_quote_lines_updated_at
  before update on public.parts_quote_lines
  for each row execute function public.set_updated_at();
