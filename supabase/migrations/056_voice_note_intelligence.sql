-- Voice note intelligence: indexed signals extracted from voice captures
-- for fast querying, alerting, and competitive tracking.

alter table public.voice_captures
  add column if not exists sentiment text,
  add column if not exists competitor_mentions text[] default '{}',
  add column if not exists linked_contact_id uuid references public.crm_contacts(id) on delete set null,
  add column if not exists linked_company_id uuid references public.crm_companies(id) on delete set null,
  add column if not exists linked_deal_id uuid references public.crm_deals(id) on delete set null,
  add column if not exists manager_attention boolean not null default false,
  add column if not exists intelligence_processed_at timestamptz;

create index idx_voice_captures_sentiment
  on public.voice_captures (sentiment)
  where sentiment is not null;

create index idx_voice_captures_manager_attention
  on public.voice_captures (manager_attention)
  where manager_attention = true;

create index idx_voice_captures_linked_contact
  on public.voice_captures (linked_contact_id)
  where linked_contact_id is not null;

create index idx_voice_captures_linked_company
  on public.voice_captures (linked_company_id)
  where linked_company_id is not null;

create index idx_voice_captures_linked_deal
  on public.voice_captures (linked_deal_id)
  where linked_deal_id is not null;

-- Competitive intelligence table: tracks competitor mentions across all voice notes
create table public.competitive_mentions (
  id uuid primary key default gen_random_uuid(),
  voice_capture_id uuid not null references public.voice_captures(id) on delete cascade,
  competitor_name text not null,
  context text,
  sentiment text check (sentiment is null or sentiment in (
    'positive', 'neutral', 'cautious', 'skeptical', 'frustrated', 'unknown'
  )),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.competitive_mentions enable row level security;

create policy "competitive_mentions_select_authenticated"
  on public.competitive_mentions for select
  using (auth.role() = 'authenticated');

create policy "competitive_mentions_service"
  on public.competitive_mentions for all
  using (auth.role() = 'service_role');

create index idx_competitive_mentions_competitor
  on public.competitive_mentions (lower(competitor_name));

create index idx_competitive_mentions_capture
  on public.competitive_mentions (voice_capture_id);
