-- 411_quote_f_and_i_attachments.sql
--
-- Wave 1A: quote-level F&I product attachments from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment_quote.financing_scenario.
-- Depends on 410_f_and_i_products.sql and existing qb_quotes.
--
-- Rollback notes:
--   drop trigger if exists set_quote_f_and_i_attachments_updated_at on public.quote_f_and_i_attachments;
--   drop policy if exists "quote_f_and_i_attachments_rep_scope" on public.quote_f_and_i_attachments;
--   drop policy if exists "quote_f_and_i_attachments_all_elevated" on public.quote_f_and_i_attachments;
--   drop policy if exists "quote_f_and_i_attachments_service_all" on public.quote_f_and_i_attachments;
--   drop table if exists public.quote_f_and_i_attachments;

create table public.quote_f_and_i_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_id uuid not null references public.qb_quotes(id) on delete cascade,
  product_id uuid not null references public.f_and_i_products(id) on delete restrict,
  retail_price_cents bigint not null,
  cost_cents bigint not null,
  commission_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, quote_id, product_id)
);

comment on table public.quote_f_and_i_attachments is
  'Typed F&I products attached to equipment quotes with retail, cost, and commission amounts.';

create index idx_quote_f_and_i_attachments_quote
  on public.quote_f_and_i_attachments (workspace_id, quote_id)
  where deleted_at is null;
comment on index public.idx_quote_f_and_i_attachments_quote is
  'Purpose: quote F&I sub-panel lookup for attached finance/insurance products.';

alter table public.quote_f_and_i_attachments enable row level security;

create policy "quote_f_and_i_attachments_service_all"
  on public.quote_f_and_i_attachments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "quote_f_and_i_attachments_all_elevated"
  on public.quote_f_and_i_attachments for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "quote_f_and_i_attachments_rep_scope"
  on public.quote_f_and_i_attachments for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.qb_quotes q
      where q.id = quote_id
        and q.workspace_id = (select public.get_my_workspace())
        and q.salesman_id = (select auth.uid())
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.qb_quotes q
      where q.id = quote_id
        and q.workspace_id = (select public.get_my_workspace())
        and q.salesman_id = (select auth.uid())
    )
  );

create trigger set_quote_f_and_i_attachments_updated_at
  before update on public.quote_f_and_i_attachments
  for each row execute function public.set_updated_at();
