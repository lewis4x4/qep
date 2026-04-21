-- ============================================================================
-- Migration 336: Hub — P2 follow-ups from the 2026-04-20 audit sweep.
-- (Renumbered from 335 after the document-center foundation PR landed at 335.)
--
-- Four hardening moves, all additive / idempotent. None of these are live
-- exploits today — they're defense-in-depth for the day a second workspace
-- lands and the day admin-note paths start writing events directly.
--
--   1. hub_feedback_events.workspace_id: keep it in sync with parent
--      hub_feedback.workspace_id via BEFORE-trigger. Until now the intake
--      trigger passes NEW.workspace_id through from the parent, which is
--      fine today (single event source) but drifts the moment a service
--      path inserts an admin_note event and forgets to denormalize.
--
--   2. match_hub_feedback_dedup: accept an optional p_workspace argument
--      honoured by service-role callers. Prior signature hardcoded
--      'default' when auth.uid() IS NULL, which silently broke multi-
--      tenant dedup the instant a second workspace shipped.
--
--   3. hub_feedback_links_read policy: add outer workspace_id filter so
--      Postgres picks up idx_hub_feedback_links_workspace directly
--      instead of double-EXISTS-joining through hub_feedback.
--
--   4. hub_changelog soft-cascade: mirror migration 320's pattern so a
--      soft-deleted hub_feedback or hub_build_items takes its changelog
--      rows with it, instead of leaving orphan "shipped" entries visible
--      in the stakeholder feed.
--
--   5. hub_feedback_events.notify_claimed_at: separate "claimed by a
--      worker" from "successfully notified" so two overlapping cron ticks
--      can't both send the same email. notified_submitter_at still stamps
--      only on successful send, preserving the transient-retry behavior
--      from the audit-fix commit.
--
-- Reversal: every statement is DROP-IF-EXISTS + CREATE OR REPLACE, so
--   re-running is safe. No data migrations.
-- ============================================================================

-- ── 1. hub_feedback_events.workspace_id integrity trigger ──────────────────

create or replace function public.hub_feedback_events_sync_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_workspace text;
begin
  -- Pull the authoritative workspace from the parent row. If the parent
  -- disappeared between event-payload construction and trigger fire,
  -- leave NEW.workspace_id as-passed; RLS on hub_feedback_events will
  -- still require it to match get_my_workspace() on read anyway.
  select workspace_id
    into v_parent_workspace
    from public.hub_feedback
    where id = NEW.feedback_id;

  if v_parent_workspace is not null then
    NEW.workspace_id := v_parent_workspace;
  end if;

  return NEW;
end;
$$;

comment on function public.hub_feedback_events_sync_workspace() is
  'Keeps hub_feedback_events.workspace_id denormalized correctly from the '
  'parent hub_feedback row. Prevents drift when admin-note paths insert '
  'events directly via service role without re-reading the parent.';

drop trigger if exists hub_feedback_events_sync_workspace on public.hub_feedback_events;
create trigger hub_feedback_events_sync_workspace
  before insert or update of feedback_id on public.hub_feedback_events
  for each row execute function public.hub_feedback_events_sync_workspace();


-- ── 2. match_hub_feedback_dedup: honour explicit p_workspace ───────────────

-- Drop the old signature before recreating with an added argument so we
-- don't leave two callable variants in the catalog.
drop function if exists public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer
);

create or replace function public.match_hub_feedback_dedup(
  p_query_embedding extensions.vector(1536),
  p_exclude_id uuid default null,
  p_min_similarity float default 0.85,
  p_max_age_days integer default 45,
  p_match_count integer default 3,
  p_workspace text default null
)
returns table (
  feedback_id uuid,
  submitted_by uuid,
  body text,
  ai_summary text,
  status text,
  priority text,
  similarity float,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  -- Resolution order:
  --   1. authenticated caller → their own workspace (ignores p_workspace
  --      so stakeholders can't widen their own view).
  --   2. service role + p_workspace passed → that workspace (the intake
  --      edge fn is expected to pass auth.workspaceId here).
  --   3. service role + no p_workspace → 'default' (legacy fallback for
  --      any caller that hasn't been updated yet).
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  elsif p_workspace is not null and length(p_workspace) > 0 then
    ws := p_workspace;
  else
    ws := 'default';
  end if;

  return query
    select
      f.id as feedback_id,
      f.submitted_by,
      f.body,
      f.ai_summary,
      f.status::text,
      f.priority::text,
      1 - (f.embedding <=> p_query_embedding) as similarity,
      f.created_at
    from public.hub_feedback f
    where f.workspace_id = ws
      and f.deleted_at is null
      and f.embedding is not null
      and f.status not in ('shipped', 'wont_fix')
      and f.created_at >= now() - make_interval(days => greatest(1, p_max_age_days))
      and (p_exclude_id is null or f.id <> p_exclude_id)
      and (1 - (f.embedding <=> p_query_embedding)) >= p_min_similarity
    order by f.embedding <=> p_query_embedding
    limit greatest(1, least(p_match_count, 10));
end;
$$;

comment on function public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer, text
) is
  'Build Hub v2.4 dedup RPC. Workspace resolution: authenticated callers '
  'use profiles.active_workspace_id; service-role callers pass p_workspace '
  'explicitly (was hardcoded to "default" in migration 325, which broke '
  'multi-tenant dedup silently).';

revoke execute on function public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer, text
) from public;

grant execute on function public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer, text
) to authenticated, service_role;


