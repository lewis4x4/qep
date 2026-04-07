-- ============================================================================
-- Migration 194: QEP Flow Engine — Foundation (Slice 1)
--
-- Internal automation, orchestration, and event fabric for QEP OS per
-- `qep_flow_engine_codex_handoff.md`. Architectural reuse decisions:
--
--   • Event store: extend existing `analytics_events` (mig 016) with the
--     5 missing flow columns instead of building a parallel table.
--   • Dead-letter queue: existing `exception_queue` (mig 165) with new
--     source value 'workflow_dead_letter'.
--   • Audit log: existing `analytics_action_log` (mig 188) with new
--     action_type values for workflow lifecycle.
--   • Trigger emit pattern: clones `customer_lifecycle_events` triggers
--     (mig 174).
--
-- New tables (3 — minimum to track workflow definitions, runs, and step
-- traces; everything else lives on existing tables):
--   • flow_workflow_definitions — registered workflow configs (TS files
--     are the source of truth; DB row is the runtime registration)
--   • flow_workflow_runs — one row per workflow execution
--   • flow_workflow_run_steps — one row per step within a run
--   • flow_action_idempotency — small TTL'd dedupe table
--
-- New SQL functions:
--   • emit_event(...) — append to analytics_events with flow columns set
--   • mark_event_consumed(...) — append run_id to consumed_by_runs jsonb
--   • enqueue_workflow_dead_letter(...) — wraps enqueue_exception
-- ============================================================================

-- ── 1. Extend analytics_events with flow columns (additive, nullable) ──────

alter table public.analytics_events
  add column if not exists flow_event_type text,
  add column if not exists flow_event_version integer default 1,
  add column if not exists source_module text,
  add column if not exists correlation_id uuid,
  add column if not exists parent_event_id uuid,
  add column if not exists consumed_by_runs jsonb not null default '[]'::jsonb;

comment on column public.analytics_events.flow_event_type is
  'QEP Flow Engine canonical event type, e.g. ''quote.expired''. Distinct from event_name so legacy analytics keeps working unchanged.';
comment on column public.analytics_events.consumed_by_runs is
  'QEP Flow Engine: array of workflow_run ids that have already processed this event. Used to prevent double-processing during cron polling.';

-- Index for the runner poll: unprocessed events with a flow type
create index if not exists idx_ae_flow_unprocessed
  on public.analytics_events (occurred_at)
  where flow_event_type is not null and consumed_by_runs = '[]'::jsonb;

create index if not exists idx_ae_flow_event_type
  on public.analytics_events (workspace_id, flow_event_type, occurred_at desc)
  where flow_event_type is not null;

-- ── 2. flow_workflow_definitions ───────────────────────────────────────────

create table if not exists public.flow_workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  slug text not null,
  name text not null,
  description text,
  owner_role text not null default 'shared'
    check (owner_role in ('ceo', 'cfo', 'coo', 'sales', 'service', 'parts', 'rental', 'accounting', 'shared')),
  enabled boolean not null default true,
  trigger_event_pattern text not null,
  condition_dsl jsonb not null default '[]'::jsonb,
  action_chain jsonb not null default '[]'::jsonb,
  retry_policy jsonb not null default '{"max":3,"backoff":"exponential","base_seconds":30}'::jsonb,
  run_cadence_seconds integer not null default 60,
  dry_run boolean not null default false,
  version integer not null default 1,
  definition_hash text,
  affects_modules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

comment on table public.flow_workflow_definitions is
  'QEP Flow Engine: workflow registration. The TypeScript file under supabase/functions/_shared/flow-workflows/<slug>.ts is the source of truth for action_chain + condition_dsl; this row holds the runtime state (enabled, version, dry_run).';

create index if not exists idx_fwd_enabled_pattern
  on public.flow_workflow_definitions (trigger_event_pattern)
  where enabled = true;

create trigger trg_fwd_updated_at
  before update on public.flow_workflow_definitions
  for each row execute function public.set_updated_at();

alter table public.flow_workflow_definitions enable row level security;

create policy "fwd_admin_read" on public.flow_workflow_definitions
  for select using (
    public.get_my_role() in ('owner', 'admin', 'manager')
    and workspace_id = public.get_my_workspace()
  );

create policy "fwd_owner_write" on public.flow_workflow_definitions
  for all using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  ) with check (workspace_id = public.get_my_workspace());

create policy "fwd_service_all" on public.flow_workflow_definitions
  for all to service_role using (true) with check (true);

-- ── 3. flow_workflow_runs ──────────────────────────────────────────────────

create table if not exists public.flow_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  workflow_id uuid not null references public.flow_workflow_definitions(id) on delete cascade,
  workflow_slug text not null,
  event_id uuid references public.analytics_events(event_id),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'partially_succeeded', 'awaiting_approval', 'failed_retrying', 'dead_lettered', 'cancelled')),
  attempt integer not null default 1,
  dry_run boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  resolved_context jsonb,
  metadata jsonb not null default '{}'::jsonb,
  dead_letter_id uuid references public.exception_queue(id) on delete set null,
  error_text text,
  created_at timestamptz not null default now()
);

