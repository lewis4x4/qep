-- 408_equipment_meter_readings.sql
--
-- Wave 1A: equipment hour/meter reading ledger from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment.machine_hours.
--
-- Rollback notes:
--   drop policy if exists "equipment_meter_readings_rep_scope" on public.equipment_meter_readings;
--   drop policy if exists "equipment_meter_readings_all_elevated" on public.equipment_meter_readings;
--   drop policy if exists "equipment_meter_readings_service_all" on public.equipment_meter_readings;
--   drop table if exists public.equipment_meter_readings;
--   drop type if exists public.meter_reading_code;

create type public.meter_reading_code as enum ('actual','estimate','tampered','replaced');

create table public.equipment_meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  equipment_id uuid not null references public.qrm_equipment(id) on delete cascade,
  meter_index integer not null default 1 check (meter_index in (1, 2)),
  hours numeric(10,1) not null,
  code public.meter_reading_code not null default 'actual',
  recorded_at date not null,
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.equipment_meter_readings is
  'Auditable equipment meter-reading ledger for primary/secondary hours with Actual/Estimate/Tampered/Replaced code.';

create index idx_equipment_meter_readings_equipment
  on public.equipment_meter_readings (workspace_id, equipment_id, recorded_at desc)
  where deleted_at is null;
comment on index public.idx_equipment_meter_readings_equipment is
  'Purpose: Equipment Profile hours history and warranty eligibility lookup ordered by reading date.';

alter table public.equipment_meter_readings enable row level security;

create policy "equipment_meter_readings_service_all"
  on public.equipment_meter_readings for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_meter_readings_all_elevated"
  on public.equipment_meter_readings for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "equipment_meter_readings_rep_scope"
  on public.equipment_meter_readings for all
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.qrm_equipment e
      where e.id = equipment_id
        and public.crm_rep_can_access_company(e.company_id)
    )
  )
  with check (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.qrm_equipment e
      where e.id = equipment_id
        and public.crm_rep_can_access_company(e.company_id)
    )
  );

create trigger set_equipment_meter_readings_updated_at
  before update on public.equipment_meter_readings
  for each row execute function public.set_updated_at();
