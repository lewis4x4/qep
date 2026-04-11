-- Tier 1 knowledge retrieval upgrade:
-- - hierarchical document chunks (section + paragraph)
-- - additive retrieval metadata for section/page/context
-- - paragraph-first retrieval with parent section hydration

alter table public.chunks
  add column if not exists chunk_kind text not null default 'paragraph';

alter table public.chunks
  add column if not exists parent_chunk_id uuid references public.chunks(id) on delete cascade;

alter table public.chunks
  drop constraint if exists chunks_chunk_kind_check;

alter table public.chunks
  add constraint chunks_chunk_kind_check
  check (chunk_kind in ('paragraph', 'section'));

update public.chunks
set chunk_kind = 'paragraph'
where chunk_kind is distinct from 'paragraph'
  and parent_chunk_id is null;

create index if not exists idx_chunks_parent_chunk_id
  on public.chunks (parent_chunk_id)
  where parent_chunk_id is not null;

create index if not exists idx_chunks_document_kind
  on public.chunks (document_id, chunk_kind, chunk_index);

drop function if exists public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float, text);

create function public.retrieve_document_evidence(
  query_embedding extensions.vector(1536),
  keyword_query text,
  user_role text,
  match_count int default 8,
  semantic_match_threshold float default 0.55,
  p_workspace_id text default 'default'
)
returns table (
  source_type text,
  source_id uuid,
  source_title text,
  excerpt text,
  confidence float,
  access_class text,
  chunk_kind text,
  parent_chunk_id uuid,
  section_title text,
  page_number integer,
  context_excerpt text
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with
  q as (
    select
      nullif(btrim(keyword_query), '') as qtext,
      coalesce(nullif(btrim(p_workspace_id), ''), 'default') as workspace_id
  ),
  doc_chunk_scope as (
    select
      d.id as doc_id,
      d.title as doc_title,
      d.audience::text as aud,
      c.id as chunk_id,
      c.parent_chunk_id,
      coalesce(c.chunk_kind, 'paragraph') as chunk_kind,
      c.content,
      trim(left(regexp_replace(c.content, E'\\s+', ' ', 'g'), 500)) as chunk_excerpt,
      nullif(c.metadata ->> 'section_title', '') as section_title,
      case
        when coalesce(c.metadata ->> 'page_number', '') ~ '^[0-9]+$'
          then (c.metadata ->> 'page_number')::integer
        else null
      end as page_number,
      trim(left(regexp_replace(coalesce(parent.content, ''), E'\\s+', ' ', 'g'), 700)) as context_excerpt
    from public.chunks c
    inner join public.documents d on d.id = c.document_id
    left join public.chunks parent on parent.id = c.parent_chunk_id
    where
      d.status = 'published'
      and public.document_role_can_view_audience(d.audience, user_role)
      and coalesce(c.chunk_kind, 'paragraph') = 'paragraph'
  ),
  semantic_raw as (
    select
      scope.doc_id,
      scope.doc_title,
      scope.chunk_excerpt,
      scope.parent_chunk_id,
      scope.section_title,
      scope.page_number,
      scope.context_excerpt,
      scope.chunk_kind,
      scope.aud,
      (1 - (scope_chunk.embedding <=> qe.qe))::double precision as sim
    from doc_chunk_scope scope
    inner join public.chunks scope_chunk on scope_chunk.id = scope.chunk_id
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) qe
    where 1 - (scope_chunk.embedding <=> qe.qe) > semantic_match_threshold
  ),
  semantic_ranked as (
    select
      doc_id,
      doc_title,
      chunk_excerpt,
      parent_chunk_id,
      section_title,
      page_number,
      context_excerpt,
      chunk_kind,
      sim,
      aud,
      row_number() over (
        partition by doc_id
        order by sim desc, length(coalesce(context_excerpt, '')) desc, chunk_excerpt
      ) as rn
    from semantic_raw
  ),
  semantic_hits as (
    select
      'document'::text as source_type,
      doc_id as source_id,
      doc_title as source_title,
      chunk_excerpt as excerpt,
      sim::float as confidence,
      aud as access_class,
      chunk_kind,
      parent_chunk_id,
      section_title,
      page_number,
      nullif(context_excerpt, '') as context_excerpt
    from semantic_ranked
    where rn = 1
  ),
  keyword_raw as (
    select
      scope.doc_id,
      scope.doc_title,
      trim(
        case
          when (select qtext from q) is not null
            and strpos(lower(scope.content), lower((select qtext from q))) > 0
          then substring(
            scope.content
            from greatest(
              strpos(lower(scope.content), lower((select qtext from q))) - 120,
              1
            )
            for 420
          )
          else scope.chunk_excerpt
        end
      ) as excerpt,
      scope.parent_chunk_id,
      scope.section_title,
      scope.page_number,
      nullif(scope.context_excerpt, '') as context_excerpt,
      scope.chunk_kind,
      scope.aud,
      case
        when lower(scope.doc_title) = lower((select qtext from q)) then 0.99::float
        when scope.doc_title ilike '%' || (select qtext from q) || '%' then 0.95::float
        when coalesce(scope.section_title, '') ilike '%' || (select qtext from q) || '%' then 0.90::float
        when scope.content ilike '%' || (select qtext from q) || '%' then 0.86::float
        else 0.88::float
      end as confidence
    from doc_chunk_scope scope
    where
      (select qtext from q) is not null
      and (
        scope.doc_title ilike '%' || (select qtext from q) || '%'
        or coalesce(scope.section_title, '') ilike '%' || (select qtext from q) || '%'
        or scope.content ilike '%' || (select qtext from q) || '%'
        or (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector(
              'english',
              scope.doc_title || ' ' || coalesce(scope.section_title, '') || ' ' || left(scope.content, 500000)
            )
        )
      )
  ),
  keyword_ranked as (
    select
      doc_id,
      doc_title,
      excerpt,
      parent_chunk_id,
      section_title,
      page_number,
      context_excerpt,
      chunk_kind,
      confidence,
      aud,
      row_number() over (
        partition by doc_id
        order by confidence desc, length(excerpt) desc, doc_title
      ) as rn
    from keyword_raw
  ),
  keyword_hits as (
    select
      'document'::text as source_type,
      doc_id as source_id,
      doc_title as source_title,
      excerpt,
      confidence,
      aud as access_class,
      chunk_kind,
      parent_chunk_id,
      section_title,
      page_number,
      context_excerpt
    from keyword_ranked
    where rn = 1
  ),
  crm_scope as (
    select
      ce.entity_type,
      ce.entity_id,
      ce.content,
      ce.embedding,
      coalesce(
        contact.workspace_id,
        company.workspace_id,
        deal.workspace_id,
        equipment.workspace_id,
        activity.workspace_id,
        voice_contact.workspace_id,
        voice_company.workspace_id,
        voice_deal.workspace_id,
        'default'
      ) as workspace_id
    from public.crm_embeddings ce
    left join public.crm_contacts contact
      on ce.entity_type = 'contact'
     and contact.id = ce.entity_id
     and contact.deleted_at is null
    left join public.crm_companies company
      on ce.entity_type = 'company'
     and company.id = ce.entity_id
     and company.deleted_at is null
    left join public.crm_deals deal
      on ce.entity_type = 'deal'
     and deal.id = ce.entity_id
     and deal.deleted_at is null
    left join public.crm_equipment equipment
      on ce.entity_type = 'equipment'
     and equipment.id = ce.entity_id
     and equipment.deleted_at is null
    left join public.crm_activities activity
      on ce.entity_type = 'activity'
     and activity.id = ce.entity_id
     and activity.deleted_at is null
    left join public.voice_captures voice_capture
      on ce.entity_type = 'voice_capture'
     and voice_capture.id = ce.entity_id
    left join public.crm_contacts voice_contact
      on voice_capture.linked_contact_id = voice_contact.id
     and voice_contact.deleted_at is null
    left join public.crm_companies voice_company
      on voice_capture.linked_company_id = voice_company.id
     and voice_company.deleted_at is null
    left join public.crm_deals voice_deal
      on voice_capture.linked_deal_id = voice_deal.id
     and voice_deal.deleted_at is null
    where ce.entity_type in ('contact', 'company', 'deal', 'equipment', 'activity', 'voice_capture')
  ),
  crm_semantic_raw as (
    select
      scope.entity_type,
      scope.entity_id,
      trim(left(regexp_replace(scope.content, E'\\s+', ' ', 'g'), 120)) as crm_title,
      trim(left(regexp_replace(scope.content, E'\\s+', ' ', 'g'), 500)) as crm_excerpt,
      (1 - (scope.embedding <=> qe.qe))::double precision as sim
    from crm_scope scope
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) qe
    where scope.workspace_id = (select workspace_id from q)
      and scope.embedding is not null
      and 1 - (scope.embedding <=> qe.qe) > semantic_match_threshold
  ),
  crm_semantic_ranked as (
    select
      entity_type,
      entity_id,
      crm_title,
      crm_excerpt,
      sim,
      row_number() over (partition by entity_type, entity_id order by sim desc) as rn
    from crm_semantic_raw
  ),
  crm_semantic_hits as (
    select
      entity_type as source_type,
      entity_id as source_id,
      crm_title as source_title,
      crm_excerpt as excerpt,
      sim::float as confidence,
      'company_wide'::text as access_class,
      null::text as chunk_kind,
      null::uuid as parent_chunk_id,
      null::text as section_title,
      null::integer as page_number,
      null::text as context_excerpt
    from crm_semantic_ranked
    where rn = 1
  ),
  service_note_scope as (
    select
      note.id,
      note.workspace_id,
      note.note_type,
      note.content,
      note.embedding,
      note.created_at,
      equipment.make,
      equipment.model,
      equipment.serial_number
    from public.machine_knowledge_notes note
    left join public.crm_equipment equipment
      on equipment.id = note.equipment_id
     and equipment.deleted_at is null
    where note.workspace_id = (select workspace_id from q)
  ),
  service_note_semantic_raw as (
    select
      note.id as note_id,
      trim(
        concat(
          'Service note',
          case when note.note_type is not null then ': ' || replace(note.note_type, '_', ' ') else '' end,
          case
            when note.make is not null or note.model is not null
              then ' - ' || btrim(concat_ws(' ', note.make, note.model))
            else ''
          end,
          case when note.serial_number is not null then ' (' || note.serial_number || ')' else '' end
        )
      ) as note_title,
      trim(left(regexp_replace(note.content, E'\\s+', ' ', 'g'), 500)) as note_excerpt,
      note.note_type,
      (1 - (note.embedding <=> qe.qe))::double precision as sim
    from service_note_scope note
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) qe
    where note.embedding is not null
      and 1 - (note.embedding <=> qe.qe) > semantic_match_threshold
  ),
  service_note_semantic_hits as (
    select
      'service_note'::text as source_type,
      note_id as source_id,
      note_title as source_title,
      note_excerpt as excerpt,
      sim::float as confidence,
      note_type::text as access_class,
      null::text as chunk_kind,
      null::uuid as parent_chunk_id,
      null::text as section_title,
      null::integer as page_number,
      null::text as context_excerpt
    from (
      select
        note_id,
        note_title,
        note_excerpt,
        note_type,
        sim,
        row_number() over (partition by note_id order by sim desc) as rn
      from service_note_semantic_raw
    ) ranked
    where rn = 1
  ),
  crm_keyword_hits as (
    select
      scope.entity_type as source_type,
      scope.entity_id as source_id,
      trim(left(regexp_replace(scope.content, E'\\s+', ' ', 'g'), 120)) as source_title,
      trim(
        case
          when (select qtext from q) is not null
            and strpos(lower(scope.content), lower((select qtext from q))) > 0
          then substring(
            scope.content
            from greatest(
              strpos(lower(scope.content), lower((select qtext from q))) - 120,
              1
            )
            for 500
          )
          else left(regexp_replace(scope.content, E'\\s+', ' ', 'g'), 500)
        end
      ) as excerpt,
      case
        when scope.content ilike '%' || (select qtext from q) || '%' then 0.88::float
        when (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(scope.content, 500000))
        ) then 0.82::float
        else 0.80::float
      end as confidence,
      'company_wide'::text as access_class,
      null::text as chunk_kind,
      null::uuid as parent_chunk_id,
      null::text as section_title,
      null::integer as page_number,
      null::text as context_excerpt
    from crm_scope scope
    where
      scope.workspace_id = (select workspace_id from q)
      and (select qtext from q) is not null
      and (
        scope.content ilike '%' || (select qtext from q) || '%'
        or (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(scope.content, 500000))
        )
      )
  ),
  service_note_keyword_hits as (
    select
      'service_note'::text as source_type,
      note.id as source_id,
      trim(
        concat(
          'Service note',
          case when note.note_type is not null then ': ' || replace(note.note_type, '_', ' ') else '' end,
          case
            when note.make is not null or note.model is not null
              then ' - ' || btrim(concat_ws(' ', note.make, note.model))
            else ''
          end,
          case when note.serial_number is not null then ' (' || note.serial_number || ')' else '' end
        )
      ) as source_title,
      trim(
        case
          when strpos(lower(note.content), lower((select qtext from q))) > 0
          then substring(
            note.content
            from greatest(
              strpos(lower(note.content), lower((select qtext from q))) - 120,
              1
            )
            for 500
          )
          else left(regexp_replace(note.content, E'\\s+', ' ', 'g'), 500)
        end
      ) as excerpt,
      case
        when note.content ilike '%' || (select qtext from q) || '%' then 0.84::float
        when (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(note.content, 500000))
        ) then 0.78::float
        else 0.74::float
      end as confidence,
      note.note_type::text as access_class,
      null::text as chunk_kind,
      null::uuid as parent_chunk_id,
      null::text as section_title,
      null::integer as page_number,
      null::text as context_excerpt
    from service_note_scope note
    where
      (select qtext from q) is not null
      and (
        note.content ilike '%' || (select qtext from q) || '%'
        or (
          plainto_tsquery('english', left((select qtext from q), 2000))
            @@ to_tsvector('english', left(note.content, 500000))
        )
      )
  ),
  combined as (
    select * from semantic_hits
    union all
    select * from crm_semantic_hits
    union all
    select * from service_note_semantic_hits
    union all
    select * from keyword_hits
    union all
    select * from crm_keyword_hits
    union all
    select * from service_note_keyword_hits
  ),
  deduped as (
    select
      source_type,
      source_id,
      source_title,
      excerpt,
      confidence,
      access_class,
      chunk_kind,
      parent_chunk_id,
      section_title,
      page_number,
      context_excerpt,
      row_number() over (
        partition by source_type, source_id
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
    access_class,
    chunk_kind,
    parent_chunk_id,
    section_title,
    page_number,
    context_excerpt
  from deduped
  where dedupe_rank = 1
  order by confidence desc, source_title
  limit greatest(coalesce(match_count, 8), 1);
$$;

revoke execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float, text) from public;
grant execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float, text) to authenticated, service_role;
