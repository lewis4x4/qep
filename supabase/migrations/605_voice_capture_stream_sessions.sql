-- VC-3 live call capture stream sessions and idempotent chunk receipts.
-- Additive only: existing voice captures remain note-mode by default.

alter table public.voice_captures
  add column if not exists activity_type public.crm_activity_type not null default 'note';

comment on column public.voice_captures.activity_type is
  'CRM activity mode represented by this capture. Existing field notes default to note; live call capture uses call.';

create table if not exists public.voice_capture_stream_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_session_id text not null,
  -- Migration 170 renamed crm_* tables to qrm_* and left crm_* as compatibility views.
  -- Foreign keys must target the underlying tables, not the views.
  company_id uuid references public.qrm_companies(id) on delete set null,
  contact_id uuid references public.qrm_contacts(id) on delete set null,
  deal_id uuid references public.qrm_deals(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'finalizing', 'finalized', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  finalized_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  expected_chunk_count integer check (expected_chunk_count is null or expected_chunk_count >= 0),
  transcript text,
  voice_capture_id uuid references public.voice_captures(id) on delete set null,
  crm_activity_id uuid references public.qrm_activities(id) on delete set null,
  sync_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, client_session_id)
);

create table if not exists public.voice_capture_stream_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voice_capture_stream_sessions(id) on delete cascade,
  workspace_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_chunk_id text,
  chunk_index integer not null check (chunk_index >= 0),
  mime_type text,
  byte_size integer check (byte_size is null or byte_size >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  audio_storage_path text,
  transcript text,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed', 'skipped')),
  error text,
  received_at timestamptz not null default now(),
  transcribed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (session_id, chunk_index)
);

create unique index if not exists voice_capture_stream_sessions_voice_capture_id_uidx
  on public.voice_capture_stream_sessions(voice_capture_id)
  where voice_capture_id is not null;

create unique index if not exists voice_capture_stream_sessions_crm_activity_id_uidx
  on public.voice_capture_stream_sessions(crm_activity_id)
  where crm_activity_id is not null;

create index if not exists voice_capture_stream_sessions_user_started_idx
  on public.voice_capture_stream_sessions(workspace_id, user_id, started_at desc);

create index if not exists voice_capture_stream_sessions_company_started_idx
  on public.voice_capture_stream_sessions(company_id, started_at desc)
  where company_id is not null;

create unique index if not exists voice_capture_stream_chunks_client_chunk_uidx
  on public.voice_capture_stream_chunks(session_id, client_chunk_id)
  where client_chunk_id is not null;

create index if not exists voice_capture_stream_chunks_session_index_idx
  on public.voice_capture_stream_chunks(session_id, chunk_index);

create unique index if not exists crm_activities_voice_capture_stream_capture_unique_idx
  on public.qrm_activities(
    workspace_id,
    (metadata ->> 'voiceCaptureId'),
    (metadata ->> 'activityKind')
  )
  where deleted_at is null
    and metadata ->> 'source' = 'voice_capture'
    and metadata ->> 'captureMode' = 'live_call'
    and metadata ? 'voiceCaptureId'
    and metadata ? 'activityKind';

alter table public.voice_capture_stream_sessions enable row level security;
alter table public.voice_capture_stream_chunks enable row level security;

drop policy if exists "voice_capture_stream_sessions_select" on public.voice_capture_stream_sessions;
create policy "voice_capture_stream_sessions_select"
  on public.voice_capture_stream_sessions
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'manager', 'owner')
        and coalesce(p.active_workspace_id, 'default') = voice_capture_stream_sessions.workspace_id
    )
  );

drop policy if exists "voice_capture_stream_sessions_service_all" on public.voice_capture_stream_sessions;
create policy "voice_capture_stream_sessions_service_all"
  on public.voice_capture_stream_sessions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "voice_capture_stream_chunks_select" on public.voice_capture_stream_chunks;
create policy "voice_capture_stream_chunks_select"
  on public.voice_capture_stream_chunks
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'manager', 'owner')
        and coalesce(p.active_workspace_id, 'default') = voice_capture_stream_chunks.workspace_id
    )
  );

drop policy if exists "voice_capture_stream_chunks_service_all" on public.voice_capture_stream_chunks;
create policy "voice_capture_stream_chunks_service_all"
  on public.voice_capture_stream_chunks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists set_voice_capture_stream_sessions_updated_at on public.voice_capture_stream_sessions;
create trigger set_voice_capture_stream_sessions_updated_at
  before update on public.voice_capture_stream_sessions
  for each row execute function public.set_updated_at();

comment on table public.voice_capture_stream_sessions is
  'VC-3 live call capture sessions. Idempotent by workspace/user/client_session_id.';

comment on table public.voice_capture_stream_chunks is
  'VC-3 live call capture audio chunks. Idempotent by session/chunk index and optional client_chunk_id.';
