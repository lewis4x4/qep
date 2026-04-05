-- ============================================================================
-- Migration 115: Parts fulfillment runs + profile↔workspace membership
--
-- Unifies portal parts demand with a canonical fulfillment record (Phase 1).
-- Staff in-app notifications scope to profile_workspaces for the portal tenant.
-- ============================================================================

-- ── profile_workspaces ───────────────────────────────────────────────────────

create table public.profile_workspaces (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, workspace_id)
);

comment on table public.profile_workspaces is
  'Many-to-many: which internal users belong to which workspace (for notifications, scoping).';

create index idx_profile_workspaces_workspace
  on public.profile_workspaces(workspace_id);

insert into public.profile_workspaces (profile_id, workspace_id)
select id, 'default' from public.profiles
on conflict do nothing;

insert into public.profile_workspaces (profile_id, workspace_id)
select user_id, workspace_id from public.technician_profiles
on conflict do nothing;

alter table public.profile_workspaces enable row level security;

create policy "profile_workspaces_select"
  on public.profile_workspaces for select
  using (
    profile_id = auth.uid()
    or public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "profile_workspaces_service_all"
  on public.profile_workspaces for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── parts_fulfillment_runs ───────────────────────────────────────────────────

create table public.parts_fulfillment_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  status text not null default 'open' check (status in (
    'open', 'submitted', 'picking', 'ordered', 'shipped', 'closed', 'cancelled'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.parts_fulfillment_runs is
  'Canonical fulfillment run for parts (portal and, later, service job linkage).';

create index idx_parts_fulfillment_runs_workspace
  on public.parts_fulfillment_runs(workspace_id)
  where deleted_at is null;

alter table public.parts_fulfillment_runs enable row level security;

create policy "parts_fulfillment_runs_select"
  on public.parts_fulfillment_runs for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_fulfillment_runs_mutate"
  on public.parts_fulfillment_runs for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = public.get_my_workspace());

create policy "parts_fulfillment_runs_service_all"
  on public.parts_fulfillment_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_fulfillment_runs_updated_at
  before update on public.parts_fulfillment_runs
  for each row execute function public.set_updated_at();

-- ── parts_fulfillment_events (audit) ───────────────────────────────────────

create table public.parts_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  fulfillment_run_id uuid not null references public.parts_fulfillment_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.parts_fulfillment_events is
  'Append-only events for fulfillment state transitions (portal submit, ship, etc.).';

create index idx_parts_fulfillment_events_run
  on public.parts_fulfillment_events(fulfillment_run_id);

alter table public.parts_fulfillment_events enable row level security;

create policy "parts_fulfillment_events_select"
  on public.parts_fulfillment_events for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "parts_fulfillment_events_service_all"
  on public.parts_fulfillment_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── parts_orders link ──────────────────────────────────────────────────────

alter table public.parts_orders
  add column if not exists fulfillment_run_id uuid references public.parts_fulfillment_runs(id) on delete set null;

create index idx_parts_orders_fulfillment_run
  on public.parts_orders(fulfillment_run_id)
  where fulfillment_run_id is not null;

comment on column public.parts_orders.fulfillment_run_id is
  'Canonical fulfillment run created when the order is submitted (or linked later).';

-- ── service_jobs optional future link ────────────────────────────────────────

alter table public.service_jobs
  add column if not exists fulfillment_run_id uuid references public.parts_fulfillment_runs(id) on delete set null;

create index idx_service_jobs_fulfillment_run
  on public.service_jobs(fulfillment_run_id)
  where fulfillment_run_id is not null;

comment on column public.service_jobs.fulfillment_run_id is
  'Optional link when job shares the same fulfillment run as portal/counter (Phase 2+).';
