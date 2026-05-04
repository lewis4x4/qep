-- Migration 535: Wave 5 deferred provider registry readiness
--
-- Seeds credential-free integration_status rows for external providers recorded
-- in docs/IntelliDealer/WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md.
-- These rows keep Admin/provider readiness explicit without claiming adapters,
-- credentials, production connectivity, or built integration workflows.

with workspaces as (
  select distinct workspace_id
  from public.integration_status
  where workspace_id is not null
  union
  select 'default'::text
),
providers as (
  select *
  from (
    values
      (
        'avatax',
        'AvaTax',
        'api_key',
        'Tax automation',
        'Live tax-decision wiring remains deferred pending tenant credentials, exemption policy, and provider adapter.'
      ),
      (
        'vesign',
        'VESign / VitalEdge eSign',
        'api_key',
        'Electronic signature',
        'VitalEdge/VESign envelope send, status, and webhook flows remain deferred pending provider credentials and legal/operations policy.'
      ),
      (
        'ups_worldship',
        'UPS WorldShip',
        'api_key',
        'Shipping labels',
        'UPS/WorldShip label or import flow remains deferred pending shipper account context, credentials, and parts/shipping owner decisions.'
      ),
      (
        'jd_quote_ii',
        'JD Quote II',
        'oauth2',
        'OEM quote upload',
        'JD Quote II upload/status import remains deferred pending JD dealer scope, license/access, payload contract, and staging fixtures.'
      ),
      (
        'oem_base_options_imports',
        'OEM Base/Options Imports',
        'api_key',
        'OEM catalog imports',
        'OEM base/options import workflow remains deferred pending in-scope OEM decision, file/API path, credentials, and parser fixtures.'
      ),
      (
        'tethr_telematics',
        'Tethr Telematics',
        'api_key',
        'Fleet telematics',
        'Tethr-specific telematics integration remains deferred pending provider credentials, webhook contract, and device-to-equipment mapping.'
      )
  ) as provider(integration_key, display_name, auth_type, category, deferred_reason)
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
  p.integration_key,
  p.display_name,
  'pending_credentials'::public.integration_status_enum,
  p.auth_type,
  'manual'::public.sync_frequency,
  jsonb_build_object(
    'category', p.category,
    'provider_scope', 'wave_5_deferred_external',
    'implementation_status', 'deferred',
    'external_dependency_required', true,
    'credentials_required', true,
    'register_doc', 'docs/IntelliDealer/WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md',
    'deferred_reason', p.deferred_reason
  )
from workspaces w
cross join providers p
on conflict (workspace_id, integration_key) do nothing;

-- Rollback reference only:
-- delete from public.integration_status
-- where integration_key in (
--   'avatax',
--   'vesign',
--   'ups_worldship',
--   'jd_quote_ii',
--   'oem_base_options_imports',
--   'tethr_telematics'
-- );
