-- Migration: 032_communication_integration_status_seed.sql
-- Purpose: Seed workspace-scoped integration_status rows for Communication Hub providers.

with workspaces as (
  select distinct workspace_id
  from public.integration_status
  where workspace_id is not null
  union
  select 'default'::text
)
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
  w.workspace_id,
  seed.integration_key,
  seed.display_name,
  'pending_credentials'::public.integration_status_enum,
  seed.auth_type,
  'manual'::public.sync_frequency,
  '{}'::jsonb
from workspaces w
cross join (
  values
    ('sendgrid', 'SendGrid Email', 'api_key'),
    ('twilio', 'Twilio SMS', 'api_key')
) as seed(integration_key, display_name, auth_type)
on conflict (workspace_id, integration_key) do nothing;

-- Rollback (reference only)
-- delete from public.integration_status
-- where integration_key in ('sendgrid', 'twilio');
