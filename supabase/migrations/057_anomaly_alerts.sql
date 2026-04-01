-- Anomaly alerts: proactive intelligence signals detected from CRM data patterns.

create table public.anomaly_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  alert_type text not null check (alert_type in (
    'stalling_deal', 'overdue_follow_up', 'pricing_anomaly',
    'utilization_drop', 'pipeline_risk', 'activity_gap'
  )),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text not null,
  entity_type text check (entity_type is null or entity_type in (
    'deal', 'contact', 'company', 'equipment'
  )),
  entity_id uuid,
  assigned_to uuid references public.profiles(id) on delete set null,
  data jsonb not null default '{}',
  acknowledged boolean not null default false,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.anomaly_alerts enable row level security;

create policy "anomaly_alerts_select_own"
  on public.anomaly_alerts for select
  using (assigned_to = auth.uid());

create policy "anomaly_alerts_select_elevated"
  on public.anomaly_alerts for select
  using (public.get_my_role() in ('manager', 'owner', 'admin'));

create policy "anomaly_alerts_update_own"
  on public.anomaly_alerts for update
  using (assigned_to = auth.uid());

create policy "anomaly_alerts_service"
  on public.anomaly_alerts for all
  using (auth.role() = 'service_role');

create index idx_anomaly_alerts_user_unack
  on public.anomaly_alerts (assigned_to, acknowledged, created_at desc)
  where acknowledged = false;

create index idx_anomaly_alerts_type
  on public.anomaly_alerts (alert_type, created_at desc);

create index idx_anomaly_alerts_entity
  on public.anomaly_alerts (entity_type, entity_id)
  where entity_id is not null;
