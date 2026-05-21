-- Migration 616: KL-2 role-aware knowledge ingestion and retrieval access
--
-- Roadmap: E4.2 / QEP-131
-- Source plan: QEP-OMI-CONSOLIDATED-BUILD-PLAN.md KL-2
--
-- Goal:
--   * Add explicit audience/role ACL rows for hub knowledge sources.
--   * Enforce access before hub knowledge ranking so unauthorized users receive
--     no matches rather than proof that restricted material exists.
--   * Keep service-role ingestion possible while tightening direct authenticated
--     reads of hub_knowledge_source and hub_knowledge_chunk.

create table if not exists public.kb_audience_role_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  source_id uuid not null references public.hub_knowledge_source(id) on delete cascade,
  audience text not null check (audience in ('internal', 'stakeholder')),
  role text not null check (role in ('rep', 'admin', 'manager', 'owner', 'client_stakeholder')),
  created_at timestamptz not null default now(),
  unique (source_id, audience, role)
);

comment on table public.kb_audience_role_access is
  'KL-2 audience/role ACL for hub knowledge ingestion and retrieval. Rows are '
  'checked before ranking so unauthorized callers receive no matches without '
  'existence leakage.';

create index if not exists idx_kb_audience_role_access_source
  on public.kb_audience_role_access (source_id, audience, role);

create index if not exists idx_kb_audience_role_access_workspace_role
  on public.kb_audience_role_access (workspace_id, audience, role);

alter table public.kb_audience_role_access enable row level security;

drop policy if exists kb_audience_role_access_service_all on public.kb_audience_role_access;
create policy kb_audience_role_access_service_all
  on public.kb_audience_role_access
  for all to service_role
  using (true)
  with check (true);

drop policy if exists kb_audience_role_access_visible_self on public.kb_audience_role_access;
create policy kb_audience_role_access_visible_self
  on public.kb_audience_role_access
  for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and audience = coalesce((select public.get_my_audience()), 'internal')
    and role = ((select public.get_my_role())::text)
  );

grant select on public.kb_audience_role_access to authenticated;

-- Preserve existing hub visibility by defaulting current sources to every
-- currently allowed hub role. Future ingestion can narrow this explicitly.
with access_roles(audience, role) as (
  values
    ('internal', 'rep'),
    ('internal', 'admin'),
    ('internal', 'manager'),
    ('internal', 'owner'),
    ('stakeholder', 'client_stakeholder')
)
insert into public.kb_audience_role_access (workspace_id, source_id, audience, role)
select s.workspace_id, s.id, ar.audience, ar.role
from public.hub_knowledge_source s
cross join access_roles ar
where s.deleted_at is null
on conflict (source_id, audience, role) do nothing;

create or replace function public.kb_role_can_access_source(
  p_source_id uuid,
  p_workspace_id text,
  p_role text,
  p_audience text
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.kb_audience_role_access access
    where access.source_id = p_source_id
      and access.workspace_id = p_workspace_id
      and access.audience = coalesce(nullif(btrim(p_audience), ''), 'internal')
      and access.role = nullif(btrim(p_role), '')
  );
$$;

comment on function public.kb_role_can_access_source(uuid, text, text, text) is
  'Security-definer ACL predicate for KL-2 hub knowledge retrieval/RLS. '
  'Used before ranking to avoid restricted-source existence leakage.';

grant execute on function public.kb_role_can_access_source(uuid, text, text, text)
  to authenticated, service_role;

-- Tighten direct source/chunk reads to the same ACL used by retrieval.
drop policy if exists hub_knowledge_source_workspace_read on public.hub_knowledge_source;
drop policy if exists hub_knowledge_source_acl_read on public.hub_knowledge_source;
create policy hub_knowledge_source_acl_read
  on public.hub_knowledge_source
  for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and deleted_at is null
    and public.kb_role_can_access_source(
      id,
      workspace_id,
      ((select public.get_my_role())::text),
      coalesce((select public.get_my_audience()), 'internal')
    )
  );

