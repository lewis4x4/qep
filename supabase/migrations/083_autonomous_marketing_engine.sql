-- ============================================================================
-- Migration 083: Autonomous Marketing Engine
--
-- Event-driven marketing automation:
-- - Inventory triggers (new arrivals → matching customer profiles)
-- - Seasonal campaign automation
-- - Customer-specific AI content from DNA profiles
-- - Social media auto-posting (Facebook Marketplace)
-- - Competitor displacement campaigns
-- ============================================================================

-- ── 1. Marketing campaigns ──────────────────────────────────────────────────

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Campaign
  name text not null,
  campaign_type text not null check (campaign_type in (
    'inventory_arrival', 'seasonal', 'competitor_displacement',
    'fleet_replacement', 'promotion', 'retention', 'custom'
  )),
  description text,

  -- Targeting
  target_segment jsonb default '{}',
  -- { persona: "price_first", equipment_interest: "excavator", region: "lake_city" }
  target_customer_count integer default 0,

  -- Content
  content_template jsonb default '{}',
  -- { subject, body, cta, images[], social_copy }
  ai_generated boolean default false,

  -- Channels
  channels text[] default '{}',
  -- ['email', 'sms', 'facebook', 'machinery_trader']

  -- Schedule
  status text not null default 'draft' check (status in (
    'draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'
  )),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,

  -- Automation trigger
  trigger_type text check (trigger_type in (
    'manual', 'inventory_event', 'seasonal_date', 'fleet_cycle',
    'competitor_signal', 'scheduled_cron'
  )),
  trigger_config jsonb default '{}',
  -- inventory_event: { equipment_category, make, model_pattern }
  -- seasonal_date: { month, day, recurrence }
  -- fleet_cycle: { replacement_window_days }
  -- competitor_signal: { competitor_brand, signal_type }

  -- Results
  sent_count integer default 0,
  open_count integer default 0,
  click_count integer default 0,
  conversion_count integer default 0,
  revenue_attributed numeric default 0,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.marketing_campaigns is 'Autonomous marketing campaigns with AI content, event triggers, and multi-channel delivery.';

-- ── 2. Campaign recipients ──────────────────────────────────────────────────

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  portal_customer_id uuid references public.portal_customers(id) on delete set null,

  -- Personalization
  personalized_content jsonb default '{}',
  -- AI-generated content specific to this customer's DNA profile

  -- Delivery
  channel text not null, -- 'email', 'sms', 'facebook'
  delivered_at timestamptz,
  delivery_status text default 'pending' check (delivery_status in (
    'pending', 'sent', 'delivered', 'bounced', 'failed'
  )),

  -- Engagement
  opened_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  conversion_deal_id uuid references public.crm_deals(id) on delete set null,
  unsubscribed boolean default false,

  created_at timestamptz not null default now()
);

-- ── 3. Inventory event triggers ─────────────────────────────────────────────

create table public.inventory_event_triggers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Trigger condition
  event_type text not null check (event_type in (
    'new_arrival', 'price_drop', 'low_stock', 'back_in_stock',
    'demo_available', 'promotion_start', 'promotion_end'
  )),
  equipment_filter jsonb default '{}',
  -- { category, make, model_pattern, price_min, price_max }

  -- Action
  campaign_template_id uuid references public.marketing_campaigns(id) on delete set null,
  auto_create_campaign boolean default true,
  target_segment jsonb default '{}',

  -- Status
  is_active boolean not null default true,
  last_triggered_at timestamptz,
  trigger_count integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inventory_event_triggers is 'Automated triggers that create marketing campaigns when inventory events occur.';

-- ── 4. Social media posts (auto-posting) ────────────────────────────────────

create table public.social_media_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Content
  platform text not null check (platform in ('facebook', 'facebook_marketplace', 'instagram', 'linkedin')),
  content_text text not null,
  images jsonb default '[]',
  link_url text,

  -- Schedule
  status text not null default 'draft' check (status in (
    'draft', 'scheduled', 'posted', 'failed', 'deleted'
  )),
  scheduled_at timestamptz,
  posted_at timestamptz,
  external_post_id text, -- Platform-specific post ID

  -- Engagement
  likes integer default 0,
  comments integer default 0,
  shares integer default 0,
  reach integer default 0,
  leads_generated integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.social_media_posts is 'Auto-generated social media posts for equipment listings and campaigns.';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.marketing_campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.inventory_event_triggers enable row level security;
alter table public.social_media_posts enable row level security;

create policy "campaigns_workspace" on public.marketing_campaigns for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "campaigns_service" on public.marketing_campaigns for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Recipients via campaign workspace
create or replace function public.campaign_in_my_workspace(p_campaign_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.marketing_campaigns c where c.id = p_campaign_id
    and c.workspace_id = (
      select coalesce(
        current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id',
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'workspace_id',
        'default'
      )
    )
  );
$$;
revoke execute on function public.campaign_in_my_workspace(uuid) from public;
grant execute on function public.campaign_in_my_workspace(uuid) to authenticated;

create policy "recipients_workspace" on public.campaign_recipients for all
  using (public.campaign_in_my_workspace(campaign_id)) with check (public.campaign_in_my_workspace(campaign_id));
create policy "recipients_service" on public.campaign_recipients for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "triggers_workspace" on public.inventory_event_triggers for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "triggers_service" on public.inventory_event_triggers for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "social_posts_workspace" on public.social_media_posts for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "social_posts_service" on public.social_media_posts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 6. Indexes ──────────────────────────────────────────────────────────────

create index idx_campaigns_workspace on public.marketing_campaigns(workspace_id);
create index idx_campaigns_status on public.marketing_campaigns(status) where status in ('scheduled', 'active');
create index idx_campaigns_type on public.marketing_campaigns(campaign_type);

create index idx_recipients_campaign on public.campaign_recipients(campaign_id);
create index idx_recipients_contact on public.campaign_recipients(contact_id) where contact_id is not null;
create index idx_recipients_status on public.campaign_recipients(delivery_status) where delivery_status = 'pending';

create index idx_event_triggers_workspace on public.inventory_event_triggers(workspace_id);
create index idx_event_triggers_active on public.inventory_event_triggers(is_active, event_type) where is_active = true;

create index idx_social_posts_workspace on public.social_media_posts(workspace_id);
create index idx_social_posts_status on public.social_media_posts(status, scheduled_at) where status = 'scheduled';

-- ── 7. Triggers ─────────────────────────────────────────────────────────────

create trigger set_campaigns_updated_at before update on public.marketing_campaigns for each row execute function public.set_updated_at();
create trigger set_event_triggers_updated_at before update on public.inventory_event_triggers for each row execute function public.set_updated_at();
create trigger set_social_posts_updated_at before update on public.social_media_posts for each row execute function public.set_updated_at();