comment on table public.flow_workflow_runs is
  'QEP Flow Engine: one row per workflow execution. Append-only — replays create new rows. resolved_context freezes the moment so historical runs stay legible.';

create index if not exists idx_fwr_workspace_status
  on public.flow_workflow_runs (workspace_id, status, started_at desc);
create index if not exists idx_fwr_workflow_started
  on public.flow_workflow_runs (workflow_id, started_at desc);
create index if not exists idx_fwr_event
  on public.flow_workflow_runs (event_id) where event_id is not null;
create index if not exists idx_fwr_dead_letter
  on public.flow_workflow_runs (dead_letter_id) where dead_letter_id is not null;

alter table public.flow_workflow_runs enable row level security;

create policy "fwr_admin_read" on public.flow_workflow_runs
  for select using (
    public.get_my_role() in ('owner', 'admin', 'manager')
    and workspace_id = public.get_my_workspace()
  );

create policy "fwr_service_all" on public.flow_workflow_runs
  for all to service_role using (true) with check (true);

-- ── 4. flow_workflow_run_steps ─────────────────────────────────────────────

create table if not exists public.flow_workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.flow_workflow_runs(id) on delete cascade,
  step_index integer not null,
  step_type text not null check (step_type in ('condition', 'action', 'approval')),
  action_key text,
  params jsonb,
  idempotency_key text,
  status text not null default 'pending'
    check (status in ('pending', 'skipped', 'succeeded', 'failed', 'retrying', 'pending_approval')),
  result jsonb,
  error_text text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, step_index)
);

create index if not exists idx_fwrs_run on public.flow_workflow_run_steps (run_id, step_index);
create index if not exists idx_fwrs_action_key on public.flow_workflow_run_steps (action_key) where action_key is not null;

alter table public.flow_workflow_run_steps enable row level security;

create policy "fwrs_admin_read" on public.flow_workflow_run_steps
  for select using (
    public.get_my_role() in ('owner', 'admin', 'manager')
    and exists (select 1 from public.flow_workflow_runs r
                where r.id = run_id and r.workspace_id = public.get_my_workspace())
  );

create policy "fwrs_service_all" on public.flow_workflow_run_steps
  for all to service_role using (true) with check (true);

-- ── 5. flow_action_idempotency ─────────────────────────────────────────────

