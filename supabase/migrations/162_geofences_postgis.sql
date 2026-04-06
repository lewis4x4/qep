-- ============================================================================
-- Migration 162: Geofences with PostGIS (Wave 6.5 — restrained v1)
--
-- v2 §1 note 10: only three geofence types in v1.
--   - customer_jobsite
--   - branch_territory
--   - competitor_yard
-- State-boundary compliance, custom polygons, multi-action automation
-- explicitly deferred to v2-next.
--
-- This migration enables PostGIS if not already present.
-- ============================================================================

create extension if not exists postgis with schema extensions;

-- ── 1. crm_geofences ───────────────────────────────────────────────────────

create table if not exists public.crm_geofences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  name text not null,
  geofence_type text not null check (geofence_type in (
    'customer_jobsite', 'branch_territory', 'competitor_yard'
  )),
  polygon extensions.geography(POLYGON, 4326) not null,
  linked_company_id uuid references public.crm_companies(id) on delete set null,
  linked_deal_id uuid references public.crm_deals(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_geofences is 'Restrained v1: only customer_jobsite, branch_territory, competitor_yard. Polygons stored as PostGIS geography(POLYGON, 4326).';

alter table public.crm_geofences enable row level security;

create policy "geofences_workspace" on public.crm_geofences for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "geofences_service" on public.crm_geofences for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_geofences_workspace_type on public.crm_geofences(workspace_id, geofence_type);
create index idx_geofences_polygon on public.crm_geofences using gist (polygon);
create index idx_geofences_company on public.crm_geofences(linked_company_id) where linked_company_id is not null;
create index idx_geofences_deal on public.crm_geofences(linked_deal_id) where linked_deal_id is not null;

create trigger set_geofences_updated_at
  before update on public.crm_geofences
  for each row execute function public.set_updated_at();

-- ── 2. geofence_events ─────────────────────────────────────────────────────

create table if not exists public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  equipment_id uuid not null references public.crm_equipment(id) on delete cascade,
  geofence_id uuid not null references public.crm_geofences(id) on delete cascade,
  event_type text not null check (event_type in ('entered', 'exited')),
  event_at timestamptz not null default now(),
  reading_lat double precision,
  reading_lng double precision,
  ai_confidence numeric(3,2) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  triggered_action_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.geofence_events is 'Crossings detected by geofence-evaluator cron. ai_confidence is null when GPS hit is exact, <1 when interpolated.';

alter table public.geofence_events enable row level security;

create policy "geofence_events_workspace" on public.geofence_events for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "geofence_events_service" on public.geofence_events for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_geofence_events_workspace_at on public.geofence_events(workspace_id, event_at desc);
create index idx_geofence_events_equipment on public.geofence_events(equipment_id, event_at desc);
create index idx_geofence_events_geofence on public.geofence_events(geofence_id, event_at desc);
