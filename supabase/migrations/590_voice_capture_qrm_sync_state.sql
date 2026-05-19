-- Separate local QRM sync state from HubSpot sync state on voice captures.

alter table public.voice_captures
  add column if not exists qrm_activity_id uuid references public.crm_activities(id) on delete set null,
  add column if not exists qrm_synced_at timestamptz;

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
from public.crm_activities a
where a.workspace_id = vc.workspace_id
  and a.deleted_at is null
  and a.activity_type = 'note'
  and a.metadata ->> 'source' = 'voice_capture'
  and a.metadata ->> 'voiceCaptureId' = vc.id::text
  and vc.qrm_activity_id is null;
