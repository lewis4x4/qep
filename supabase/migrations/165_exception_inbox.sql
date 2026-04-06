-- ============================================================================
-- Migration 165: Exception Inbox (Wave 6.9 — new in v2)
--
-- Cross-functional human work queue. Every edge function that can fail in a
-- way a human needs to fix inserts into exception_queue. Surfaced in
-- /exceptions with playbook actions per source (retry, override, escalate,
-- dismiss-with-reason).
-- ============================================================================

create table if not exists public.exception_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source text not null check (source in (
    'tax_failed',
    'price_unmatched',
    'health_refresh_failed',
    'ar_override_pending',
    'stripe_mismatch',
    'portal_reorder_approval',
    'sop_evidence_mismatch',
    'geofence_conflict',
    'stale_telematics',
    'doc_visibility',
    'data_quality'
  )),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'error', 'critical')),
  title text not null,
  detail text,
  payload jsonb not null default '{}'::jsonb,
  entity_table text,
  entity_id uuid,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.exception_queue is 'Cross-functional human work queue. Every edge function that needs human triage inserts here.';

alter table public.exception_queue enable row level security;

create policy "exq_workspace" on public.exception_queue for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "exq_service" on public.exception_queue for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_exq_workspace_status on public.exception_queue(workspace_id, status, severity);
create index idx_exq_source on public.exception_queue(source, status);
create index idx_exq_assigned on public.exception_queue(assigned_to) where assigned_to is not null;
create index idx_exq_open_severity on public.exception_queue(severity, created_at desc) where status = 'open';

create trigger set_exq_updated_at
  before update on public.exception_queue
  for each row execute function public.set_updated_at();

-- Helper RPC for edge functions to enqueue from any source.
create or replace function public.enqueue_exception(
  p_source text,
  p_title text,
  p_severity text default 'warn',
  p_detail text default null,
  p_payload jsonb default '{}'::jsonb,
  p_entity_table text default null,
  p_entity_id uuid default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  insert into public.exception_queue (source, severity, title, detail, payload, entity_table, entity_id)
  values (p_source, p_severity, p_title, p_detail, p_payload, p_entity_table, p_entity_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.enqueue_exception(text, text, text, text, jsonb, text, uuid) is 'Edge-function helper to enqueue an exception. SECURITY DEFINER so cron jobs can call it.';
