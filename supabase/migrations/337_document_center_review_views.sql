-- Migration 337 — Document Center: Pending Review + Ingest Failures views
--
-- Extends `document_center_list_documents` with two admin-only synthetic views:
--   • 'pending_review'  → documents.status = 'pending_review'
--   • 'ingest_failed'   → documents.status = 'ingest_failed'
--
-- Both filter to the caller's workspace via public.get_my_workspace() and
-- inherit the existing RLS on public.documents (audience + workspace gates).
-- The audience gate already restricts reps from reaching admin-only audiences,
-- so no additional role check is required inside the function — the UI gates
-- the views themselves behind RequireAdmin.
--
-- Also adds `document_reindex_requested` to document_audit_event_type so the
-- /reindex endpoint on document-router can log a canonical audit row when an
-- operator manually retries a failed ingest.
--
-- No data migration. No behavior change for existing views.

-- ── 1. Audit event value for manual reindex requests ────────────────────────
-- `alter type ... add value` must run outside a transaction, so no begin/commit.

alter type public.document_audit_event_type
  add value if not exists 'document_reindex_requested';

-- ── 2. Extend document_center_list_documents with the two review views ─────

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
  v_status_filter public.document_status;
begin
  if v_view not in ('all', 'recent', 'pinned', 'unfiled', 'folder', 'pending_review', 'ingest_failed') then
    raise exception 'invalid document center view: %', v_view;
  end if;

  if v_view = 'folder' and p_folder_id is null then
    raise exception 'folder_id is required for folder view';
  end if;

  if v_view in ('pending_review', 'ingest_failed') then
    v_status_filter := v_view::public.document_status;
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
        and d.status = v_status_filter
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
    return;
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

  -- 'all' / 'recent' share the same query shape.
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
  'Track 8.1.1 + Slice X paginated document list surface. Synthetic views (all, recent, pinned, unfiled, pending_review, ingest_failed) sort by updated_at desc/id desc. Folder view sorts by sort_order asc/added_at desc/document_id asc.';

revoke execute on function public.document_center_list_documents(text, uuid, integer, timestamptz, timestamptz, integer, uuid, text) from public;
grant execute on function public.document_center_list_documents(text, uuid, integer, timestamptz, timestamptz, integer, uuid, text) to authenticated, service_role;
