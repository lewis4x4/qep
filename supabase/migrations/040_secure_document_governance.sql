-- Secure document governance, retrieval access controls, and auditability.

do $$
begin
  if not exists (
    select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'document_audience'
  ) then
    create type public.document_audience as enum (
      'company_wide',
      'finance',
      'leadership',
      'admin_owner',
      'owner_only'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'document_status'
  ) then
    create type public.document_status as enum (
      'draft',
      'pending_review',
      'published',
      'archived',
      'ingest_failed'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'document_audit_event_type'
  ) then
    create type public.document_audit_event_type as enum (
      'uploaded',
      'reindexed',
      'approved',
      'published',
      'archived',
      'reclassified',
      'deleted',
      'status_changed',
      'ingest_failed'
    );
  end if;
end
$$;

alter table public.documents
  add column if not exists audience public.document_audience,
  add column if not exists status public.document_status,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists classification_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists classification_updated_at timestamptz,
  add column if not exists review_owner_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists review_due_at timestamptz;

update public.documents
set
  audience = coalesce(audience, 'company_wide'::public.document_audience),
  status = coalesce(
    status,
    case
      when is_active then 'published'::public.document_status
      else 'archived'::public.document_status
    end
  ),
  approved_at = case
    when approved_at is not null then approved_at
    when coalesce(status, case when is_active then 'published'::public.document_status else 'archived'::public.document_status end) = 'published'::public.document_status
      then updated_at
    else null
  end,
  classification_updated_at = coalesce(classification_updated_at, updated_at);

alter table public.documents
  alter column audience set default 'company_wide'::public.document_audience,
  alter column audience set not null,
  alter column status set default 'published'::public.document_status,
  alter column status set not null;

create table if not exists public.document_audit_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete set null,
  document_title_snapshot text,
  event_type public.document_audit_event_type not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

alter table public.document_audit_events enable row level security;

create index if not exists idx_documents_status_audience_updated
  on public.documents (status, audience, updated_at desc);

create index if not exists idx_documents_review_due
  on public.documents (status, review_due_at)
  where status = 'pending_review';

create index if not exists idx_document_audit_events_document_created
  on public.document_audit_events (document_id, created_at desc);

create index if not exists idx_document_audit_events_actor_created
  on public.document_audit_events (actor_user_id, created_at desc);

create or replace function public.document_role_can_view_audience(
  p_audience public.document_audience,
  p_role text
)
returns boolean
language sql
immutable
as $$
  select case p_audience
    when 'company_wide' then p_role in ('rep', 'admin', 'manager', 'owner')
    when 'finance' then p_role in ('admin', 'manager', 'owner')
    when 'leadership' then p_role in ('manager', 'owner')
    when 'admin_owner' then p_role in ('admin', 'owner')
    when 'owner_only' then p_role = 'owner'
    else false
  end;
$$;

create or replace function public.sync_document_compatibility_fields()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.status = 'published');

  if tg_op = 'UPDATE' then
    if new.audience is distinct from old.audience then
      new.classification_updated_at := now();
      new.classification_updated_by := coalesce(new.classification_updated_by, auth.uid(), old.classification_updated_by);
    end if;

    if new.status = 'published' and old.status is distinct from new.status and new.approved_at is null then
      new.approved_at := now();
    end if;
  elsif tg_op = 'INSERT' then
    if new.status = 'published' and new.approved_at is null then
      new.approved_at := now();
    end if;
    if new.classification_updated_at is null then
      new.classification_updated_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_documents_sync_compatibility on public.documents;
create trigger trg_documents_sync_compatibility
  before insert or update on public.documents
  for each row execute function public.sync_document_compatibility_fields();

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
as $$
  with keyword_hits as (
    select
      'document'::text as source_type,
      d.id as source_id,
      d.title as source_title,
      trim(
        case
          when strpos(lower(coalesce(d.raw_text, '')), lower(keyword_query)) > 0 then substring(
            coalesce(d.raw_text, '')
            from greatest(strpos(lower(coalesce(d.raw_text, '')), lower(keyword_query)) - 120, 1)
            for 420
          )
          else left(coalesce(d.raw_text, ''), 420)
        end
      ) as excerpt,
      case
        when lower(d.title) = lower(keyword_query) then 0.99::float
        when d.title ilike '%' || keyword_query || '%' then 0.95::float
        when coalesce(d.raw_text, '') ilike '%' || keyword_query || '%' then 0.86::float
        else 0.0::float
      end as confidence,
      d.audience::text as access_class
    from public.documents d
    where
      nullif(btrim(keyword_query), '') is not null
      and d.status = 'published'
      and public.document_role_can_view_audience(d.audience, user_role)
      and (
        d.title ilike '%' || keyword_query || '%'
        or coalesce(d.raw_text, '') ilike '%' || keyword_query || '%'
      )
  ),
  combined as (
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
        order by confidence desc, source_title
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

revoke execute on function public.document_role_can_view_audience(public.document_audience, text) from public;
grant execute on function public.document_role_can_view_audience(public.document_audience, text) to authenticated, service_role;

revoke execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float) from public;
grant execute on function public.retrieve_document_evidence(extensions.vector(1536), text, text, int, float) to authenticated, service_role;

drop policy if exists "document_audit_events_select_elevated" on public.document_audit_events;
create policy "document_audit_events_select_elevated"
  on public.document_audit_events
  for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

drop policy if exists "documents_select_rep" on public.documents;
drop policy if exists "documents_all_elevated" on public.documents;
drop policy if exists "documents_select_visible_role_scoped" on public.documents;
drop policy if exists "documents_select_elevated_all" on public.documents;

create policy "documents_select_visible_role_scoped"
  on public.documents
  for select
  using (
    status = 'published'
    and public.document_role_can_view_audience(audience, public.get_my_role()::text)
  );

create policy "documents_select_elevated_all"
  on public.documents
  for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

drop policy if exists "chunks_select_authenticated" on public.chunks;
drop policy if exists "chunks_select_visible_documents" on public.chunks;

create policy "chunks_select_visible_documents"
  on public.chunks
  for select
  using (
    exists (
      select 1
      from public.documents d
      where
        d.id = chunks.document_id
        and d.status = 'published'
        and public.document_role_can_view_audience(d.audience, public.get_my_role()::text)
    )
  );
