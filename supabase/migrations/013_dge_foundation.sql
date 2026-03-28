-- DGE Foundation Migration — Sprint 1
-- Creates 16 new tables, 5 new enums, RLS policies, indexes, and triggers
-- for the Deal Genome Engine.
--
-- Rollback DDL at the bottom of this file.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

create type public.integration_status_enum as enum (
  'connected', 'pending_credentials', 'error', 'demo_mode'
);

create type public.sync_frequency as enum (
  'realtime', 'hourly', 'every_6_hours', 'daily', 'weekly', 'manual'
);

create type public.scenario_type as enum (
  'max_margin', 'balanced', 'win_the_deal'
);

create type public.pricing_persona as enum (
  'value_driven', 'relationship_loyal', 'budget_constrained', 'urgency_buyer'
);

create type public.outreach_status as enum (
  'pending', 'approved', 'sent', 'deferred', 'dismissed'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 1: integration_status — Master integration registry
-- ─────────────────────────────────────────────────────────────────────────────

create table public.integration_status (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null unique,
  display_name text not null,
  status public.integration_status_enum not null default 'pending_credentials',
  credentials_encrypted text,
  endpoint_url text,
  auth_type text default 'api_key',
  sync_frequency public.sync_frequency default 'daily',
  last_sync_at timestamptz,
  last_sync_records integer default 0,
  last_sync_error text,
  last_test_at timestamptz,
  last_test_success boolean,
  last_test_latency_ms integer,
  last_test_error text,
  config jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integration_status enable row level security;

create policy "integration_status_select_owner" on public.integration_status
  for select using (public.get_my_role() = 'owner');

create policy "integration_status_all_owner" on public.integration_status
  for all using (public.get_my_role() = 'owner');

create policy "integration_status_service" on public.integration_status
  for all using (auth.role() = 'service_role');

create index idx_integration_status_key on public.integration_status(integration_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 2: market_valuations — Cached equipment valuations
-- ─────────────────────────────────────────────────────────────────────────────

create table public.market_valuations (
  id uuid primary key default gen_random_uuid(),
  stock_number text,
  make text not null,
  model text not null,
  year integer not null,
  hours integer,
  condition text,
  location text,
  estimated_fmv numeric(12,2),
  low_estimate numeric(12,2),
  high_estimate numeric(12,2),
  confidence_score numeric(3,2) default 0.5,
  source text not null,
  source_detail jsonb default '{}',
  expires_at timestamptz not null,
  valued_by uuid references public.profiles(id),
  override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.market_valuations enable row level security;

create policy "market_valuations_select" on public.market_valuations
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "market_valuations_insert_elevated" on public.market_valuations
  for insert with check (public.get_my_role() in ('manager', 'owner'));

create policy "market_valuations_service" on public.market_valuations
  for all using (auth.role() = 'service_role');

create index idx_market_valuations_stock on public.market_valuations(stock_number);
create index idx_market_valuations_make_model on public.market_valuations(make, model, year);
create index idx_market_valuations_expires on public.market_valuations(expires_at);
create index idx_market_valuations_created on public.market_valuations(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 3: auction_results — Historical auction data
-- ─────────────────────────────────────────────────────────────────────────────

create table public.auction_results (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  auction_date date not null,
  make text not null,
  model text not null,
  year integer,
  hours integer,
  hammer_price numeric(12,2) not null,
  location text,
  condition text,
  lot_number text,
  metadata jsonb default '{}',
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.auction_results enable row level security;

create policy "auction_results_select" on public.auction_results
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "auction_results_insert_elevated" on public.auction_results
  for insert with check (public.get_my_role() in ('manager', 'owner'));

create policy "auction_results_service" on public.auction_results
  for all using (auth.role() = 'service_role');

create index idx_auction_results_make_model on public.auction_results(make, model);
create index idx_auction_results_date on public.auction_results(auction_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 4: competitor_listings — Competitor dealer inventory
-- ─────────────────────────────────────────────────────────────────────────────

create table public.competitor_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_url text,
  make text not null,
  model text not null,
  year integer,
  hours integer,
  asking_price numeric(12,2),
  location text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.competitor_listings enable row level security;

create policy "competitor_listings_select" on public.competitor_listings
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "competitor_listings_service" on public.competitor_listings
  for all using (auth.role() = 'service_role');

create index idx_competitor_listings_make_model on public.competitor_listings(make, model);
create index idx_competitor_listings_active on public.competitor_listings(is_active) where is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 5: economic_indicators — Macro economic data
-- ─────────────────────────────────────────────────────────────────────────────

create table public.economic_indicators (
  id uuid primary key default gen_random_uuid(),
  indicator_key text not null,
  indicator_name text not null,
  value numeric(14,4) not null,
  unit text,
  observation_date date not null,
  source text not null,
  series_id text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  unique(indicator_key, observation_date)
);

alter table public.economic_indicators enable row level security;

create policy "economic_indicators_select" on public.economic_indicators
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "economic_indicators_service" on public.economic_indicators
  for all using (auth.role() = 'service_role');

create index idx_economic_indicators_key_date on public.economic_indicators(indicator_key, observation_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 6: customer_profiles_extended — Customer DNA
-- ─────────────────────────────────────────────────────────────────────────────

create table public.customer_profiles_extended (
  id uuid primary key default gen_random_uuid(),
  hubspot_contact_id text,
  intellidealer_customer_id text,
  customer_name text not null,
  company_name text,
  industry text,
  region text,
  pricing_persona public.pricing_persona,
  persona_confidence numeric(3,2),
  persona_model_version text,
  lifetime_value numeric(14,2) default 0,
  total_deals integer default 0,
  avg_deal_size numeric(12,2),
  avg_discount_pct numeric(5,2),
  avg_days_to_close integer,
  attachment_rate numeric(5,2),
  service_contract_rate numeric(5,2),
  fleet_size integer default 0,
  seasonal_pattern text,
  last_deal_at timestamptz,
  last_interaction_at timestamptz,
  price_sensitivity_score numeric(3,2),
  notes text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles_extended enable row level security;

create policy "customer_profiles_ext_select" on public.customer_profiles_extended
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "customer_profiles_ext_insert" on public.customer_profiles_extended
  for insert with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "customer_profiles_ext_update" on public.customer_profiles_extended
  for update using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "customer_profiles_ext_service" on public.customer_profiles_extended
  for all using (auth.role() = 'service_role');

create index idx_customer_profiles_hubspot on public.customer_profiles_extended(hubspot_contact_id);
create index idx_customer_profiles_intellidealer on public.customer_profiles_extended(intellidealer_customer_id);
create index idx_customer_profiles_persona on public.customer_profiles_extended(pricing_persona);
create index idx_customer_profiles_name on public.customer_profiles_extended(customer_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 7: customer_deal_history — Denormalized deal records for ML
-- ─────────────────────────────────────────────────────────────────────────────

create table public.customer_deal_history (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid not null references public.customer_profiles_extended(id) on delete cascade,
  hubspot_deal_id text,
  deal_date timestamptz not null,
  outcome text not null,
  equipment_make text,
  equipment_model text,
  equipment_year integer,
  equipment_category text,
  list_price numeric(12,2),
  sold_price numeric(12,2),
  discount_pct numeric(5,2),
  margin_pct numeric(5,2),
  trade_in_value numeric(12,2),
  financing_used boolean default false,
  financing_term_months integer,
  attachments_sold integer default 0,
  service_contract_sold boolean default false,
  days_to_close integer,
  rep_id uuid references public.profiles(id),
  loss_reason text,
  competitor text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table public.customer_deal_history enable row level security;

create policy "deal_history_select_elevated" on public.customer_deal_history
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "deal_history_select_rep" on public.customer_deal_history
  for select using (
    public.get_my_role() = 'rep'
    and rep_id = auth.uid()
  );

create policy "deal_history_service" on public.customer_deal_history
  for all using (auth.role() = 'service_role');

create index idx_deal_history_customer on public.customer_deal_history(customer_profile_id);
create index idx_deal_history_date on public.customer_deal_history(deal_date desc);
create index idx_deal_history_rep on public.customer_deal_history(rep_id);
create index idx_deal_history_outcome on public.customer_deal_history(outcome);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 8: pricing_persona_models — ML model metadata
-- ─────────────────────────────────────────────────────────────────────────────

create table public.pricing_persona_models (
  id uuid primary key default gen_random_uuid(),
  model_name text not null,
  model_version text not null,
  model_type text not null,
  is_active boolean not null default false,
  training_date timestamptz,
  training_samples integer,
  accuracy_score numeric(5,4),
  precision_score numeric(5,4),
  recall_score numeric(5,4),
  config jsonb default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(model_name, model_version)
);

alter table public.pricing_persona_models enable row level security;

create policy "persona_models_select_elevated" on public.pricing_persona_models
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "persona_models_service" on public.pricing_persona_models
  for all using (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 9: deal_scenarios — Generated deal scenarios
-- ─────────────────────────────────────────────────────────────────────────────

create table public.deal_scenarios (
  id uuid primary key default gen_random_uuid(),
  quote_id text not null,
  scenario_type public.scenario_type not null,
  customer_profile_id uuid references public.customer_profiles_extended(id),
  market_valuation_id uuid references public.market_valuations(id),
  equipment_make text not null,
  equipment_model text not null,
  equipment_year integer,
  equipment_stock_number text,
  list_price numeric(12,2) not null,
  recommended_price numeric(12,2) not null,
  discount_pct numeric(5,2) default 0,
  trade_in_allowance numeric(12,2) default 0,
  trade_in_actual_value numeric(12,2) default 0,
  financing_recommended boolean default false,
  financing_term_months integer,
  financing_rate_pct numeric(5,3),
  financing_monthly_payment numeric(10,2),
  financing_holdback_pct numeric(5,3),
  total_deal_margin numeric(12,2),
  total_deal_margin_pct numeric(5,2),
  close_probability numeric(3,2),
  expected_value numeric(12,2),
  explanation text not null,
  ai_model text,
  ai_temperature numeric(3,2),
  ai_tokens_used integer,
  is_recommended boolean default false,
  is_selected boolean default false,
  selected_at timestamptz,
  selected_by uuid references public.profiles(id),
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deal_scenarios enable row level security;

create policy "deal_scenarios_select" on public.deal_scenarios
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "deal_scenarios_update_elevated" on public.deal_scenarios
  for update using (public.get_my_role() in ('manager', 'owner'));

create policy "deal_scenarios_service" on public.deal_scenarios
  for all using (auth.role() = 'service_role');

create index idx_deal_scenarios_quote on public.deal_scenarios(quote_id);
create index idx_deal_scenarios_customer on public.deal_scenarios(customer_profile_id);
create index idx_deal_scenarios_created on public.deal_scenarios(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 10: margin_waterfalls — Line-by-line margin decomposition
-- ─────────────────────────────────────────────────────────────────────────────

create table public.margin_waterfalls (
  id uuid primary key default gen_random_uuid(),
  deal_scenario_id uuid not null references public.deal_scenarios(id) on delete cascade,
  line_order integer not null,
  line_label text not null,
  line_category text not null,
  amount numeric(12,2) not null,
  is_margin_line boolean default false,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table public.margin_waterfalls enable row level security;

-- REPS MUST NEVER SEE MARGIN WATERFALLS — manager/owner only
create policy "margin_waterfalls_select" on public.margin_waterfalls
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "margin_waterfalls_service" on public.margin_waterfalls
  for all using (auth.role() = 'service_role');

create index idx_margin_waterfalls_scenario on public.margin_waterfalls(deal_scenario_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 11: deal_feedback — Rep/manager feedback on scenarios
-- ─────────────────────────────────────────────────────────────────────────────

create table public.deal_feedback (
  id uuid primary key default gen_random_uuid(),
  deal_scenario_id uuid not null references public.deal_scenarios(id) on delete cascade,
  quote_id text not null,
  feedback_by uuid not null references public.profiles(id),
  feedback_role public.user_role not null,
  action text not null,
  modifications jsonb default '{}',
  reason text,
  deal_outcome text,
  created_at timestamptz not null default now()
);

alter table public.deal_feedback enable row level security;

create policy "deal_feedback_select" on public.deal_feedback
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "deal_feedback_insert" on public.deal_feedback
  for insert with check (public.get_my_role() in ('rep', 'manager', 'owner'));

create policy "deal_feedback_service" on public.deal_feedback
  for all using (auth.role() = 'service_role');

create index idx_deal_feedback_scenario on public.deal_feedback(deal_scenario_id);
create index idx_deal_feedback_quote on public.deal_feedback(quote_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 12: financing_rate_matrix — Configurable rate tables
-- ─────────────────────────────────────────────────────────────────────────────

create table public.financing_rate_matrix (
  id uuid primary key default gen_random_uuid(),
  lender_name text not null,
  min_amount numeric(12,2),
  max_amount numeric(12,2),
  term_months integer not null,
  credit_tier text not null,
  rate_pct numeric(5,3) not null,
  dealer_holdback_pct numeric(5,3) default 0,
  is_active boolean not null default true,
  effective_date date,
  expiry_date date,
  notes text,
  entered_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financing_rate_matrix enable row level security;

create policy "financing_rate_select" on public.financing_rate_matrix
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "financing_rate_all_owner" on public.financing_rate_matrix
  for all using (public.get_my_role() = 'owner');

create policy "financing_rate_service" on public.financing_rate_matrix
  for all using (auth.role() = 'service_role');

create index idx_financing_rate_lender on public.financing_rate_matrix(lender_name);
create index idx_financing_rate_active on public.financing_rate_matrix(is_active) where is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 13: manufacturer_incentives — Active incentive programs
-- ─────────────────────────────────────────────────────────────────────────────

create table public.manufacturer_incentives (
  id uuid primary key default gen_random_uuid(),
  oem_name text not null,
  program_name text not null,
  eligible_categories text[],
  eligible_models text[],
  discount_type text not null,
  discount_value numeric(10,2) not null,
  eligibility_criteria text,
  stacking_rules text,
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  source text default 'manual',
  entered_by uuid references public.profiles(id),
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.manufacturer_incentives enable row level security;

create policy "incentives_select" on public.manufacturer_incentives
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "incentives_all_owner" on public.manufacturer_incentives
  for all using (public.get_my_role() = 'owner');

create policy "incentives_service" on public.manufacturer_incentives
  for all using (auth.role() = 'service_role');

create index idx_incentives_oem on public.manufacturer_incentives(oem_name);
create index idx_incentives_active on public.manufacturer_incentives(is_active, end_date)
  where is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 14: fleet_intelligence — Per-unit fleet records
-- ─────────────────────────────────────────────────────────────────────────────

create table public.fleet_intelligence (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid references public.customer_profiles_extended(id),
  customer_name text not null,
  equipment_serial text,
  make text not null,
  model text not null,
  year integer,
  current_hours integer,
  last_service_date date,
  last_service_hours integer,
  utilization_trend text,
  predicted_replacement_date date,
  replacement_confidence numeric(3,2),
  replacement_model_version text,
  outreach_status public.outreach_status default 'pending',
  outreach_deal_value numeric(12,2),
  telematics_source text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fleet_intelligence enable row level security;

create policy "fleet_select" on public.fleet_intelligence
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "fleet_insert_elevated" on public.fleet_intelligence
  for insert with check (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "fleet_update_elevated" on public.fleet_intelligence
  for update using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "fleet_service" on public.fleet_intelligence
  for all using (auth.role() = 'service_role');

create index idx_fleet_customer on public.fleet_intelligence(customer_profile_id);
create index idx_fleet_replacement on public.fleet_intelligence(predicted_replacement_date)
  where outreach_status = 'pending';
create index idx_fleet_make_model on public.fleet_intelligence(make, model);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 15: fleet_import_history — Audit trail for fleet data imports
-- ─────────────────────────────────────────────────────────────────────────────

create table public.fleet_import_history (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,
  records_imported integer not null default 0,
  records_updated integer not null default 0,
  records_failed integer not null default 0,
  error_log jsonb default '[]',
  imported_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.fleet_import_history enable row level security;

create policy "fleet_import_select" on public.fleet_import_history
  for select using (public.get_my_role() in ('admin', 'manager', 'owner'));

create policy "fleet_import_service" on public.fleet_import_history
  for all using (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 16: outreach_queue — Proactive deal opportunities
-- ─────────────────────────────────────────────────────────────────────────────

create table public.outreach_queue (
  id uuid primary key default gen_random_uuid(),
  fleet_intelligence_id uuid not null references public.fleet_intelligence(id) on delete cascade,
  customer_profile_id uuid references public.customer_profiles_extended(id),
  customer_name text not null,
  equipment_description text not null,
  trigger_reason text not null,
  estimated_deal_value numeric(12,2),
  priority_score numeric(5,2),
  status public.outreach_status not null default 'pending',
  assigned_rep_id uuid references public.profiles(id),
  hubspot_sequence_id text,
  actioned_at timestamptz,
  actioned_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outreach_queue enable row level security;

create policy "outreach_select" on public.outreach_queue
  for select using (public.get_my_role() in ('rep', 'manager', 'owner'));

create policy "outreach_update" on public.outreach_queue
  for update using (public.get_my_role() in ('rep', 'manager', 'owner'));

create policy "outreach_service" on public.outreach_queue
  for all using (auth.role() = 'service_role');

create index idx_outreach_status on public.outreach_queue(status) where status = 'pending';
create index idx_outreach_priority on public.outreach_queue(priority_score desc);
create index idx_outreach_rep on public.outreach_queue(assigned_rep_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGERS — set_updated_at on all tables with updated_at column
-- ─────────────────────────────────────────────────────────────────────────────

create trigger set_integration_status_updated_at before update on public.integration_status
  for each row execute function public.set_updated_at();

create trigger set_market_valuations_updated_at before update on public.market_valuations
  for each row execute function public.set_updated_at();

create trigger set_competitor_listings_updated_at before update on public.competitor_listings
  for each row execute function public.set_updated_at();

create trigger set_customer_profiles_ext_updated_at before update on public.customer_profiles_extended
  for each row execute function public.set_updated_at();

create trigger set_pricing_persona_models_updated_at before update on public.pricing_persona_models
  for each row execute function public.set_updated_at();

create trigger set_deal_scenarios_updated_at before update on public.deal_scenarios
  for each row execute function public.set_updated_at();

create trigger set_financing_rate_updated_at before update on public.financing_rate_matrix
  for each row execute function public.set_updated_at();

create trigger set_incentives_updated_at before update on public.manufacturer_incentives
  for each row execute function public.set_updated_at();

create trigger set_fleet_intelligence_updated_at before update on public.fleet_intelligence
  for each row execute function public.set_updated_at();

create trigger set_outreach_queue_updated_at before update on public.outreach_queue
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Default integration_status rows for all 8 integrations
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.integration_status (integration_key, display_name, status, auth_type)
values
  ('intellidealer',           'IntelliDealer (VitalEdge)',         'pending_credentials', 'oauth2'),
  ('ironguides',              'Iron Solutions / IronGuides',        'pending_credentials', 'api_key'),
  ('rouse',                   'Rouse Analytics',                    'pending_credentials', 'api_key'),
  ('aemp',                    'AEMP 2.0 Telematics',                'pending_credentials', 'oauth2'),
  ('financing',               'Financing Partners',                 'pending_credentials', 'api_key'),
  ('manufacturer_incentives', 'Manufacturer Incentives API',        'pending_credentials', 'api_key'),
  ('auction_data',            'Auction Data (Rouse/IronPlanet)',    'pending_credentials', 'api_key'),
  ('fred_usda',               'FRED / USDA Economic Data',          'pending_credentials', 'api_key');

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Initial rule-based persona classifier model metadata
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.pricing_persona_models (model_name, model_version, model_type, is_active, notes)
values (
  'persona_classifier', 'v1',
  'rule_based',
  true,
  'Rule-based decision tree for Sprint 1. Upgrade to ML in Sprint 2.'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK DDL (execute in reverse order to undo this migration)
-- ─────────────────────────────────────────────────────────────────────────────

-- drop trigger if exists set_outreach_queue_updated_at on public.outreach_queue;
-- drop trigger if exists set_fleet_intelligence_updated_at on public.fleet_intelligence;
-- drop trigger if exists set_incentives_updated_at on public.manufacturer_incentives;
-- drop trigger if exists set_financing_rate_updated_at on public.financing_rate_matrix;
-- drop trigger if exists set_deal_scenarios_updated_at on public.deal_scenarios;
-- drop trigger if exists set_pricing_persona_models_updated_at on public.pricing_persona_models;
-- drop trigger if exists set_customer_profiles_ext_updated_at on public.customer_profiles_extended;
-- drop trigger if exists set_competitor_listings_updated_at on public.competitor_listings;
-- drop trigger if exists set_market_valuations_updated_at on public.market_valuations;
-- drop trigger if exists set_integration_status_updated_at on public.integration_status;

-- drop table if exists public.outreach_queue cascade;
-- drop table if exists public.fleet_import_history cascade;
-- drop table if exists public.fleet_intelligence cascade;
-- drop table if exists public.manufacturer_incentives cascade;
-- drop table if exists public.financing_rate_matrix cascade;
-- drop table if exists public.deal_feedback cascade;
-- drop table if exists public.margin_waterfalls cascade;
-- drop table if exists public.deal_scenarios cascade;
-- drop table if exists public.pricing_persona_models cascade;
-- drop table if exists public.customer_deal_history cascade;
-- drop table if exists public.customer_profiles_extended cascade;
-- drop table if exists public.economic_indicators cascade;
-- drop table if exists public.competitor_listings cascade;
-- drop table if exists public.auction_results cascade;
-- drop table if exists public.market_valuations cascade;
-- drop table if exists public.integration_status cascade;

-- drop type if exists public.outreach_status;
-- drop type if exists public.pricing_persona;
-- drop type if exists public.scenario_type;
-- drop type if exists public.sync_frequency;
-- drop type if exists public.integration_status_enum;
