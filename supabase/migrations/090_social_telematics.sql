-- ============================================================================
-- Migration 090: Social / Telematics / Accuracy Tracking
-- ============================================================================

-- ── 1. Social accounts (Meta API credentials) ──────────────────────────────

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  account_name text not null,
  access_token_encrypted text, -- encrypted via hubspot-crypto pattern
  page_id text,
  is_active boolean not null default true,
  last_posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_accounts enable row level security;
create policy "social_accounts_elevated" on public.social_accounts for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "social_accounts_service" on public.social_accounts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_social_accounts_workspace on public.social_accounts(workspace_id);

-- ── 2. Telematics feeds (device config) ─────────────────────────────────────

create table public.telematics_feeds (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  equipment_id uuid references public.crm_equipment(id) on delete set null,
  subscription_id uuid references public.eaas_subscriptions(id) on delete set null,

  provider text not null, -- 'john_deere', 'caterpillar', 'generic_oem'
  device_id text not null,
  device_serial text,

  -- Status
  is_active boolean not null default true,
  last_reading_at timestamptz,
  last_hours numeric,
  last_lat numeric,
  last_lng numeric,

  -- Config
  sync_interval_minutes integer default 60,
  alert_on_excessive_idle boolean default false,
  alert_on_geofence_exit boolean default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telematics_feeds enable row level security;
create policy "telematics_workspace" on public.telematics_feeds for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "telematics_service" on public.telematics_feeds for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_telematics_workspace on public.telematics_feeds(workspace_id);
create index idx_telematics_equipment on public.telematics_feeds(equipment_id) where equipment_id is not null;
create index idx_telematics_active on public.telematics_feeds(is_active) where is_active = true;

-- ── 3. Needs assessment accuracy tracking ───────────────────────────────────

alter table public.needs_assessments
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists fields_corrected integer default 0;

comment on column public.needs_assessments.verified_by is 'Iron Advisor who reviewed and corrected the voice-extracted assessment';
comment on column public.needs_assessments.fields_corrected is 'Number of fields corrected during verification — tracks AI accuracy';

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger set_social_accounts_updated_at before update on public.social_accounts for each row execute function public.set_updated_at();
create trigger set_telematics_feeds_updated_at before update on public.telematics_feeds for each row execute function public.set_updated_at();
