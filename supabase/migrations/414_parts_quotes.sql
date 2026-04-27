-- 414_parts_quotes.sql
--
-- Wave 1B: IntelliDealer Parts Quoting header from
-- docs/intellidealer-gap-audit/phase-3-parts.yaml#parts_quote.reference_number.
--
-- Rollback notes:
--   drop trigger if exists set_parts_quotes_updated_at on public.parts_quotes;
--   drop policy if exists "parts_quotes_rep_scope" on public.parts_quotes;
--   drop policy if exists "parts_quotes_all_elevated" on public.parts_quotes;
--   drop policy if exists "parts_quotes_service_all" on public.parts_quotes;
--   drop table if exists public.parts_quotes;

create table public.parts_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_number text not null,
  customer_id uuid not null references public.qrm_companies(id) on delete restrict,
  contact_id uuid references public.qrm_contacts(id) on delete set null,
  salesperson_id uuid references public.profiles(id) on delete set null,
  assigned_salesperson_id uuid references public.profiles(id) on delete set null,
  description text,
  location_branch_id uuid references public.branches(id) on delete set null,
  is_master boolean not null default false,
  cloned_from_quote_id uuid references public.parts_quotes(id) on delete set null,
  status text not null default 'pending',
  expiry_date date,
  subtotal_cents bigint,
  discount_cents bigint,
  tax_cents bigint,
  total_cents bigint,
  notes text,
  pdf_url text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, quote_number)
);

comment on table public.parts_quotes is
  'Parts-only quote headers for PM kits, counter quotes, and parts restock proposals separate from equipment quotes.';

create index idx_parts_quotes_customer_status
  on public.parts_quotes (workspace_id, customer_id, status, created_at desc)
  where deleted_at is null;
comment on index public.idx_parts_quotes_customer_status is
  'Purpose: customer-scoped Parts Quoting listing and status filter.';

create index idx_parts_quotes_assigned_salesperson
  on public.parts_quotes (workspace_id, assigned_salesperson_id, created_at desc)
  where assigned_salesperson_id is not null and deleted_at is null;
comment on index public.idx_parts_quotes_assigned_salesperson is
  'Purpose: assigned-salesperson parts quote queue and follow-up worklist.';

alter table public.parts_quotes enable row level security;

create policy "parts_quotes_service_all"
  on public.parts_quotes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "parts_quotes_all_elevated"
  on public.parts_quotes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "parts_quotes_rep_scope"
  on public.parts_quotes for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (
      salesperson_id = (select auth.uid())
      or assigned_salesperson_id = (select auth.uid())
      or public.crm_rep_can_access_company(customer_id)
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (
      salesperson_id = (select auth.uid())
      or assigned_salesperson_id = (select auth.uid())
      or public.crm_rep_can_access_company(customer_id)
    )
  );

create trigger set_parts_quotes_updated_at
  before update on public.parts_quotes
  for each row execute function public.set_updated_at();
