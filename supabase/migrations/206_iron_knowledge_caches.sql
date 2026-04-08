-- ============================================================================
-- Migration 206: Wave 7.1 Iron Companion — knowledge layer caches + top flows
--
-- Adds the storage layer that backs the iron-knowledge edge function:
--
--   • iron_web_search_cache  — 24h cache for Tavily web search results,
--     keyed by (workspace_id, query_hash). Without this every "what's the
--     torque spec on a CAT 320" query would hit Tavily fresh and burn
--     external API quota.
--
--   • iron_oem_doc_cache     — long-lived cache for OEM manual fetches.
--     Same shape as the web cache but with a longer TTL (30 days) and
--     keyed by (oem, model, doc_type).
--
--   • iron_top_flows(p_user_id, p_limit) RPC — read-only ranking of the
--     user's most-used flows derived from iron_memory + iron_flow_runs.
--     Powers the affinity-ranked quick-action list in IronBar.
--
-- All tables use the same workspace + RLS pattern as migration 197/201.
-- ============================================================================

-- ── 1. Web search cache (Tavily) ──────────────────────────────────────────

create table if not exists public.iron_web_search_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  query_hash text not null,
  query_text text not null,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, query_hash)
);

comment on table public.iron_web_search_cache is
  'Wave 7.1 Iron knowledge layer: cached Tavily web search results. 24h TTL enforced in iron-knowledge.';

create index if not exists idx_iron_web_search_cache_lookup
  on public.iron_web_search_cache (workspace_id, query_hash);

create index if not exists idx_iron_web_search_cache_age
  on public.iron_web_search_cache (created_at desc);

alter table public.iron_web_search_cache enable row level security;

create policy iron_web_search_cache_workspace_read on public.iron_web_search_cache for select
  using (workspace_id = public.get_my_workspace());

create policy iron_web_search_cache_service_all on public.iron_web_search_cache for all
  to service_role using (true) with check (true);

-- ── 2. OEM document cache ─────────────────────────────────────────────────

create table if not exists public.iron_oem_doc_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  oem text not null,
  model text not null,
  doc_type text not null check (doc_type in ('spec_sheet', 'service_manual', 'parts_diagram', 'recall_notice', 'other')),
  source_url text not null,
  title text not null,
  content text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (workspace_id, oem, model, doc_type)
);

comment on table public.iron_oem_doc_cache is
  'Wave 7.1 Iron knowledge layer: cached OEM spec sheets and manuals. 30-day TTL.';

create index if not exists idx_iron_oem_doc_cache_lookup
  on public.iron_oem_doc_cache (workspace_id, oem, model);

create index if not exists idx_iron_oem_doc_cache_expiry
  on public.iron_oem_doc_cache (expires_at);

alter table public.iron_oem_doc_cache enable row level security;

create policy iron_oem_doc_cache_workspace_read on public.iron_oem_doc_cache for select
  using (workspace_id = public.get_my_workspace());

create policy iron_oem_doc_cache_service_all on public.iron_oem_doc_cache for all
  to service_role using (true) with check (true);

-- ── 3. Top flows ranking RPC (read-only) ──────────────────────────────────
--
-- Powers the affinity-ranked quick-action list in IronBar. Returns the
-- user's most-used flows over the last 60 days, ranked by execution count
-- weighted by recency. Falls back to an empty result for new users — the
-- UI should layer this on top of the static template registry, never
-- replace it.

create or replace function public.iron_top_flows(
  p_user_id uuid,
  p_limit integer default 6
) returns table (
  flow_slug text,
  execution_count bigint,
  last_used_at timestamptz,
  recency_score numeric
) language plpgsql security definer set search_path = public as $$
begin
  return query
    select
      def.slug as flow_slug,
      count(runs.id) as execution_count,
      max(runs.completed_at) as last_used_at,
      -- Recency-weighted: count divided by days since last use (capped at 60)
      (count(runs.id)::numeric /
        greatest(1, extract(epoch from (now() - max(runs.completed_at))) / 86400)
      )::numeric(10, 4) as recency_score
    from public.flow_workflow_runs runs
    join public.flow_workflow_definitions def on def.id = runs.definition_id
    where runs.attributed_user_id = p_user_id
      and runs.status = 'succeeded'
      and runs.completed_at > now() - interval '60 days'
      and def.surface in ('iron_conversational', 'iron_voice')
    group by def.slug
    order by recency_score desc nulls last
    limit p_limit;
end;
$$;

comment on function public.iron_top_flows(uuid, integer) is
  'Wave 7.1 Iron knowledge layer: ranks the users top flows by recency-weighted execution count. Used by IronBar to pin the most-used quick actions.';

grant execute on function public.iron_top_flows(uuid, integer) to authenticated;
