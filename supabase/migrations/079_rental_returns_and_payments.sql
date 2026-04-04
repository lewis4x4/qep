-- ============================================================================
-- Migration 079: Rental Returns + Payment Policy Enforcement + GL Routing
--
-- Three operational systems in one migration:
-- 1. Rental deposit return process (branching workflow: clean vs damaged)
-- 2. Payment validation rules (check limits, delivery-day restrictions)
-- 3. GL account routing for work orders
-- ============================================================================

-- ═══ 1. Rental Returns ═════════════════════════════════════════════════════

create table public.rental_returns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Inspection (Step 1: Iron Man inspects)
  inspection_date date,
  inspector_id uuid references public.profiles(id) on delete set null,
  inspection_checklist jsonb default '[]',
  condition_photos jsonb default '[]',

  -- Decision (Step 2: Rental Asset Manager decides)
  has_charges boolean, -- null = pending, false = clean, true = damaged
  decided_by uuid references public.profiles(id) on delete set null,

  -- Clean return path
  credit_invoice_number text,
  rental_contract_reference text,

  -- Damaged return path
  work_order_number text,
  damage_description text,
  charge_amount numeric,
  deposit_amount numeric,
  deposit_covers_charges boolean,
  balance_due numeric,

  -- Refund (same method as payment per SOP)
  original_payment_method text check (original_payment_method in ('cash', 'check', 'wire', 'credit_card', 'debit_card', 'ach')),
  refund_method text,
  refund_status text default 'pending' check (refund_status in ('pending', 'processing', 'completed')),
  refund_check_turnaround text default '7-14 days',

  status text not null default 'inspection_pending' check (status in (
    'inspection_pending', 'decision_pending', 'clean_return', 'damage_assessment',
    'work_order_open', 'refund_processing', 'completed'
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rental_returns enable row level security;
create policy "rental_returns_workspace" on public.rental_returns for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "rental_returns_service" on public.rental_returns for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_rental_returns_status on public.rental_returns(status) where status != 'completed';

-- ═══ 2. Payment Validation ═════════════════════════════════════════════════

create table public.payment_validations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  customer_id uuid references public.crm_contacts(id) on delete set null,

  payment_type text not null,
  amount numeric not null,
  validation_date date not null default current_date,

  -- Running totals
  daily_check_total numeric,

  -- Rules applied
  rule_applied text,
  passed boolean not null,
  override_by uuid references public.profiles(id) on delete set null,
  override_reason text,

  -- Context
  invoice_reference text,
  transaction_type text check (transaction_type in ('equipment_sale', 'rental', 'parts', 'service')),
  is_delivery_day boolean default false,

  created_at timestamptz not null default now()
);

alter table public.payment_validations enable row level security;
create policy "payment_validations_workspace" on public.payment_validations for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "payment_validations_service" on public.payment_validations for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Payment rules enforcement function ──────────────────────────────────────

create or replace function public.validate_payment(
  p_workspace_id text,
  p_customer_id uuid,
  p_payment_type text,
  p_amount numeric,
  p_transaction_type text,
  p_is_delivery_day boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_daily_total numeric;
  v_rule text;
  v_passed boolean := true;
  v_reason text;
begin
  -- Rule 1: Equipment sales on delivery day = Cashier's Check ONLY
  if p_is_delivery_day and p_transaction_type = 'equipment_sale' and p_payment_type not in ('cashiers_check', 'wire', 'ach') then
    v_passed := false;
    v_rule := 'delivery_day_cashiers_only';
    v_reason := 'Equipment sales on delivery day require Cashier''s Check, wire, or ACH only.';
  end if;

  -- Rule 2: Equipment rentals = no regular checks
  if p_transaction_type = 'rental' and p_payment_type in ('business_check', 'personal_check') then
    v_passed := false;
    v_rule := 'rental_no_checks';
    v_reason := 'Equipment rentals do not accept regular checks. Use Cashier''s Check, ACH, card, or wire.';
  end if;

  -- Rule 3: Business check daily limit $2,500
  if p_payment_type = 'business_check' and v_passed then
    select coalesce(sum(amount), 0) into v_daily_total
    from public.payment_validations
    where customer_id = p_customer_id
      and validation_date = current_date
      and payment_type = 'business_check'
      and passed = true;

    if v_daily_total + p_amount > 2500 then
      v_passed := false;
      v_rule := 'business_check_limit';
      v_reason := format('Business check limit exceeded. Daily total: $%s + $%s = $%s (limit: $2,500)',
        v_daily_total, p_amount, v_daily_total + p_amount);
    end if;
  end if;

  -- Rule 4: Personal check daily limit $1,000
  if p_payment_type = 'personal_check' and v_passed then
    select coalesce(sum(amount), 0) into v_daily_total
    from public.payment_validations
    where customer_id = p_customer_id
      and validation_date = current_date
      and payment_type = 'personal_check'
      and passed = true;

    if v_daily_total + p_amount > 1000 then
      v_passed := false;
      v_rule := 'personal_check_limit';
      v_reason := format('Personal check limit exceeded. Daily total: $%s + $%s = $%s (limit: $1,000)',
        v_daily_total, p_amount, v_daily_total + p_amount);
    end if;
  end if;

  return jsonb_build_object(
    'passed', v_passed,
    'rule_applied', v_rule,
    'reason', v_reason,
    'daily_check_total', v_daily_total
  );
end;
$$;

-- ═══ 3. GL Account Routing ═════════════════════════════════════════════════

create table public.gl_routing_rules (
  id uuid primary key default gen_random_uuid(),
  gl_code text not null,
  gl_name text not null,
  gl_number text,

  -- Matching rules
  equipment_status text,
  ticket_type text,
  is_customer_damage boolean,
  has_ldw boolean,
  is_sales_truck boolean,
  truck_numbers text[],
  is_event_related boolean,
  requires_ownership_approval boolean default false,

  description text,
  usage_examples text,

  created_at timestamptz not null default now()
);

alter table public.gl_routing_rules enable row level security;
create policy "gl_rules_select_workspace" on public.gl_routing_rules for select
  using (public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "gl_rules_modify_elevated" on public.gl_routing_rules for all
  using (public.get_my_role() in ('admin', 'owner')) with check (public.get_my_role() in ('admin', 'owner'));
create policy "gl_rules_service" on public.gl_routing_rules for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Seed GL routing rules from SOP
insert into public.gl_routing_rules (gl_code, gl_name, description, equipment_status, requires_ownership_approval) values
  ('EQUIP001', 'Equipment Inventory', 'Repairs/maintenance on inventory units', 'inventory', false),
  ('RENTA001', 'Rental Fleet', 'General rental fleet maintenance', 'rental', false),
  ('RENTA003', 'Rental Customer Damage', 'Customer-caused damage on rental equipment', 'rental', false),
  ('LOSS01', 'Loss Damage Waiver', 'LDW-covered rental damage', null, false),
  ('SALEM001', 'Sales Department', 'Sales truck maintenance & operational costs', null, false),
  ('TRKM008', 'Truck Maintenance', 'Sales truck fleet (units 251-254)', null, false),
  ('EXPO01', 'Events & Expos', 'Trade show and event-related equipment costs', null, false),
  ('SALEW001', 'Good Faith', 'Customer goodwill — REQUIRES OWNERSHIP APPROVAL', null, true);

-- ── Triggers ────────────────────────────────────────────────────────────────

drop trigger if exists set_rental_returns_updated_at on public.rental_returns;
create trigger set_rental_returns_updated_at
  before update on public.rental_returns for each row
  execute function public.set_updated_at();
