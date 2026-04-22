-- ============================================================================
-- Migration 351: Service Labor Pricing
--
-- Rollback notes:
--   1. Drop trigger set_service_labor_pricing_rules_updated_at.
--   2. Drop indexes idx_service_labor_pricing_rules_lookup and
--      idx_service_labor_pricing_rules_customer.
--   3. Drop policies on service_labor_pricing_rules.
--   4. Drop table service_labor_pricing_rules.
--   5. Optionally drop column default_labor_rate from service_branch_config
--      if no downstream slice depends on it.
-- ============================================================================

alter table public.service_branch_config
  add column if not exists default_labor_rate numeric(10, 2) not null default 150;

comment on column public.service_branch_config.default_labor_rate is
  'Default branch labor rate used when no more specific labor pricing rule applies.';

create table public.service_labor_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  location_code text,
  customer_id uuid references public.qrm_companies(id) on delete set null,
  customer_group_label text,
  work_order_status text not null default 'all' check (
    work_order_status in ('all', 'customer', 'warranty', 'internal')
  ),
  labor_type_code text,
  premium_code text,
  default_premium_code text,
  comment text,
  pricing_code text not null default 'fixed_price' check (
    pricing_code in ('fixed_price', 'list_plus_pct', 'list_minus_pct', 'cost_plus_pct', 'cost_minus_pct')
  ),
  pricing_value numeric(10, 2) not null,
  effective_start_on date,
  effective_end_on date,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_labor_pricing_rules is
  'Tiered labor pricing rules by location, customer/group, work-order status, labor type, and premium code.';

create index idx_service_labor_pricing_rules_lookup
  on public.service_labor_pricing_rules(workspace_id, active, location_code, work_order_status);

create index idx_service_labor_pricing_rules_customer
  on public.service_labor_pricing_rules(customer_id)
  where customer_id is not null;

alter table public.service_labor_pricing_rules enable row level security;

create policy "svc_labor_pricing_rules_select"
  on public.service_labor_pricing_rules for select
  using (workspace_id = public.get_my_workspace());

create policy "svc_labor_pricing_rules_insert"
  on public.service_labor_pricing_rules for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_labor_pricing_rules_update"
  on public.service_labor_pricing_rules for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_labor_pricing_rules_delete"
  on public.service_labor_pricing_rules for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "svc_labor_pricing_rules_service_all"
  on public.service_labor_pricing_rules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_service_labor_pricing_rules_updated_at
  before update on public.service_labor_pricing_rules
  for each row execute function public.set_updated_at();