drop policy if exists hub_knowledge_chunk_workspace_read on public.hub_knowledge_chunk;
drop policy if exists hub_knowledge_chunk_acl_read on public.hub_knowledge_chunk;
create policy hub_knowledge_chunk_acl_read
  on public.hub_knowledge_chunk
  for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.hub_knowledge_source source
      where source.id = hub_knowledge_chunk.source_id
        and source.workspace_id = hub_knowledge_chunk.workspace_id
        and source.deleted_at is null
        and public.kb_role_can_access_source(
          source.id,
          source.workspace_id,
          ((select public.get_my_role())::text),
          coalesce((select public.get_my_audience()), 'internal')
        )
    )
  );

-- Replace match_hub_knowledge with ACL-aware candidate filtering. The filter is
-- applied in candidate_scope before similarity ranking, so restricted chunks do
-- not affect order, count, or timing in a way that reveals existence.
revoke execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) from public, authenticated, service_role;
drop function if exists public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
);

create or replace function public.match_hub_knowledge(
  p_query_embedding extensions.vector(1536),
  p_workspace text default null,
  p_match_count integer default 8,
  p_min_similarity float default 0.7,
  p_caller_role text default null,
  p_caller_audience text default null
)
returns table (
  chunk_id uuid,
  source_id uuid,
  chunk_index integer,
  body text,
  similarity float,
  source_title text,
  source_type text,
  notebooklm_source_id text,
  related_build_item_id uuid,
  related_decision_id uuid,
  related_feedback_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  caller_role text;
  caller_audience text;
begin
  if auth.uid() is not null then
    select
      coalesce(active_workspace_id, 'default'),
      role::text,
      coalesce(audience, 'internal')
    into ws, caller_role, caller_audience
    from public.profiles
    where id = auth.uid();

    ws := coalesce(ws, 'default');
    caller_role := coalesce(caller_role, p_caller_role);
    caller_audience := coalesce(caller_audience, p_caller_audience, 'internal');
  else
    ws := coalesce(nullif(btrim(p_workspace), ''), 'default');
    caller_role := nullif(btrim(p_caller_role), '');
    caller_audience := coalesce(nullif(btrim(p_caller_audience), ''), 'internal');
  end if;

  if caller_role is null then
    return;
  end if;

  return query
    with candidate_scope as (
      select
        c.id as chunk_id,
        c.source_id,
        c.chunk_index,
        c.body,
        c.embedding,
        s.title,
        s.source_type,
        s.notebooklm_source_id,
        s.related_build_item_id,
        s.related_decision_id,
        s.related_feedback_id
      from public.hub_knowledge_chunk c
      join public.hub_knowledge_source s on s.id = c.source_id
      where c.workspace_id = ws
        and s.workspace_id = ws
        and s.deleted_at is null
        and c.embedding is not null
        and public.kb_role_can_access_source(s.id, s.workspace_id, caller_role, caller_audience)
    ),
    ranked as (
      select
        candidate_scope.*,
        1 - (candidate_scope.embedding <=> p_query_embedding) as similarity
      from candidate_scope
      where (1 - (candidate_scope.embedding <=> p_query_embedding)) >= p_min_similarity
    )
    select
      ranked.chunk_id,
      ranked.source_id,
      ranked.chunk_index,
      ranked.body,
      ranked.similarity,
      ranked.title as source_title,
      ranked.source_type,
      ranked.notebooklm_source_id,
      ranked.related_build_item_id,
      ranked.related_decision_id,
      ranked.related_feedback_id
    from ranked
    order by ranked.embedding <=> p_query_embedding
    limit greatest(1, least(coalesce(p_match_count, 8), 50));
end;
$$;

comment on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float, text, text
) is
  'KL-2 ACL-aware hub knowledge retrieval. Filters by caller audience/role '
  'before similarity ranking so unauthorized callers get no matches without '
  'restricted-source existence leakage.';

revoke execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float, text, text
) from public;

grant execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float, text, text
) to authenticated, service_role;
