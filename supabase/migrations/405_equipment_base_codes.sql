-- 405_equipment_base_codes.sql
--
-- Wave 1A: IntelliDealer Base & Options base-code library from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment.base_code.
-- The qrm_equipment.base_code_id extension is intentionally Wave 2 scope.
--
-- Rollback notes:
--   drop trigger if exists set_equipment_base_codes_updated_at on public.equipment_base_codes;
--   drop policy if exists "equipment_base_codes_rep_select" on public.equipment_base_codes;
--   drop policy if exists "equipment_base_codes_all_elevated" on public.equipment_base_codes;
--   drop policy if exists "equipment_base_codes_service_all" on public.equipment_base_codes;
--   drop table if exists public.equipment_base_codes;

create table public.equipment_base_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  base_number text not null,
  description text,
  make text,
  model text,
  group_code text,
  class_code text,
  price_cents bigint,
  cost_cents bigint,
  active_for_build boolean not null default true,
  active_for_equipment boolean not null default true,
  added_at date,
  modified_at date,
  miscellaneous text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, base_number)
);

comment on table public.equipment_base_codes is
  'Manufacturer-published equipment base configuration codes that drive Base & Options lookup and OEM order submission.';

create index idx_equipment_base_codes_active
  on public.equipment_base_codes (workspace_id, make, model, lower(base_number))
  where deleted_at is null and active_for_build = true;
comment on index public.idx_equipment_base_codes_active is
  'Purpose: Base & Options lookup by workspace, make/model, and base number for active buildable configurations.';

alter table public.equipment_base_codes enable row level security;

create policy "equipment_base_codes_service_all"
  on public.equipment_base_codes for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_base_codes_all_elevated"
  on public.equipment_base_codes for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "equipment_base_codes_rep_select"
  on public.equipment_base_codes for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_equipment_base_codes_updated_at
  before update on public.equipment_base_codes
  for each row execute function public.set_updated_at();
