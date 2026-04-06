-- ============================================================================
-- Migration 146: Deal Timing Engine
--
-- Moonshot 1: Predict the optimal action window for every customer.
-- Ryan: "where we miss out is not being in front of the customer
--        when they're ready to purchase."
--
-- Three timelines per customer:
-- 1. Budget cycle — when their fiscal year/PO window opens
-- 2. Price increases — when manufacturer prices go up
-- 3. Equipment aging — when their fleet hits replacement thresholds
-- ============================================================================

-- ── 1. Budget cycle fields on customer profiles ─────────────────────────────

alter table public.customer_profiles_extended
  add column if not exists budget_cycle_month integer
    check (budget_cycle_month between 1 and 12),
  add column if not exists fiscal_year_end_month integer
    check (fiscal_year_end_month between 1 and 12),
  add column if not exists budget_cycle_notes text;

comment on column public.customer_profiles_extended.budget_cycle_month is 'Month when customer typically approves CapEx purchases (1-12)';
comment on column public.customer_profiles_extended.fiscal_year_end_month is 'Customer fiscal year end month — drives end-of-year urgency';

-- ── 2. Price increase tracking ──────────────────────────────────────────────

create table public.price_increase_tracking (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  manufacturer text not null,
  effective_date date not null,
  increase_pct numeric(5,2) not null,
  announcement_date date,
  source text, -- 'manufacturer_bulletin', 'tariff', 'raw_material'
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.price_increase_tracking is 'Manufacturer price increases and tariff changes. Drives urgency alerts on open deals.';

alter table public.price_increase_tracking enable row level security;
create policy "price_tracking_workspace" on public.price_increase_tracking for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "price_tracking_service" on public.price_increase_tracking for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_price_tracking_workspace on public.price_increase_tracking(workspace_id);
create index idx_price_tracking_mfr_date on public.price_increase_tracking(manufacturer, effective_date);

-- ── 3. Equipment age categories (configurable lookup) ───────────────────────

create table public.equipment_age_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  make text,
  model text,
  category text not null, -- e.g. 'excavator', 'forestry', 'loader'
  age_bracket_label text not null, -- 'sweet_spot', 'aging', 'end_of_life'
  min_hours integer,
  max_hours integer,
  min_years integer,
  max_years integer,
  replacement_probability numeric(3,2), -- 0.00-1.00
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipment_age_categories is 'Configurable equipment age brackets. When fleet hits "aging" or "end_of_life", triggers deal timing alert.';

alter table public.equipment_age_categories enable row level security;
create policy "age_categories_workspace" on public.equipment_age_categories for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "age_categories_service" on public.equipment_age_categories for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_age_categories_make on public.equipment_age_categories(make, model);

-- ── 4. Deal timing alerts ───────────────────────────────────────────────────

create table public.deal_timing_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  customer_profile_id uuid references public.customer_profiles_extended(id) on delete cascade,
  fleet_intelligence_id uuid references public.fleet_intelligence(id) on delete set null,

  alert_type text not null check (alert_type in (
    'budget_cycle', 'price_increase', 'equipment_aging',
    'seasonal_pattern', 'trade_in_interest'
  )),
  trigger_date date not null,
  urgency text not null default 'upcoming' check (urgency in ('immediate', 'upcoming', 'future')),

  title text not null,
  description text,
  recommended_action text,

  assigned_rep_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'acknowledged', 'actioned', 'dismissed'
  )),
  actioned_at timestamptz,
  actioned_deal_id uuid references public.crm_deals(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.deal_timing_alerts is 'Proactive timing alerts: budget cycles, price increases, equipment aging, trade-in interest. The Deal Timing Engine.';

alter table public.deal_timing_alerts enable row level security;
create policy "timing_alerts_workspace" on public.deal_timing_alerts for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "timing_alerts_service" on public.deal_timing_alerts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_timing_alerts_workspace_status on public.deal_timing_alerts(workspace_id, status, urgency);
create index idx_timing_alerts_rep on public.deal_timing_alerts(assigned_rep_id, status)
  where status in ('pending', 'acknowledged');
create index idx_timing_alerts_customer on public.deal_timing_alerts(customer_profile_id);
create index idx_timing_alerts_type on public.deal_timing_alerts(alert_type, trigger_date);

-- Prevent duplicate alerts
create unique index uq_timing_alerts_dedup
  on public.deal_timing_alerts(workspace_id, customer_profile_id, alert_type, trigger_date)
  where status = 'pending';

-- ── 5. Triggers ─────────────────────────────────────────────────────────────

create trigger set_price_tracking_updated_at before update on public.price_increase_tracking for each row execute function public.set_updated_at();
create trigger set_age_categories_updated_at before update on public.equipment_age_categories for each row execute function public.set_updated_at();
create trigger set_timing_alerts_updated_at before update on public.deal_timing_alerts for each row execute function public.set_updated_at();
