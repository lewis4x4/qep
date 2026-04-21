-- ============================================================================
-- Migration 323: Hub — Build Hub v2.2 voice capture + page context
--
-- Turns feedback capture into a voice-first, context-aware surface:
--
--   1. `hub_feedback.submission_context jsonb` — the frontend captures the
--      URL path, page title, build_item_id (from data-attribute), screen
--      size, dark_mode flag, and user-agent shorthand at submit time.
--      The triage prompt in hub-feedback-intake reads this so Claude's
--      summary references "/qrm/quotes/new" in its first clause instead
--      of asking the stakeholder to tell us where they were.
--
--   2. `hub_feedback.voice_duration_ms numeric` — kept alongside the
--      existing voice_audio_url / voice_transcript columns so the inbox
--      can show "0:47" on voice submissions without parsing the audio
--      file again.
--
--   3. `hub-feedback-audio` Storage bucket — private, 8MB cap, webm/mp4/
--      m4a/ogg. Path convention: {workspace_id}/{submitter_id}/{uuid}.{ext}.
--      RLS enforces:
--        - submitter read + insert on own-folder paths
--        - internal admin/owner/manager read on workspace-prefix paths
--        - service role unrestricted (the transcribe edge fn uploads here)
--
-- Design decisions:
--   * Bucket is PRIVATE. Voice is sensitive signal; signed URLs (1h TTL)
--     are minted per-playback by the UI, not baked into the DB column.
--     The column voice_audio_url stores the storage path, not a full URL.
--   * Schema is additive — no existing constraint tightening.
-- ============================================================================

-- ── 1. hub_feedback columns ────────────────────────────────────────────────

alter table public.hub_feedback
  add column if not exists submission_context jsonb not null default '{}'::jsonb,
  add column if not exists voice_duration_ms numeric;

comment on column public.hub_feedback.submission_context is
  'Build Hub v2.2: page + device metadata captured at submit time. Shape: '
  '{ path, title, build_item_id, screen: {w,h}, dark_mode, ua_short }. '
  'Fed into the triage prompt so Claude summaries reference where the '
  'stakeholder was, not just what they said.';

comment on column public.hub_feedback.voice_duration_ms is
  'Milliseconds of recorded audio when the submission is voice-originated. '
  'NULL for typed-only submissions.';

-- Index on the path for "show me everything submitted from the quote
-- builder" style admin queries. Partial index keeps it cheap for the
-- typed-only majority.
create index if not exists idx_hub_feedback_context_path
  on public.hub_feedback ((submission_context ->> 'path'))
  where deleted_at is null
    and submission_context ? 'path';

-- ── 2. Storage bucket: hub-feedback-audio (private) ────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hub-feedback-audio',
  'hub-feedback-audio',
  false,
  8388608,  -- 8 MB, matches iron-transcribe's MAX_AUDIO_BYTES
  array[
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/m4a',
    'audio/ogg',
    'audio/wav'
  ]::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop any prior policies we own (idempotent reruns).
do $$
begin
  if exists (select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'hub_feedback_audio_service_all') then
    drop policy "hub_feedback_audio_service_all" on storage.objects;
  end if;
  if exists (select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'hub_feedback_audio_owner_read') then
    drop policy "hub_feedback_audio_owner_read" on storage.objects;
  end if;
  if exists (select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'hub_feedback_audio_owner_insert') then
    drop policy "hub_feedback_audio_owner_insert" on storage.objects;
  end if;
  if exists (select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'hub_feedback_audio_admin_read') then
    drop policy "hub_feedback_audio_admin_read" on storage.objects;
  end if;
end $$;

-- Service role: unrestricted (hub-feedback-transcribe uploads here).
create policy "hub_feedback_audio_service_all" on storage.objects
  for all
  using (auth.role() = 'service_role' and bucket_id = 'hub-feedback-audio')
  with check (auth.role() = 'service_role' and bucket_id = 'hub-feedback-audio');

-- Submitter read: first path segment is workspace, second is submitter_id.
-- Stakeholders + internal users read their own uploads.
create policy "hub_feedback_audio_owner_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hub-feedback-audio'
    and (storage.foldername(name))[1] = public.get_my_workspace()
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Submitter insert: same scoping. Guardrail — the edge fn uploads via
-- service role, but this policy ensures even a compromised anon key
-- can't write outside its own folder.
create policy "hub_feedback_audio_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hub-feedback-audio'
    and (storage.foldername(name))[1] = public.get_my_workspace()
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Internal admin/owner/manager read: playback from the admin inbox.
-- Scoped to workspace prefix so cross-workspace reads are impossible.
create policy "hub_feedback_audio_admin_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hub-feedback-audio'
    and (storage.foldername(name))[1] = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );
