create unique index if not exists crm_activities_voice_capture_cluster_unique_idx
on public.qrm_activities (
  workspace_id,
  activity_type,
  coalesce(deal_id::text, company_id::text, contact_id::text),
  (metadata ->> 'voiceClusterKey'),
  (metadata ->> 'activityKind')
)
where deleted_at is null
  and metadata ->> 'source' = 'voice_capture'
  and metadata ? 'voiceClusterKey';
