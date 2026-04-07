-- ============================================================================
-- Migration 197: Wave 7 — Iron Companion foundation (v3 plan)
--
-- Iron is the conversational + voice + UX layer ON TOP of the existing flow
-- engine (migrations 194/195/196). This migration deliberately does NOT
-- create parallel `iron_flow_definitions` / `iron_flow_runs` tables.
-- Instead it:
--   • extends `flow_workflow_definitions` with Iron surface metadata
--   • extends `flow_workflow_runs` with conversation linkage + undo state
--   • adds Iron-specific tables for conversation, settings, cost counters,
--     handoffs to Paperclip (stub), and red-team history
--
-- All workspace columns follow the repo pattern:
--   workspace_id text not null default public.get_my_workspace()
--
-- No FK to a nonexistent `workspaces` table. RLS policies enforce scoping.
-- ============================================================================

-- ── 1. Extend flow_workflow_definitions for Iron surface ──────────────────

alter table public.flow_workflow_definitions
  add column if not exists surface text not null default 'automated'
    check (surface in ('automated', 'iron_conversational', 'iron_voice')),
  add column if not exists iron_metadata jsonb,
  add column if not exists feature_flag text,
  add column if not exists undo_handler text,
  add column if not exists undo_semantic_rule text,
  add column if not exists high_value_threshold_cents integer,
  add column if not exists roles_allowed text[];

comment on column public.flow_workflow_definitions.surface is
  'Wave 7 Iron: which interaction layer this workflow is exposed through. ''automated'' = background event-driven; ''iron_conversational'' = Iron text/UI; ''iron_voice'' = Iron voice + text.';
comment on column public.flow_workflow_definitions.iron_metadata is
  'Wave 7 Iron: slot schema, voice prompts, pre-fill rules. Shape: { slot_schema: [...], voice_prompts: {...}, prefill_from_route: {...} }';
comment on column public.flow_workflow_definitions.undo_handler is
  'Wave 7 Iron: name of the server-side handler in iron-undo-flow-run that knows how to reverse this flow''s effects.';
comment on column public.flow_workflow_definitions.undo_semantic_rule is
  'Wave 7 Iron: SQL fragment evaluated against the resulting entity. While true, undo is allowed even past the 60s wall-clock window. Empty = wall-clock only.';

create index if not exists idx_fwd_iron_surface
  on public.flow_workflow_definitions (surface)
  where surface in ('iron_conversational', 'iron_voice');

-- ── 2. Extend flow_workflow_runs with Iron conversation + undo state ──────

alter table public.flow_workflow_runs
  add column if not exists surface text,
  add column if not exists conversation_id uuid,
  add column if not exists undo_deadline timestamptz,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references auth.users(id),
  add column if not exists attributed_user_id uuid references auth.users(id),
  add column if not exists idempotency_key text;

create index if not exists idx_fwr_iron_undo
  on public.flow_workflow_runs (workspace_id, undo_deadline)
  where undo_deadline is not null and undone_at is null;

create index if not exists idx_fwr_iron_conversation
  on public.flow_workflow_runs (conversation_id)
  where conversation_id is not null;

create unique index if not exists idx_fwr_iron_idempotency
  on public.flow_workflow_runs (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- Allow 'undone' as a terminal status for Iron flows
alter table public.flow_workflow_runs drop constraint if exists flow_workflow_runs_status_check;
alter table public.flow_workflow_runs add constraint flow_workflow_runs_status_check
  check (status in (
    'pending', 'running', 'succeeded', 'partially_succeeded',
    'awaiting_approval', 'failed_retrying', 'dead_lettered',
    'cancelled', 'undone'
  ));

-- ── 3. iron_conversations ─────────────────────────────────────────────────

create table if not exists public.iron_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  input_mode text not null default 'text'
    check (input_mode in ('text', 'voice', 'hybrid')),
  route_at_start text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.iron_conversations is
  'Wave 7 Iron: one row per Iron session with a user. Holds conversation-level metadata; messages live in iron_messages.';

create index if not exists idx_iron_conv_user
  on public.iron_conversations (user_id, started_at desc);
create index if not exists idx_iron_conv_workspace
  on public.iron_conversations (workspace_id, started_at desc);

alter table public.iron_conversations enable row level security;

create policy iron_conv_self_all on public.iron_conversations for all
  using (workspace_id = public.get_my_workspace() and user_id = auth.uid())
  with check (workspace_id = public.get_my_workspace() and user_id = auth.uid());

create policy iron_conv_manager_read on public.iron_conversations for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_conv_service_all on public.iron_conversations for all
  to service_role using (true) with check (true);

-- ── 4. iron_messages ──────────────────────────────────────────────────────

create table if not exists public.iron_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.iron_conversations(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'iron', 'system')),
  content text not null,                                   -- POST-redaction
  classifier_output jsonb,
  flow_run_id uuid references public.flow_workflow_runs(id) on delete set null,
  tokens_in integer,
  tokens_out integer,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

