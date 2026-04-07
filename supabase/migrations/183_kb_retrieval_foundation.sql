-- Knowledge base discipline foundation:
-- - knowledge gap dedup + frequency tracking
-- - machine_knowledge_notes embeddings
-- - retrieval hardening for workspace scope + service notes
-- - retire legacy search_chunks helper

create or replace function public.normalize_knowledge_gap_question(p_question text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select nullif(lower(regexp_replace(btrim(p_question), '\s+', ' ', 'g')), '');
$$;

alter table public.knowledge_gaps
  add column if not exists question_normalized text
  generated always as (public.normalize_knowledge_gap_question(question)) stored;

with duplicate_groups as (
  select
    workspace_id,
    question_normalized,
    (array_agg(id order by last_asked_at desc, created_at desc, id desc))[1] as survivor_id,
    (array_agg(trace_id order by last_asked_at desc, created_at desc, id desc))[1] as latest_trace_id,
    sum(frequency) as total_frequency,
    max(last_asked_at) as latest_asked_at,
    bool_or(not resolved) as has_unresolved
  from public.knowledge_gaps
  where question_normalized is not null
  group by workspace_id, question_normalized
  having count(*) > 1
),
survivor_updates as (
  update public.knowledge_gaps gap
  set
    frequency = dup.total_frequency,
    last_asked_at = dup.latest_asked_at,
    resolved = not dup.has_unresolved,
    trace_id = coalesce(dup.latest_trace_id, gap.trace_id)
  from duplicate_groups dup
  where gap.id = dup.survivor_id
  returning dup.workspace_id, dup.question_normalized, dup.survivor_id
)
delete from public.knowledge_gaps gap
using survivor_updates survivor
where gap.workspace_id = survivor.workspace_id
  and gap.question_normalized = survivor.question_normalized
  and gap.id <> survivor.survivor_id;

create unique index if not exists idx_knowledge_gaps_workspace_question_normalized
  on public.knowledge_gaps (workspace_id, question_normalized)
  where question_normalized is not null;

create or replace function public.log_knowledge_gap(
  p_workspace_id text,
  p_user_id uuid,
  p_question text,
  p_trace_id text default null
)
returns public.knowledge_gaps
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id text := coalesce(nullif(btrim(p_workspace_id), ''), 'default');
  v_question text := left(btrim(coalesce(p_question, '')), 500);
  v_normalized text := public.normalize_knowledge_gap_question(v_question);
  v_existing public.knowledge_gaps;
  v_result public.knowledge_gaps;
begin
  if v_normalized is null then
    raise exception 'Question is required';
  end if;

  select *
  into v_existing
  from public.knowledge_gaps
  where workspace_id = v_workspace_id
    and question_normalized = v_normalized
  limit 1;

  if found then
    update public.knowledge_gaps
    set
      user_id = coalesce(p_user_id, user_id),
      question = v_question,
      trace_id = coalesce(p_trace_id, trace_id),
      frequency = frequency + 1,
      last_asked_at = now(),
      resolved = false
    where id = v_existing.id
    returning * into v_result;

    return v_result;
  end if;

  insert into public.knowledge_gaps (
    workspace_id,
    user_id,
    question,
    trace_id
  )
  values (
    v_workspace_id,
    p_user_id,
    v_question,
    p_trace_id
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function public.log_knowledge_gap(text, uuid, text, text) from public;
grant execute on function public.log_knowledge_gap(text, uuid, text, text) to authenticated, service_role;

alter table public.machine_knowledge_notes
  add column if not exists embedding extensions.vector(1536);

comment on column public.machine_knowledge_notes.embedding is
  'OpenAI text-embedding-3-small vector for institutional service notes.';

create index if not exists idx_machine_knowledge_notes_embedding
  on public.machine_knowledge_notes
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_machine_knowledge_notes_workspace_created
  on public.machine_knowledge_notes (workspace_id, created_at desc);

drop function if exists public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float);

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
  access_class text
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
  semantic_raw as (
    select
      d.id as doc_id,
      d.title as doc_title,
      trim(left(regexp_replace(c.content, E'\\s+', ' ', 'g'), 500)) as chunk_excerpt,
      (1 - (c.embedding <=> qe.qe))::double precision as sim,
      d.audience::text as aud
    from public.chunks c
    inner join public.documents d on d.id = c.document_id
    cross join lateral (
      select query_embedding as qe
      where query_embedding is not null
    ) qe
    where
      d.status = 'published'
      and public.document_role_can_view_audience(d.audience, user_role)
      and 1 - (c.embedding <=> qe.qe) > semantic_match_threshold
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
      'company_wide'::text as access_class
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
              then ' — ' || btrim(concat_ws(' ', note.make, note.model))
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
      note_type::text as access_class
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
      'company_wide'::text as access_class
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
              then ' — ' || btrim(concat_ws(' ', note.make, note.model))
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
      note.note_type::text as access_class
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
    access_class
  from deduped
  where dedupe_rank = 1
  order by confidence desc, source_title
  limit greatest(coalesce(match_count, 8), 1);
$$;

revoke execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float, text) from public;
grant execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float, text) to authenticated, service_role;

drop function if exists public.search_chunks(extensions.vector(1536), float, int);
