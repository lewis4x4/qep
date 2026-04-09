-- ============================================================================
-- Migration 217: DGE Intelligence Cockpit (Slice 3.1)
--
-- Adds:
--   1. deal_id column to deal_scenarios (links scenarios to CRM deals)
--   2. dge_learning_events table for tracking scenario selection vs outcomes
--   3. dge_variable_breakdown table for "Why this scenario" 14-variable display
--   4. Indexes for cockpit query performance
-- ============================================================================

-- ── 1. Add deal_id to deal_scenarios ─────────────────────────────────────────
alter table public.deal_scenarios
  add column if not exists deal_id uuid references public.crm_deals(id) on delete cascade;

create index if not exists idx_deal_scenarios_deal_id
  on public.deal_scenarios(deal_id);

-- ── 2. DGE Learning Events ───────────────────────────────────────────────────
-- Tracks which scenario the advisor selected and the eventual deal outcome.
-- Feeds back into DGE accuracy over time.

create table if not exists public.dge_learning_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  scenario_type public.scenario_type not null,
  selected_by uuid references public.profiles(id) on delete set null,
  selected_at timestamptz not null default now(),
  deal_outcome text check (deal_outcome in ('won', 'lost', 'stalled', 'no_decision')),
  final_amount numeric(12,2),
  final_margin_pct numeric(5,2),
  outcome_at timestamptz,
  accuracy_delta numeric(5,2),
  created_at timestamptz not null default now()
);

alter table public.dge_learning_events enable row level security;

create policy "dge_learning_select_manager" on public.dge_learning_events
  for select using (public.get_my_role() in ('manager', 'owner'));

create policy "dge_learning_insert_authenticated" on public.dge_learning_events
  for insert with check (auth.role() = 'authenticated');

create policy "dge_learning_update_manager" on public.dge_learning_events
  for update using (public.get_my_role() in ('manager', 'owner'));

create policy "dge_learning_service" on public.dge_learning_events
  for all using (auth.role() = 'service_role');

create index if not exists idx_dge_learning_deal
  on public.dge_learning_events(deal_id);

create index if not exists idx_dge_learning_workspace
  on public.dge_learning_events(workspace_id);

-- ── 3. DGE Variable Breakdown ────────────────────────────────────────────────
-- Stores the 14-variable breakdown per scenario for "Why this scenario" UI.

create table if not exists public.dge_variable_breakdown (
  id uuid primary key default gen_random_uuid(),
  deal_scenario_id uuid not null references public.deal_scenarios(id) on delete cascade,
  variable_name text not null,
  variable_value numeric(12,4),
  variable_unit text not null default 'usd',
  weight numeric(5,4),
  impact_direction text not null check (impact_direction in ('positive', 'negative', 'neutral')),
  description text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.dge_variable_breakdown enable row level security;

create policy "dge_breakdown_select" on public.dge_variable_breakdown
  for select using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));

create policy "dge_breakdown_service" on public.dge_variable_breakdown
  for all using (auth.role() = 'service_role');

create index if not exists idx_dge_breakdown_scenario
  on public.dge_variable_breakdown(deal_scenario_id);

-- ── 4. Add selected_scenario column to crm_deals ────────────────────────────
alter table public.crm_deals
  add column if not exists selected_scenario public.scenario_type;

comment on column public.crm_deals.selected_scenario is
  'The DGE scenario type the advisor selected for this deal.';
