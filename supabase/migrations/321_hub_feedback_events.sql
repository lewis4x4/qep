-- ============================================================================
-- Migration 321: Hub — Build Hub v2.1 submitter loop-back
--
-- Turns hub_feedback from a submission pipe into a conversation.
--
-- Adds:
--   1. `hub_feedback_events` — immutable ledger of every state transition
--      and admin note on a feedback item. Drives the FeedbackTimeline UI,
--      the NotificationBell unseen-count, and the hub-feedback-notify email
--      queue.
--   2. `hub_feedback.last_seen_events_at` — per-row bookmark for the
--      submitter's bell. NULL = "never seen"; an event is "unseen" when
--      event.created_at > feedback.last_seen_events_at.
--   3. Trigger `hub_feedback_emit_event` — after every INSERT/UPDATE on
--      hub_feedback, write a row into hub_feedback_events for the
--      transition. Derives event_type from old.status → new.status.
--
-- Design decisions (locked):
--   * Events are write-once. No updates except `notified_submitter_at`
--     (stamped by hub-feedback-notify). No deletes.
--   * Soft-delete on hub_feedback cascades via 320's soft-cascade pattern?
--     No — events are a ledger; we preserve them even when parent is
--     soft-deleted. The read policy simply stops returning them via the
--     standard API because they join through hub_feedback.
--   * Events table has its own RLS: submitter sees events on their own
--     rows; internal admin/owner sees all events in workspace.
--   * Actor is captured as a bare UUID + a denormalized role string
--     ("service", "admin", "owner", "manager", "rep", "client_stakeholder").
--     The role string lets the UI say "Brian (admin) marked this
--     drafting_started" without re-joining profiles.
--   * Zero-blocking: if auth.uid() is NULL at trigger time (service-role
--     writes from edge fns), actor_id is NULL and actor_role is 'service'.
--
-- RLS:
--   * hub_feedback_events read: submitter-on-own OR workspace-internal-admin.
--   * No direct inserts from clients — only the trigger + service role.
--
-- Reversal: schema changes are additive. Disabling V2.1 = feature-flag off
--   in app; no column drops, no constraint tightening.
-- ============================================================================

-- ── 1. hub_feedback.last_seen_events_at ────────────────────────────────────

alter table public.hub_feedback
  add column if not exists last_seen_events_at timestamptz;

comment on column public.hub_feedback.last_seen_events_at is
  'Submitter bookmark for Build Hub notification bell. An event with '
  'created_at > this value is considered unseen. Stamped client-side via '
  'markFeedbackEventsSeen() in brief-api.ts.';

-- ── 2. hub_feedback_events table ───────────────────────────────────────────

create table if not exists public.hub_feedback_events (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.hub_feedback(id) on delete cascade,
  workspace_id text not null,
  event_type text not null check (event_type in (
    'submitted',
    'triaged',
    'drafting_started',
    'pr_opened',
    'awaiting_merge',
    'merged',
    'shipped',
    'wont_fix',
    'reopened',
    'admin_note'
  )),
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null default 'service',
  payload jsonb not null default '{}'::jsonb,
  notified_submitter_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.hub_feedback_events is
  'Build Hub v2.1: append-only ledger of state transitions on hub_feedback. '
  'Drives FeedbackTimeline UI, NotificationBell, and hub-feedback-notify email loop.';

comment on column public.hub_feedback_events.event_type is
  'Derived from status transition by the hub_feedback_emit_event trigger. '
  'admin_note is reserved for out-of-band admin commentary (not yet emitted).';

comment on column public.hub_feedback_events.notified_submitter_at is
  'Stamped by hub-feedback-notify after a Resend email ships. NULL = not '
  'yet notified; the notify cron retries NULL rows on its 1-minute tick.';

-- Primary access pattern: list events for a feedback row, newest first.
create index if not exists idx_hub_feedback_events_feedback
  on public.hub_feedback_events (feedback_id, created_at desc);

-- Notify cron scan: find unsent events for the submitter across a workspace.
create index if not exists idx_hub_feedback_events_unsent
  on public.hub_feedback_events (workspace_id, created_at)
  where notified_submitter_at is null;

-- Bell unseen-count: workspace + time filter, joined against
-- hub_feedback.submitted_by.
create index if not exists idx_hub_feedback_events_workspace_created
  on public.hub_feedback_events (workspace_id, created_at desc);

alter table public.hub_feedback_events enable row level security;

create policy hub_feedback_events_service_all on public.hub_feedback_events
  for all to service_role using (true) with check (true);

-- Read: workspace-scoped. Submitter sees events on their own feedback;
-- internal admin/owner/manager sees everything in the workspace.
create policy hub_feedback_events_read on public.hub_feedback_events
  for select
  using (
    workspace_id = public.get_my_workspace()
    and (
      public.get_my_audience() = 'internal'
      or exists (
        select 1 from public.hub_feedback f
        where f.id = hub_feedback_events.feedback_id
          and f.submitted_by = auth.uid()
          and f.deleted_at is null
      )
    )
  );

-- No client inserts. Trigger + service role only.
create policy hub_feedback_events_no_client_insert on public.hub_feedback_events
  for insert
  with check (false);

grant select on public.hub_feedback_events to authenticated;

-- ── 3. Event-emitting trigger ──────────────────────────────────────────────

create or replace function public.hub_feedback_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_payload jsonb := '{}'::jsonb;
begin
  -- Derive event type from the status transition. An INSERT emits
  -- 'submitted' unconditionally; an UPDATE emits only when status changed
  -- to a tracked value.
  if TG_OP = 'INSERT' then
    v_event_type := 'submitted';
  elsif TG_OP = 'UPDATE' then
    -- Soft-delete flip is not an event.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      return NEW;
    end if;

    -- No status change → nothing to log. Admin-note events arrive via
    -- explicit service-role inserts, not this trigger.
    if OLD.status is not distinct from NEW.status then
      return NEW;
    end if;

    v_event_type := case NEW.status
      when 'triaged' then 'triaged'
      when 'drafting' then 'drafting_started'
      when 'awaiting_merge' then
        case when NEW.claude_pr_url is not null and OLD.claude_pr_url is null
          then 'pr_opened'
          else 'awaiting_merge'
        end
      when 'shipped' then 'shipped'
      when 'wont_fix' then 'wont_fix'
      when 'open' then
        case when OLD.status in ('shipped', 'wont_fix')
          then 'reopened'
          else null
        end
      else null
    end;

    if v_event_type is null then
      return NEW;
    end if;
  else
    return NEW;
  end if;

  -- Denormalized actor role. Service-role writes (no auth.uid()) record as
  -- 'service' so the UI doesn't render "unknown" for system transitions.
  if v_actor_id is null then
    v_actor_role := 'service';
  else
    select coalesce(role, 'service')
      into v_actor_role
      from public.profiles
      where id = v_actor_id;
    if v_actor_role is null then
      v_actor_role := 'service';
    end if;
  end if;

  -- Payload captures the delta fields the UI and the notify fn need.
  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'claude_pr_url', NEW.claude_pr_url,
      'claude_branch_name', NEW.claude_branch_name,
      'priority', NEW.priority,
      'feedback_type', NEW.feedback_type,
      'ai_summary', NEW.ai_summary,
      'ai_suggested_action', NEW.ai_suggested_action,
      'resolved_at', NEW.resolved_at
    )
  );

  insert into public.hub_feedback_events (
    feedback_id,
    workspace_id,
    event_type,
    from_status,
    to_status,
    actor_id,
    actor_role,
    payload
  )
  values (
    NEW.id,
    NEW.workspace_id,
    v_event_type,
    case when TG_OP = 'UPDATE' then OLD.status else null end,
    NEW.status,
    v_actor_id,
    v_actor_role,
    v_payload
  );

  return NEW;
