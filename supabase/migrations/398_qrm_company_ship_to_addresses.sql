-- 398_qrm_company_ship_to_addresses.sql
--
-- Wave 1A: IntelliDealer Customer Profile Ship-To address book from
-- docs/intellidealer-gap-audit/phase-1-crm.yaml#customer.ship_to_addresses.
-- Adapts audit workspace_id uuid hints to the current QEP workspace_id text
-- convention used by get_my_workspace().
--
-- Rollback notes:
--   drop trigger if exists set_qrm_company_ship_to_addresses_updated_at on public.qrm_company_ship_to_addresses;
--   drop policy if exists "qrm_company_ship_to_addresses_rep_scope" on public.qrm_company_ship_to_addresses;
--   drop policy if exists "qrm_company_ship_to_addresses_all_elevated" on public.qrm_company_ship_to_addresses;
--   drop policy if exists "qrm_company_ship_to_addresses_service_all" on public.qrm_company_ship_to_addresses;
--   drop table if exists public.qrm_company_ship_to_addresses;

create table public.qrm_company_ship_to_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  label text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  state text,
  postal_code text,
  country text,
  contact_name text,
  contact_phone text,
  freight_terms text,
  tax_jurisdiction_override text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.qrm_company_ship_to_addresses is
  'IntelliDealer Customer Profile Ship-To address book for customer jobsites, yards, and alternate delivery destinations.';

comment on column public.qrm_company_ship_to_addresses.freight_terms is
  'Customer-specific freight terms for this ship-to destination, such as prepaid, collect, or dealer-truck.';

create unique index uq_qrm_company_ship_to_addresses_default
  on public.qrm_company_ship_to_addresses (workspace_id, company_id)
  where is_default = true and deleted_at is null;
comment on index public.uq_qrm_company_ship_to_addresses_default is
  'Purpose: enforce one active default ship-to address per customer per workspace.';

create index idx_qrm_company_ship_to_addresses_company
  on public.qrm_company_ship_to_addresses (workspace_id, company_id, is_active, created_at desc)
  where deleted_at is null;
comment on index public.idx_qrm_company_ship_to_addresses_company is
  'Purpose: fast Customer Profile Ship-To tab lookup scoped by workspace and company.';

alter table public.qrm_company_ship_to_addresses enable row level security;

create policy "qrm_company_ship_to_addresses_service_all"
  on public.qrm_company_ship_to_addresses for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_company_ship_to_addresses_all_elevated"
  on public.qrm_company_ship_to_addresses for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_company_ship_to_addresses_rep_scope"
  on public.qrm_company_ship_to_addresses for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_qrm_company_ship_to_addresses_updated_at
  before update on public.qrm_company_ship_to_addresses
  for each row execute function public.set_updated_at();
