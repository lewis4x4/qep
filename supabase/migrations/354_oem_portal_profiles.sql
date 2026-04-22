-- ============================================================================
-- Migration 354: OEM Portal Dashboard
--
-- Rollback notes:
--   1. Drop trigger set_oem_portal_profiles_updated_at.
--   2. Drop indexes idx_oem_portal_profiles_workspace_status and
--      idx_oem_portal_profiles_workspace_brand.
--   3. Drop policies on oem_portal_profiles.
--   4. Drop table oem_portal_profiles.
-- ============================================================================

create table public.oem_portal_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  brand_code text,
  oem_name text not null,
  portal_name text not null,
  segment text not null default 'support' check (
    segment in ('construction', 'forestry', 'industrial', 'support')
  ),
  launch_url text,
  status text not null default 'needs_setup' check (
    status in ('active', 'needs_setup', 'paused')
  ),
  access_mode text not null default 'bookmark_only' check (
    access_mode in ('bookmark_only', 'shared_login', 'individual_login', 'oauth_ready', 'api_only')
  ),
  favorite boolean not null default false,
  mfa_required boolean not null default false,
  credential_owner text,
  support_contact text,
  notes text,
  last_verified_at timestamptz,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, oem_name, portal_name)
);

comment on table public.oem_portal_profiles is
  'Registry of OEM/manufacturer portals for the internal OEM Portal SSO dashboard.';

create index idx_oem_portal_profiles_workspace_status
  on public.oem_portal_profiles(workspace_id, status, segment, sort_order, oem_name);

create index idx_oem_portal_profiles_workspace_brand
  on public.oem_portal_profiles(workspace_id, brand_code)
  where brand_code is not null;

alter table public.oem_portal_profiles enable row level security;

create policy "oem_portal_profiles_select"
  on public.oem_portal_profiles for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "oem_portal_profiles_mutate"
  on public.oem_portal_profiles for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "oem_portal_profiles_service_all"
  on public.oem_portal_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_oem_portal_profiles_updated_at
  before update on public.oem_portal_profiles
  for each row execute function public.set_updated_at();

insert into public.oem_portal_profiles
  (workspace_id, brand_code, oem_name, portal_name, segment, access_mode, status, sort_order, notes)
