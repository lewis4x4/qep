-- Module 4: Voice-to-CRM Field Capture

create type public.voice_capture_status as enum ('pending', 'processing', 'synced', 'failed');

create table public.voice_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  audio_storage_path text,
  duration_seconds integer,
  transcript text,
  extracted_data jsonb not null default '{}',
  hubspot_deal_id text,
  hubspot_contact_id text,
  hubspot_note_id text,
  hubspot_task_id text,
  hubspot_synced_at timestamptz,
  sync_status public.voice_capture_status not null default 'pending',
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.voice_captures enable row level security;

create policy "voice_captures_select_own" on public.voice_captures
  for select using (user_id = auth.uid());

create policy "voice_captures_select_elevated" on public.voice_captures
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('manager', 'owner')
    )
  );

create policy "voice_captures_insert_own" on public.voice_captures
  for insert with check (user_id = auth.uid());

create policy "voice_captures_update_own" on public.voice_captures
  for update using (user_id = auth.uid());

create policy "voice_captures_service_all" on public.voice_captures
  for all using (auth.role() = 'service_role');

create trigger set_voice_captures_updated_at before update on public.voice_captures
  for each row execute function public.set_updated_at();
