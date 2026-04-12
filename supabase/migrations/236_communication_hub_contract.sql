-- Sprint 4 Communication Hub contract remediation.
-- Adds durable provider-backed communication storage, campaign execution tables,
-- consent fields, and workspace-safe elevated CRM reads.

alter table public.qrm_contacts
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists sms_opt_in_at timestamptz,
  add column if not exists sms_opt_in_source text;

create table if not exists public.crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  channel text not null check (channel in ('email', 'sms')),
  template_id uuid references public.qrm_activity_templates(id) on delete set null,
  audience_snapshot jsonb not null default '{}'::jsonb,
  state text not null default 'draft' check (state in ('draft', 'running', 'completed', 'cancelled')),
  execution_summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_crm_campaigns_workspace_state_created
  on public.crm_campaigns(workspace_id, state, created_at desc)
  where deleted_at is null;

create index if not exists idx_crm_campaigns_workspace_channel_created
  on public.crm_campaigns(workspace_id, channel, created_at desc)
  where deleted_at is null;

create trigger set_crm_campaigns_updated_at
  before update on public.crm_campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.crm_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.crm_campaigns(id) on delete cascade,
  workspace_id text not null default 'default',
  contact_id uuid not null references public.qrm_contacts(id) on delete cascade,
  activity_id uuid references public.qrm_activities(id) on delete set null,
  status text not null check (
    status in ('pending', 'sent', 'delivered', 'failed', 'ineligible')
  ),
  provider_message_id text,
  ineligibility_reason text,
  error_code text,
  attempted_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index if not exists idx_crm_campaign_recipients_campaign_status
  on public.crm_campaign_recipients(campaign_id, status);

create index if not exists idx_crm_campaign_recipients_workspace_status_created
  on public.crm_campaign_recipients(workspace_id, status, created_at desc);

create trigger set_crm_campaign_recipients_updated_at
  before update on public.crm_campaign_recipients
  for each row execute function public.set_updated_at();

create table if not exists public.crm_communication_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  activity_id uuid references public.qrm_activities(id) on delete set null,
  contact_id uuid not null references public.qrm_contacts(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  direction text not null check (direction in ('inbound', 'outbound')),
  provider text check (provider in ('sendgrid', 'twilio')),
  provider_message_id text,
  idempotency_key text,
  status text not null,
  failure_code text,
  subject text,
  body_preview text,
  campaign_id uuid references public.crm_campaigns(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists uq_crm_communication_messages_workspace_provider_message
  on public.crm_communication_messages(workspace_id, provider, provider_message_id)
  where provider_message_id is not null and deleted_at is null;

create index if not exists idx_crm_communication_messages_contact_occurred
  on public.crm_communication_messages(contact_id, occurred_at desc)
  where deleted_at is null;

create index if not exists idx_crm_communication_messages_workspace_occurred
  on public.crm_communication_messages(workspace_id, occurred_at desc)
  where deleted_at is null;

create index if not exists idx_crm_communication_messages_campaign
  on public.crm_communication_messages(campaign_id)
  where campaign_id is not null;

create trigger set_crm_communication_messages_updated_at
  before update on public.crm_communication_messages
  for each row execute function public.set_updated_at();

create table if not exists public.crm_communication_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  provider text not null check (provider in ('sendgrid', 'twilio')),
  event_id text not null,
  payload_hash text,
  route_binding_key text,
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, event_id)
);

create index if not exists idx_crm_communication_webhook_receipts_workspace_provider_created
  on public.crm_communication_webhook_receipts(workspace_id, provider, created_at desc);

create trigger set_crm_communication_webhook_receipts_updated_at
  before update on public.crm_communication_webhook_receipts
  for each row execute function public.set_updated_at();

alter table public.crm_campaigns enable row level security;
alter table public.crm_campaign_recipients enable row level security;
alter table public.crm_communication_messages enable row level security;
alter table public.crm_communication_webhook_receipts enable row level security;

create policy "crm_campaigns_service_all"
  on public.crm_campaigns
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_campaign_recipients_service_all"
  on public.crm_campaign_recipients
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_communication_messages_service_all"
  on public.crm_communication_messages
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_communication_webhook_receipts_service_all"
  on public.crm_communication_webhook_receipts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "crm_companies_all_elevated" on public.qrm_companies;
create policy "crm_companies_all_elevated"
  on public.qrm_companies
  for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

drop policy if exists "crm_contacts_all_elevated" on public.qrm_contacts;
create policy "crm_contacts_all_elevated"
  on public.qrm_contacts
  for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

drop policy if exists "crm_deals_all_elevated" on public.qrm_deals;
create policy "crm_deals_all_elevated"
  on public.qrm_deals
  for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

drop policy if exists "crm_activities_all_elevated" on public.qrm_activities;
create policy "crm_activities_all_elevated"
  on public.qrm_activities
  for all
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

-- Rollback (manual):
-- drop policy if exists "crm_communication_webhook_receipts_service_all" on public.crm_communication_webhook_receipts;
-- drop policy if exists "crm_communication_messages_service_all" on public.crm_communication_messages;
-- drop policy if exists "crm_campaign_recipients_service_all" on public.crm_campaign_recipients;
-- drop policy if exists "crm_campaigns_service_all" on public.crm_campaigns;
-- drop table if exists public.crm_communication_webhook_receipts;
-- drop table if exists public.crm_communication_messages;
-- drop table if exists public.crm_campaign_recipients;
-- drop table if exists public.crm_campaigns;
-- alter table public.qrm_contacts
--   drop column if exists sms_opt_in_source,
--   drop column if exists sms_opt_in_at,
--   drop column if exists sms_opt_in;