values
  ('default', 'ASV',         'ASV',                         'ASV Dealer Portal',                 'construction', 'bookmark_only', 'needs_setup',  10, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'YANMAR',      'Yanmar Compact Equipment',    'Yanmar Dealer Portal',              'construction', 'bookmark_only', 'needs_setup',  20, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'DEVELON',     'Develon',                     'Develon Dealer Portal',             'construction', 'bookmark_only', 'needs_setup',  30, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'BARKO',       'Barko',                       'Barko Dealer Portal',               'forestry',     'bookmark_only', 'needs_setup',  40, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'PRINOTH',     'Prinoth',                     'Prinoth Dealer Portal',             'forestry',     'bookmark_only', 'needs_setup',  50, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'LAMTRAC',     'Lamtrac',                     'Lamtrac Dealer Portal',             'forestry',     'bookmark_only', 'needs_setup',  60, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'BANDIT',      'Bandit',                      'Bandit Dealer Portal',              'forestry',     'bookmark_only', 'needs_setup',  70, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'SHEAREX',     'Shearex',                     'Shearex Dealer Portal',             'forestry',     'bookmark_only', 'needs_setup',  80, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'DENIS_CIMAF', 'Denis Cimaf',                 'Denis Cimaf Dealer Portal',         'forestry',     'bookmark_only', 'needs_setup',  90, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'SUPERTRAK',   'Supertrak',                   'Supertrak Dealer Portal',           'forestry',     'bookmark_only', 'needs_setup', 100, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'CMI',         'CMI',                         'CMI Dealer Portal',                 'industrial',   'bookmark_only', 'needs_setup', 110, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'SERCO',       'Serco',                       'Serco Dealer Portal',               'industrial',   'bookmark_only', 'needs_setup', 120, 'Configure verified launch URL and dealer login flow.'),
  ('default', 'DIAMOND_Z',   'Diamond Z',                   'Diamond Z Dealer Portal',           'industrial',   'bookmark_only', 'needs_setup', 130, 'Configure verified launch URL and dealer login flow.'),
  ('default', null,          'Peterson',                    'Peterson Dealer Portal',            'industrial',   'bookmark_only', 'needs_setup', 140, 'Brand referenced in repo prompts and parts AI context.'),
  ('default', null,          'Fecon',                       'Fecon Dealer Portal',               'forestry',     'bookmark_only', 'needs_setup', 150, 'Brand referenced in competitive and demo contexts.'),
  ('default', null,          'Morbark',                     'Morbark Dealer Portal',             'forestry',     'bookmark_only', 'needs_setup', 160, 'Configure verified launch URL and dealer login flow.'),
  ('default', null,          'Tigercat',                    'Tigercat Dealer Portal',            'forestry',     'bookmark_only', 'needs_setup', 170, 'Configure verified launch URL and dealer login flow.'),
  ('default', null,          'Kubota',                      'Kubota Dealer Portal',              'construction', 'bookmark_only', 'needs_setup', 180, 'Brand referenced in portal and stress fixtures.'),
  ('default', null,          'Bobcat',                      'Bobcat Dealer Portal',              'construction', 'bookmark_only', 'needs_setup', 190, 'Brand referenced in pricing and stress fixtures.'),
  ('default', null,          'JCB',                         'JCB Dealer Portal',                 'construction', 'bookmark_only', 'needs_setup', 200, 'Brand referenced in pricing fixtures.'),
  ('default', null,          'Komatsu',                     'Komatsu Dealer Portal',             'construction', 'bookmark_only', 'needs_setup', 210, 'Brand referenced in parts/service fixtures.'),
  ('default', null,          'John Deere',                  'John Deere Dealer Portal',          'construction', 'bookmark_only', 'needs_setup', 220, 'Brand referenced in portal notifications and pricing docs.'),
  ('default', null,          'Takeuchi',                    'Takeuchi Dealer Portal',            'construction', 'bookmark_only', 'needs_setup', 230, 'Brand referenced in pricing/stress fixtures.'),
  ('default', null,          'Vermeer',                     'Vermeer Dealer Portal',             'industrial',   'bookmark_only', 'needs_setup', 240, 'Brand referenced in roadmap docs.'),
  ('default', null,          'Toro',                        'Toro Dealer Portal',                'support',      'bookmark_only', 'needs_setup', 250, 'Brand referenced in roadmap docs.'),
  ('default', null,          'Ditch Witch',                 'Ditch Witch Dealer Portal',         'support',      'bookmark_only', 'needs_setup', 260, 'Brand referenced in roadmap docs.'),
  ('default', null,          'CASE',                        'CASE Dealer Portal',                'construction', 'bookmark_only', 'needs_setup', 270, 'Brand referenced in pricing/stress fixtures.'),
  ('default', null,          'Caterpillar',                 'Caterpillar Dealer Portal',         'construction', 'bookmark_only', 'needs_setup', 280, 'Brand referenced in service/telematics fixtures.'),
  ('default', null,          'Hitachi',                     'Hitachi Dealer Portal',             'construction', 'bookmark_only', 'needs_setup', 290, 'Brand referenced in market/trade contexts.'),
  ('default', null,          'Bomag',                       'Bomag Dealer Portal',               'support',      'bookmark_only', 'needs_setup', 300, 'Brand referenced in roadmap/stress contexts.'),
  ('default', null,          'Hamm',                        'Hamm Dealer Portal',                'support',      'bookmark_only', 'needs_setup', 310, 'Brand referenced in roadmap/stress contexts.');
