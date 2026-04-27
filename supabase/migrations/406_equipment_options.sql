-- 406_equipment_options.sql
--
-- Wave 1A: per-base equipment option catalog from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment.options.
-- Depends on 405_equipment_base_codes.sql.
--
-- Rollback notes:
--   drop trigger if exists set_equipment_options_updated_at on public.equipment_options;
--   drop policy if exists "equipment_options_rep_select" on public.equipment_options;
--   drop policy if exists "equipment_options_all_elevated" on public.equipment_options;
--   drop policy if exists "equipment_options_service_all" on public.equipment_options;
--   drop table if exists public.equipment_options;

create table public.equipment_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  base_code_id uuid not null references public.equipment_base_codes(id) on delete cascade,
  option_number text not null,
  description text,
  price_cents bigint,
  master_price_cents bigint,
  cost_cents bigint,
  master_cost_cents bigint,
  added_at date,
  modified_at date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, base_code_id, option_number)
);

comment on table public.equipment_options is
  'Manufacturer-published option rows attached to equipment base codes for OEM order submission and quote option selection.';

create index idx_equipment_options_base_active
  on public.equipment_options (workspace_id, base_code_id, is_active, lower(option_number))
  where deleted_at is null;
comment on index public.idx_equipment_options_base_active is
  'Purpose: Base & Options tab option grid lookup for one base code.';

alter table public.equipment_options enable row level security;

create policy "equipment_options_service_all"
  on public.equipment_options for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_options_all_elevated"
  on public.equipment_options for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "equipment_options_rep_select"
  on public.equipment_options for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_equipment_options_updated_at
  before update on public.equipment_options
  for each row execute function public.set_updated_at();
