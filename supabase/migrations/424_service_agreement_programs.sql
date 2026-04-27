-- 424_service_agreement_programs.sql
--
-- Wave 1B: IntelliDealer Service Agreement program catalog from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#service_agreement.program.
-- Supports the existing service_agreements table from 349_service_agreements.sql; any additive compatibility work remains a held Wave 1 decision.
--
-- Rollback notes:
--   drop trigger if exists set_service_agreement_programs_updated_at on public.service_agreement_programs;
--   drop policy if exists "service_agreement_programs_rep_select" on public.service_agreement_programs;
--   drop policy if exists "service_agreement_programs_all_elevated" on public.service_agreement_programs;
--   drop policy if exists "service_agreement_programs_service_all" on public.service_agreement_programs;
--   drop table if exists public.service_agreement_programs;

create table public.service_agreement_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  program_code text not null,
  name text not null,
  sponsor text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, program_code)
);

comment on table public.service_agreement_programs is
  'Preventive-maintenance and product-support service agreement program catalog.';

create index idx_service_agreement_programs_active
  on public.service_agreement_programs (workspace_id, program_code, name)
  where deleted_at is null;
comment on index public.idx_service_agreement_programs_active is
  'Purpose: Service Agreements program picker and program-code lookup.';

alter table public.service_agreement_programs enable row level security;

create policy "service_agreement_programs_service_all"
  on public.service_agreement_programs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_agreement_programs_all_elevated"
  on public.service_agreement_programs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "service_agreement_programs_rep_select"
  on public.service_agreement_programs for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_service_agreement_programs_updated_at
  before update on public.service_agreement_programs
  for each row execute function public.set_updated_at();
