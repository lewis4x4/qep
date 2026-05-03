-- 527_intellidealer_sales_base_options_non_must.sql
--
-- Non-must Phase-2 Sales Intelligence cleanup: record OEM Base & Options
-- import attempts without asserting that Bobcat/Vermeer parsers or UI buttons
-- are implemented.

create table if not exists public.equipment_base_codes_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  manufacturer text not null,
  import_format text,
  source_filename text,
  source_storage_path text,
  source_sha256 text,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_skipped integer not null default 0,
  run_status text not null default 'pending',
  error text,
  metadata jsonb not null default '{}'::jsonb,
  ran_by uuid references public.profiles(id) on delete set null,
  ran_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_base_codes_import_runs_manufacturer_chk
    check (manufacturer in ('bobcat', 'vermeer', 'jd', 'yanmar', 'other')),
  constraint equipment_base_codes_import_runs_status_chk
    check (run_status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  constraint equipment_base_codes_import_runs_counts_chk
    check (rows_inserted >= 0 and rows_updated >= 0 and rows_skipped >= 0)
);

comment on table public.equipment_base_codes_import_runs is
  'Audit ledger for OEM Base & Options import attempts. Parser/UI implementation remains a separate workflow.';
comment on column public.equipment_base_codes_import_runs.manufacturer is
  'OEM source for the Base & Options import, including Bobcat and Vermeer.';
comment on column public.equipment_base_codes_import_runs.source_storage_path is
  'Optional Supabase Storage object path for a staged OEM spreadsheet or CSV.';
comment on column public.equipment_base_codes_import_runs.source_sha256 is
  'Optional source fingerprint used to detect duplicate OEM catalog imports.';
comment on column public.equipment_base_codes_import_runs.metadata is
  'Parser-specific summary payload; no raw IntelliDealer/OEM rows are required here.';

create index if not exists idx_equipment_base_codes_import_runs_lookup
  on public.equipment_base_codes_import_runs (workspace_id, manufacturer, ran_at desc);
comment on index public.idx_equipment_base_codes_import_runs_lookup is
  'Purpose: Base & Options admin import history by workspace and OEM.';

create index if not exists idx_equipment_base_codes_import_runs_status
  on public.equipment_base_codes_import_runs (workspace_id, run_status, ran_at desc);
comment on index public.idx_equipment_base_codes_import_runs_status is
  'Purpose: pending/failed Base & Options import review queue.';

alter table public.equipment_base_codes_import_runs enable row level security;

drop policy if exists "equipment_base_codes_import_runs_service_all"
  on public.equipment_base_codes_import_runs;
create policy "equipment_base_codes_import_runs_service_all"
  on public.equipment_base_codes_import_runs for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "equipment_base_codes_import_runs_elevated_all"
  on public.equipment_base_codes_import_runs;
create policy "equipment_base_codes_import_runs_elevated_all"
  on public.equipment_base_codes_import_runs for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

drop trigger if exists set_equipment_base_codes_import_runs_updated_at
  on public.equipment_base_codes_import_runs;
create trigger set_equipment_base_codes_import_runs_updated_at
  before update on public.equipment_base_codes_import_runs
  for each row execute function public.set_updated_at();
