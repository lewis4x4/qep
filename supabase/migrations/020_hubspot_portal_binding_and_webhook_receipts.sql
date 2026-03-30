-- CRM MVP Slice 1 (QUA-170)
-- BLOCK-1 / SEC-QEP-009: Canonical workspace→HubSpot portal binding.
-- BLOCK-2: Durable webhook receipt table for insert-first idempotency.
--
-- Rollback (explicit):
--   drop table if exists public.hubspot_webhook_receipts;
--   drop table if exists public.workspace_hubspot_portal cascade;

-- ── Canonical portal binding ─────────────────────────────────────────────────
create table public.workspace_hubspot_portal (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  hub_id text not null,
  connection_id uuid not null references public.hubspot_connections(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_workspace_hubspot_portal_active_workspace
  on public.workspace_hubspot_portal(workspace_id)
  where is_active = true;

create index idx_workspace_hubspot_portal_hub_active
  on public.workspace_hubspot_portal(hub_id, workspace_id)
  where is_active = true;

comment on table public.workspace_hubspot_portal is
  'Canonical mapping from workspace_id to the active HubSpot OAuth connection row used by service-role ingestion.';

alter table public.workspace_hubspot_portal enable row level security;

create policy "workspace_hubspot_portal_service_all"
  on public.workspace_hubspot_portal
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "workspace_hubspot_portal_select_elevated"
  on public.workspace_hubspot_portal
  for select
  using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "workspace_hubspot_portal_insert_admin_owner"
  on public.workspace_hubspot_portal
  for insert
  with check (public.get_my_role() in ('admin', 'owner'));

create policy "workspace_hubspot_portal_update_admin_owner"
  on public.workspace_hubspot_portal
  for update
  using (public.get_my_role() in ('admin', 'owner'))
  with check (public.get_my_role() in ('admin', 'owner'));

create policy "workspace_hubspot_portal_delete_admin_owner"
  on public.workspace_hubspot_portal
  for delete
  using (public.get_my_role() in ('admin', 'owner'));

create trigger set_workspace_hubspot_portal_updated_at
  before update on public.workspace_hubspot_portal
  for each row execute function public.set_updated_at();

-- ── Webhook receipts (idempotency ledger) ────────────────────────────────────
create table public.hubspot_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_key text not null,
  hub_id text not null,
  payload_hash text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'skipped_duplicate')),
  error text,
  created_at timestamptz not null default now(),
  unique (receipt_key)
);

create index idx_hubspot_webhook_receipts_hub_created
  on public.hubspot_webhook_receipts(hub_id, created_at desc);

comment on column public.hubspot_webhook_receipts.receipt_key is
  'Normalized key contract: portalId:objectId:subscriptionType:propertyName:propertyValue:occurredAt (lowercased string fields).';

alter table public.hubspot_webhook_receipts enable row level security;

create policy "hubspot_webhook_receipts_service_all"
  on public.hubspot_webhook_receipts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
