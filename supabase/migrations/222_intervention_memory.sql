-- ============================================================================
-- Migration 222: Intervention Memory (Track 5, Slice 5.4)
--
-- Records how alerts were resolved so the system can surface
-- "what solved this last time" on future similar alerts.
-- Links resolved alerts to their resolution patterns.
-- ============================================================================

create table if not exists public.intervention_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  alert_type text not null,
  alert_severity text not null,
  alert_title_pattern text not null,
  resolution_type text not null check (resolution_type in ('acknowledged', 'resolved', 'dismissed')),
  resolution_notes text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz not null default now(),
  time_to_resolve_minutes integer,
  recurrence_count integer not null default 1,
  last_recurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_intervention_memory_type on public.intervention_memory(alert_type);
create index idx_intervention_memory_pattern on public.intervention_memory(alert_title_pattern);
create index idx_intervention_memory_workspace on public.intervention_memory(workspace_id);

alter table public.intervention_memory enable row level security;

create policy "Managers and owners can view intervention memory"
  on public.intervention_memory for select
  to authenticated
  using (
    workspace_id = (select active_workspace_id from public.profiles where id = auth.uid())
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
      and role in ('manager', 'owner', 'admin')
    )
  );

create policy "Service role full access"
  on public.intervention_memory for all
  to service_role using (true) with check (true);

-- Function to look up past resolutions for a given alert type/title
create or replace function public.lookup_intervention_history(
  p_alert_type text,
  p_alert_title text,
  p_limit int default 3
)
returns table (
  id uuid,
  alert_type text,
  resolution_type text,
  resolution_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  time_to_resolve_minutes integer,
  recurrence_count integer
)
language sql
security definer
set search_path = ''
as $$
  select
    im.id,
    im.alert_type,
    im.resolution_type,
    im.resolution_notes,
    im.resolved_by,
    im.resolved_at,
    im.time_to_resolve_minutes,
    im.recurrence_count
  from public.intervention_memory im
  where im.alert_type = p_alert_type
    and im.alert_title_pattern = p_alert_title
  order by im.resolved_at desc
  limit p_limit;
$$;

-- Trigger: when an alert is resolved, upsert into intervention_memory
create or replace function public.record_intervention_on_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.status in ('resolved', 'acknowledged', 'dismissed') and OLD.status != NEW.status then
    insert into public.intervention_memory (
      alert_type,
      alert_severity,
      alert_title_pattern,
      resolution_type,
      resolved_at,
      time_to_resolve_minutes,
      recurrence_count
    ) values (
      coalesce(NEW.alert_type, 'unknown'),
      coalesce(NEW.severity, 'info'),
      left(coalesce(NEW.title, ''), 120),
      NEW.status,
      coalesce(NEW.resolved_at, now()),
      case
        when NEW.created_at is not null then
          extract(epoch from (coalesce(NEW.resolved_at, now()) - NEW.created_at)) / 60
        else null
      end::int,
      1
    )
    on conflict on constraint intervention_memory_pkey do nothing;
  end if;
  return NEW;
end;
$$;

-- Note: We do NOT attach the trigger here since the analytics_alerts table
-- structure varies. The edge function will call record_intervention_on_resolve
-- logic directly when it resolves an alert.
