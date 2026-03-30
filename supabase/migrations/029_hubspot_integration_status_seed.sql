-- Seed workspace-scoped HubSpot integration status rows so Admin can
-- configure OAuth app credentials from /admin/integrations without
-- requiring a manual DB bootstrap.

insert into public.integration_status (
  workspace_id,
  integration_key,
  display_name,
  status,
  auth_type,
  sync_frequency,
  config
)
select
  src.workspace_id,
  'hubspot',
  'HubSpot CRM',
  'pending_credentials',
  'oauth2',
  'manual',
  '{}'::jsonb
from (
  select distinct workspace_id
  from public.integration_status
) as src
where src.workspace_id is not null
on conflict (workspace_id, integration_key) do nothing;

-- rollback:
-- delete from public.integration_status where integration_key = 'hubspot';
