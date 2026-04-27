-- 427_inspection_runs.sql
--
-- Wave 1B: IntelliDealer ID InspectionPlus run instances from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#inspection.run_instance.
-- Depends on 426_inspection_templates.sql.
--
-- Rollback notes:
--   drop trigger if exists set_inspection_runs_updated_at on public.inspection_runs;
--   drop policy if exists "inspection_runs_rep_scope" on public.inspection_runs;
--   drop policy if exists "inspection_runs_all_elevated" on public.inspection_runs;
--   drop policy if exists "inspection_runs_service_all" on public.inspection_runs;
--   drop table if exists public.inspection_runs;

create table public.inspection_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  template_id uuid not null references public.inspection_templates(id) on delete restrict,
  inspection_number text not null,
  service_job_id uuid references public.service_jobs(id) on delete set null,
  rental_contract_id uuid references public.rental_contracts(id) on delete set null,
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  customer_id uuid references public.qrm_companies(id) on delete set null,
  inspector_id uuid references public.profiles(id) on delete set null default auth.uid(),
  started_at timestamptz,
  completed_at timestamptz,
  responses jsonb not null default '{}'::jsonb,
  photos jsonb,
  signature_url text,
  machine_hours numeric(10,2),
  damage_found boolean,
  damage_description text,
  overall_condition text,
  internal_comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, inspection_number)
);

comment on table public.inspection_runs is
  'InspectionPlus run instances for service jobs, rental returns, equipment, customers, and generic inspection templates.';

create index idx_inspection_runs_service_job
  on public.inspection_runs (workspace_id, service_job_id, started_at desc)
  where service_job_id is not null;
comment on index public.idx_inspection_runs_service_job is
  'Purpose: Work Order Detail inspection history and active inspection lookup.';

create index idx_inspection_runs_customer_equipment
  on public.inspection_runs (workspace_id, customer_id, equipment_id, started_at desc)
  where customer_id is not null or equipment_id is not null;
comment on index public.idx_inspection_runs_customer_equipment is
  'Purpose: customer/equipment inspection history and rental-return evidence lookup.';

alter table public.inspection_runs enable row level security;

create policy "inspection_runs_service_all"
  on public.inspection_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "inspection_runs_all_elevated"
  on public.inspection_runs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "inspection_runs_rep_scope"
  on public.inspection_runs for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (
      inspector_id = (select auth.uid())
      or (customer_id is not null and public.crm_rep_can_access_company(customer_id))
      or exists (
        select 1
        from public.service_jobs j
        where j.id = service_job_id
          and j.workspace_id = (select public.get_my_workspace())
          and (
            j.advisor_id = (select auth.uid())
            or j.technician_id = (select auth.uid())
            or j.service_manager_id = (select auth.uid())
            or public.crm_rep_can_access_company(j.customer_id)
          )
      )
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and (
      inspector_id = (select auth.uid())
      or (customer_id is not null and public.crm_rep_can_access_company(customer_id))
      or exists (
        select 1
        from public.service_jobs j
        where j.id = service_job_id
          and j.workspace_id = (select public.get_my_workspace())
          and (
            j.advisor_id = (select auth.uid())
            or j.technician_id = (select auth.uid())
            or j.service_manager_id = (select auth.uid())
            or public.crm_rep_can_access_company(j.customer_id)
          )
      )
    )
  );

create trigger set_inspection_runs_updated_at
  before update on public.inspection_runs
  for each row execute function public.set_updated_at();
