-- ============================================================================
-- Migration 227: Track 1 Exit Gate — QRM Absence Engine Nightly Snapshots
--
-- Adds:
--   1. qrm_absence_engine_runs — one nightly run row per workspace/date
--   2. qrm_absence_engine_rep_snapshots — per-rep completeness rows
--   3. nightly qrm-absence-engine worker schedule
-- ============================================================================

create table if not exists public.qrm_absence_engine_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  snapshot_date date not null default current_date,
  generated_at timestamptz not null default now(),
  top_gap_count integer not null default 0,
  worst_fields jsonb not null default '[]'::jsonb,
  unique (workspace_id, snapshot_date)
);

comment on table public.qrm_absence_engine_runs is
  'Nightly absence engine rollup per workspace. Stores the manager-reviewable snapshot metadata for Track 1 exit-gate evidence.';

create table if not exists public.qrm_absence_engine_rep_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.qrm_absence_engine_runs(id) on delete cascade,
  workspace_id text not null default 'default',
  snapshot_date date not null,
  rep_id uuid references public.profiles(id) on delete cascade,
  rep_name text not null,
  iron_role text,
  deal_count integer not null default 0,
  missing_amount integer not null default 0,
  missing_close_date integer not null default 0,
  missing_contact integer not null default 0,
  missing_company integer not null default 0,
  absence_score numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, rep_id)
);

comment on table public.qrm_absence_engine_rep_snapshots is
  'Nightly per-rep data completeness snapshot for the QRM Absence Engine.';

create index if not exists idx_qrm_absence_runs_workspace_generated
  on public.qrm_absence_engine_runs(workspace_id, generated_at desc);

create index if not exists idx_qrm_absence_rep_snapshots_workspace_date
  on public.qrm_absence_engine_rep_snapshots(workspace_id, snapshot_date desc);

alter table public.qrm_absence_engine_runs enable row level security;
alter table public.qrm_absence_engine_rep_snapshots enable row level security;

create policy "qaer_workspace_select" on public.qrm_absence_engine_runs for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qaer_service_all" on public.qrm_absence_engine_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "qaers_workspace_select" on public.qrm_absence_engine_rep_snapshots for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qaers_service_all" on public.qrm_absence_engine_rep_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

select cron.schedule(
  'qrm-absence-engine-nightly',
  '30 4 * * *',
  format(
    $sql$
    select net.http_post(
      url := '%s/functions/v1/qrm-absence-engine-nightly',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', format('Bearer %s', current_setting('app.settings.service_role_key', true))
      ),
      body := '{"source":"cron"}'::jsonb
    );
    $sql$,
    current_setting('app.settings.supabase_url', true),
    current_setting('app.settings.service_role_key', true)
  )
);
