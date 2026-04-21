-- ============================================================================
-- Migration 324: Hub — Build Hub v2.3 feedback as knowledge-source type
--
-- The "Remembered" tenet: when a stakeholder asks the Project Brain "why does
-- the quote builder auto-pick the preferred vendor?" Claude's answer should
-- cite *Ryan's feedback that surfaced it* — not just the changelog entry.
-- That requires shipped hub_feedback rows to live in the knowledge corpus
-- next to changelog + decisions + specs.
--
-- Changes:
--   1. Widen `hub_knowledge_source.source_type` check to include 'feedback'.
--   2. Add `related_feedback_id uuid` column with an ON DELETE SET NULL
--      foreign key. Enables cite-back from Ask-the-Brain to the inbox card.
--   3. Rebuild `match_hub_knowledge` RPC to also return the feedback id.
--      Signature + SECURITY DEFINER workspace isolation preserved exactly —
--      we drop+recreate only because return-table shapes are immutable.
--
-- The hub-knowledge-sync edge function will pick up shipped feedback as a
-- 4th candidate type once this migration lands. Until then, existing sync
-- behaviour is unaffected — this is additive only.
-- ============================================================================

-- 1. Widen the check constraint.
alter table public.hub_knowledge_source
  drop constraint if exists hub_knowledge_source_source_type_check;

alter table public.hub_knowledge_source
  add constraint hub_knowledge_source_source_type_check
  check (source_type in (
    'transcript', 'document', 'changelog', 'decision', 'email', 'spec',
    'roadmap', 'feedback'
  ));

-- 2. Add the feedback foreign key. ON DELETE SET NULL so purging a feedback
--    row doesn't torch the knowledge chunk — the markdown body remains as
--    a historical record even if the original submission is gone.
alter table public.hub_knowledge_source
  add column if not exists related_feedback_id uuid
    references public.hub_feedback(id) on delete set null;

comment on column public.hub_knowledge_source.related_feedback_id is
  'Build Hub v2.3: soft-FK to the hub_feedback row this source was distilled '
  'from, when source_type=''feedback''. Lets Ask-the-Brain citations deep-link '
  'back to the submitter story in /brief/feedback.';

create index if not exists idx_hub_knowledge_source_feedback
  on public.hub_knowledge_source (related_feedback_id)
  where related_feedback_id is not null
    and deleted_at is null;

-- 3. Rebuild the RPC. Same signature, same SECURITY DEFINER + profiles
--    workspace isolation as migration 314. Only the returns-table gains
--    `related_feedback_id` at the end — existing callers ignore it.
drop function if exists public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
);

create or replace function public.match_hub_knowledge(
  p_query_embedding extensions.vector(1536),
  p_workspace text default null,
  p_match_count integer default 8,
  p_min_similarity float default 0.7
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
begin
  if auth.uid() is not null then
    select active_workspace_id into ws from public.profiles where id = auth.uid();
    ws := coalesce(ws, 'default');
  else
    ws := coalesce(p_workspace, 'default');
  end if;

  return query
    select
      c.id as chunk_id,
      c.source_id,
      c.chunk_index,
      c.body,
      1 - (c.embedding <=> p_query_embedding) as similarity,
      s.title as source_title,
      s.source_type,
      s.notebooklm_source_id,
      s.related_build_item_id,
      s.related_decision_id,
      s.related_feedback_id
    from public.hub_knowledge_chunk c
    join public.hub_knowledge_source s on s.id = c.source_id
    where c.workspace_id = ws
      and s.deleted_at is null
      and c.embedding is not null
      and (1 - (c.embedding <=> p_query_embedding)) >= p_min_similarity
    order by c.embedding <=> p_query_embedding
    limit greatest(1, least(p_match_count, 50));
end;
$$;

comment on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) is
  'Ask-the-Project-Brain retrieval RPC. Returns top-k cosine-similar chunks '
  'with source citation metadata, including v2.3 related_feedback_id so '
  'answers can cite the stakeholder feedback that drove the shipped change. '
  'Workspace isolation enforced via profiles lookup.';

revoke execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) from public;

grant execute on function public.match_hub_knowledge(
  extensions.vector(1536), text, integer, float
) to authenticated, service_role;
