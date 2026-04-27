-- 446_vendor_1099_ytd.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#vendor.form_1099_ytd_amount.
--
-- Rollback notes:
--   drop trigger if exists set_vendor_1099_ytd_updated_at on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_rep_select" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_rep_scope" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_rep_own_select" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_workspace_select" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_workspace_insert" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_workspace_update" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_delete_elevated" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_all_elevated" on public.vendor_1099_ytd;
--   drop policy if exists "vendor_1099_ytd_service_all" on public.vendor_1099_ytd;
--   drop table if exists public.vendor_1099_ytd;
create table public.vendor_1099_ytd (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  tax_year integer not null check (tax_year between 1900 and 3000),
  form_type text not null,
  ytd_amount numeric not null default 0 check (ytd_amount >= 0),
  last_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, vendor_id, tax_year, form_type)
);

comment on table public.vendor_1099_ytd is 'Vendor 1099 year-to-date totals by tax year and form type.';

alter table public.vendor_1099_ytd enable row level security;

create policy "vendor_1099_ytd_service_all"
  on public.vendor_1099_ytd for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "vendor_1099_ytd_all_elevated"
  on public.vendor_1099_ytd for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_vendor_1099_ytd_updated_at
  before update on public.vendor_1099_ytd
  for each row execute function public.set_updated_at();
