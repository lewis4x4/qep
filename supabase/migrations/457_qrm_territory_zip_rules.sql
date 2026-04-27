-- 457_qrm_territory_zip_rules.sql
--
-- Wave 1 clean foundation: Cross-Cutting from
-- docs/intellidealer-gap-audit/cross-cutting.yaml#territory.zip_mapping.
--
-- Rollback notes:
--   drop trigger if exists set_qrm_territory_zip_rules_updated_at on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_rep_select" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_rep_scope" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_rep_own_select" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_workspace_select" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_workspace_insert" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_workspace_update" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_delete_elevated" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_all_elevated" on public.qrm_territory_zip_rules;
--   drop policy if exists "qrm_territory_zip_rules_service_all" on public.qrm_territory_zip_rules;
--   drop table if exists public.qrm_territory_zip_rules;
create table public.qrm_territory_zip_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  territory_id uuid not null references public.qrm_territories(id) on delete cascade,
  country text not null default 'US',
  postal_prefix text not null,
  rank integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, country, postal_prefix)
);

comment on table public.qrm_territory_zip_rules is 'Postal-prefix routing rules for QRM territory assignment.';

create index idx_qrm_territory_zip_rules_territory
  on public.qrm_territory_zip_rules (workspace_id, territory_id, rank)
  where deleted_at is null;
comment on index public.idx_qrm_territory_zip_rules_territory is 'Purpose: resolve ZIP/postal prefixes to ranked territory rules.';

alter table public.qrm_territory_zip_rules enable row level security;

create policy "qrm_territory_zip_rules_service_all"
  on public.qrm_territory_zip_rules for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "qrm_territory_zip_rules_all_elevated"
  on public.qrm_territory_zip_rules for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "qrm_territory_zip_rules_rep_select"
  on public.qrm_territory_zip_rules for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_qrm_territory_zip_rules_updated_at
  before update on public.qrm_territory_zip_rules
  for each row execute function public.set_updated_at();
