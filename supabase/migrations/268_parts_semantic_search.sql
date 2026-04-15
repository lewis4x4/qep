-- ============================================================================
-- Migration 268: Natural-Language Parts Search (Slice 3.1)
--
-- Adds semantic search on parts_catalog on top of the existing FTS layer.
--
-- Design principles (validated by plan review):
--   * Mirror the crm_embeddings pattern (migration 053) — simpler than the
--     document-chunk RPCs because parts are flat rows, no chunking.
--   * Single hybrid RPC combines semantic + FTS in one SQL round-trip with
--     per-result-set FTS normalization.
--   * SQL trigger invalidates embedding when signal columns change;
--     pg_cron calls parts-embed-backfill edge function every 5 min to compute.
--   * Filter pushdown (manufacturer, category) — not post-filter.
--   * Dimension-resilience via embedding_model column.
-- ============================================================================

-- ── Extend parts_catalog with embedding fields ─────────────────────────────

alter table public.parts_catalog
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedding_text text,
  add column if not exists embedding_model text default 'text-embedding-3-small',
  add column if not exists embedding_computed_at timestamptz;

comment on column public.parts_catalog.embedding is
  'OpenAI text-embedding-3-small vector of the composed embedding_text. '
  'NULL when stale — see v_parts_embedding_backlog + parts-embed-backfill edge function.';
comment on column public.parts_catalog.embedding_text is
  'Composed input that was fed to the embedding model. Stored for debugging + '
  'replay when model version changes.';
comment on column public.parts_catalog.embedding_model is
  'Dimension-resilience: identifies which model produced the vector. Switching '
  'models becomes a backfill, not a flag day.';

-- ── Extend counter_inquiries with match_type (no enum change) ──────────────

alter table public.counter_inquiries
  add column if not exists match_type text
    check (match_type is null or match_type in ('exact', 'semantic', 'fts', 'hybrid'));

comment on column public.counter_inquiries.match_type is
  'How the result was matched: exact (part number / cross-ref), semantic '
  '(cosine similarity), fts (full-text), hybrid (blended semantic+fts).';

-- ── HNSW index (matches repo convention: migrations 001, 053) ──────────────

create index if not exists idx_parts_catalog_embedding_hnsw
  on public.parts_catalog
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ── View: parts that need (re)embedding ────────────────────────────────────

create or replace view public.v_parts_embedding_backlog as
select
  id,
  workspace_id,
  part_number,
  description,
  manufacturer,
  vendor_code,
  machine_code,
  model_code,
  category,
  category_code,
  embedding_computed_at,
  updated_at,
  case
    when embedding is null then 'never_embedded'
    when embedding_computed_at is null then 'invalidated'
    when embedding_model <> 'text-embedding-3-small' then 'model_drift'
    else 'unknown'
  end as backlog_reason
from public.parts_catalog
where deleted_at is null
  and (
    embedding is null
    or embedding_computed_at is null
    or embedding_model <> 'text-embedding-3-small'
  );

comment on view public.v_parts_embedding_backlog is
  'Parts whose embeddings are stale or never computed. '
  'Consumed by parts-embed-backfill edge function.';

grant select on public.v_parts_embedding_backlog to authenticated;

-- ── Trigger: invalidate embedding on signal column change ──────────────────
-- Intentionally does NOT set embedding=NULL (keeps the old vector valid for
-- search until the new one is computed), only clears embedding_computed_at
-- so the backlog view picks it up.

create or replace function public.parts_catalog_invalidate_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Bypass if running inside an import that sets the suppression GUC
  -- (same pattern as parts_catalog_track_manual_edits)
  begin
    if coalesce(current_setting('parts_catalog.suppress_override_tracking', true), 'off') = 'on' then
      -- Imports mark embeddings for refresh too, but unconditionally
      new.embedding_computed_at := null;
      return new;
    end if;
  exception when others then
    -- setting not defined → treat as off
    null;
  end;

  if (
    new.description is distinct from old.description
    or new.manufacturer is distinct from old.manufacturer
    or new.vendor_code is distinct from old.vendor_code
    or new.machine_code is distinct from old.machine_code
    or new.model_code is distinct from old.model_code
    or new.category is distinct from old.category
    or new.category_code is distinct from old.category_code
  ) then
    new.embedding_computed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists parts_catalog_invalidate_embedding_trg on public.parts_catalog;
create trigger parts_catalog_invalidate_embedding_trg
  before update on public.parts_catalog
  for each row execute function public.parts_catalog_invalidate_embedding();

-- ── RPC: match_parts_hybrid ────────────────────────────────────────────────
-- Combines semantic + FTS in one SQL round-trip. Per-result-set FTS
-- normalization via MAX() OVER (). Filter pushdown into WHERE clauses.

