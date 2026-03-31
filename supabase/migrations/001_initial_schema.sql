-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Postgres 17: ensure extensions schema operators (e.g. vector <=>) are resolvable
do $$
begin
  execute format(
    'alter database %I set search_path to "$user", public, extensions',
    current_database()
  );
end;
$$;
set search_path to "$user", public, extensions;

-- ============================================================
-- PROFILES (extends auth.users with role-based access)
-- ============================================================
create type public.user_role as enum ('rep', 'admin', 'manager', 'owner');

create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text,
  email text,
  role public.user_role not null default 'rep',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- Owners and managers can read all profiles
create policy "profiles_select_elevated" on public.profiles
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('owner', 'manager', 'admin')
    )
  );

-- Users can update their own profile (non-role fields)
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Only owners can update roles
create policy "profiles_update_role_owner" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- Auto-create profile on sign up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- DOCUMENTS (source files ingested into the knowledge base)
-- ============================================================
create type public.document_source as enum ('onedrive', 'pdf_upload', 'manual');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source public.document_source not null,
  source_id text,                    -- OneDrive item id or upload filename
  source_url text,                   -- OneDrive webUrl
  mime_type text,
  raw_text text,
  metadata jsonb default '{}',
  word_count integer,
  is_active boolean not null default true,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

-- Reps can read active documents (via chunks/chat only — no direct raw_text)
create policy "documents_select_rep" on public.documents
  for select using (
    is_active = true
    and exists (
      select 1 from public.profiles p where p.id = auth.uid()
    )
  );

-- Admins/managers/owners can manage documents
create policy "documents_all_elevated" on public.documents
  for all using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('admin', 'manager', 'owner')
    )
  );

-- ============================================================
-- CHUNKS (document segments with embeddings)
-- ============================================================
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  embedding extensions.vector(1536),
  metadata jsonb default '{}',       -- page number, section header, etc.
  created_at timestamptz not null default now()
);

alter table public.chunks enable row level security;

-- All authenticated users can use chunks for search
create policy "chunks_select_authenticated" on public.chunks
  for select using (auth.role() = 'authenticated');

-- Only service role can insert/update embeddings
create policy "chunks_insert_service" on public.chunks
  for insert with check (auth.role() = 'service_role');

create policy "chunks_update_service" on public.chunks
  for update using (auth.role() = 'service_role');

create policy "chunks_delete_service" on public.chunks
  for delete using (auth.role() = 'service_role');

-- Vector similarity search index (HNSW for fast ANN queries)
create index chunks_embedding_hnsw_idx
  on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================================
-- ONEDRIVE SYNC STATE
-- ============================================================
create table public.onedrive_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  drive_id text,
  delta_token text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onedrive_sync_state enable row level security;

create policy "onedrive_sync_owner" on public.onedrive_sync_state
  for all using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- ============================================================
-- SEMANTIC SEARCH FUNCTION
-- ============================================================
create or replace function public.search_chunks(
  query_embedding extensions.vector(1536),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    d.title as document_title,
    c.content,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where
    d.is_active = true
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create trigger set_onedrive_sync_updated_at before update on public.onedrive_sync_state
  for each row execute function public.set_updated_at();
