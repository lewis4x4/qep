-- ============================================================================
-- Migration 349: Service Agreements
--
-- Rollback notes:
--   1. Drop trigger set_service_agreements_updated_at.
--   2. Drop indexes idx_service_agreements_workspace_status_expiry,
--      idx_service_agreements_equipment, idx_service_agreements_customer.
--   3. Drop policies on service_agreements.
--   4. Drop table service_agreements.
-- ============================================================================

create table public.service_agreements (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  contract_number text not null,
  status text not null default 'active' check (
    status in ('draft', 'active', 'expired', 'cancelled')
  ),
  customer_id uuid references public.qrm_companies(id) on delete set null,
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  location_code text,
  program_name text not null,
  category text,
  coverage_summary text,
  starts_on date,
  expires_on date,
  renewal_date date,
  billing_cycle text,
  term_months integer,
  included_pm_services integer,
  estimated_contract_value numeric(12, 2),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, contract_number)
);

comment on table public.service_agreements is
  'Service agreement contract register for PM/service contracts, distinct from maintenance schedules and service jobs.';

create index idx_service_agreements_workspace_status_expiry
  on public.service_agreements(workspace_id, status, expires_on, created_at desc);

create index idx_service_agreements_equipment
  on public.service_agreements(equipment_id)
  where equipment_id is not null;

create index idx_service_agreements_customer
  on public.service_agreements(customer_id)
  where customer_id is not null;

alter table public.service_agreements enable row level security;

create policy "svc_agreements_select"
  on public.service_agreements for select
  using (workspace_id = public.get_my_workspace());

create policy "svc_agreements_insert"
  on public.service_agreements for insert
  with check (workspace_id = public.get_my_workspace());

create policy "svc_agreements_update"
  on public.service_agreements for update
  using (workspace_id = public.get_my_workspace());

create policy "svc_agreements_delete"
  on public.service_agreements for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_agreements_service_all"
  on public.service_agreements for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_service_agreements_updated_at
  before update on public.service_agreements
  for each row execute function public.set_updated_at();
