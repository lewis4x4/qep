-- ============================================================================
-- Migration 149: Cross-Department Health Score + Alert System
--
-- Moonshot 5: The Nervous System.
-- Rylee: "Anything that's really of our business revolves around how
--         we interact with our customers."
--
-- Customer health score: 4 components (0-25 each) = 0-100 total
-- Cross-department alerts: AR→Sales, Service→Sales, Parts→Service, Portal→Sales
-- ============================================================================

-- ── 1. Health score fields on customer_profiles_extended ─────────────────────

alter table public.customer_profiles_extended
  add column if not exists health_score numeric(5,2),
  add column if not exists health_score_components jsonb default '{}',
  add column if not exists health_score_updated_at timestamptz,
  add column if not exists revenue_attribution jsonb default '{}';

comment on column public.customer_profiles_extended.health_score is 'Composite 0-100 customer health: deal velocity(25) + service engagement(25) + parts revenue(25) + financial health(25)';
comment on column public.customer_profiles_extended.revenue_attribution is 'Revenue by equipment serial: { "SERIAL123": { parts: 5000, service: 3000, purchase: 180000 } }';

create index if not exists idx_customer_health_score
  on public.customer_profiles_extended(health_score desc)
  where health_score is not null;

-- ── 2. Cross-department alerts ──────────────────────────────────────────────

create table public.cross_department_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  source_department text not null check (source_department in ('sales', 'service', 'parts', 'finance', 'portal')),
  target_department text not null check (target_department in ('sales', 'service', 'parts', 'finance', 'portal', 'management')),

  customer_profile_id uuid references public.customer_profiles_extended(id) on delete cascade,
  alert_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),

  title text not null,
  body text,
  context_entity_type text, -- 'invoice', 'service_job', 'parts_order', 'deal', 'fleet_item'
  context_entity_id uuid,

  status text not null default 'pending' check (status in ('pending', 'routed', 'acknowledged', 'resolved')),
  routed_to_user_id uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cross_department_alerts is 'Cross-department intelligence alerts. The Nervous System — every department sees customer-relevant signals from other departments.';

alter table public.cross_department_alerts enable row level security;

create policy "xdept_alerts_workspace" on public.cross_department_alerts for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "xdept_alerts_service" on public.cross_department_alerts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_xdept_alerts_workspace_status on public.cross_department_alerts(workspace_id, target_department, status);
create index idx_xdept_alerts_customer on public.cross_department_alerts(customer_profile_id);
create index idx_xdept_alerts_routed on public.cross_department_alerts(routed_to_user_id, status)
  where status in ('pending', 'routed');

-- Dedup: one pending alert per customer + type + source
create unique index uq_xdept_alerts_dedup
  on public.cross_department_alerts(workspace_id, customer_profile_id, alert_type, source_department)
  where status = 'pending';

-- ── 3. Trigger ──────────────────────────────────────────────────────────────

create trigger set_xdept_alerts_updated_at
  before update on public.cross_department_alerts for each row
  execute function public.set_updated_at();
