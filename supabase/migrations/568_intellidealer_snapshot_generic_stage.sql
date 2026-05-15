-- 568_intellidealer_snapshot_generic_stage.sql
--
-- Lossless generic staging tables for the 2026-05-14 IntelliDealer snapshot
-- lanes beyond the customer workbook. These preserve raw exports first; later
-- canonical commit jobs can map payload columns into QRM entities with review.

create table if not exists public.qrm_intellidealer_equipment_master_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source text not null default 'intellidealer_snapshot_2026-05-14',
  source_dataset text not null default 'equipment_master',
  source_file_name text not null,
  source_row_number integer not null,
  snapshot_loaded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  stage_metadata jsonb not null default '{}'::jsonb,
  canonical_equipment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qrm_intellidealer_quotes_history_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source text not null default 'intellidealer_snapshot_2026-05-14',
  source_dataset text not null default 'quotes_history',
  source_file_name text not null,
  source_row_number integer not null,
  snapshot_loaded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  stage_metadata jsonb not null default '{}'::jsonb,
  canonical_quote_package_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qrm_intellidealer_parts_master_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source text not null default 'intellidealer_snapshot_2026-05-14',
  source_dataset text not null default 'parts_master',
  source_file_name text not null,
  source_row_number integer not null,
  snapshot_loaded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  stage_metadata jsonb not null default '{}'::jsonb,
  canonical_part_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qrm_intellidealer_service_history_stage (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source text not null default 'intellidealer_snapshot_2026-05-14',
  source_dataset text not null default 'service_history',
  source_file_name text not null,
  source_row_number integer not null,
  snapshot_loaded_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  stage_metadata jsonb not null default '{}'::jsonb,
  canonical_service_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_qrm_intellidealer_equipment_stage_source_row
  on public.qrm_intellidealer_equipment_master_stage (workspace_id, source, source_file_name, source_row_number);
create unique index if not exists idx_qrm_intellidealer_quotes_stage_source_row
  on public.qrm_intellidealer_quotes_history_stage (workspace_id, source, source_file_name, source_row_number);
create unique index if not exists idx_qrm_intellidealer_parts_stage_source_row
  on public.qrm_intellidealer_parts_master_stage (workspace_id, source, source_file_name, source_row_number);
create unique index if not exists idx_qrm_intellidealer_service_stage_source_row
  on public.qrm_intellidealer_service_history_stage (workspace_id, source, source_file_name, source_row_number);

create index if not exists idx_qrm_intellidealer_equipment_stage_loaded
  on public.qrm_intellidealer_equipment_master_stage (workspace_id, snapshot_loaded_at desc);
create index if not exists idx_qrm_intellidealer_quotes_stage_loaded
  on public.qrm_intellidealer_quotes_history_stage (workspace_id, snapshot_loaded_at desc);
create index if not exists idx_qrm_intellidealer_parts_stage_loaded
  on public.qrm_intellidealer_parts_master_stage (workspace_id, snapshot_loaded_at desc);
create index if not exists idx_qrm_intellidealer_service_stage_loaded
  on public.qrm_intellidealer_service_history_stage (workspace_id, snapshot_loaded_at desc);

alter table public.qrm_intellidealer_equipment_master_stage enable row level security;
alter table public.qrm_intellidealer_quotes_history_stage enable row level security;
alter table public.qrm_intellidealer_parts_master_stage enable row level security;
alter table public.qrm_intellidealer_service_history_stage enable row level security;

create policy "qrm_intellidealer_equipment_stage_service_all"
  on public.qrm_intellidealer_equipment_master_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_equipment_stage_elevated_all"
  on public.qrm_intellidealer_equipment_master_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_quotes_stage_service_all"
  on public.qrm_intellidealer_quotes_history_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_quotes_stage_elevated_all"
  on public.qrm_intellidealer_quotes_history_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_parts_stage_service_all"
  on public.qrm_intellidealer_parts_master_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_parts_stage_elevated_all"
  on public.qrm_intellidealer_parts_master_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

create policy "qrm_intellidealer_service_stage_service_all"
  on public.qrm_intellidealer_service_history_stage for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
create policy "qrm_intellidealer_service_stage_elevated_all"
  on public.qrm_intellidealer_service_history_stage for all
  using (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'))
  with check (workspace_id = (select public.get_my_workspace()) and (select public.get_my_role()) in ('admin', 'manager', 'owner'));

comment on table public.qrm_intellidealer_equipment_master_stage is
  'Lossless staging table for IntelliDealer equipment snapshot CSV exports.';
comment on table public.qrm_intellidealer_quotes_history_stage is
  'Lossless staging table for IntelliDealer quote-history snapshot CSV exports.';
comment on table public.qrm_intellidealer_parts_master_stage is
  'Lossless staging table for IntelliDealer parts-master snapshot CSV exports.';
comment on table public.qrm_intellidealer_service_history_stage is
  'Lossless staging table for IntelliDealer service-history snapshot CSV exports.';
