-- ============================================================================
-- Migration 325: Hub — Build Hub v2.4 semantic dedup for feedback
--
-- Four stakeholders each filing "the save button doesn't work on
-- /qrm/quotes/new" shouldn't produce four separate inbox cards. But we
-- *also* can't collapse them — Angela's loop-back notification, timeline,
-- and "Ryan built X for you" ledger all depend on her row existing with
-- her name on it.
--
-- So dedup links, not dedup merges:
--   1. `hub_feedback.embedding vector(1536)` — written by the intake edge
--      fn at insert time via openai text-embedding-3-small (same model
--      the rest of the hub corpus uses — do NOT introduce a second model,
--      dimension resilience depends on single-source).
--   2. `hub_feedback_links` junction table — directed edges from
--      primary → duplicate, with a similarity score.
--   3. `match_hub_feedback_dedup` RPC — called by the intake edge fn
--      BEFORE insert to find the nearest in-flight row in the caller's
--      workspace.
--
-- When a link is created: both rows stay (so both submitters keep their
-- loop-back), but the admin inbox gets a "+N linked submissions" chip
-- on the primary card so Brian sees signal instead of noise.
--
-- Additive only — no existing constraints tightened. Intake falls back
-- to the old no-dedup path when OPENAI_API_KEY is missing.
-- ============================================================================

-- ── 1. hub_feedback.embedding ────────────────────────────────────────────────

alter table public.hub_feedback
  add column if not exists embedding extensions.vector(1536);

comment on column public.hub_feedback.embedding is
  'Build Hub v2.4: text-embedding-3-small vector of body + ai_summary. '
  'Used by match_hub_feedback_dedup RPC to detect near-duplicate submissions '
  'at intake time. NULL when OPENAI_API_KEY was unset — a follow-up backfill '
  'run can populate retroactively.';

-- HNSW index tuned for small-to-medium row counts (< 100k feedback rows
-- expected for years). m=16 ef=64 matches migration 314's chunk index.
create index if not exists idx_hub_feedback_embedding_hnsw
  on public.hub_feedback
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null
    and deleted_at is null;

-- ── 2. hub_feedback_links ────────────────────────────────────────────────────
--
-- Directed edge: the *primary* is the oldest / earliest-triaged row in
-- the cluster; every subsequent near-duplicate is a secondary pointing
-- at that primary. We store the forward edge only; the reverse is
-- derivable via a join on (duplicate_id = :id).

create table if not exists public.hub_feedback_links (
  primary_id uuid not null references public.hub_feedback(id) on delete cascade,
  duplicate_id uuid not null references public.hub_feedback(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  similarity float not null check (similarity > 0 and similarity <= 1),
  link_reason text not null default 'semantic_dup'
    check (link_reason in ('semantic_dup', 'manual_merge', 'admin_link')),
  created_at timestamptz not null default now(),
  primary key (primary_id, duplicate_id),
  check (primary_id <> duplicate_id)
);

comment on table public.hub_feedback_links is
  'Build Hub v2.4: directed edges between near-duplicate hub_feedback '
  'rows. primary_id is the canonical row the cluster roots at; '
  'duplicate_id is a later submission that matched it semantically. '
  'Both rows remain live so each submitter keeps their loop-back.';

create index if not exists idx_hub_feedback_links_primary
  on public.hub_feedback_links (primary_id);
create index if not exists idx_hub_feedback_links_duplicate
  on public.hub_feedback_links (duplicate_id);
create index if not exists idx_hub_feedback_links_workspace
  on public.hub_feedback_links (workspace_id, created_at desc);

alter table public.hub_feedback_links enable row level security;

-- Read: anyone who can read either side of the link can read the link.
-- This piggybacks on the existing hub_feedback RLS — no new policy
-- logic to maintain.
drop policy if exists "hub_feedback_links_read" on public.hub_feedback_links;
create policy "hub_feedback_links_read" on public.hub_feedback_links
  for select to authenticated
  using (
    exists (
      select 1 from public.hub_feedback f
      where f.id = hub_feedback_links.primary_id
    )
    or exists (
      select 1 from public.hub_feedback f
      where f.id = hub_feedback_links.duplicate_id
    )
  );

-- Write: service role + internal admin/owner/manager only. Stakeholders
-- cannot hand-link their own rows. The intake edge fn writes as service.
drop policy if exists "hub_feedback_links_service" on public.hub_feedback_links;
create policy "hub_feedback_links_service" on public.hub_feedback_links
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "hub_feedback_links_admin_write" on public.hub_feedback_links;
create policy "hub_feedback_links_admin_write" on public.hub_feedback_links
  for all to authenticated
  using (
    public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

grant select on public.hub_feedback_links to authenticated;

-- ── 3. match_hub_feedback_dedup RPC ──────────────────────────────────────────
--
-- Find the nearest in-flight feedback row in the caller's workspace.
-- Restricted to:
--   - status NOT IN ('shipped', 'wont_fix') — terminal rows aren't dedup
--     candidates; the new submission is signal, not duplicate noise.
--   - age ≤ p_max_age_days (default 45) — older rows have had their shot
--     at triage; very old matches are probably re-raised issues that
--     deserve their own card.
--   - exclude p_exclude_id so the RPC doesn't match a row against
--     itself during backfill.

create or replace function public.match_hub_feedback_dedup(
  p_query_embedding extensions.vector(1536),
  p_exclude_id uuid default null,
  p_min_similarity float default 0.85,
  p_max_age_days integer default 45,
  p_match_count integer default 3
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
  -- Mirror migration 314's workspace isolation — callers cannot over-reach.
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
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
  extensions.vector(1536), uuid, float, integer, integer
) is
  'Build Hub v2.4 dedup RPC. Returns top-k in-flight hub_feedback rows '
  'semantically similar to the query embedding, workspace-scoped. Called '
  'by hub-feedback-intake before insert — matches above threshold become '
  'hub_feedback_links edges rather than new inbox cards.';

revoke execute on function public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer
) from public;

grant execute on function public.match_hub_feedback_dedup(
  extensions.vector(1536), uuid, float, integer, integer
) to authenticated, service_role;

-- ── 4. Allow 'duplicate_linked' event type ───────────────────────────────────
--
-- Extend the hub_feedback_events check constraint so the intake fn can
-- emit a first-class timeline event when a new submission links onto an
-- existing cluster. The constraint was declared inline in migration 321.

alter table public.hub_feedback_events
  drop constraint if exists hub_feedback_events_event_type_check;

alter table public.hub_feedback_events
  add constraint hub_feedback_events_event_type_check
  check (event_type in (
    'submitted', 'triaged', 'drafting_started', 'pr_opened',
    'awaiting_merge', 'merged', 'shipped', 'wont_fix', 'reopened',
    'admin_note', 'duplicate_linked'
  ));
