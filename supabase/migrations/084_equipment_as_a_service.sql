-- ============================================================================
-- Migration 084: Equipment-as-a-Service (EaaS)
--
-- Subscription-based equipment rentals with:
-- - Predictive maintenance scheduling
-- - Usage-based pricing
-- - Automatic fleet rotation
-- - Telematics integration readiness
-- ============================================================================

-- ── 1. EaaS subscriptions ───────────────────────────────────────────────────

create table public.eaas_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Plan
  plan_type text not null check (plan_type in (
    'fixed_monthly', 'usage_based', 'hybrid', 'seasonal'
  )),
  plan_name text not null,

  -- Pricing
  base_monthly_rate numeric not null,
  usage_rate_per_hour numeric, -- for usage-based plans
  usage_cap_hours numeric, -- included hours before overage
  overage_rate numeric, -- per-hour overage charge

  -- Term
  start_date date not null,
  end_date date,
  auto_renew boolean default true,
  renewal_terms jsonb default '{}',

  -- Status
  status text not null default 'active' check (status in (
    'pending', 'active', 'paused', 'expired', 'cancelled', 'upgraded'
  )),

  -- Fleet rotation
  rotation_eligible boolean default false,
  rotation_interval_months integer, -- e.g. 24 months
  last_rotation_date date,
  next_rotation_date date,

  -- Maintenance
  includes_maintenance boolean default true,
  maintenance_schedule_id uuid, -- self-reference for schedule tracking

  -- Billing
  next_billing_date date,
  billing_cycle text default 'monthly' check (billing_cycle in ('monthly', 'quarterly', 'annual')),
  total_billed numeric default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.eaas_subscriptions is 'Equipment-as-a-Service subscriptions. Subscription rentals with maintenance, usage pricing, and fleet rotation.';

-- ── 2. Usage tracking (telematics-ready) ────────────────────────────────────

create table public.eaas_usage_records (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.eaas_subscriptions(id) on delete cascade,

  -- Period
  period_start date not null,
  period_end date not null,

  -- Usage
  hours_used numeric not null default 0,
  hours_included numeric, -- from plan cap
  overage_hours numeric generated always as (
    greatest(0, hours_used - coalesce(hours_included, 0))
  ) stored,

  -- Source
  source text not null default 'manual' check (source in (
    'manual', 'telematics', 'hour_meter_photo', 'estimated'
  )),
  telematics_device_id text,

  -- Billing
  base_charge numeric not null default 0,
  overage_charge numeric default 0,
  total_charge numeric generated always as (base_charge + coalesce(overage_charge, 0)) stored,
  invoiced boolean default false,
  invoice_id uuid references public.customer_invoices(id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.eaas_usage_records is 'Monthly usage records for EaaS subscriptions. Telematics-ready.';

-- ── 3. Maintenance schedules ────────────────────────────────────────────────

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  subscription_id uuid references public.eaas_subscriptions(id) on delete cascade,
  fleet_id uuid references public.customer_fleet(id) on delete cascade,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Schedule
  maintenance_type text not null check (maintenance_type in (
    'preventive', 'predictive', 'corrective', 'inspection'
  )),
  description text not null,

  -- Timing
  scheduled_date date not null,
  scheduled_hours numeric, -- trigger at X hours
  estimated_duration_hours numeric,

  -- Status
  status text not null default 'scheduled' check (status in (
    'scheduled', 'due', 'in_progress', 'completed', 'skipped', 'overdue'
  )),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  completion_notes text,

  -- Cost
  estimated_cost numeric,
  actual_cost numeric,
  parts_used jsonb default '[]',

  -- Prediction (for predictive maintenance)
  prediction_confidence numeric, -- 0-100
  prediction_model text,
  prediction_signals jsonb default '{}',
  -- { vibration_anomaly, oil_analysis, hour_pattern, seasonal_factor }

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.maintenance_schedules is 'Predictive and preventive maintenance scheduling for EaaS and customer fleet.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.eaas_subscriptions enable row level security;
alter table public.eaas_usage_records enable row level security;
alter table public.maintenance_schedules enable row level security;

create policy "subscriptions_internal" on public.eaas_subscriptions for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "subscriptions_self" on public.eaas_subscriptions for select
  using (portal_customer_id = public.get_portal_customer_id());
create policy "subscriptions_service" on public.eaas_subscriptions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Usage records via subscription
create or replace function public.subscription_in_my_workspace(p_sub_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.eaas_subscriptions s where s.id = p_sub_id
    and s.workspace_id = (
      select coalesce(
        current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id',
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'workspace_id',
        'default'
      )
    )
  );
$$;
revoke execute on function public.subscription_in_my_workspace(uuid) from public;
grant execute on function public.subscription_in_my_workspace(uuid) to authenticated;

create policy "usage_internal" on public.eaas_usage_records for all
  using (public.subscription_in_my_workspace(subscription_id))
  with check (public.subscription_in_my_workspace(subscription_id));
create policy "usage_service" on public.eaas_usage_records for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "maintenance_internal" on public.maintenance_schedules for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "maintenance_self" on public.maintenance_schedules for select
  using (
    fleet_id in (select id from public.customer_fleet where portal_customer_id = public.get_portal_customer_id())
    or subscription_id in (select id from public.eaas_subscriptions where portal_customer_id = public.get_portal_customer_id())
  );
create policy "maintenance_service" on public.maintenance_schedules for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 5. Indexes ──────────────────────────────────────────────────────────────

create index idx_subscriptions_workspace on public.eaas_subscriptions(workspace_id);
create index idx_subscriptions_customer on public.eaas_subscriptions(portal_customer_id);
create index idx_subscriptions_status on public.eaas_subscriptions(status) where status = 'active';
create index idx_subscriptions_rotation on public.eaas_subscriptions(next_rotation_date)
  where rotation_eligible = true and status = 'active';
create index idx_subscriptions_billing on public.eaas_subscriptions(next_billing_date)
  where status = 'active';

create index idx_usage_subscription on public.eaas_usage_records(subscription_id);
create index idx_usage_period on public.eaas_usage_records(period_start, period_end);
create index idx_usage_uninvoiced on public.eaas_usage_records(subscription_id)
  where invoiced = false;

create index idx_maintenance_workspace on public.maintenance_schedules(workspace_id);
create index idx_maintenance_scheduled on public.maintenance_schedules(scheduled_date)
  where status in ('scheduled', 'due');
create index idx_maintenance_fleet on public.maintenance_schedules(fleet_id) where fleet_id is not null;
create index idx_maintenance_subscription on public.maintenance_schedules(subscription_id)
  where subscription_id is not null;

-- ── 6. Triggers ─────────────────────────────────────────────────────────────

create trigger set_subscriptions_updated_at before update on public.eaas_subscriptions for each row execute function public.set_updated_at();
create trigger set_maintenance_updated_at before update on public.maintenance_schedules for each row execute function public.set_updated_at();
