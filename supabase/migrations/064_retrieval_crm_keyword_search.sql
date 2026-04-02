-- Add keyword search against crm_embeddings.content so CRM data surfaces
-- even when semantic similarity is below threshold (e.g. a name lookup like
-- "John Smith skid steer budget" that shares few embedding dimensions with
-- the stored activity text).

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
  -- Document semantic search (via chunks)
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
  -- CRM semantic search (via crm_embeddings)
  crm_semantic_raw as (
    select
      ce.entity_type,
      ce.entity_id,
      trim(left(regexp_replace(ce.content, E'\\s+', ' ', 'g'), 120)) as crm_title,
      trim(left(regexp_replace(ce.content, E'\\s+', ' ', 'g'), 500)) as crm_excerpt,
      (1 - (ce.embedding <=> q.qe))::double precision as sim
    from public.crm_embeddings ce
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) q
    where
      1 - (ce.embedding <=> q.qe) > semantic_match_threshold
  ),
  crm_semantic_ranked as (
    select
      entity_type,
      entity_id,
      crm_title,
      crm_excerpt,
      sim,
      row_number() over (partition by entity_id order by sim desc) as rn
    from crm_semantic_raw
  ),
  crm_semantic_hits as (
    select
      entity_type as source_type,
      entity_id as source_id,
      crm_title as source_title,
      crm_excerpt as excerpt,
      sim::float as confidence,
      'company_wide'::text as access_class
    from crm_semantic_ranked
    where rn = 1
  ),
  -- Document keyword / full-text search
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
  -- CRM keyword search (via crm_embeddings.content) — catches name lookups
  -- and topic queries that semantic similarity alone might miss
  crm_keyword_hits as (
    select
      ce.entity_type as source_type,
      ce.entity_id as source_id,
      trim(left(regexp_replace(ce.content, E'\\s+', ' ', 'g'), 120)) as source_title,
      trim(
        case
          when (select qtext from q) is not null
            and strpos(lower(ce.content), lower((select qtext from q))) > 0
          then substring(
            ce.content
            from greatest(
              strpos(lower(ce.content), lower((select qtext from q))) - 120,
              1
            )
            for 500
          )
          else left(regexp_replace(ce.content, E'\\s+', ' ', 'g'), 500)
        end
      ) as excerpt,
      case
        when ce.content ilike '%' || (select qtext from q) || '%' then 0.88::float
        when (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(ce.content, 500000))
        ) then 0.82::float
        else 0.80::float
      end as confidence,
      'company_wide'::text as access_class
    from public.crm_embeddings ce
    where
      (select qtext from q) is not null
      and (
        ce.content ilike '%' || (select qtext from q) || '%'
        or (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(ce.content, 500000))
        )
      )
  ),
  combined as (
    select * from semantic_hits
    union all
    select * from crm_semantic_hits
    union all
    select * from keyword_hits
    union all
    select * from crm_keyword_hits
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
