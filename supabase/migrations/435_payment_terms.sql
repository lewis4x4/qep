-- 435_payment_terms.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#customer_ar.terms.
-- Existing customer/vendor column extensions are Wave 2 scope and intentionally not included here.
--
-- Rollback notes:
--   drop trigger if exists set_payment_terms_updated_at on public.payment_terms;
--   drop policy if exists "payment_terms_rep_select" on public.payment_terms;
--   drop policy if exists "payment_terms_rep_scope" on public.payment_terms;
--   drop policy if exists "payment_terms_rep_own_select" on public.payment_terms;
--   drop policy if exists "payment_terms_workspace_select" on public.payment_terms;
--   drop policy if exists "payment_terms_workspace_insert" on public.payment_terms;
--   drop policy if exists "payment_terms_workspace_update" on public.payment_terms;
--   drop policy if exists "payment_terms_delete_elevated" on public.payment_terms;
--   drop policy if exists "payment_terms_all_elevated" on public.payment_terms;
--   drop policy if exists "payment_terms_service_all" on public.payment_terms;
--   drop table if exists public.payment_terms;
create table public.payment_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  code text not null,
  name text not null,
  net_days integer not null default 0 check (net_days >= 0),
  discount_pct numeric(5,2),
  discount_days integer,
  is_cod boolean not null default false,
  is_prepaid boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, code)
);

comment on table public.payment_terms is 'Payment terms lookup for AR, AP, customer, vendor, quote, and invoice defaults.';

create index idx_payment_terms_active
  on public.payment_terms (workspace_id, lower(code))
  where active = true and deleted_at is null;
comment on index public.idx_payment_terms_active is 'Purpose: active payment-term lookup by code.';

alter table public.payment_terms enable row level security;

create policy "payment_terms_service_all"
  on public.payment_terms for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "payment_terms_all_elevated"
  on public.payment_terms for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "payment_terms_rep_select"
  on public.payment_terms for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_payment_terms_updated_at
  before update on public.payment_terms
  for each row execute function public.set_updated_at();
