-- ============================================================================
-- Migration 235: Rental Contracts, Extensions, and Pricing Rules
-- ============================================================================

create table if not exists public.rental_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  requested_category text,
  requested_make text,
  requested_model text,
  branch_id uuid references public.branches(id) on delete set null,
  delivery_mode text not null default 'pickup' check (delivery_mode in ('pickup', 'delivery')),
  delivery_location text,
  request_type text not null default 'booking' check (request_type in ('booking', 'extension')),
  requested_start_date date not null,
  requested_end_date date not null,
  approved_start_date date,
  approved_end_date date,
  status text not null default 'submitted' check (status in (
    'submitted', 'reviewing', 'quoted', 'approved', 'awaiting_payment', 'active', 'completed', 'declined', 'cancelled'
  )),
  estimate_daily_rate numeric(12,2),
  estimate_weekly_rate numeric(12,2),
  estimate_monthly_rate numeric(12,2),
  agreed_daily_rate numeric(12,2),
  agreed_weekly_rate numeric(12,2),
  agreed_monthly_rate numeric(12,2),
  deposit_required boolean not null default false,
  deposit_amount numeric(12,2),
  deposit_status text check (deposit_status in ('not_required', 'pending', 'processing', 'paid', 'failed')),
  deposit_invoice_id uuid references public.customer_invoices(id) on delete set null,
  customer_notes text,
  dealer_notes text,
  dealer_response text,
  signed_terms_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requested_end_date >= requested_start_date),
  check (status not in ('approved', 'awaiting_payment', 'active', 'completed') or equipment_id is not null)
);

comment on table public.rental_contracts is
  'Customer-facing rental booking contracts and dealership-approved rental agreements.';

create table if not exists public.rental_contract_extensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  rental_contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  requested_end_date date not null,
  approved_end_date date,
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'approved', 'declined', 'cancelled')),
  customer_reason text,
  dealer_response text,
  additional_charge numeric(12,2),
  requested_by uuid references public.portal_customers(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  payment_invoice_id uuid references public.customer_invoices(id) on delete set null,
  payment_status text check (payment_status in ('not_required', 'pending', 'processing', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rental_contract_extensions is
  'Customer-requested rental extensions with dealership approval and payment gating.';

create table if not exists public.rental_rate_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  customer_id uuid references public.portal_customers(id) on delete cascade,
  equipment_id uuid references public.qrm_equipment(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  category text,
  make text,
  model text,
  season_start date,
  season_end date,
  daily_rate numeric(12,2),
  weekly_rate numeric(12,2),
  monthly_rate numeric(12,2),
  minimum_days integer,
  is_active boolean not null default true,
  priority_rank integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rental_rate_rules is
  'Rental pricing rules with precedence across customer, unit, branch, category, and seasonal scopes.';

alter table public.rental_returns
  add column if not exists rental_contract_id uuid references public.rental_contracts(id) on delete set null;

create index if not exists idx_rental_contracts_customer_status
  on public.rental_contracts (portal_customer_id, status, created_at desc);
create index if not exists idx_rental_contracts_workspace_status
  on public.rental_contracts (workspace_id, request_type, status);
create index if not exists idx_rental_contracts_equipment_status
  on public.rental_contracts (equipment_id, status) where equipment_id is not null;
create index if not exists idx_rental_contracts_deposit_invoice
  on public.rental_contracts (deposit_invoice_id) where deposit_invoice_id is not null;

create index if not exists idx_rental_contract_extensions_contract_status
  on public.rental_contract_extensions (rental_contract_id, status, created_at desc);

create index if not exists idx_rental_rate_rules_scope
  on public.rental_rate_rules (workspace_id, is_active, priority_rank);
create index if not exists idx_rental_rate_rules_customer
  on public.rental_rate_rules (customer_id) where customer_id is not null;
create index if not exists idx_rental_rate_rules_equipment
  on public.rental_rate_rules (equipment_id) where equipment_id is not null;

alter table public.rental_contracts enable row level security;
alter table public.rental_contract_extensions enable row level security;
alter table public.rental_rate_rules enable row level security;

create policy "rental_contracts_internal" on public.rental_contracts for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'));
create policy "rental_contracts_self" on public.rental_contracts for select
  using (portal_customer_id = public.get_portal_customer_id());
create policy "rental_contracts_service" on public.rental_contracts for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "rental_extensions_internal" on public.rental_contract_extensions for all
  using (
    exists (
      select 1
      from public.rental_contracts rc
      where rc.id = rental_contract_extensions.rental_contract_id
        and rc.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    )
  )
  with check (
    exists (
      select 1
      from public.rental_contracts rc
      where rc.id = rental_contract_extensions.rental_contract_id
        and rc.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    )
  );
create policy "rental_extensions_self" on public.rental_contract_extensions for select
  using (
    exists (
      select 1
      from public.rental_contracts rc
      where rc.id = rental_contract_extensions.rental_contract_id
        and rc.portal_customer_id = public.get_portal_customer_id()
    )
  );
create policy "rental_extensions_service" on public.rental_contract_extensions for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "rental_rate_rules_internal" on public.rental_rate_rules for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "rental_rate_rules_service" on public.rental_rate_rules for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop trigger if exists set_rental_contracts_updated_at on public.rental_contracts;
create trigger set_rental_contracts_updated_at
  before update on public.rental_contracts for each row
  execute function public.set_updated_at();

drop trigger if exists set_rental_contract_extensions_updated_at on public.rental_contract_extensions;
create trigger set_rental_contract_extensions_updated_at
  before update on public.rental_contract_extensions for each row
  execute function public.set_updated_at();

drop trigger if exists set_rental_rate_rules_updated_at on public.rental_rate_rules;
create trigger set_rental_rate_rules_updated_at
  before update on public.rental_rate_rules for each row
  execute function public.set_updated_at();
