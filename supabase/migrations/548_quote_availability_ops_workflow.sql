-- ============================================================================
-- 548_quote_availability_ops_workflow.sql
--
-- Adds the operations layer for quote availability requests: timeline events,
-- SLA/priority fields, manager override governance, and candidate selection
-- metadata. This builds on 547_quote_availability_requests.sql.
-- ============================================================================

alter table public.quote_availability_requests
  add column if not exists priority_score numeric not null default 0,
  add column if not exists sla_due_at timestamptz,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists manager_override_by uuid references public.profiles(id) on delete set null,
  add column if not exists manager_override_at timestamptz,
  add column if not exists manager_override_reason text,
  add column if not exists rep_visibility_note text,
  add column if not exists customer_safe_summary text;

alter table public.quote_availability_candidates
  add column if not exists selected_at timestamptz,
  add column if not exists selected_by uuid references public.profiles(id) on delete set null,
  add column if not exists source_ref text,
  add column if not exists source_confidence text
    check (source_confidence is null or source_confidence in ('low', 'medium', 'high')),
  add column if not exists customer_safe_label text,
  add column if not exists internal_note text;

create table if not exists public.quote_availability_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  request_id uuid not null references public.quote_availability_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null
    check (event_type in (
      'requested',
      'assigned',
      'status_changed',
      'candidate_added',
      'candidate_selected',
      'note_added',
      'rep_clarification_requested',
      'manager_escalated',
      'override_granted',
      'resolved',
      'cancelled'
    )),
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_quote_availability_events_request
  on public.quote_availability_events (request_id, created_at desc);

create index if not exists idx_quote_availability_events_workspace
  on public.quote_availability_events (workspace_id, created_at desc);

create index if not exists idx_quote_availability_requests_ops_queue
  on public.quote_availability_requests (workspace_id, status, urgency, sla_due_at, last_activity_at desc);

create index if not exists idx_quote_availability_requests_override
  on public.quote_availability_requests (workspace_id, manager_override_at)
  where manager_override_at is not null;

alter table public.quote_availability_events enable row level security;

create policy "qae_service_all" on public.quote_availability_events
  for all to service_role using (true) with check (true);

create policy "qae_select" on public.quote_availability_events
  for select using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qae_manage" on public.quote_availability_events
  for all using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = (select public.get_my_workspace()));

comment on table public.quote_availability_events is
  'Immutable audit timeline for quote availability operations workflow actions.';