comment on column public.iron_messages.content is
  'Wave 7 Iron: PII-redacted message text. Redaction is applied server-side via the same regex set used by Wave 6.11 Flare (redactPII.ts).';

create index if not exists idx_iron_msg_conv
  on public.iron_messages (conversation_id, created_at);

alter table public.iron_messages enable row level security;

create policy iron_msg_self_read on public.iron_messages for select
  using (
    workspace_id = public.get_my_workspace()
    and exists (
      select 1 from public.iron_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy iron_msg_manager_read on public.iron_messages for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_msg_service_all on public.iron_messages for all
  to service_role using (true) with check (true);

-- ── 5. iron_settings ──────────────────────────────────────────────────────

create table if not exists public.iron_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  iron_role text not null default 'iron_advisor'
    check (iron_role in ('iron_man', 'iron_woman', 'iron_advisor', 'iron_manager')),
  pinned_flows text[] not null default '{}',
  first_run_completed boolean not null default false,
  voice_enabled boolean not null default false,
  sandbox_mode boolean not null default false,
  avatar_corner text not null default 'bottom-right'
    check (avatar_corner in ('top-left', 'top-right', 'bottom-left', 'bottom-right')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_iron_settings_updated_at
  before update on public.iron_settings
  for each row execute function public.set_updated_at();

alter table public.iron_settings enable row level security;

create policy iron_settings_self_all on public.iron_settings for all
  using (workspace_id = public.get_my_workspace() and user_id = auth.uid())
  with check (workspace_id = public.get_my_workspace() and user_id = auth.uid());

create policy iron_settings_manager_read on public.iron_settings for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_settings_service_all on public.iron_settings for all
  to service_role using (true) with check (true);

-- ── 6. iron_usage_counters (per-user-per-day cost ladder) ─────────────────

create table if not exists public.iron_usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  bucket_date date not null default current_date,
  classifications integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  flow_executes integer not null default 0,
  cost_usd_micro bigint not null default 0,
  degradation_state text not null default 'full'
    check (degradation_state in ('full', 'reduced', 'cached', 'escalated')),
  primary key (user_id, bucket_date)
);

create index if not exists idx_iron_usage_workspace_date
  on public.iron_usage_counters (workspace_id, bucket_date desc);

alter table public.iron_usage_counters enable row level security;

create policy iron_usage_self_read on public.iron_usage_counters for select
  using (workspace_id = public.get_my_workspace() and user_id = auth.uid());

create policy iron_usage_manager_read on public.iron_usage_counters for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_usage_service_all on public.iron_usage_counters for all
  to service_role using (true) with check (true);

-- ── 7. iron_handoffs (Paperclip CEO stub) ─────────────────────────────────

create table if not exists public.iron_handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.iron_conversations(id) on delete cascade,
  brief text not null,                                     -- post-redaction
  context jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'in_progress', 'done', 'rejected')),
  assigned_to uuid references auth.users(id) on delete set null,
  result jsonb,
  sentry_trace_id text,                                    -- for distributed tracing when Paperclip lands
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_iron_handoffs_updated_at
  before update on public.iron_handoffs
  for each row execute function public.set_updated_at();

create index if not exists idx_iron_handoffs_workspace_status
  on public.iron_handoffs (workspace_id, status, created_at desc);

alter table public.iron_handoffs enable row level security;

create policy iron_handoffs_self on public.iron_handoffs for all
  using (workspace_id = public.get_my_workspace() and user_id = auth.uid())
  with check (workspace_id = public.get_my_workspace() and user_id = auth.uid());

create policy iron_handoffs_manager_all on public.iron_handoffs for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_handoffs_service_all on public.iron_handoffs for all
  to service_role using (true) with check (true);

-- ── 8. iron_redteam_history (continuous prompt-injection defense) ─────────

create table if not exists public.iron_redteam_history (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  attack_id text not null,
  attack_string text not null,
  classifier_category text,
  flow_id_returned text,
  was_caught boolean not null,
  notes text
);

create index if not exists idx_iron_redteam_ran_at
  on public.iron_redteam_history (ran_at desc);

alter table public.iron_redteam_history enable row level security;

create policy iron_redteam_admin_read on public.iron_redteam_history for select
  using (public.get_my_role() in ('owner', 'admin', 'manager'));

