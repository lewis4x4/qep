-- Migration 613: Telematics adapter contract lookup hardening
--
-- C5.1 keeps the existing migration 090 feed table as the foundation and adds
-- deterministic provider-aware lookup rules for future provider adapters.

create unique index if not exists uq_telematics_feeds_active_workspace_provider_device
  on public.telematics_feeds (workspace_id, provider, device_id)
  where is_active = true;

create index if not exists idx_telematics_feeds_active_provider_device
  on public.telematics_feeds (provider, device_id)
  where is_active = true;

comment on column public.telematics_feeds.provider is
  'Provider adapter key used by normalized telematics ingestion (for example generic_oem, aemp, yanmar_smart_assist).';

comment on index public.uq_telematics_feeds_active_workspace_provider_device is
  'Ensures active telematics device lookups are deterministic per workspace/provider/device for adapter-backed ingestion.';
