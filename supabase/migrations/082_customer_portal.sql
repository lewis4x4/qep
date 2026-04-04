-- ============================================================================
-- Migration 082: Customer Self-Service Portal
--
-- Separate auth flow from internal users. Customers get:
-- - Equipment fleet view, service history, warranty, maintenance schedules
-- - Quote review + e-signature for repeat purchases
-- - Rental self-service: availability, booking, deposit, return scheduling
-- - Parts ordering with AI-suggested PM kits
-- - Service requests with photo upload
-- - Payment portal: invoices, online payment, statements
-- ============================================================================

-- ── 1. Portal customers (separate from internal profiles) ───────────────────

create table public.portal_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  auth_user_id uuid unique, -- links to auth.users for portal login
  crm_contact_id uuid references public.crm_contacts(id) on delete set null,
  crm_company_id uuid references public.crm_companies(id) on delete set null,

  -- Profile
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  job_title text,

  -- Portal access
  is_active boolean not null default true,
  last_login_at timestamptz,
  portal_role text not null default 'viewer'
    check (portal_role in ('viewer', 'manager', 'admin')),

  -- Preferences
  notification_preferences jsonb default '{"email": true, "sms": false}',
  default_branch text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, email)
);

comment on table public.portal_customers is 'Customer-facing portal users. Separate auth flow from internal QRM users.';

-- ── 2. Customer equipment fleet (their machines) ────────────────────────────

create table public.customer_fleet (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  equipment_id uuid references public.crm_equipment(id) on delete set null,

  -- Equipment details (may not match internal inventory if customer-owned)
  make text not null,
  model text not null,
  year integer,
  serial_number text,
  current_hours numeric,

  -- Ownership
  purchase_date date,
  purchase_deal_id uuid references public.crm_deals(id) on delete set null,
  warranty_expiry date,
  warranty_type text, -- 'standard', 'extended', 'powertrain'

  -- Service
  last_service_date date,
  next_service_due date,
  service_interval_hours numeric,
  maintenance_plan_id uuid, -- future FK to EaaS maintenance plans

  -- Status
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_fleet is 'Customer-owned equipment tracked for service, warranty, and replacement cycle.';

-- ── 3. Service requests (customer-initiated) ────────────────────────────────

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  fleet_id uuid references public.customer_fleet(id) on delete set null,

  -- Request
  request_type text not null check (request_type in (
    'repair', 'maintenance', 'warranty', 'parts', 'inspection', 'emergency'
  )),
  description text not null,
  urgency text not null default 'normal' check (urgency in ('low', 'normal', 'high', 'emergency')),
  photos jsonb default '[]',

  -- Scheduling
  preferred_date date,
  preferred_branch text,

  -- Internal routing
  assigned_to uuid references public.profiles(id) on delete set null,
  department text, -- 'service', 'parts'

  -- Status
  status text not null default 'submitted' check (status in (
    'submitted', 'acknowledged', 'scheduled', 'in_progress',
    'parts_ordered', 'completed', 'cancelled'
  )),
  estimated_completion date,
  actual_completion date,

  -- Billing
  estimate_amount numeric,
  final_amount numeric,
  invoice_reference text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_requests is 'Customer-initiated service requests via portal. Photo upload supported.';

-- ── 4. Parts orders (customer self-service) ─────────────────────────────────

create table public.parts_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  fleet_id uuid references public.customer_fleet(id) on delete set null,

  -- Order
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'confirmed', 'processing',
    'shipped', 'delivered', 'cancelled'
  )),

  -- Items
  line_items jsonb not null default '[]',
  -- [{part_number, description, quantity, unit_price, is_ai_suggested}]

  -- AI suggestions
  ai_suggested_pm_kit boolean default false,
  ai_suggestion_reason text,

  -- Totals
  subtotal numeric default 0,
  tax numeric default 0,
  shipping numeric default 0,
  total numeric default 0,

  -- Delivery
  shipping_address jsonb,
  tracking_number text,
  estimated_delivery date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_orders is 'Customer self-service parts ordering. AI suggests PM kits based on fleet equipment.';

-- ── 5. Customer invoices / payment portal ───────────────────────────────────

create table public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,

  -- Invoice
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date not null,
  description text,

  -- Amounts
  amount numeric not null,
  tax numeric default 0,
  total numeric not null,
  amount_paid numeric default 0,
  balance_due numeric generated always as (total - amount_paid) stored,

  -- Status
  status text not null default 'pending' check (status in (
    'pending', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'
  )),

  -- Payment
  payment_method text,
  paid_at timestamptz,
  payment_reference text,

  -- Links
  deal_id uuid references public.crm_deals(id) on delete set null,
  service_request_id uuid references public.service_requests(id) on delete set null,
  parts_order_id uuid references public.parts_orders(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_invoices is 'Customer-facing invoice and payment tracking for the portal.';

-- ── 6. Quote reviews (e-signature) ──────────────────────────────────────────

create table public.portal_quote_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete set null,

  -- Quote
  quote_pdf_url text,
  quote_data jsonb default '{}',

  -- Review
  status text not null default 'sent' check (status in (
    'sent', 'viewed', 'accepted', 'rejected', 'expired', 'countered'
  )),
  viewed_at timestamptz,

  -- E-signature
  signature_url text,
  signed_at timestamptz,
  signer_name text,
  signer_ip text,

  -- Counter
  counter_notes text,

  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.portal_quote_reviews is 'Customer quote review and e-signature for deal closure.';

-- ── 7. RLS ──────────────────────────────────────────────────────────────────

alter table public.portal_customers enable row level security;
alter table public.customer_fleet enable row level security;
alter table public.service_requests enable row level security;
alter table public.parts_orders enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.portal_quote_reviews enable row level security;

-- Internal staff can see all portal data in their workspace
create policy "portal_customers_internal" on public.portal_customers for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));