end;
$$;

comment on function public.hub_feedback_emit_event() is
  'Build Hub v2.1: emits hub_feedback_events rows on status transitions. '
  'Derives event_type from OLD.status → NEW.status mapping. Service-role '
  'writes (auth.uid() IS NULL) record actor_role = "service".';

drop trigger if exists hub_feedback_emit_event on public.hub_feedback;
create trigger hub_feedback_emit_event
  after insert or update on public.hub_feedback
  for each row execute function public.hub_feedback_emit_event();

-- ── 4. Mark-seen RPC for stakeholders ──────────────────────────────────────
--
-- The submitter-facing bell needs to stamp last_seen_events_at = now() on
-- their own rows. hub_feedback_admin_update is internal-only — stakeholders
-- cannot update rows directly. Rather than loosen that policy or introduce
-- a one-purpose edge function, expose a SECURITY DEFINER RPC that validates
-- auth.uid() internally and updates only the bookmark column.

create or replace function public.hub_feedback_mark_seen()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    return 0;
  end if;

  update public.hub_feedback
    set last_seen_events_at = now()
    where submitted_by = v_uid
      and deleted_at is null;

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;

comment on function public.hub_feedback_mark_seen() is
  'Build Hub v2.1: stamps last_seen_events_at = now() on every hub_feedback '
  'row owned by the caller. Called by the NotificationBell click handler. '
  'SECURITY DEFINER to bypass the internal-only hub_feedback_admin_update '
  'policy; validates auth.uid() inline so stakeholders can only stamp their '
  'own rows.';

revoke all on function public.hub_feedback_mark_seen() from public;
grant execute on function public.hub_feedback_mark_seen() to authenticated;

-- ── 5. Backfill for existing rows ───────────────────────────────────────────
--
-- Rows that predate this migration never fired the trigger. Seed them with
-- a single 'submitted' event at created_at so their timelines aren't empty
-- and the bell math works. Status-based synthetic events are not backfilled
-- (we don't know the actual transition timestamps); only the submission.

insert into public.hub_feedback_events (
  feedback_id,
  workspace_id,
  event_type,
  from_status,
  to_status,
  actor_id,
  actor_role,
  payload,
  created_at
)
select
  f.id,
  f.workspace_id,
  'submitted',
  null,
  'open',
  f.submitted_by,
  coalesce((select role from public.profiles where id = f.submitted_by), 'service'),
  jsonb_strip_nulls(jsonb_build_object(
    'ai_summary', f.ai_summary,
    'feedback_type', f.feedback_type,
    'priority', f.priority,
    'backfilled', true
  )),
  f.created_at
from public.hub_feedback f
where f.deleted_at is null
  and not exists (
    select 1 from public.hub_feedback_events e
    where e.feedback_id = f.id and e.event_type = 'submitted'
  );
