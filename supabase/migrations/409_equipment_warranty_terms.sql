-- 409_equipment_warranty_terms.sql
--
-- Wave 1A: structured equipment warranty terms from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment.basic_warranty_hours_code_date.
--
-- Rollback notes:
--   drop trigger if exists set_equipment_warranty_terms_updated_at on public.equipment_warranty_terms;
--   drop policy if exists "equipment_warranty_terms_rep_scope" on public.equipment_warranty_terms;
--   drop policy if exists "equipment_warranty_terms_all_elevated" on public.equipment_warranty_terms;
--   drop policy if exists "equipment_warranty_terms_service_all" on public.equipment_warranty_terms;
--   drop table if exists public.equipment_warranty_terms;

create table public.equipment_warranty_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  equipment_id uuid not null references public.qrm_equipment(id) on delete cascade,
  warranty_type text not null,
  max_hours numeric(10,1),
  max_months integer,
  start_date date not null,
  end_date date,
  provider text,
  contract_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.equipment_warranty_terms is
  'Structured equipment warranty terms for basic, extended, powertrain, dealer, or third-party coverage.';

create index idx_equipment_warranty_terms_equipment
  on public.equipment_warranty_terms (workspace_id, equipment_id, warranty_type, start_date desc)
  where deleted_at is null;
comment on index public.idx_equipment_warranty_terms_equipment is
  'Purpose: warranty eligibility lookup from Equipment Profile and service warranty checks.';

alter table public.equipment_warranty_terms enable row level security;

create policy "equipment_warranty_terms_service_all"
  on public.equipment_warranty_terms for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_warranty_terms_all_elevated"
  on public.equipment_warranty_terms for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "equipment_warranty_terms_rep_scope"
  on public.equipment_warranty_terms for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.qrm_equipment e
      where e.id = equipment_id
        and public.crm_rep_can_access_company(e.company_id)
    )
  );

create trigger set_equipment_warranty_terms_updated_at
  before update on public.equipment_warranty_terms
  for each row execute function public.set_updated_at();
