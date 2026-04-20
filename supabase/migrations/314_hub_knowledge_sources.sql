-- ============================================================================
-- Migration 314: Hub — knowledge sources + embedded chunks
--
-- The "Ask the Project Brain" substrate. Mirrors NotebookLM sources (backed
-- by a Google Drive folder the hub-knowledge-sync cron walks every 4h) into
-- Supabase so Claude can answer stakeholder questions with low-latency
-- pgvector retrieval + citations.
--
-- Why mirror vs. live-query NotebookLM:
--   * NotebookLM has no public API. The only production-safe bridge is the
--     Drive folder it imports from. We author markdown into that folder from
--     hub_changelog / hub_decisions; NotebookLM ingests it on its own cadence.
--   * The Supabase mirror gives us sub-second retrieval, citation fidelity,
--     and the same shape as the existing iron_web_search_cache pattern
--     (migration 206) that the codebase already operates.
--
-- Design decisions (locked):
--   * OpenAI text-embedding-3-small — same model used by parts_catalog
--     (migration 268) and CRM embeddings (migration 053). Reuse the existing
--     provider, don't introduce a second dimension.
--   * extensions.vector(1536) + HNSW with vector_cosine_ops + m=16, ef=64
--     (matches migration 268 conventions).
--   * content_hash is the idempotency key: hub-knowledge-sync skips chunking
--     when the Drive file's hash is unchanged.
--   * body_markdown stored on the source row; chunks hold the embedded slices.
--
-- RLS:
--   * Everyone in workspace reads (so Ask-the-Brain works for both stakeholders
--     and internal operators).
--   * Only service role writes (hub-knowledge-sync edge fn).
-- ============================================================================

-- ── 1. hub_knowledge_source ─────────────────────────────────────────────────

create table if not exists public.hub_knowledge_source (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  drive_file_id text,
  notebooklm_notebook_id text,
  notebooklm_source_id text,
  title text not null,
  source_type text not null check (source_type in (
    'transcript', 'document', 'changelog', 'decision', 'email', 'spec', 'roadmap'
  )),
  body_markdown text not null,
  content_hash text not null,
  related_build_item_id uuid references public.hub_build_items(id) on delete set null,
  related_decision_id uuid references public.hub_decisions(id) on delete set null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, drive_file_id),
  unique (workspace_id, notebooklm_source_id)
);

comment on table public.hub_knowledge_source is
  'Stakeholder Build Hub: Supabase mirror of NotebookLM sources (via Drive folder). '
  'Powers /brief/ask ("Ask the Project Brain") with pgvector retrieval + citations.';

comment on column public.hub_knowledge_source.content_hash is
  'SHA-256 of body_markdown. hub-knowledge-sync uses this as the idempotency key '
  'to skip re-chunking unchanged files.';

create index if not exists idx_hub_knowledge_source_workspace
  on public.hub_knowledge_source (workspace_id, source_type)
  where deleted_at is null;

create index if not exists idx_hub_knowledge_source_build_item
  on public.hub_knowledge_source (related_build_item_id)
  where deleted_at is null and related_build_item_id is not null;

create index if not exists idx_hub_knowledge_source_decision
  on public.hub_knowledge_source (related_decision_id)
  where deleted_at is null and related_decision_id is not null;

drop trigger if exists set_hub_knowledge_source_updated_at on public.hub_knowledge_source;
create trigger set_hub_knowledge_source_updated_at
  before update on public.hub_knowledge_source
  for each row execute function public.set_updated_at();

alter table public.hub_knowledge_source enable row level security;

create policy hub_knowledge_source_service_all on public.hub_knowledge_source
  for all to service_role using (true) with check (true);

create policy hub_knowledge_source_workspace_read on public.hub_knowledge_source
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

grant select on public.hub_knowledge_source to authenticated;

-- ── 2. hub_knowledge_chunk (embedded) ───────────────────────────────────────

create table if not exists public.hub_knowledge_chunk (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.hub_knowledge_source(id) on delete cascade,
  workspace_id text not null default public.get_my_workspace(),
  chunk_index integer not null,
  body text not null,
  embedding extensions.vector(1536),
  embedding_model text not null default 'text-embedding-3-small',
  token_count integer,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

comment on table public.hub_knowledge_chunk is
  'Stakeholder Build Hub: embedded chunks of hub_knowledge_source.body_markdown. '
  'Queried by hub-ask-brain via match_hub_knowledge RPC (migration TBD).';

comment on column public.hub_knowledge_chunk.embedding_model is
  'Dimension-resilience: identifies the embedding model. Switching models '
  'becomes a backfill, not a flag day (matches parts_catalog pattern).';

-- HNSW index for cosine similarity search (matches migration 268 convention).
create index if not exists idx_hub_knowledge_chunk_embedding_hnsw
  on public.hub_knowledge_chunk
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_hub_knowledge_chunk_source
  on public.hub_knowledge_chunk (source_id, chunk_index);

create index if not exists idx_hub_knowledge_chunk_workspace
  on public.hub_knowledge_chunk (workspace_id);

alter table public.hub_knowledge_chunk enable row level security;

create policy hub_knowledge_chunk_service_all on public.hub_knowledge_chunk
  for all to service_role using (true) with check (true);

create policy hub_knowledge_chunk_workspace_read on public.hub_knowledge_chunk
  for select
  using (workspace_id = public.get_my_workspace());

grant select on public.hub_knowledge_chunk to authenticated;

-- ── 3. match_hub_knowledge RPC ──────────────────────────────────────────────
-- Cosine-similarity retrieval over hub_knowledge_chunk, joined back to
-- hub_knowledge_source for citation metadata. Consumed by the hub-ask-brain
-- edge function. Workspace isolation enforced inside the function body —
-- callers cannot over-reach.

create or replace function public.match_hub_knowledge(
  p_query_embedding extensions.vector(1536),
  p_workspace text default null,
  p_match_count integer default 8,
  p_min_similarity float default 0.7
)
returns table (
  chunk_id uuid,
  source_id uuid,
  chunk_index integer,
  body text,
  similarity float,
  source_title text,
  source_type text,
  notebooklm_source_id text,
  related_build_item_id uuid,
  related_decision_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  -- Authenticated callers are scoped to their own workspace; service role
  -- can pass an explicit p_workspace.
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  return query
    select
      c.id as chunk_id,
      c.source_id,
      c.chunk_index,
      c.body,
      1 - (c.embedding <=> p_query_embedding) as similarity,
      s.title as source_title,
      s.source_type,
      s.notebooklm_source_id,
      s.related_build_item_id,
      s.related_decision_id
    from public.hub_knowledge_chunk c
    join public.hub_knowledge_source s on s.id = c.source_id
    where c.workspace_id = ws
      and s.deleted_at is null
      and c.embedding is not null
      and (1 - (c.embedding <=> p_query_embedding)) >= p_min_similarity
    order by c.embedding <=> p_query_embedding
    limit greatest(1, least(p_match_count, 50));
end;
$$;

comment on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) is
  'Ask-the-Project-Brain retrieval RPC. Returns top-k cosine-similar chunks '
  'with source citation metadata. Workspace isolation enforced via profiles '
  'lookup — callers cannot over-reach.';

revoke execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) from public;

grant execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) to authenticated, service_role;
