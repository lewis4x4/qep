-- Migration 614: Yanmar / ASV Smart Assist telematics adapter registry
--
-- C5.2 registers Smart Assist as an adapter-ready telematics provider while
-- keeping live connectivity credential-gated and provider-contract gated.

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
  'yanmar_smart_assist',
  'Yanmar / ASV Smart Assist Telematics',
  'pending_credentials'::public.integration_status_enum,
  'api_key',
  'manual'::public.sync_frequency,
  jsonb_build_object(
    'category', 'Fleet telematics',
    'provider_scope', 'telematics_adapter',
    'implementation_status', 'adapter_ready_credentials_blocked',
    'external_dependency_required', true,
    'credentials_required', true,
    'supported_brand_surfaces', jsonb_build_array('Yanmar', 'ASV'),
    'adapter_key', 'yanmar_smart_assist',
    'foundation_migration', '613_telematics_adapter_contract.sql',
    'contract_note', 'Adapter normalizes Smart Assist readings and alerts only; live polling/webhook cutover requires approved credentials, endpoint, payload, and device-mapping policy.'
  )
from workspaces w
on conflict (workspace_id, integration_key) do update set
  display_name = excluded.display_name,
  auth_type = excluded.auth_type,
  sync_frequency = excluded.sync_frequency,
  config = public.integration_status.config || excluded.config,
  updated_at = now();
