-- ============================================================================
-- Migration 326: Document Center foundation
--
-- Track 8.1.1 establishes:
--   * workspace-scoped documents
--   * folder + membership substrate
--   * workspace-safe document retrieval
--   * first-slice list / move / duplicate-link RPCs for document-router
--
-- Folder visibility contract:
--   * document_folders.audience controls whether the folder is visible
--   * documents.audience controls whether the document is visible/openable
--   * folder membership never grants document access
-- ============================================================================

-- ── 1. documents.workspace_id hardening ─────────────────────────────────────

alter type public.document_audit_event_type add value if not exists 'folder_created';
alter type public.document_audit_event_type add value if not exists 'folder_reparented';
alter type public.document_audit_event_type add value if not exists 'folder_linked';
alter type public.document_audit_event_type add value if not exists 'folder_membership_moved';
alter type public.document_audit_event_type add value if not exists 'download_url_generated';

alter table public.documents
  add column if not exists workspace_id text;

comment on column public.documents.workspace_id is
  'Track 8.1.1 source-of-truth workspace for governed documents. Backfilled from the uploader profile when available; defaults to ''default'' as the final fallback.';

with uploader_workspace as (
  select
    d.id,
    coalesce(
      p.active_workspace_id,
      (
        select 'default'
        from public.profile_workspaces pw
        where pw.profile_id = d.uploaded_by
          and pw.workspace_id = 'default'
        limit 1
      ),
      (
        select pw.workspace_id
        from public.profile_workspaces pw
        where pw.profile_id = d.uploaded_by
        order by pw.workspace_id asc
        limit 1
      ),
      'default'
    ) as workspace_id
  from public.documents d
  left join public.profiles p on p.id = d.uploaded_by
)
update public.documents d
set workspace_id = uploader_workspace.workspace_id
from uploader_workspace
where d.id = uploader_workspace.id
  and d.workspace_id is null;

update public.documents
set workspace_id = 'default'
where workspace_id is null;

alter table public.documents
  alter column workspace_id set default 'default';

alter table public.documents
  alter column workspace_id set not null;

create index if not exists idx_documents_workspace_updated
  on public.documents (workspace_id, updated_at desc, id desc);

drop policy if exists "documents_select_visible_role_scoped" on public.documents;
drop policy if exists "documents_select_elevated_all" on public.documents;

create policy "documents_select_visible_role_scoped"
  on public.documents
  for select
  using (
    workspace_id = public.get_my_workspace()
    and status = 'published'
    and public.document_role_can_view_audience(audience, public.get_my_role()::text)
  );

create policy "documents_select_elevated_all"
  on public.documents
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

drop policy if exists "chunks_select_visible_documents" on public.chunks;

create policy "chunks_select_visible_documents"
  on public.chunks
  for select
  using (
    exists (
      select 1
      from public.documents d
      where d.id = chunks.document_id
        and d.workspace_id = public.get_my_workspace()
        and (
          (
            d.status = 'published'
            and public.document_role_can_view_audience(d.audience, public.get_my_role()::text)
          )
          or public.get_my_role() in ('admin', 'manager', 'owner')
        )
    )
  );

-- ── 2. Folder + membership substrate ───────────────────────────────────────

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  parent_id uuid references public.document_folders(id) on delete restrict,
  name text not null,
  audience public.document_audience not null default 'company_wide',
  owner_user_id uuid references public.profiles(id) on delete set null,
  is_smart boolean not null default false,
  smart_query jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (smart_query is null or jsonb_typeof(smart_query) = 'object')
);

comment on table public.document_folders is
  'Track 8.1.1 organizational folders for governed documents. Folder audience controls folder visibility only; it does not grant access to member documents.';

comment on column public.document_folders.deleted_at is
  'Soft-delete reserved for future folder delete UX. Delete must be blocked while live child folders or live memberships remain.';

create unique index if not exists idx_document_folders_unique_live_name
  on public.document_folders (workspace_id, parent_id, lower(name))
  where deleted_at is null;

create index if not exists idx_document_folders_workspace_parent_name
  on public.document_folders (workspace_id, parent_id, name)
  where deleted_at is null;

drop trigger if exists set_document_folders_updated_at on public.document_folders;
create trigger set_document_folders_updated_at
  before update on public.document_folders
  for each row execute function public.set_updated_at();

alter table public.document_folders enable row level security;

drop policy if exists "document_folders_select_visible" on public.document_folders;
create policy "document_folders_select_visible"
  on public.document_folders
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
    and public.document_role_can_view_audience(audience, public.get_my_role()::text)
  );

