-- Sprint 2 DGE additive migration
-- Adds economic sync run observability and customer profile view audit enum value.
-- Rollback DDL is included at the bottom.

create table if not exists public.economic_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null default 'mock',
  indicators text[] not null default '{}',
  rows_upserted integer not null default 0,
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.economic_sync_runs enable row level security;

create policy "economic_sync_runs_select_elevated"
  on public.economic_sync_runs
  for select
  using (public.get_my_role() in ('manager', 'owner'));

create policy "economic_sync_runs_service"
  on public.economic_sync_runs
  for all
  using (auth.role() = 'service_role');

create index if not exists idx_economic_sync_runs_started_at
  on public.economic_sync_runs(started_at desc)
  where deleted_at is null;

create trigger set_economic_sync_runs_updated_at
  before update on public.economic_sync_runs
  for each row execute function public.set_updated_at();

alter type public.activity_type
  add value if not exists 'customer_profile_viewed';

-- Rollback (manual):
-- drop trigger if exists set_economic_sync_runs_updated_at on public.economic_sync_runs;
-- drop policy if exists "economic_sync_runs_service" on public.economic_sync_runs;
-- drop policy if exists "economic_sync_runs_select_elevated" on public.economic_sync_runs;
-- drop table if exists public.economic_sync_runs;
-- -- Enum rollback requires recreating type in PostgreSQL; leave value in place.
