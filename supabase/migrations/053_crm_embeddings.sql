-- CRM record embeddings: semantic vector search for contacts, companies,
-- deals, equipment, voice captures, and activities.
-- Separate from the document/chunks pipeline so document_id FK isn't violated.

create table public.crm_embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'contact', 'company', 'deal', 'equipment', 'voice_capture', 'activity'
  )),
  entity_id uuid not null,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_embeddings enable row level security;

create unique index idx_crm_embeddings_entity
  on public.crm_embeddings (entity_type, entity_id);

create index idx_crm_embeddings_hnsw
  on public.crm_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index idx_crm_embeddings_type
  on public.crm_embeddings (entity_type);

-- Authenticated users can search CRM embeddings (RLS on the source CRM tables
-- already gates what users can access; embedding search is a discovery layer).
create policy "crm_embeddings_select_authenticated" on public.crm_embeddings
  for select using (auth.role() = 'authenticated');

create policy "crm_embeddings_service" on public.crm_embeddings
  for all using (auth.role() = 'service_role');

create trigger set_crm_embeddings_updated_at
  before update on public.crm_embeddings
  for each row execute function public.set_updated_at();