drop policy if exists "document_folders_insert_elevated" on public.document_folders;
create policy "document_folders_insert_elevated"
  on public.document_folders
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
    and public.document_role_can_view_audience(audience, public.get_my_role()::text)
  );

drop policy if exists "document_folders_update_elevated" on public.document_folders;
create policy "document_folders_update_elevated"
  on public.document_folders
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
    and deleted_at is null
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

drop policy if exists "document_folders_delete_elevated" on public.document_folders;
create policy "document_folders_delete_elevated"
  on public.document_folders
  for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create table if not exists public.document_folder_memberships (
  document_id uuid not null references public.documents(id) on delete cascade,
  folder_id uuid not null references public.document_folders(id) on delete cascade,
  pinned boolean not null default false,
  sort_order integer not null default 0,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (document_id, folder_id)
);

comment on table public.document_folder_memberships is
  'Track 8.1.1 document organization rows. Membership is organizational only; it never grants access to a document.';

create index if not exists idx_document_folder_memberships_document
  on public.document_folder_memberships (document_id, folder_id);

create index if not exists idx_document_folder_memberships_folder_sort
  on public.document_folder_memberships (folder_id, sort_order, added_at desc, document_id);

alter table public.document_folder_memberships enable row level security;

drop policy if exists "document_folder_memberships_select_visible" on public.document_folder_memberships;
create policy "document_folder_memberships_select_visible"
  on public.document_folder_memberships
  for select
  using (
    exists (
      select 1
      from public.document_folders f
      where f.id = document_folder_memberships.folder_id
        and f.workspace_id = public.get_my_workspace()
        and f.deleted_at is null
        and public.document_role_can_view_audience(f.audience, public.get_my_role()::text)
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_folder_memberships.document_id
        and d.workspace_id = public.get_my_workspace()
        and (
          (
            d.status = 'published'
            and public.document_role_can_view_audience(d.audience, public.get_my_role()::text)
          )
          or public.get_my_role() in ('admin', 'manager', 'owner')
        )
    )
  );

drop policy if exists "document_folder_memberships_insert_elevated" on public.document_folder_memberships;
create policy "document_folder_memberships_insert_elevated"
  on public.document_folder_memberships
  for insert
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and exists (
      select 1
      from public.document_folders f
      where f.id = document_folder_memberships.folder_id
        and f.workspace_id = public.get_my_workspace()
        and f.deleted_at is null
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_folder_memberships.document_id
        and d.workspace_id = public.get_my_workspace()
    )
  );

drop policy if exists "document_folder_memberships_update_elevated" on public.document_folder_memberships;
create policy "document_folder_memberships_update_elevated"
  on public.document_folder_memberships
  for update
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and exists (
      select 1
      from public.document_folders f
      where f.id = document_folder_memberships.folder_id
        and f.workspace_id = public.get_my_workspace()
        and f.deleted_at is null
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_folder_memberships.document_id
        and d.workspace_id = public.get_my_workspace()
    )
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and exists (
      select 1
      from public.document_folders f
      where f.id = document_folder_memberships.folder_id
        and f.workspace_id = public.get_my_workspace()
        and f.deleted_at is null
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_folder_memberships.document_id
        and d.workspace_id = public.get_my_workspace()
    )
  );

drop policy if exists "document_folder_memberships_delete_elevated" on public.document_folder_memberships;
create policy "document_folder_memberships_delete_elevated"
  on public.document_folder_memberships
  for delete
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and exists (
      select 1
      from public.document_folders f
      where f.id = document_folder_memberships.folder_id
        and f.workspace_id = public.get_my_workspace()
    )
    and exists (
      select 1
      from public.documents d
      where d.id = document_folder_memberships.document_id
        and d.workspace_id = public.get_my_workspace()
    )
  );

-- ── 3. Retrieval workspace fix ─────────────────────────────────────────────

