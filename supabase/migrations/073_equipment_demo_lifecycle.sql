-- ============================================================================
-- Migration 073: Equipment Demo Lifecycle
--
-- Full demo management per owner's Equipment Demo SOP.
-- Qualification gate: needs assessment + quote presented + buying intent
-- Hour limits: 10hr construction, 4hr forestry
-- Cost allocation: demo costs added to machine cost in deal margin
-- Mandatory 24hr follow-up after completion
-- ============================================================================

-- ── 1. Demos table ──────────────────────────────────────────────────────────

create table public.demos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Qualification (from SOP: all must be true before demo approved)
  needs_assessment_complete boolean not null default false,
  quote_presented boolean not null default false,
  buying_intent_confirmed boolean not null default false,

  -- Approval
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'denied', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  denial_reason text,

  -- Scheduling
  scheduled_date date,
  scheduled_time_start timestamptz,
  scheduled_time_end timestamptz,
  traffic_ticket_id uuid, -- FK added in Phase 3 when traffic_tickets table exists

  -- Execution (from SOP: max hours)
  equipment_category text check (equipment_category in ('construction', 'forestry')),
  max_hours numeric not null default 10, -- 10 for construction, 4 for forestry
  starting_hours numeric,
  ending_hours numeric,
  hours_used numeric generated always as (ending_hours - starting_hours) stored,

  -- Cost allocation (from SOP: demo costs added to machine cost)
  transport_cost numeric default 0,
  fuel_cost numeric default 0,
  prep_labor_cost numeric default 0,
  wear_cost numeric default 0,
  total_demo_cost numeric generated always as (transport_cost + fuel_cost + prep_labor_cost + wear_cost) stored,

  -- Follow-up
  followup_due_at timestamptz, -- 24 hours after completion per SOP
  followup_completed boolean default false,
  customer_decision text check (customer_decision in ('purchase', 'decline', 'undecided')),

  -- Customer responsibilities (from SOP)
  customer_responsible_fuel boolean default true,
  customer_responsible_def boolean default true,
  customer_responsible_damage boolean default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.demos is 'Equipment demo lifecycle. Qualification gate + hour tracking + cost allocation + mandatory follow-up.';

-- ── 2. Demo inspections ─────────────────────────────────────────────────────

create table public.demo_inspections (
  id uuid primary key default gen_random_uuid(),
  demo_id uuid not null references public.demos(id) on delete cascade,
  inspection_type text not null check (inspection_type in ('pre_demo', 'post_demo')),
  inspector_id uuid references public.profiles(id) on delete set null,

  -- Checklist
  checklist_items jsonb not null default '[]',
  photos jsonb default '[]',

  -- Condition
  overall_condition text check (overall_condition in ('excellent', 'good', 'fair', 'poor')),
  damage_found boolean default false,
  damage_description text,
  damage_photos jsonb default '[]',

  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.demo_inspections is 'Pre and post-demo equipment inspections by Iron Man.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.demos enable row level security;
alter table public.demo_inspections enable row level security;

create policy "demos_select_workspace" on public.demos for select
  using (workspace_id = public.get_my_workspace());
create policy "demos_insert_workspace" on public.demos for insert
  with check (workspace_id = public.get_my_workspace());
create policy "demos_update_workspace" on public.demos for update
  using (workspace_id = public.get_my_workspace());
create policy "demos_delete_elevated" on public.demos for delete
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "demos_service_all" on public.demos for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Inspections via demo workspace (SECURITY DEFINER helper)
create or replace function public.inspection_in_my_workspace(p_demo_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.demos d where d.id = p_demo_id
    and d.workspace_id = (
      select coalesce(
        current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id',
        current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'workspace_id',
        'default'
      )
    )
  );
$$;

revoke execute on function public.inspection_in_my_workspace(uuid) from public;
grant execute on function public.inspection_in_my_workspace(uuid) to authenticated;

create policy "inspections_select" on public.demo_inspections for select
  using (public.inspection_in_my_workspace(demo_id));
create policy "inspections_insert" on public.demo_inspections for insert
  with check (public.inspection_in_my_workspace(demo_id));
create policy "inspections_update" on public.demo_inspections for update
  using (public.inspection_in_my_workspace(demo_id));
create policy "inspections_service_all" on public.demo_inspections for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index idx_demos_deal on public.demos(deal_id);
create index idx_demos_status on public.demos(status) where status not in ('completed', 'cancelled');
create index idx_demos_scheduled on public.demos(scheduled_date) where status = 'scheduled';
create index idx_demos_followup on public.demos(followup_due_at) where followup_completed = false;
create index idx_demo_inspections_demo on public.demo_inspections(demo_id);

-- ── 5. Qualification gate trigger ───────────────────────────────────────────

create or replace function public.demo_qualification_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only check when moving to 'approved' status
  if NEW.status = 'approved' and OLD.status = 'requested' then
    if not NEW.needs_assessment_complete then
      raise exception 'DEMO_GATE: Needs assessment must be complete before demo approval.'
        using errcode = 'P0001';
    end if;
    if not NEW.quote_presented then
      raise exception 'DEMO_GATE: Quote must be presented before demo approval.'
        using errcode = 'P0001';
    end if;
    if not NEW.buying_intent_confirmed then
      raise exception 'DEMO_GATE: Buying intent must be confirmed before demo approval.'
        using errcode = 'P0001';
    end if;
    NEW.approved_at := now();
  end if;

  -- Auto-set followup when completed
  if NEW.status = 'completed' and OLD.status != 'completed' then
    NEW.followup_due_at := now() + interval '24 hours';
  end if;

  -- Auto-set max_hours based on category
  if NEW.equipment_category is distinct from OLD.equipment_category then
    NEW.max_hours := case
      when NEW.equipment_category = 'forestry' then 4
      else 10
    end;
  end if;

  return NEW;
end;
$$;

drop trigger if exists demo_qualification_gate on public.demos;
create trigger demo_qualification_gate
  before update on public.demos
  for each row
  execute function public.demo_qualification_gate();

-- ── 6. Hour limit alert function ────────────────────────────────────────────
-- Called by the pipeline-enforcer cron to check for hour limit violations

create or replace function public.check_demo_hour_alerts()
returns table (
  demo_id uuid,
  deal_id uuid,
  hours_used numeric,
  max_hours numeric,
  pct_used numeric,
  alert_type text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    d.id as demo_id,
    d.deal_id,
    d.hours_used,
    d.max_hours,
    round((d.hours_used / nullif(d.max_hours, 0)) * 100, 1) as pct_used,
    case
      when d.hours_used >= d.max_hours then 'exceeded'
      when d.hours_used >= d.max_hours * 0.8 then 'warning'
    end as alert_type
  from public.demos d
  where d.status = 'in_progress'
    and d.hours_used is not null
    and d.hours_used >= d.max_hours * 0.8;
$$;

-- ── 7. Triggers ─────────────────────────────────────────────────────────────

drop trigger if exists set_demos_updated_at on public.demos;
create trigger set_demos_updated_at
  before update on public.demos for each row
  execute function public.set_updated_at();
