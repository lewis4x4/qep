create unique index if not exists crm_activities_voice_capture_unique_idx
on public.crm_activities (
  workspace_id,
  deal_id,
  activity_type,
  ((metadata ->> 'voiceCaptureId')),
  ((metadata ->> 'activityKind'))
)
where deleted_at is null
  and metadata ->> 'source' = 'voice_capture';
