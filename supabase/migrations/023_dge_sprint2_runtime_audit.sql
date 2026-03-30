-- DGE Sprint 2 runtime observability and access audit tables
-- Adds:
--   1) economic_sync_runs
--   2) customer_profile_access_audit
--
-- Rollback DDL is documented at the bottom of this file.

-- ── economic_sync_runs ───────────────────────────────────────────────────────
create table if not exists public.economic_sync_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid references public.profiles(id) on delete set null,
  mode text not null default 'mock' check (mode in ('live', 'mock', 'partial')),
  indicators jsonb not null default '[]'::jsonb,
  rows_upserted integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.economic_sync_runs enable row level security;

drop policy if exists "economic_sync_runs_select_elevated" on public.economic_sync_runs;
drop policy if exists "economic_sync_runs_service_all" on public.economic_sync_runs;

create policy "economic_sync_runs_select_elevated"
  on public.economic_sync_runs
  for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "economic_sync_runs_service_all"
  on public.economic_sync_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_economic_sync_runs_started
  on public.economic_sync_runs(started_at desc);

create index if not exists idx_economic_sync_runs_mode
  on public.economic_sync_runs(mode, started_at desc);

-- ── customer_profile_access_audit ────────────────────────────────────────────
create table if not exists public.customer_profile_access_audit (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null
    references public.customer_profiles_extended(id)
    on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  hubspot_contact_id text,
  intellidealer_customer_id text,
  access_mode text not null default 'user' check (access_mode in ('user', 'service')),
  source text not null default 'customer-profile',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.customer_profile_access_audit enable row level security;

drop policy if exists "customer_profile_access_audit_select_elevated"
  on public.customer_profile_access_audit;
drop policy if exists "customer_profile_access_audit_service_all"
  on public.customer_profile_access_audit;

create policy "customer_profile_access_audit_select_elevated"
  on public.customer_profile_access_audit
  for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "customer_profile_access_audit_service_all"
  on public.customer_profile_access_audit
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists idx_customer_profile_access_audit_profile_created
  on public.customer_profile_access_audit(customer_profile_id, created_at desc);

create index if not exists idx_customer_profile_access_audit_actor_created
  on public.customer_profile_access_audit(actor_user_id, created_at desc);

-- ── Updated-at triggers ──────────────────────────────────────────────────────
drop trigger if exists set_economic_sync_runs_updated_at on public.economic_sync_runs;
create trigger set_economic_sync_runs_updated_at
  before update on public.economic_sync_runs
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_customer_profile_access_audit_updated_at on public.customer_profile_access_audit;
create trigger set_customer_profile_access_audit_updated_at
  before update on public.customer_profile_access_audit
  for each row
  execute function public.set_updated_at();

-- ── Rollback DDL ─────────────────────────────────────────────────────────────
-- drop trigger if exists set_customer_profile_access_audit_updated_at on public.customer_profile_access_audit;
-- drop trigger if exists set_economic_sync_runs_updated_at on public.economic_sync_runs;
-- drop policy if exists "customer_profile_access_audit_service_all" on public.customer_profile_access_audit;
-- drop policy if exists "customer_profile_access_audit_select_elevated" on public.customer_profile_access_audit;
-- drop table if exists public.customer_profile_access_audit;
-- drop policy if exists "economic_sync_runs_service_all" on public.economic_sync_runs;
-- drop policy if exists "economic_sync_runs_select_elevated" on public.economic_sync_runs;
-- drop table if exists public.economic_sync_runs;