create or replace function public.match_parts_hybrid(
  p_query_embedding  extensions.vector(1536),
  p_query_text       text,
  p_workspace        text default null,
  p_manufacturer     text default null,
  p_category         text default null,
  p_alpha            numeric default 0.6,
  p_match_count      integer default 20
)
returns table (
  part_id             uuid,
  part_number         text,
  description         text,
  manufacturer        text,
  vendor_code         text,
  machine_code        text,
  model_code          text,
  category            text,
  on_hand             numeric,
  list_price          numeric,
  cost_price          numeric,
  cosine_similarity   numeric,
  fts_rank            numeric,
  fts_norm            numeric,
  hybrid_score        numeric,
  match_source        text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
begin
  ws := coalesce(p_workspace, public.get_my_workspace(), 'default');

  return query
  with semantic_matches as (
    select
      pc.id                                                     as part_id,
      (1 - (pc.embedding <=> p_query_embedding))::numeric        as cosine_similarity
    from public.parts_catalog pc
    where pc.workspace_id = ws
      and pc.deleted_at is null
      and pc.embedding is not null
      and (p_manufacturer is null or upper(pc.manufacturer) = upper(p_manufacturer)
           or upper(pc.vendor_code) = upper(p_manufacturer))
      and (p_category is null or upper(pc.category) = upper(p_category)
           or upper(pc.category_code) = upper(p_category))
    order by pc.embedding <=> p_query_embedding
    limit 50
  ),
  fts_matches as (
    select
      pc.id                                                     as part_id,
      ts_rank_cd(
        to_tsvector('english',
          coalesce(pc.part_number, '') || ' ' ||
          coalesce(pc.description, '') || ' ' ||
          coalesce(pc.category, '') || ' ' ||
          coalesce(pc.manufacturer, '') || ' ' ||
          coalesce(pc.machine_code, '') || ' ' ||
          coalesce(pc.model_code, '')
        ),
        plainto_tsquery('english', p_query_text)
      )::numeric                                                 as fts_rank
    from public.parts_catalog pc
    where pc.workspace_id = ws
      and pc.deleted_at is null
      and to_tsvector('english',
            coalesce(pc.part_number, '') || ' ' ||
            coalesce(pc.description, '') || ' ' ||
            coalesce(pc.category, '') || ' ' ||
            coalesce(pc.manufacturer, '') || ' ' ||
            coalesce(pc.machine_code, '') || ' ' ||
            coalesce(pc.model_code, '')
          ) @@ plainto_tsquery('english', p_query_text)
      and (p_manufacturer is null or upper(pc.manufacturer) = upper(p_manufacturer)
           or upper(pc.vendor_code) = upper(p_manufacturer))
      and (p_category is null or upper(pc.category) = upper(p_category)
           or upper(pc.category_code) = upper(p_category))
    order by fts_rank desc
    limit 50
  ),
  combined as (
    select
      coalesce(s.part_id, f.part_id) as part_id,
      coalesce(s.cosine_similarity, 0::numeric) as cosine_similarity,
      coalesce(f.fts_rank, 0::numeric)           as fts_rank,
      case
        when s.part_id is not null and f.part_id is not null then 'both'
        when s.part_id is not null then 'semantic'
        else 'fts'
      end as match_source
    from semantic_matches s
    full outer join fts_matches f on f.part_id = s.part_id
  ),
  normalized as (
    select
      c.part_id,
      c.cosine_similarity,
      c.fts_rank,
      case
        when max(c.fts_rank) over () > 0
          then (c.fts_rank / max(c.fts_rank) over ())::numeric
        else 0::numeric
      end as fts_norm,
      c.match_source
    from combined c
  )
  select
    n.part_id,
    pc.part_number,
    pc.description,
    pc.manufacturer,
    pc.vendor_code,
    pc.machine_code,
    pc.model_code,
    pc.category,
    pc.on_hand,
    pc.list_price,
    pc.cost_price,
    round(n.cosine_similarity, 4)                     as cosine_similarity,
    round(n.fts_rank, 4)                              as fts_rank,
    round(n.fts_norm, 4)                              as fts_norm,
    round((p_alpha * n.cosine_similarity + (1 - p_alpha) * n.fts_norm), 4) as hybrid_score,
    n.match_source
  from normalized n
  join public.parts_catalog pc on pc.id = n.part_id
  where pc.deleted_at is null
  order by hybrid_score desc
  limit p_match_count;
end;
$$;

grant execute on function public.match_parts_hybrid(
  extensions.vector(1536), text, text, text, text, numeric, integer
) to authenticated;

-- ============================================================================
-- Migration 268 complete.
-- ============================================================================
