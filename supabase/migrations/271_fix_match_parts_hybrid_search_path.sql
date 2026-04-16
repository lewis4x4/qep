-- ============================================================================
-- Migration 271: Fix match_parts_hybrid — operator resolution for <=>
--
-- Bug: migration 268 declared the RPC with `set search_path = ''` to follow
-- Supabase security guidance, but pgvector's cosine distance operator `<=>`
-- lives in the `extensions` schema. With an empty search_path, Postgres can't
-- resolve the operator against the `extensions.vector` type at runtime →
-- ERROR: operator does not exist: extensions.vector <=> extensions.vector
--
-- Fix: follow the established repo pattern (migration 054) and set search_path
-- to `public, extensions, pg_temp`. `pg_temp` last keeps injection-resistant
-- defaults; `extensions` is needed for the <=> operator to resolve.
--
-- Surface symptom: parts-predictive-ai (Slice 3.3b) grounding returned 0
-- candidates for every Claude-proposed hint because the RPC errored before
-- returning rows.
-- ============================================================================

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
set search_path = public, extensions, pg_temp
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
-- Migration 271 complete.
-- ============================================================================