-- ── 3. hub_feedback_links_read: outer workspace short-circuit ──────────────

drop policy if exists "hub_feedback_links_read" on public.hub_feedback_links;
create policy "hub_feedback_links_read" on public.hub_feedback_links
  for select to authenticated
  using (
    workspace_id = public.get_my_workspace()
    and (
      exists (
        select 1 from public.hub_feedback f
        where f.id = hub_feedback_links.primary_id
      )
      or exists (
        select 1 from public.hub_feedback f
        where f.id = hub_feedback_links.duplicate_id
      )
    )
  );

comment on policy "hub_feedback_links_read" on public.hub_feedback_links is
  'Workspace-gated link read. Outer workspace check lets Postgres hit '
  'idx_hub_feedback_links_workspace before the nested hub_feedback lookups.';


-- ── 4. hub_changelog soft-cascade ──────────────────────────────────────────
--
-- When a hub_feedback or hub_build_items row flips to soft-deleted, any
-- hub_changelog entries pointing at it should disappear from the
-- stakeholder feed too. Left unresolved, the feed keeps showing "your
-- fix shipped" cards after the underlying item was retracted.

create or replace function public.hub_cascade_soft_delete_changelog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only fire on soft-delete transition (NULL → NOT NULL). Skip re-deletes
  -- and undeletes.
  if OLD.deleted_at is not null or NEW.deleted_at is null then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'hub_feedback' then
    update public.hub_changelog
      set deleted_at = NEW.deleted_at
      where feedback_id = NEW.id
        and deleted_at is null;
  elsif TG_TABLE_NAME = 'hub_build_items' then
    update public.hub_changelog
      set deleted_at = NEW.deleted_at
      where build_item_id = NEW.id
        and deleted_at is null;
  end if;

  return NEW;
end;
$$;

comment on function public.hub_cascade_soft_delete_changelog() is
  'Cascades soft-delete from hub_feedback or hub_build_items onto matching '
  'hub_changelog rows. Separate from hub_cascade_soft_delete_comments so '
  'the two cascades evolve independently.';

drop trigger if exists hub_feedback_soft_cascade_changelog on public.hub_feedback;
create trigger hub_feedback_soft_cascade_changelog
  after update on public.hub_feedback
  for each row execute function public.hub_cascade_soft_delete_changelog();

drop trigger if exists hub_build_items_soft_cascade_changelog on public.hub_build_items;
create trigger hub_build_items_soft_cascade_changelog
  after update on public.hub_build_items
  for each row execute function public.hub_cascade_soft_delete_changelog();


-- ── 5. hub_feedback_events claim lock (prevents duplicate notify sends) ────

alter table public.hub_feedback_events
  add column if not exists notify_claimed_at timestamptz;

comment on column public.hub_feedback_events.notify_claimed_at is
  'Cooperative lock stamped by hub_feedback_events_claim() when a notify '
  'worker picks up an event. Cleared by claim_release() on transient send '
  'failure so the next cron tick retries. Separate from '
  'notified_submitter_at (which stamps only on confirmed send) so the '
  'two semantics (claimed vs sent) don''t collide.';

-- Partial index for the "claim me" scan — rows with no notify and either
-- never claimed or with a stale claim (> lease seconds ago).
create index if not exists idx_hub_feedback_events_claimable
  on public.hub_feedback_events (created_at)
  where notified_submitter_at is null;

-- Atomic claim: returns the row if we won the race, nothing otherwise.
-- Lease defaults to 2 minutes — longer than any reasonable Resend round-
-- trip, short enough that a dead isolate's claim evaporates before the
-- next cron tick at 1-minute cadence.
create or replace function public.hub_feedback_events_claim(
  p_event_id uuid,
  p_lease_seconds integer default 120
)
returns table (claimed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.hub_feedback_events
    set notify_claimed_at = now()
    where id = p_event_id
      and notified_submitter_at is null
      and (
        notify_claimed_at is null
        or notify_claimed_at < now() - make_interval(secs => greatest(1, p_lease_seconds))
      );
  get diagnostics v_rows = row_count;
  return query select v_rows = 1;
end;
$$;

comment on function public.hub_feedback_events_claim(uuid, integer) is
  'Atomically claim a notify event. Returns {claimed: true} if we won '
  'the race, {claimed: false} if another worker already owns it or the '
  'event has been notified. Caller must stamp notified_submitter_at on '
  'successful send, or call hub_feedback_events_release_claim on '
  'transient failure so the next tick retries.';

revoke all on function public.hub_feedback_events_claim(uuid, integer) from public;
grant execute on function public.hub_feedback_events_claim(uuid, integer) to service_role;

-- Release a claim on transient send failure so the next tick can retry.
-- Guarded to only clear rows that are still unsent — releasing after a
-- successful stamp would be a no-op, but guarding keeps the intent clear.
create or replace function public.hub_feedback_events_release_claim(
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hub_feedback_events
    set notify_claimed_at = null
    where id = p_event_id
      and notified_submitter_at is null;
end;
$$;

comment on function public.hub_feedback_events_release_claim(uuid) is
  'Release a previously held claim so the next cron tick can retry. '
  'Only clears rows that haven''t been successfully notified yet.';

revoke all on function public.hub_feedback_events_release_claim(uuid) from public;
grant execute on function public.hub_feedback_events_release_claim(uuid) to service_role;
