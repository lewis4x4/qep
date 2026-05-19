-- Separate local QRM sync state from HubSpot sync state on voice captures.

alter table public.voice_captures
  add column if not exists qrm_activity_id uuid,
  add column if not exists qrm_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'voice_captures_qrm_activity_id_fkey'
      and conrelid = 'public.voice_captures'::regclass
  ) then
    alter table public.voice_captures
      add constraint voice_captures_qrm_activity_id_fkey
      foreign key (qrm_activity_id)
      references public.qrm_activities(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'qrm_activities_workspace_id_id_unique'
      and conrelid = 'public.qrm_activities'::regclass
  ) then
    alter table public.qrm_activities
      add constraint qrm_activities_workspace_id_id_unique
      unique (workspace_id, id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'voice_captures_qrm_activity_workspace_fkey'
      and conrelid = 'public.voice_captures'::regclass
  ) then
    alter table public.voice_captures
      add constraint voice_captures_qrm_activity_workspace_fkey
      foreign key (workspace_id, qrm_activity_id)
      references public.qrm_activities(workspace_id, id);
  end if;
end $$;

create index if not exists idx_voice_captures_qrm_activity_id
  on public.voice_captures(qrm_activity_id)
  where qrm_activity_id is not null;

create index if not exists idx_voice_captures_qrm_synced_at
  on public.voice_captures(qrm_synced_at)
  where qrm_synced_at is not null;

comment on column public.voice_captures.qrm_activity_id is
  'Local QRM note activity id created/maintained for this voice capture.';

comment on column public.voice_captures.qrm_synced_at is
  'Timestamp when local QRM sync succeeded independent of external CRM sync.';

update public.voice_captures vc
set
  qrm_activity_id = a.id,
  qrm_synced_at = coalesce(vc.qrm_synced_at, now())
from public.qrm_activities a
where a.workspace_id = vc.workspace_id
  and a.deleted_at is null
  and a.activity_type = 'note'
  and a.metadata ->> 'source' = 'voice_capture'
  and a.metadata ->> 'voiceCaptureId' = vc.id::text
  and vc.qrm_activity_id is null;
