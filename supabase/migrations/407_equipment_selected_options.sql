-- 407_equipment_selected_options.sql
--
-- Wave 1A: selected options attached to an equipment unit from
-- docs/intellidealer-gap-audit/phase-2-sales-intelligence.yaml#equipment.options.
-- Depends on 406_equipment_options.sql.
--
-- Rollback notes:
--   drop trigger if exists set_equipment_selected_options_updated_at on public.equipment_selected_options;
--   drop policy if exists "equipment_selected_options_rep_scope" on public.equipment_selected_options;
--   drop policy if exists "equipment_selected_options_all_elevated" on public.equipment_selected_options;
--   drop policy if exists "equipment_selected_options_service_all" on public.equipment_selected_options;
--   drop table if exists public.equipment_selected_options;

create table public.equipment_selected_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  equipment_id uuid not null references public.qrm_equipment(id) on delete cascade,
  option_id uuid not null references public.equipment_options(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, equipment_id, option_id)
);

comment on table public.equipment_selected_options is
  'Selected Base & Options option rows attached to individual equipment assets.';

create index idx_equipment_selected_options_equipment
  on public.equipment_selected_options (workspace_id, equipment_id)
  where deleted_at is null;
comment on index public.idx_equipment_selected_options_equipment is
  'Purpose: load selected option rows for an Equipment Profile Base & Options tab.';

create index idx_equipment_selected_options_option
  on public.equipment_selected_options (workspace_id, option_id)
  where deleted_at is null;
comment on index public.idx_equipment_selected_options_option is
  'Purpose: support equipment listing filters by option code.';

alter table public.equipment_selected_options enable row level security;

create policy "equipment_selected_options_service_all"
  on public.equipment_selected_options for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_selected_options_all_elevated"
  on public.equipment_selected_options for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "equipment_selected_options_rep_scope"
  on public.equipment_selected_options for all
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

create trigger set_equipment_selected_options_updated_at
  before update on public.equipment_selected_options
  for each row execute function public.set_updated_at();
