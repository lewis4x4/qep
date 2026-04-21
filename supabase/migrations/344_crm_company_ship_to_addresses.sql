-- ============================================================================
-- Migration 344: CRM company ship-to addresses
--
-- Rollback notes:
--   1. Drop trigger set_crm_company_ship_to_addresses_updated_at on
--      public.crm_company_ship_to_addresses.
--   2. Drop indexes uq_crm_company_ship_to_primary,
--      idx_crm_company_ship_to_company, idx_crm_company_ship_to_name.
--   3. Drop policies on public.crm_company_ship_to_addresses.
--   4. Drop table public.crm_company_ship_to_addresses.
-- ============================================================================

create table public.crm_company_ship_to_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  company_id uuid not null references public.qrm_companies(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  instructions text,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.crm_company_ship_to_addresses is
  'Named ship-to destinations for a CRM company. Mirrors the IntelliDealer Customer Profile Ship To concept.';

comment on column public.crm_company_ship_to_addresses.name is
  'Named destination label used by operators to distinguish ship-to records for the same company.';

comment on column public.crm_company_ship_to_addresses.instructions is
  'Optional operator notes for delivery routing, gate details, or yard-specific handling.';

create unique index uq_crm_company_ship_to_primary
  on public.crm_company_ship_to_addresses(workspace_id, company_id)
  where is_primary = true and deleted_at is null;

create index idx_crm_company_ship_to_company
  on public.crm_company_ship_to_addresses(workspace_id, company_id, sort_order, created_at desc)
  where deleted_at is null;

create index idx_crm_company_ship_to_name
  on public.crm_company_ship_to_addresses(workspace_id, company_id, lower(name))
  where deleted_at is null;

alter table public.crm_company_ship_to_addresses enable row level security;

create policy "crm_company_ship_to_addresses_service_all"
  on public.crm_company_ship_to_addresses for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_company_ship_to_addresses_all_elevated"
  on public.crm_company_ship_to_addresses for all
  using (public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "crm_company_ship_to_addresses_rep_scope"
  on public.crm_company_ship_to_addresses for all
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  )
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  );

create trigger set_crm_company_ship_to_addresses_updated_at
  before update on public.crm_company_ship_to_addresses
  for each row execute function public.set_updated_at();
