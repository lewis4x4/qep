-- Track questions the knowledge base couldn't answer so admins can
-- identify what documents or data need to be added.

create table if not exists public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  user_id uuid references public.profiles(id) on delete set null,
  question text not null,
  trace_id text,
  frequency int not null default 1,
  last_asked_at timestamptz not null default now(),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_gaps enable row level security;

create policy "knowledge_gaps_admin_select" on public.knowledge_gaps
  for select using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "knowledge_gaps_service" on public.knowledge_gaps
  for all using (auth.role() = 'service_role');

create index idx_knowledge_gaps_freq
  on public.knowledge_gaps (resolved, frequency desc);

create index idx_knowledge_gaps_recent
  on public.knowledge_gaps (resolved, last_asked_at desc);
