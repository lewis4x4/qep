-- Migration 342 — Document Knowledge Gaps (Slice IX)
--
-- Captures low-confidence or abandoned /ask attempts so admins can see
-- where the knowledge base is thin and (in a follow-up slice) promote
-- clusters of related questions into first-class SOPs.
--
-- Writes come from the document-router /ask endpoint: whenever the top
-- citation confidence falls below 0.5 OR zero citations land, a row is
-- inserted fire-and-forget. The `question_hash` is workspace-scoped +
-- lower/trim-normalized so repeat askers build a signal without
-- polluting the table with duplicates at clustering time.
--
-- RLS:
--   SELECT → admin+ in the caller's workspace
--   INSERT/UPDATE/DELETE → service-role only

create table if not exists public.document_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  document_id uuid references public.documents(id) on delete set null,
  question_text text not null,
  question_hash text not null,
  asked_by uuid references public.profiles(id) on delete set null,
  asked_at timestamptz not null default now(),
  retrieved_evidence_hash text,
  user_reaction text check (user_reaction in ('thumbs_up','thumbs_down','abandoned','low_confidence')),
  top_citation_confidence real,
  answer_preview text,
  trace_id uuid,
  cluster_id uuid,
  promoted_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_kg_workspace_asked on public.document_knowledge_gaps (workspace_id, asked_at desc);
create index if not exists idx_kg_cluster on public.document_knowledge_gaps (cluster_id) where cluster_id is not null;
create index if not exists idx_kg_question_hash on public.document_knowledge_gaps (workspace_id, question_hash, asked_at desc);

alter table public.document_knowledge_gaps enable row level security;

drop policy if exists document_knowledge_gaps_select on public.document_knowledge_gaps;
create policy document_knowledge_gaps_select on public.document_knowledge_gaps
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner')
  );

drop policy if exists document_knowledge_gaps_write on public.document_knowledge_gaps;
create policy document_knowledge_gaps_write on public.document_knowledge_gaps
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.document_knowledge_gaps is
  'Slice IX: captures low-confidence or explicitly-downvoted answers from the document Ask surface. Clustering + SOP promotion happen in a follow-up cron.';
