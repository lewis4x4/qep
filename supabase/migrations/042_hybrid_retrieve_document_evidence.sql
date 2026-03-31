-- Hybrid document retrieval: semantic (chunk vectors) + keyword / full-text fallback.
-- Explicit role and published status filters (chat uses service role; RLS is not enough).

create or replace function public.retrieve_document_evidence(
  query_embedding extensions.vector(1536),
  keyword_query text,
  user_role text,
  match_count int default 8,
  semantic_match_threshold float default 0.55
)
returns table (
  source_type text,
  source_id uuid,
  source_title text,
  excerpt text,
  confidence float,
  access_class text
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with
  q as (
    select nullif(btrim(keyword_query), '') as qtext
  ),
  -- LATERAL ensures vector distance is never evaluated when query_embedding is NULL
  -- (avoids "operator does not exist" / unknown-type NULL binding on hosted Postgres).
  semantic_raw as (
    select
      d.id as doc_id,
      d.title as doc_title,
      trim(left(regexp_replace(c.content, E'\\s+', ' ', 'g'), 500)) as chunk_excerpt,
      (1 - (c.embedding <=> q.qe))::double precision as sim,
      d.audience::text as aud
    from public.chunks c
    inner join public.documents d on d.id = c.document_id
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) q
    where
      d.status = 'published'
      and public.document_role_can_view_audience(d.audience, user_role)
      and 1 - (c.embedding <=> q.qe) > semantic_match_threshold
  ),
  semantic_ranked as (
    select
      doc_id,
      doc_title,
      chunk_excerpt,
      sim,
      aud,
      row_number() over (partition by doc_id order by sim desc) as rn
    from semantic_raw
  ),
  semantic_hits as (
    select
      'document'::text as source_type,
      doc_id as source_id,
      doc_title as source_title,
      chunk_excerpt as excerpt,
      sim::float as confidence,
      aud as access_class
    from semantic_ranked
    where rn = 1
  ),
  keyword_hits as (
    select
      'document'::text as source_type,
      d.id as source_id,
      d.title as source_title,
      trim(
        case
          when (select qtext from q) is not null
            and strpos(lower(coalesce(d.raw_text, '')), lower((select qtext from q))) > 0
          then substring(
            coalesce(d.raw_text, '')
            from greatest(
              strpos(lower(coalesce(d.raw_text, '')), lower((select qtext from q))) - 120,
              1
            )
            for 420
          )
          else left(regexp_replace(coalesce(d.raw_text, ''), E'\\s+', ' ', 'g'), 420)
        end
      ) as excerpt,
      case
        when lower(d.title) = lower((select qtext from q)) then 0.99::float
        when d.title ilike '%' || (select qtext from q) || '%' then 0.95::float
        when coalesce(d.raw_text, '') ilike '%' || (select qtext from q) || '%' then 0.86::float
        else 0.88::float
      end as confidence,
      d.audience::text as access_class
    from public.documents d
    where
      (select qtext from q) is not null
      and d.status = 'published'
      and public.document_role_can_view_audience(d.audience, user_role)
      and (
        d.title ilike '%' || (select qtext from q) || '%'
        or coalesce(d.raw_text, '') ilike '%' || (select qtext from q) || '%'
        or (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector(
              'english',
              coalesce(d.title, '') || ' ' || left(coalesce(d.raw_text, ''), 500000)
            )
        )
      )
  ),
  combined as (
    select * from semantic_hits
    union all
    select * from keyword_hits
  ),
  deduped as (
    select
      source_type,
      source_id,
      source_title,
      excerpt,
      confidence,
      access_class,
      row_number() over (
        partition by source_id
        order by confidence desc, length(excerpt) desc, source_title
      ) as dedupe_rank
    from combined
  )
  select
    source_type,
    source_id,
    source_title,
    excerpt,
    confidence,
    access_class
  from deduped
  where dedupe_rank = 1
  order by confidence desc, source_title
  limit greatest(coalesce(match_count, 8), 1);
$$;

revoke execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float) from public;
grant execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float) to authenticated, service_role;
