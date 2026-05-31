-- ============================================================================
-- Migration 632: Service rate & margin engine (H1)
--
-- Adds owner-binding equipment-class door-rate dimensions to service labor
-- pricing and stores explicit labor margin guardrail outputs on quote lines.
-- ============================================================================

alter table public.service_branch_config
  add column if not exists default_labor_cost_rate numeric(10, 2) not null default 67.50;

comment on column public.service_branch_config.default_labor_cost_rate is
  'Default loaded labor cost rate used for service quote margin checks when technician/profile or pricing-rule cost is unavailable.';

alter table public.service_labor_pricing_rules
  add column if not exists rate_key text,
  add column if not exists equipment_class_code text,
  add column if not exists field_mileage_rate numeric(10, 2) not null default 0,
  add column if not exists labor_cost_rate numeric(10, 2),
  add column if not exists target_margin_pct numeric(5, 2) not null default 55,
  add column if not exists floor_margin_pct numeric(5, 2) not null default 35,
  add column if not exists internal_discount_pct numeric(5, 2) not null default 10;

comment on column public.service_labor_pricing_rules.rate_key is
  'Stable seed/admin key for idempotent service labor rate cards.';
comment on column public.service_labor_pricing_rules.equipment_class_code is
  'Optional H1 service equipment-class door-rate bucket such as large_construction, forestry, grapple, or compact_construction.';
comment on column public.service_labor_pricing_rules.field_mileage_rate is
  'Optional per-mile field-service rate. H1 models the rate; H15 owns GPS/mileage feed automation.';
comment on column public.service_labor_pricing_rules.labor_cost_rate is
  'Loaded labor cost rate used by the service quote margin guardrail when technician cost is unavailable.';
comment on column public.service_labor_pricing_rules.target_margin_pct is
  'Target service labor margin percentage. Owner-binding H1 default is 55%.';
comment on column public.service_labor_pricing_rules.floor_margin_pct is
  'Hard floor service labor margin percentage. Owner-binding H1 default is 35%.';
