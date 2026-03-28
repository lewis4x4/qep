-- Migration 016: analytics_events table
-- Materialises the EventEnvelope from event-tracker.ts so frontend and backend
-- events have a dedicated, structured analytics store (previously deferred to Sprint 2
-- but required for QUA-132 simulation fix — events must be capturable now).
--
-- Schema mirrors EventEnvelope interface in _shared/event-tracker.ts.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  event_id         uuid         not null default gen_random_uuid() primary key,
  event_name       text         not null,
  event_version    integer      not null default 1,
  occurred_at      timestamptz  not null default now(),
  received_at      timestamptz  not null default now(),
  workspace_id     text         not null,
  project_id       text         not null,
  source           text         not null, -- 'web' | 'edge_function' | 'cron' | 'admin_hub'
  role             text         not null default 'system', -- UserRole
  user_id          uuid         references auth.users (id) on delete set null,
  session_id       text,
  request_id       text,
  entity_type      text,        -- 'quote' | 'deal' | 'customer' | 'integration' | 'scenario'
  entity_id        text,
  properties       jsonb,
  context          jsonb        not null default '{}'
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists analytics_events_event_name_idx  on public.analytics_events (event_name);
create index if not exists analytics_events_occurred_at_idx on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_entity_idx      on public.analytics_events (entity_type, entity_id)
  where entity_type is not null;
create index if not exists analytics_events_user_idx        on public.analytics_events (user_id)
  where user_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.analytics_events enable row level security;

-- Service role (edge functions) writes events — no RLS restriction needed for service_role.
-- Owners can read all events.
create policy "analytics_events_select_owner" on public.analytics_events
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- drop table if exists public.analytics_events;
