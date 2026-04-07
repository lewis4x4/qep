-- ============================================================================
-- Migration 188: QEP Moonshot Command Center — Alerts + Audit (Slice 1)
--
-- Implements `analytics_alerts` (spec §8) and `analytics_action_log` (spec §9).
--
-- Architectural decision: KPI alerts get their own lifecycle table so they
-- can carry metric attribution (metric_key, business_impact_value, etc.)
-- but the dual-write helper `enqueue_analytics_alert` ALSO inserts blocker
-- severity rows into the existing `exception_queue` so the Wave 6.9
-- Exception Inbox surfaces them with no extra UI. One row, two views.
--
-- Note: this migration extends `exception_queue.source` CHECK to include
-- 'analytics_alert' (drop + readd pattern, idempotent).
-- ============================================================================

-- ── 1. analytics_alerts ─────────────────────────────────────────────────────

create table if not exists public.analytics_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  alert_type text not null,
  metric_key text references public.analytics_metric_definitions(metric_key) on delete set null,
  severity text not null check (severity in ('info', 'warn', 'error', 'critical')),
  title text not null,
  description text,
  role_target text not null default 'ceo' check (role_target in ('ceo', 'cfo', 'coo', 'shared')),
  business_impact_value numeric,
  business_impact_type text,
  entity_type text,
  entity_id uuid,
  branch_id text,
  department_id text,
  owner_user_id uuid references public.profiles(id) on delete set null,
  root_cause_guess text,
  suggested_action text,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'in_progress', 'resolved', 'dismissed')),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  source_record_ids jsonb not null default '[]'::jsonb,
  dedupe_key text,
  exception_queue_id uuid references public.exception_queue(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analytics_alerts is
  'QEP Command Center: KPI-attributed alerts with full lifecycle. Spec §8. Blocker severity rows are dual-written into exception_queue via enqueue_analytics_alert().';

-- Dedupe: a unique partial index on dedupe_key prevents the evaluator from
-- emitting duplicate "still-failing" alerts. Resolved/dismissed rows are
-- exempt so the same condition can re-fire after recovery + regression.
create unique index if not exists uq_aa_dedupe_open
  on public.analytics_alerts(workspace_id, dedupe_key)
  where dedupe_key is not null and status in ('new', 'acknowledged', 'in_progress');

create index if not exists idx_aa_workspace_status
  on public.analytics_alerts(workspace_id, status, severity, created_at desc);
create index if not exists idx_aa_role_target
  on public.analytics_alerts(role_target, status) where status in ('new', 'acknowledged', 'in_progress');
create index if not exists idx_aa_metric_key
  on public.analytics_alerts(metric_key, created_at desc) where metric_key is not null;
create index if not exists idx_aa_metadata_gin
  on public.analytics_alerts using gin (metadata);

create trigger trg_aa_updated_at
  before update on public.analytics_alerts
  for each row execute function public.set_updated_at();

alter table public.analytics_alerts enable row level security;

create policy "aa_owner_read" on public.analytics_alerts
  for select using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "aa_owner_update" on public.analytics_alerts
  for update using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  ) with check (workspace_id = public.get_my_workspace());

create policy "aa_service_all" on public.analytics_alerts
  for all to service_role using (true) with check (true);

-- ── 2. analytics_action_log ─────────────────────────────────────────────────

create table if not exists public.analytics_action_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  user_id uuid references public.profiles(id) on delete set null,
  action_type text not null check (action_type in (
    'alert_acknowledge', 'alert_resolve', 'alert_dismiss',
    'export_run', 'packet_generate', 'action_launch',
    'manual_override', 'restricted_drill_open',
    'snapshot_recalculate', 'metric_definition_update'
  )),
  source_widget text,
  metric_key text,
  alert_id uuid references public.analytics_alerts(id) on delete set null,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.analytics_action_log is
  'QEP Command Center: full audit log for any operator action taken from /exec. Spec §9. Append-only.';

create index if not exists idx_aal_workspace_created
  on public.analytics_action_log(workspace_id, created_at desc);
create index if not exists idx_aal_user
  on public.analytics_action_log(user_id, created_at desc);
create index if not exists idx_aal_action_type
  on public.analytics_action_log(action_type, created_at desc);
create index if not exists idx_aal_metric_key
  on public.analytics_action_log(metric_key, created_at desc) where metric_key is not null;

alter table public.analytics_action_log enable row level security;