comment on column public.service_labor_pricing_rules.internal_discount_pct is
  'Internal work-order door-rate discount. Owner-binding H1 default is 10% off the applicable door rate.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_labor_pricing_rules_field_mileage_nonnegative_chk') then
    alter table public.service_labor_pricing_rules
      add constraint service_labor_pricing_rules_field_mileage_nonnegative_chk
      check (field_mileage_rate >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_labor_pricing_rules_labor_cost_nonnegative_chk') then
    alter table public.service_labor_pricing_rules
      add constraint service_labor_pricing_rules_labor_cost_nonnegative_chk
      check (labor_cost_rate is null or labor_cost_rate >= 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_labor_pricing_rules_margin_pct_chk') then
    alter table public.service_labor_pricing_rules
      add constraint service_labor_pricing_rules_margin_pct_chk
      check (
        target_margin_pct >= 0 and target_margin_pct <= 100
        and floor_margin_pct >= 0 and floor_margin_pct <= 100
        and floor_margin_pct <= target_margin_pct
        and internal_discount_pct >= 0 and internal_discount_pct <= 100
      ) not valid;
  end if;
end $$;

create unique index if not exists uq_service_labor_pricing_rules_workspace_rate_key
  on public.service_labor_pricing_rules(workspace_id, rate_key)
  where rate_key is not null;

create index if not exists idx_service_labor_pricing_rules_equipment_lookup
  on public.service_labor_pricing_rules(workspace_id, active, equipment_class_code, labor_type_code, work_order_status)
  where active = true;

comment on index public.idx_service_labor_pricing_rules_equipment_lookup is
  'Supports H1 service quote door-rate lookup by workspace, equipment class, labor type, and WO status.';

alter table public.service_quote_lines
  add column if not exists labor_cost_rate numeric(10, 2),
  add column if not exists margin_cost_basis numeric(12, 2),
  add column if not exists margin_amount numeric(12, 2),
  add column if not exists margin_pct numeric(6, 2),
  add column if not exists margin_status text,
  add column if not exists margin_warning text,
  add column if not exists margin_floor_blocked boolean not null default false,
  add column if not exists margin_metadata jsonb not null default '{}'::jsonb;

comment on column public.service_quote_lines.labor_cost_rate is
  'Loaded labor cost rate per hour used for H1 margin calculations on labor lines.';
comment on column public.service_quote_lines.margin_pct is
  'Computed service quote line margin percentage. Labor floor is enforced at 35% by the quote engine.';
comment on column public.service_quote_lines.margin_status is
  'H1 margin guardrail status: target_met, below_target, near_floor, blocked_below_floor, or not_applicable.';
comment on column public.service_quote_lines.margin_floor_blocked is
  'True when a quote labor line is below the 35% hard floor; the edge function rejects new/updated quotes before persisting this state.';

alter table public.service_quotes
  add column if not exists margin_guardrail_status text not null default 'not_applicable',
  add column if not exists margin_guardrail_summary jsonb not null default '{}'::jsonb;

comment on column public.service_quotes.margin_guardrail_status is
  'Worst H1 margin guardrail status across quote labor lines.';
comment on column public.service_quotes.margin_guardrail_summary is
  'Structured H1 quote margin guardrail summary for API/UI consumers.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_quote_lines_margin_status_chk') then
    alter table public.service_quote_lines
      add constraint service_quote_lines_margin_status_chk
      check (
        margin_status is null
        or margin_status in ('target_met', 'below_target', 'near_floor', 'blocked_below_floor', 'not_applicable')
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_quotes_margin_guardrail_status_chk') then
    alter table public.service_quotes
      add constraint service_quotes_margin_guardrail_status_chk
      check (margin_guardrail_status in ('target_met', 'below_target', 'near_floor', 'blocked_below_floor', 'not_applicable')) not valid;
  end if;
end $$;

-- H13-compatible RLS policies for labor pricing administration.
drop policy if exists "svc_labor_pricing_rules_select" on public.service_labor_pricing_rules;
drop policy if exists "svc_labor_pricing_rules_insert" on public.service_labor_pricing_rules;
drop policy if exists "svc_labor_pricing_rules_update" on public.service_labor_pricing_rules;
drop policy if exists "svc_labor_pricing_rules_delete" on public.service_labor_pricing_rules;
drop policy if exists "svc_labor_pricing_rules_service_all" on public.service_labor_pricing_rules;

create policy "svc_labor_pricing_rules_select"
  on public.service_labor_pricing_rules for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in (
      'rep', 'admin', 'manager', 'owner', 'service_writer', 'technician', 'dispatch', 'parts_counter', 'finance_admin'
    )
  );

create policy "svc_labor_pricing_rules_insert"
  on public.service_labor_pricing_rules for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create policy "svc_labor_pricing_rules_update"
  on public.service_labor_pricing_rules for update
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create policy "svc_labor_pricing_rules_delete"
  on public.service_labor_pricing_rules for delete
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create policy "svc_labor_pricing_rules_service_all"
  on public.service_labor_pricing_rules for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

insert into public.service_labor_pricing_rules (
  workspace_id,
  rate_key,
  equipment_class_code,
  labor_type_code,
  work_order_status,
  default_premium_code,
  comment,
  pricing_code,
  pricing_value,
  field_mileage_rate,
  labor_cost_rate,
  target_margin_pct,
  floor_margin_pct,
  internal_discount_pct,
  active
)
values
  ('default', 'h1_large_construction_door_rate', 'large_construction', null, 'all', 'STD', 'H1 owner-binding large construction door rate: $185/hr.', 'fixed_price', 185.00, 0.00, 83.25, 55.00, 35.00, 10.00, true),
  ('default', 'h1_forestry_door_rate', 'forestry', null, 'all', 'STD', 'H1 owner-binding forestry door rate: $185/hr.', 'fixed_price', 185.00, 0.00, 83.25, 55.00, 35.00, 10.00, true),
  ('default', 'h1_grapple_door_rate', 'grapple', null, 'all', 'STD', 'H1 owner-binding grapple door rate: $165/hr.', 'fixed_price', 165.00, 0.00, 74.25, 55.00, 35.00, 10.00, true),
  ('default', 'h1_compact_construction_door_rate', 'compact_construction', null, 'all', 'STD', 'H1 owner-binding compact construction door rate: $165/hr.', 'fixed_price', 165.00, 0.00, 74.25, 55.00, 35.00, 10.00, true),
  ('default', 'h1_field_service_door_rate', null, 'field', 'all', 'STD', 'H1 owner-binding field service rate: $185/hr + $2.00/mile. Mileage feed/manual fallback is H15.', 'fixed_price', 185.00, 2.00, 83.25, 55.00, 35.00, 10.00, true),
  ('default', 'h1_lube_door_rate', null, 'lube', 'all', 'STD', 'H1 owner-binding lube door rate: $135/hr.', 'fixed_price', 135.00, 0.00, 60.75, 55.00, 35.00, 10.00, true),
  ('default', 'h1_specialty_door_rate', null, 'specialty', 'all', 'STD', 'H1 owner-binding specialty door rate: $195/hr.', 'fixed_price', 195.00, 0.00, 87.75, 55.00, 35.00, 10.00, true)
on conflict (workspace_id, rate_key) where rate_key is not null do update set
  equipment_class_code = excluded.equipment_class_code,
  labor_type_code = excluded.labor_type_code,
  work_order_status = excluded.work_order_status,
  default_premium_code = excluded.default_premium_code,
  comment = excluded.comment,
  pricing_code = excluded.pricing_code,
  pricing_value = excluded.pricing_value,
  field_mileage_rate = excluded.field_mileage_rate,
  labor_cost_rate = excluded.labor_cost_rate,
  target_margin_pct = excluded.target_margin_pct,
  floor_margin_pct = excluded.floor_margin_pct,
  internal_discount_pct = excluded.internal_discount_pct,
  active = true,
  updated_at = now();
