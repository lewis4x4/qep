-- ============================================================================
-- Migration 163: Service Knowledge Base (Wave 6.6)
--
-- "What solved this last time" — institutional memory for service.
-- Technicians contribute solutions; the AskIronAdvisor button preloads
-- matching entries into the chat system prompt.
-- ============================================================================

create table if not exists public.service_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  make text,
  model text,
  fault_code text,
  symptom text not null,
  solution text not null,
  parts_used jsonb not null default '[]'::jsonb,
  contributed_by uuid references public.profiles(id) on delete set null,
  verified boolean not null default false,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_knowledge_base is 'Tech-contributed solutions per make/model/fault. Surfaced by AskIronAdvisor and the institutional memory panel on Asset 360.';

alter table public.service_knowledge_base enable row level security;

create policy "kb_workspace_select" on public.service_knowledge_base for select
  using (workspace_id = public.get_my_workspace());
create policy "kb_workspace_insert" on public.service_knowledge_base for insert
  with check (workspace_id = public.get_my_workspace());
create policy "kb_workspace_update" on public.service_knowledge_base for update
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "kb_service" on public.service_knowledge_base for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_kb_make_model on public.service_knowledge_base(make, model) where make is not null;
create index idx_kb_fault_code on public.service_knowledge_base(fault_code) where fault_code is not null;
create index idx_kb_workspace on public.service_knowledge_base(workspace_id);
create index idx_kb_verified on public.service_knowledge_base(verified) where verified = true;

create trigger set_kb_updated_at
  before update on public.service_knowledge_base
  for each row execute function public.set_updated_at();

-- Match function used by sop-suggest / chat preload
create or replace function public.match_service_knowledge(
  p_make text default null,
  p_model text default null,
  p_fault_code text default null,
  p_limit int default 5
)
returns setof public.service_knowledge_base
language sql
security invoker
stable
as $$
  select kb.*
  from public.service_knowledge_base kb
  where (p_fault_code is not null and kb.fault_code = p_fault_code)
     or (p_make is not null and p_model is not null and kb.make = p_make and kb.model = p_model)
     or (p_make is not null and kb.make = p_make and kb.model is null)
  order by kb.verified desc, kb.use_count desc, kb.updated_at desc
  limit p_limit;
$$;

comment on function public.match_service_knowledge(text, text, text, int) is 'Ranked KB lookup for AskIronAdvisor + Asset 360 institutional memory panel.';