create policy "aal_owner_read" on public.analytics_action_log
  for select using (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "aal_owner_insert" on public.analytics_action_log
  for insert with check (
    public.get_my_role() = 'owner'
    and workspace_id = public.get_my_workspace()
  );

create policy "aal_service_all" on public.analytics_action_log
  for all to service_role using (true) with check (true);

-- ── 3. Extend exception_queue.source CHECK to include analytics_alert ──────
--
-- Idempotent drop+readd. The new value lets enqueue_analytics_alert dual-write
-- blockers into the existing Wave 6.9 inbox.

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
    'analytics_alert'
  ));

-- ── 4. enqueue_analytics_alert helper ───────────────────────────────────────
--
-- Single entry point for the alert evaluator. Handles dedupe, dual-write,
-- and links the analytics_alerts.id <-> exception_queue.id pair.

create or replace function public.enqueue_analytics_alert(
  p_alert_type text,
  p_metric_key text,
  p_severity text,
  p_title text,
  p_description text default null,
  p_role_target text default 'ceo',
  p_business_impact_value numeric default null,
  p_business_impact_type text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_branch_id text default null,
  p_root_cause_guess text default null,
  p_suggested_action text default null,
  p_source_record_ids jsonb default '[]'::jsonb,
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_exception_id uuid;
  v_workspace text;
begin
  v_workspace := public.get_my_workspace();

  -- Dedupe check: existing open row with the same dedupe_key short-circuits
  if p_dedupe_key is not null then
    select id into v_alert_id
    from public.analytics_alerts
    where workspace_id = v_workspace
      and dedupe_key = p_dedupe_key
      and status in ('new', 'acknowledged', 'in_progress')
    limit 1;
    if v_alert_id is not null then
      -- Refresh updated_at + bump source_record_ids to track recurrence
      update public.analytics_alerts
      set updated_at = now(),
          source_record_ids = case
            when source_record_ids ? p_source_record_ids::text then source_record_ids
            else source_record_ids || p_source_record_ids
          end
      where id = v_alert_id;
      return v_alert_id;
    end if;
  end if;

  -- Dual-write to exception_queue for blocker/critical so the existing
  -- /exceptions inbox surfaces this with no extra UI.
  if p_severity in ('error', 'critical') then
    insert into public.exception_queue
      (source, severity, title, detail, payload, workspace_id)
    values
      ('analytics_alert',
       p_severity,
       p_title,
       p_description,
       jsonb_build_object(
         'metric_key', p_metric_key,
         'role_target', p_role_target,
         'business_impact_value', p_business_impact_value,
         'business_impact_type', p_business_impact_type,
         'source_record_ids', p_source_record_ids,
         'dedupe_key', p_dedupe_key
       ),
       v_workspace)
    returning id into v_exception_id;
  end if;

  insert into public.analytics_alerts
    (workspace_id, alert_type, metric_key, severity, title, description,
     role_target, business_impact_value, business_impact_type,
     entity_type, entity_id, branch_id, root_cause_guess, suggested_action,
     source_record_ids, dedupe_key, exception_queue_id, metadata)
  values
    (v_workspace, p_alert_type, p_metric_key, p_severity, p_title, p_description,
     p_role_target, p_business_impact_value, p_business_impact_type,
     p_entity_type, p_entity_id, p_branch_id, p_root_cause_guess, p_suggested_action,
     p_source_record_ids, p_dedupe_key, v_exception_id, p_metadata)
  returning id into v_alert_id;

  return v_alert_id;
end;
$$;

comment on function public.enqueue_analytics_alert is
  'QEP Command Center alert evaluator entry point. Dedupes on dedupe_key, dual-writes blockers into exception_queue, returns the analytics_alerts.id.';

revoke execute on function public.enqueue_analytics_alert from public;
grant execute on function public.enqueue_analytics_alert to service_role;

-- ── 5. log_analytics_action helper (audit log shorthand) ───────────────────

create or replace function public.log_analytics_action(
  p_action_type text,
  p_source_widget text default null,
  p_metric_key text default null,
  p_alert_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into public.analytics_action_log
    (user_id, action_type, source_widget, metric_key, alert_id,
     entity_type, entity_id, before_state, after_state, metadata)
  values
    (auth.uid(), p_action_type, p_source_widget, p_metric_key, p_alert_id,
     p_entity_type, p_entity_id, p_before_state, p_after_state, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_analytics_action is
  'Append a row to analytics_action_log. Owner-only via RLS on the table.';

revoke execute on function public.log_analytics_action from public;
grant execute on function public.log_analytics_action to authenticated, service_role;
