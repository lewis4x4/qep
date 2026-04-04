-- ============================================================================
-- Migration 075: Prospecting KPI System
--
-- Per owner's Customer Prospecting SOP:
-- - 10 positive visits per day (non-negotiable)
-- - Only visits with quality criteria count toward target
-- - QRM updated same day, no drive-by visits counted
-- - Real-time counter on Iron Advisor mobile dashboard
-- - Iron Manager sees all advisors' KPI status
-- - Automated nudge at 2 PM if under 50% of target
-- - Streak tracking for consecutive days meeting target
-- ============================================================================

-- ── 1. Prospecting visits ───────────────────────────────────────────────────

create table public.prospecting_visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rep_id uuid not null references public.profiles(id) on delete cascade,
  visit_date date not null default current_date,

  -- Location
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  location_name text,
  location_lat numeric,
  location_lng numeric,

  -- Quality criteria (from SOP: at least one must be true for "positive" visit)
  spoke_with_decision_maker boolean default false,
  identified_need_or_opportunity boolean default false,
  equipment_discussion boolean default false,
  followed_up_on_active_deal boolean default false,

  -- Computed
  is_positive boolean generated always as (
    spoke_with_decision_maker or identified_need_or_opportunity or
    equipment_discussion or followed_up_on_active_deal
  ) stored,

  -- Details (from SOP: mandatory same-day logging)
  contact_name text,
  contact_role text,
  conversation_summary text,
  opportunities_identified text,
  competitive_equipment_on_site text,
  next_action text,
  follow_up_date date,

  -- Linked records
  deal_id uuid references public.crm_deals(id) on delete set null,
  voice_capture_id uuid references public.voice_captures(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.prospecting_visits is 'Field visit log. Only positive visits (with quality criteria) count toward daily 10-visit target.';

-- ── 2. Daily KPI rollup ─────────────────────────────────────────────────────

create table public.prospecting_kpis (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rep_id uuid not null references public.profiles(id) on delete cascade,
  kpi_date date not null default current_date,

  total_visits integer default 0,
  positive_visits integer default 0,
  target integer default 10,
  target_met boolean generated always as (positive_visits >= 10) stored,

  -- Streak
  consecutive_days_met integer default 0,

  -- Derived
  opportunities_created integer default 0,
  quotes_generated integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, rep_id, kpi_date)
);

comment on table public.prospecting_kpis is 'Daily KPI rollup per rep. Target: 10 positive visits/day. Streak tracking included.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.prospecting_visits enable row level security;
alter table public.prospecting_kpis enable row level security;

create policy "visits_select_workspace" on public.prospecting_visits for select
  using (workspace_id = public.get_my_workspace());
create policy "visits_insert_workspace" on public.prospecting_visits for insert
  with check (workspace_id = public.get_my_workspace());
create policy "visits_update_own" on public.prospecting_visits for update
  using (workspace_id = public.get_my_workspace() and rep_id = auth.uid());
create policy "visits_service_all" on public.prospecting_visits for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "kpis_select_workspace" on public.prospecting_kpis for select
  using (workspace_id = public.get_my_workspace());
create policy "kpis_insert_workspace" on public.prospecting_kpis for insert
  with check (workspace_id = public.get_my_workspace());
create policy "kpis_update_workspace" on public.prospecting_kpis for update
  using (workspace_id = public.get_my_workspace());
create policy "kpis_service_all" on public.prospecting_kpis for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index idx_visits_rep_date on public.prospecting_visits(rep_id, visit_date);
create index idx_visits_positive on public.prospecting_visits(rep_id, visit_date) where is_positive = true;
create index idx_kpis_rep_date on public.prospecting_kpis(rep_id, kpi_date);

-- ── 5. Auto-update KPI rollup on visit insert ──────────────────────────────

create or replace function public.update_prospecting_kpi_on_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.prospecting_kpis (workspace_id, rep_id, kpi_date, total_visits, positive_visits)
  values (NEW.workspace_id, NEW.rep_id, NEW.visit_date, 1, NEW.is_positive::int)
  on conflict (workspace_id, rep_id, kpi_date) do update set
    total_visits = prospecting_kpis.total_visits + 1,
    positive_visits = prospecting_kpis.positive_visits + NEW.is_positive::int,
    updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists kpi_rollup_on_visit on public.prospecting_visits;
create trigger kpi_rollup_on_visit
  after insert on public.prospecting_visits
  for each row
  execute function public.update_prospecting_kpi_on_visit();

-- ── 6. Updated_at trigger ───────────────────────────────────────────────────

drop trigger if exists set_prospecting_kpis_updated_at on public.prospecting_kpis;
create trigger set_prospecting_kpis_updated_at
  before update on public.prospecting_kpis for each row
  execute function public.set_updated_at();