-- Portal customers can only see their own data
create or replace function public.get_portal_customer_id()
returns uuid
language sql security definer stable set search_path = ''
as $$
  select id from public.portal_customers where auth_user_id = auth.uid();
$$;
revoke execute on function public.get_portal_customer_id() from public;
grant execute on function public.get_portal_customer_id() to authenticated;

create policy "portal_customers_self" on public.portal_customers for select
  using (auth_user_id = auth.uid());

create policy "fleet_internal" on public.customer_fleet for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "fleet_self" on public.customer_fleet for select
  using (portal_customer_id = public.get_portal_customer_id());

create policy "service_requests_internal" on public.service_requests for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "service_requests_self" on public.service_requests for all
  using (portal_customer_id = public.get_portal_customer_id())
  with check (portal_customer_id = public.get_portal_customer_id());

create policy "parts_orders_internal" on public.parts_orders for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "parts_orders_self" on public.parts_orders for all
  using (portal_customer_id = public.get_portal_customer_id())
  with check (portal_customer_id = public.get_portal_customer_id());

create policy "invoices_internal" on public.customer_invoices for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "invoices_self" on public.customer_invoices for select
  using (portal_customer_id = public.get_portal_customer_id());

create policy "quote_reviews_internal" on public.portal_quote_reviews for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "quote_reviews_self" on public.portal_quote_reviews for all
  using (portal_customer_id = public.get_portal_customer_id())
  with check (portal_customer_id = public.get_portal_customer_id());

-- Service role bypass on all
create policy "portal_customers_service" on public.portal_customers for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "fleet_service" on public.customer_fleet for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_requests_service" on public.service_requests for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "parts_orders_service" on public.parts_orders for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "invoices_service" on public.customer_invoices for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "quote_reviews_service" on public.portal_quote_reviews for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 8. Indexes ──────────────────────────────────────────────────────────────

create index idx_portal_customers_workspace on public.portal_customers(workspace_id);
create index idx_portal_customers_auth on public.portal_customers(auth_user_id) where auth_user_id is not null;
create index idx_portal_customers_contact on public.portal_customers(crm_contact_id) where crm_contact_id is not null;
create index idx_portal_customers_email on public.portal_customers(workspace_id, email);

create index idx_customer_fleet_workspace on public.customer_fleet(workspace_id);
create index idx_customer_fleet_customer on public.customer_fleet(portal_customer_id);
create index idx_customer_fleet_warranty on public.customer_fleet(warranty_expiry) where warranty_expiry is not null;
create index idx_customer_fleet_service_due on public.customer_fleet(next_service_due) where next_service_due is not null;

create index idx_service_requests_workspace on public.service_requests(workspace_id);
create index idx_service_requests_customer on public.service_requests(portal_customer_id);
create index idx_service_requests_status on public.service_requests(status) where status not in ('completed', 'cancelled');

create index idx_parts_orders_workspace on public.parts_orders(workspace_id);
create index idx_parts_orders_customer on public.parts_orders(portal_customer_id);
create index idx_parts_orders_status on public.parts_orders(status) where status not in ('delivered', 'cancelled');

create index idx_customer_invoices_workspace on public.customer_invoices(workspace_id);
create index idx_customer_invoices_customer on public.customer_invoices(portal_customer_id);
create index idx_customer_invoices_status on public.customer_invoices(status) where status in ('pending', 'sent', 'overdue');
create index idx_customer_invoices_due on public.customer_invoices(due_date) where status in ('pending', 'sent');

create index idx_quote_reviews_workspace on public.portal_quote_reviews(workspace_id);
create index idx_quote_reviews_customer on public.portal_quote_reviews(portal_customer_id);
create index idx_quote_reviews_status on public.portal_quote_reviews(status) where status in ('sent', 'viewed');

-- ── 9. Triggers ─────────────────────────────────────────────────────────────

create trigger set_portal_customers_updated_at before update on public.portal_customers for each row execute function public.set_updated_at();
create trigger set_customer_fleet_updated_at before update on public.customer_fleet for each row execute function public.set_updated_at();
create trigger set_service_requests_updated_at before update on public.service_requests for each row execute function public.set_updated_at();
create trigger set_parts_orders_updated_at before update on public.parts_orders for each row execute function public.set_updated_at();
create trigger set_customer_invoices_updated_at before update on public.customer_invoices for each row execute function public.set_updated_at();
create trigger set_quote_reviews_updated_at before update on public.portal_quote_reviews for each row execute function public.set_updated_at();