create or replace function public.retrieve_document_evidence(
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
      d.workspace_id = (select workspace_id from q)
      and d.status = 'published'
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

-- ── 4. Document center list + move/link RPCs ───────────────────────────────

create or replace function public.document_center_list_documents(
  p_view text default 'all',
  p_folder_id uuid default null,
  p_page_size integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_added_at timestamptz default null,
  p_cursor_sort_order integer default null,
  p_cursor_document_id uuid default null,
  p_search_title text default null
)
returns table (
  document_id uuid,
  title text,
  source text,
  mime_type text,
  summary text,
  audience text,
  status text,
  updated_at timestamptz,
  created_at timestamptz,
  word_count integer,
  folder_count bigint,
  pinned boolean,
  sort_order integer,
  added_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_view text := lower(coalesce(nullif(btrim(p_view), ''), 'all'));
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
  v_search_title text := nullif(btrim(p_search_title), '');
begin
  if v_view not in ('all', 'recent', 'pinned', 'unfiled', 'folder') then
    raise exception 'invalid document center view: %', v_view;
  end if;

  if v_view = 'folder' and p_folder_id is null then
    raise exception 'folder_id is required for folder view';
  end if;

  if v_view = 'folder' then
    return query
      select
        d.id as document_id,
        d.title,
        d.source::text as source,
        d.mime_type,
        d.summary,
        d.audience::text as audience,
        d.status::text as status,
        d.updated_at,
        d.created_at,
        d.word_count,
        (
          select count(*)::bigint
          from public.document_folder_memberships fm
          join public.document_folders ff on ff.id = fm.folder_id
          where fm.document_id = d.id
            and ff.deleted_at is null
        ) as folder_count,
        exists (
          select 1
          from public.document_folder_memberships fm
          join public.document_folders ff on ff.id = fm.folder_id
          where fm.document_id = d.id
            and ff.deleted_at is null
            and fm.pinned = true
        ) as pinned,
        m.sort_order,
        m.added_at
      from public.document_folder_memberships m
      join public.document_folders f on f.id = m.folder_id
      join public.documents d on d.id = m.document_id
      where m.folder_id = p_folder_id
        and f.deleted_at is null
        and d.workspace_id = public.get_my_workspace()
        and (v_search_title is null or d.title ilike '%' || v_search_title || '%')
        and (
          p_cursor_sort_order is null
          or m.sort_order > p_cursor_sort_order
          or (
            m.sort_order = p_cursor_sort_order
            and p_cursor_added_at is not null
            and m.added_at < p_cursor_added_at
          )
          or (
            m.sort_order = p_cursor_sort_order
            and (
              (p_cursor_added_at is null and m.added_at is null)
              or m.added_at = p_cursor_added_at
            )
            and p_cursor_document_id is not null
            and d.id > p_cursor_document_id
          )
        )
      order by m.sort_order asc, m.added_at desc, d.id asc
      limit v_page_size + 1;
    return;
  end if;

  if v_view = 'pinned' then
    return query
      select
        d.id as document_id,
        d.title,
        d.source::text as source,
        d.mime_type,
        d.summary,
        d.audience::text as audience,
        d.status::text as status,
        d.updated_at,
        d.created_at,
        d.word_count,
        (
          select count(*)::bigint
          from public.document_folder_memberships fm
          join public.document_folders ff on ff.id = fm.folder_id
          where fm.document_id = d.id
            and ff.deleted_at is null
        ) as folder_count,
        true as pinned,
        null::integer as sort_order,
        null::timestamptz as added_at
      from public.documents d
      where d.workspace_id = public.get_my_workspace()
        and (v_search_title is null or d.title ilike '%' || v_search_title || '%')
        and exists (
          select 1
          from public.document_folder_memberships m
          join public.document_folders f on f.id = m.folder_id
          where m.document_id = d.id
            and f.deleted_at is null
            and m.pinned = true
        )
        and (
          p_cursor_updated_at is null
          or d.updated_at < p_cursor_updated_at
          or (
            d.updated_at = p_cursor_updated_at
            and p_cursor_document_id is not null
            and d.id < p_cursor_document_id
          )
        )
      order by d.updated_at desc, d.id desc
      limit v_page_size + 1;
    return;
  end if;

  if v_view = 'unfiled' then
    return query
      select
        d.id as document_id,
        d.title,
        d.source::text as source,
        d.mime_type,
        d.summary,
        d.audience::text as audience,
        d.status::text as status,
        d.updated_at,
        d.created_at,
        d.word_count,
        0::bigint as folder_count,
        false as pinned,
        null::integer as sort_order,
        null::timestamptz as added_at
      from public.documents d
      where d.workspace_id = public.get_my_workspace()
        and (v_search_title is null or d.title ilike '%' || v_search_title || '%')
        and not exists (
          select 1
          from public.document_folder_memberships m
          join public.document_folders f on f.id = m.folder_id
          where m.document_id = d.id
            and f.deleted_at is null
        )
        and (
          p_cursor_updated_at is null
          or d.updated_at < p_cursor_updated_at
          or (
            d.updated_at = p_cursor_updated_at
            and p_cursor_document_id is not null
            and d.id < p_cursor_document_id
          )
        )
      order by d.updated_at desc, d.id desc
      limit v_page_size + 1;
    return;
  end if;

  return query
    select
      d.id as document_id,
      d.title,
      d.source::text as source,
      d.mime_type,
      d.summary,
      d.audience::text as audience,
      d.status::text as status,
      d.updated_at,
      d.created_at,
      d.word_count,
      (
        select count(*)::bigint
        from public.document_folder_memberships fm
        join public.document_folders ff on ff.id = fm.folder_id
        where fm.document_id = d.id
          and ff.deleted_at is null
      ) as folder_count,
      exists (
        select 1
        from public.document_folder_memberships fm
        join public.document_folders ff on ff.id = fm.folder_id
        where fm.document_id = d.id
          and ff.deleted_at is null
          and fm.pinned = true
      ) as pinned,
      null::integer as sort_order,
      null::timestamptz as added_at
    from public.documents d
    where d.workspace_id = public.get_my_workspace()
      and (v_search_title is null or d.title ilike '%' || v_search_title || '%')
      and (
        p_cursor_updated_at is null
        or d.updated_at < p_cursor_updated_at
        or (
          d.updated_at = p_cursor_updated_at
          and p_cursor_document_id is not null
          and d.id < p_cursor_document_id
        )
      )
    order by d.updated_at desc, d.id desc
    limit v_page_size + 1;
end;
$$;

comment on function public.document_center_list_documents(text, uuid, integer, timestamptz, timestamptz, integer, uuid, text) is
  'Track 8.1.1 paginated document list surface. Synthetic views sort by updated_at desc/id desc. Folder view sorts by sort_order asc/added_at desc/document_id asc.';

revoke execute on function public.document_center_list_documents(text, uuid, integer, timestamptz, timestamptz, integer, uuid, text) from public;
grant execute on function public.document_center_list_documents(text, uuid, integer, timestamptz, timestamptz, integer, uuid, text) to authenticated, service_role;

create or replace function public.document_center_duplicate_link(
  p_document_id uuid,
  p_target_folder_id uuid
)
returns public.document_folder_memberships
language plpgsql
set search_path = ''
as $$
declare
  v_result public.document_folder_memberships;
begin
  if p_document_id is null or p_target_folder_id is null then
    raise exception 'document_id and target_folder_id are required';
  end if;

  if auth.role() <> 'service_role' and public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.workspace_id = public.get_my_workspace()
  ) then
    raise exception 'document not found';
  end if;

  if not exists (
    select 1
    from public.document_folders f
    where f.id = p_target_folder_id
      and f.workspace_id = public.get_my_workspace()
      and f.deleted_at is null
  ) then
    raise exception 'folder not found';
  end if;

  insert into public.document_folder_memberships (
    document_id,
    folder_id,
    pinned,
    sort_order,
    added_by
  )
  values (
    p_document_id,
    p_target_folder_id,
    false,
    0,
    auth.uid()
  )
  on conflict (document_id, folder_id) do update
    set added_by = coalesce(excluded.added_by, public.document_folder_memberships.added_by)
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.document_center_duplicate_link(uuid, uuid) is
  'Track 8.1.1 organizational duplicate-link helper. Idempotently adds a document-to-folder membership without removing existing memberships.';

revoke execute on function public.document_center_duplicate_link(uuid, uuid) from public;
grant execute on function public.document_center_duplicate_link(uuid, uuid) to authenticated, service_role;

create or replace function public.document_center_move_document(
  p_document_id uuid,
  p_target_folder_id uuid,
  p_source_folder_id uuid default null
)
returns public.document_folder_memberships
language plpgsql
set search_path = ''
as $$
declare
  v_result public.document_folder_memberships;
begin
  v_result := public.document_center_duplicate_link(p_document_id, p_target_folder_id);

  if p_source_folder_id is not null and p_source_folder_id <> p_target_folder_id then
    if not exists (
      select 1
      from public.document_folder_memberships m
      where m.document_id = p_document_id
        and m.folder_id = p_source_folder_id
    ) then
      raise exception 'source membership not found';
    end if;

    delete from public.document_folder_memberships
    where document_id = p_document_id
      and folder_id = p_source_folder_id;
  end if;

  return v_result;
end;
$$;

comment on function public.document_center_move_document(uuid, uuid, uuid) is
  'Track 8.1.1 move helper. Atomically upserts the target membership, then removes the specified source membership.';

revoke execute on function public.document_center_move_document(uuid, uuid, uuid) from public;
grant execute on function public.document_center_move_document(uuid, uuid, uuid) to authenticated, service_role;