create policy iron_redteam_service_all on public.iron_redteam_history for all
  to service_role using (true) with check (true);

-- ── 9. iron_increment_usage helper RPC ────────────────────────────────────
--
-- Atomic per-user-per-day counter bump. Service role only — called from
-- iron-orchestrator + iron-execute-flow-step after every Anthropic call.

create or replace function public.iron_increment_usage(
  p_user_id uuid,
  p_workspace_id text,
  p_classifications integer default 0,
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_flow_executes integer default 0,
  p_cost_usd_micro bigint default 0
) returns public.iron_usage_counters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.iron_usage_counters;
begin
  insert into public.iron_usage_counters
    (user_id, workspace_id, bucket_date,
     classifications, tokens_in, tokens_out, flow_executes, cost_usd_micro)
  values
    (p_user_id, coalesce(p_workspace_id, 'default'), current_date,
     p_classifications, p_tokens_in, p_tokens_out, p_flow_executes, p_cost_usd_micro)
  on conflict (user_id, bucket_date) do update
    set classifications = public.iron_usage_counters.classifications + excluded.classifications,
        tokens_in = public.iron_usage_counters.tokens_in + excluded.tokens_in,
        tokens_out = public.iron_usage_counters.tokens_out + excluded.tokens_out,
        flow_executes = public.iron_usage_counters.flow_executes + excluded.flow_executes,
        cost_usd_micro = public.iron_usage_counters.cost_usd_micro + excluded.cost_usd_micro
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.iron_increment_usage(uuid, text, integer, integer, integer, integer, bigint) from public;
grant execute on function public.iron_increment_usage(uuid, text, integer, integer, integer, integer, bigint) to service_role;

-- ── 10. iron_set_degradation_state RPC ────────────────────────────────────

create or replace function public.iron_set_degradation_state(
  p_user_id uuid,
  p_state text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state not in ('full', 'reduced', 'cached', 'escalated') then
    raise exception 'iron_set_degradation_state: invalid state %', p_state;
  end if;

  insert into public.iron_usage_counters (user_id, bucket_date, degradation_state)
  values (p_user_id, current_date, p_state)
  on conflict (user_id, bucket_date) do update
    set degradation_state = excluded.degradation_state;
end;
$$;

revoke execute on function public.iron_set_degradation_state(uuid, text) from public;
grant execute on function public.iron_set_degradation_state(uuid, text) to service_role;

-- ── 11. iron_undo_run RPC (writes the undone state, called from edge fn) ──

create or replace function public.iron_mark_run_undone(
  p_run_id uuid,
  p_user_id uuid,
  p_compensation_log jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.flow_workflow_runs
  set status = 'undone',
      undone_at = now(),
      undone_by = p_user_id,
      metadata = metadata || jsonb_build_object('compensation_log', p_compensation_log)
  where id = p_run_id
    and status = 'succeeded'
    and undone_at is null;

  if not found then
    raise exception 'iron_mark_run_undone: run % not eligible (not succeeded or already undone)', p_run_id;
  end if;
end;
$$;

revoke execute on function public.iron_mark_run_undone(uuid, uuid, jsonb) from public;
grant execute on function public.iron_mark_run_undone(uuid, uuid, jsonb) to service_role;

-- ── 12. Workspace-scoped settings for cost caps + thresholds ──────────────
--
-- The repo doesn't have a workspaces table; settings live as columns in
-- workspace_settings (already used by other features). Iron adds its own.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'workspace_settings') then
    create table public.workspace_settings (
      workspace_id text primary key default public.get_my_workspace(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.workspace_settings enable row level security;
    create policy ws_settings_self_read on public.workspace_settings for select
      using (workspace_id = public.get_my_workspace());
    create policy ws_settings_admin_write on public.workspace_settings for all
      using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('owner', 'admin'))
      with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('owner', 'admin'));
    create policy ws_settings_service_all on public.workspace_settings for all
      to service_role using (true) with check (true);
  end if;
end $$;

alter table public.workspace_settings
  add column if not exists iron_user_daily_soft_cap_tokens integer not null default 10000,
  add column if not exists iron_user_daily_hard_cap_tokens integer not null default 20000,
  add column if not exists iron_workspace_monthly_soft_cap_tokens bigint not null default 5000000,
  add column if not exists iron_workspace_monthly_hard_cap_tokens bigint not null default 10000000,
  add column if not exists iron_high_value_threshold_cents integer not null default 2500000,
  add column if not exists iron_escalation_slack_channel text not null default '#qep-iron-health';

-- Seed the default workspace row if missing
insert into public.workspace_settings (workspace_id)
values ('default')
on conflict (workspace_id) do nothing;
