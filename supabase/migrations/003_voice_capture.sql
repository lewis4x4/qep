-- Voice-to-CRM Field Capture Schema (Module 4)

-- Storage bucket for audio recordings
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-recordings',
  'voice-recordings',
  false,
  52428800, -- 50MB limit
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']
)
on conflict (id) do nothing;

-- Storage RLS: reps upload their own; managers/owners can read all
create policy "voice_recordings_insert" on storage.objects
  for insert with check (
    bucket_id = 'voice-recordings'
    and auth.role() = 'authenticated'
  );

create policy "voice_recordings_select" on storage.objects
  for select using (
    bucket_id = 'voice-recordings'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('manager', 'owner')
      )
    )
  );

create policy "voice_recordings_delete" on storage.objects
  for delete using (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Voice capture sync status
create type public.voice_capture_status as enum ('pending', 'processing', 'synced', 'failed');

-- Voice captures table
create table public.voice_captures (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references public.profiles(id) on delete cascade,
  audio_storage_path  text,
  duration_seconds    integer,
  transcript          text,
  extracted_data      jsonb       not null default '{}',
  hubspot_deal_id     text,
  hubspot_contact_id  text,
  hubspot_note_id     text,
  hubspot_task_id     text,
  hubspot_synced_at   timestamptz,
  sync_status         public.voice_capture_status not null default 'pending',
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.voice_captures enable row level security;

-- Reps see only their own captures; managers/owners see all
create policy "voice_captures_select" on public.voice_captures
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('manager', 'owner')
    )
  );

create policy "voice_captures_insert" on public.voice_captures
  for insert with check (user_id = auth.uid());

create policy "voice_captures_update" on public.voice_captures
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('manager', 'owner')
    )
  );

create policy "voice_captures_service_all" on public.voice_captures
  for all using (auth.role() = 'service_role');

create trigger set_voice_captures_updated_at
  before update on public.voice_captures
  for each row execute function public.set_updated_at();

create index voice_captures_user_id_idx   on public.voice_captures(user_id);
create index voice_captures_created_at_idx on public.voice_captures(created_at desc);
create index voice_captures_sync_status_idx on public.voice_captures(sync_status);
create index voice_captures_hubspot_deal_id_idx on public.voice_captures(hubspot_deal_id)
  where hubspot_deal_id is not null;