create table if not exists public.flow_action_idempotency (
  idempotency_key text primary key,
  workspace_id text not null,
  run_id uuid references public.flow_workflow_runs(id) on delete set null,
  action_key text not null,
  result jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_fai_expires on public.flow_action_idempotency (expires_at);

alter table public.flow_action_idempotency enable row level security;

create policy "fai_service_all" on public.flow_action_idempotency
  for all to service_role using (true) with check (true);

-- ── 6. Extend exception_queue.source for workflow dead letters ─────────────

alter table public.exception_queue drop constraint if exists exception_queue_source_check;
alter table public.exception_queue add constraint exception_queue_source_check
  check (source in (
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
    'data_quality',
    'analytics_alert',
    'workflow_dead_letter'
  ));

-- ── 7. Extend analytics_action_log.action_type for workflow lifecycle ──────

alter table public.analytics_action_log drop constraint if exists analytics_action_log_action_type_check;
alter table public.analytics_action_log add constraint analytics_action_log_action_type_check
  check (action_type in (
    'alert_acknowledge', 'alert_resolve', 'alert_dismiss',
    'export_run', 'packet_generate', 'action_launch',
    'manual_override', 'restricted_drill_open',
    'snapshot_recalculate', 'metric_definition_update',
    'flow_run_start', 'flow_run_complete', 'flow_run_dead_letter',
    'workflow_replay', 'workflow_override',
    'approval_request', 'approval_decision'
  ));

-- ── 8. emit_event SQL function ─────────────────────────────────────────────

create or replace function public.emit_event(
  p_event_type text,
  p_source_module text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_workspace_id text default null,
  p_correlation_id uuid default null,
  p_parent_event_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_workspace text;
begin
  v_workspace := coalesce(p_workspace_id, public.get_my_workspace(), 'default');

  insert into public.analytics_events
    (event_name, source, role, workspace_id, project_id,
     entity_type, entity_id, properties,
     flow_event_type, source_module, correlation_id, parent_event_id)
  values
    (p_event_type, 'edge_function', 'system', v_workspace, 'qep',
     p_entity_type, p_entity_id, p_payload,
     p_event_type, p_source_module, p_correlation_id, p_parent_event_id)
  returning event_id into v_event_id;

  -- Wake the runner async (graceful no-op if no listener attached)
  perform pg_notify('flow_event', v_event_id::text);

  return v_event_id;
end;
$$;

revoke execute on function public.emit_event(text, text, text, text, jsonb, text, uuid, uuid) from public;
grant execute on function public.emit_event(text, text, text, text, jsonb, text, uuid, uuid) to authenticated, service_role;

comment on function public.emit_event is
  'QEP Flow Engine entry point. Inserts a canonical event into analytics_events with flow_event_type set, fires pg_notify(''flow_event'') for sub-cron-tick wakeup. Idempotent at the caller level — caller controls dedupe via correlation_id or upstream natural keys.';

-- ── 9. mark_event_consumed ─────────────────────────────────────────────────

create or replace function public.mark_event_consumed(
  p_event_id uuid,
  p_run_id uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.analytics_events
  set consumed_by_runs = case
    when consumed_by_runs ? p_run_id::text then consumed_by_runs
    else consumed_by_runs || to_jsonb(p_run_id::text)
  end
  where event_id = p_event_id;
$$;

revoke execute on function public.mark_event_consumed(uuid, uuid) from public;
grant execute on function public.mark_event_consumed(uuid, uuid) to service_role;

-- ── 10. enqueue_workflow_dead_letter ───────────────────────────────────────

create or replace function public.enqueue_workflow_dead_letter(
  p_run_id uuid,
  p_workflow_slug text,
  p_reason text,
  p_failed_step text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace text;
  v_exq_id uuid;
begin
  select workspace_id into v_workspace from public.flow_workflow_runs where id = p_run_id;
  v_workspace := coalesce(v_workspace, 'default');

  insert into public.exception_queue
    (source, severity, title, detail, payload, workspace_id)
  values
    ('workflow_dead_letter',
     'error',
     format('Flow workflow %s dead-lettered', p_workflow_slug),
     p_reason,
     p_payload || jsonb_build_object('flow_run_id', p_run_id, 'failed_step', p_failed_step),
     v_workspace)
  returning id into v_exq_id;

  update public.flow_workflow_runs
  set dead_letter_id = v_exq_id,
      status = 'dead_lettered',
      finished_at = now()
  where id = p_run_id;

  return v_exq_id;
end;
$$;

revoke execute on function public.enqueue_workflow_dead_letter(uuid, text, text, text, jsonb) from public;
grant execute on function public.enqueue_workflow_dead_letter(uuid, text, text, text, jsonb) to service_role;

-- ── 11. Trigger seeds: 3 source tables prove the pattern ───────────────────
--
-- Slice 2 adds parts_orders, customer_invoices, service_jobs, rental_returns.
-- Pattern is identical to mig 174 lifecycle triggers.

create or replace function public.flow_emit_from_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'deal.created';
  elsif new.stage_id is distinct from old.stage_id then
    v_event_type := 'deal.stage.changed';
  else
    return new;
  end if;

  perform public.emit_event(
    v_event_type,
    'qrm',
    'crm_deal',
    new.id::text,
    jsonb_build_object(
      'deal_id', new.id,
      'workspace_id', new.workspace_id,
      'amount', new.amount,
      'stage_id', new.stage_id,
      'expected_close_on', new.expected_close_on,
      'company_id', new.company_id,
      'assigned_rep_id', new.assigned_rep_id,
      'closed_at', new.closed_at,
      'old_stage_id', case when tg_op = 'UPDATE' then old.stage_id else null end
    ),
    new.workspace_id
  );
  return new;
end;
$$;

-- Migration 170 turned crm_deals into a compat view; triggers must attach
-- to the underlying qrm_deals table.
drop trigger if exists trg_flow_emit_deal on public.qrm_deals;
create trigger trg_flow_emit_deal
  after insert or update on public.qrm_deals
  for each row execute function public.flow_emit_from_deal();

create or replace function public.flow_emit_from_voice_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'voice.capture.created';
  elsif new.extraction_result is distinct from old.extraction_result and new.extraction_result is not null then
    v_event_type := 'voice.capture.parsed';
  else
    return new;
  end if;

  perform public.emit_event(
    v_event_type,
    'qrm',
    'voice_capture',
    new.id::text,
    jsonb_build_object(
      'voice_capture_id', new.id,
      'workspace_id', new.workspace_id,
      'user_id', new.user_id,
      'extraction_result', new.extraction_result
    ),
    new.workspace_id
  );
  return new;
end;
$$;

drop trigger if exists trg_flow_emit_voice on public.voice_captures;
create trigger trg_flow_emit_voice
  after insert or update on public.voice_captures
  for each row execute function public.flow_emit_from_voice_capture();

create or replace function public.flow_emit_from_quote_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'quote.created';
  elsif new.status is distinct from old.status then
    if new.status = 'sent' then v_event_type := 'quote.sent';
    elsif new.status = 'expired' then v_event_type := 'quote.expired';
    else v_event_type := 'quote.updated';
    end if;
  else
    return new;
  end if;

  perform public.emit_event(
    v_event_type,
    'quotes',
    'quote_package',
    new.id::text,
    jsonb_build_object(
      'quote_id', new.id,
      'workspace_id', new.workspace_id,
      'status', new.status,
      'net_total', new.net_total,
      'expires_at', new.expires_at
    ),
    new.workspace_id
  );
  return new;
end;
$$;

drop trigger if exists trg_flow_emit_quote on public.quote_packages;
create trigger trg_flow_emit_quote
  after insert or update on public.quote_packages
  for each row execute function public.flow_emit_from_quote_package();
