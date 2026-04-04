-- ============================================================================
-- Migration 080: DGE Predictive Prospecting & Daily Visit Lists
--
-- Transforms morning briefing from "here's what happened" to
-- "here's exactly what to do today."
--
-- For each Iron Advisor, generates a ranked daily visit list of 10 customers.
-- ============================================================================

-- ── Predictive visit recommendations ────────────────────────────────────────

create table public.predictive_visit_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rep_id uuid not null references public.profiles(id) on delete cascade,
  list_date date not null default current_date,

  -- Generated recommendations
  recommendations jsonb not null default '[]',
  -- Each: { contact_id, company_id, reason, priority_score, distance_km,
  --         equipment_interest, last_contact_days, replacement_due }

  -- Generation metadata
  generated_at timestamptz not null default now(),
  generation_model text default 'rule_based', -- 'rule_based', 'ml_v1', etc.
  generation_context jsonb default '{}',

  -- Execution tracking
  visits_completed integer default 0,
  visits_total integer default 10,

  created_at timestamptz not null default now(),
  unique(workspace_id, rep_id, list_date)
);

alter table public.predictive_visit_lists enable row level security;

create policy "visit_lists_select" on public.predictive_visit_lists for select
  using (workspace_id = public.get_my_workspace());
create policy "visit_lists_service" on public.predictive_visit_lists for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_visit_lists_rep_date on public.predictive_visit_lists(rep_id, list_date);

-- ── Add deal scoring columns to crm_deals if not present ────────────────────

alter table public.crm_deals
  add column if not exists dge_score numeric,
  add column if not exists dge_scenario_count integer default 0,
  add column if not exists dge_last_scored_at timestamptz;

comment on column public.crm_deals.dge_score is 'DGE composite score from 14-variable analysis (0-100)';
