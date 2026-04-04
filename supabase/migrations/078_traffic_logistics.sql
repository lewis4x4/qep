-- ============================================================================
-- Migration 078: Traffic & Logistics System
--
-- Per owner's Traffic Manual: No equipment moves without a traffic ticket.
-- 12 ticket types, color-coded status, GPS delivery, driver checklists.
-- Auto-creation when deal reaches Stage 18 (Delivery Scheduled).
-- Requestors cannot modify after submission (locked).
-- ============================================================================

create table public.traffic_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Required fields (from Traffic Manual)
  stock_number text not null,
  equipment_id uuid references public.crm_equipment(id) on delete set null,
  from_location text not null,
  to_location text not null,
  to_contact_name text not null,
  to_contact_phone text not null,
  shipping_date date not null,
  department text not null,
  billing_comments text not null,

  -- Type (from Traffic Manual: 12 ticket types)
  ticket_type text not null check (ticket_type in (
    'demo', 'loaner', 'rental', 'sale', 'purchase', 'service',
    'trade_in', 'customer_transfer', 'job_site_transfer',
    'location_transfer', 'miscellaneous', 're_rent'
  )),

  -- Status (from Traffic Manual: color coding)
  status text not null default 'haul_pending' check (status in (
    'haul_pending',   -- Gray
    'scheduled',      -- Yellow (Low)
    'being_shipped',  -- Orange (Medium)
    'completed'       -- Red (High/Delivered)
  )),
  urgency text, -- Set by Logistics Coordinator only

  -- GPS
  delivery_lat numeric,
  delivery_lng numeric,
  delivery_address text,

  -- Assignment
  requested_by uuid references public.profiles(id) on delete set null,
  driver_id uuid references public.profiles(id) on delete set null,
  coordinator_id uuid references public.profiles(id) on delete set null,

  -- Driver checklist
  driver_checklist jsonb default '[]',
  delivery_signature_url text,
  delivery_photos jsonb default '[]',
  hour_meter_reading numeric,
  problems_reported text,

  -- Links
  deal_id uuid references public.crm_deals(id) on delete set null,
  demo_id uuid references public.demos(id) on delete set null,

  -- Requestor lock (from Traffic Manual)
  locked boolean default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.traffic_tickets is 'Logistics traffic tickets. No equipment moves without one. 12 types, color-coded status.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.traffic_tickets enable row level security;

create policy "traffic_select_workspace" on public.traffic_tickets for select
  using (workspace_id = public.get_my_workspace());
create policy "traffic_insert_workspace" on public.traffic_tickets for insert
  with check (workspace_id = public.get_my_workspace());
create policy "traffic_update_workspace" on public.traffic_tickets for update
  using (workspace_id = public.get_my_workspace());
create policy "traffic_delete_elevated" on public.traffic_tickets for delete
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'));
create policy "traffic_service_all" on public.traffic_tickets for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_traffic_status on public.traffic_tickets(status) where status != 'completed';
create index idx_traffic_shipping_date on public.traffic_tickets(shipping_date) where status != 'completed';
create index idx_traffic_deal on public.traffic_tickets(deal_id) where deal_id is not null;
create index idx_traffic_driver on public.traffic_tickets(driver_id) where driver_id is not null;

-- ── Auto-lock on submission ─────────────────────────────────────────────────

create or replace function public.traffic_ticket_auto_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock ticket once it leaves haul_pending (requestor can no longer modify)
  if OLD.status = 'haul_pending' and NEW.status != 'haul_pending' then
    NEW.locked := true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists traffic_auto_lock on public.traffic_tickets;
create trigger traffic_auto_lock
  before update of status on public.traffic_tickets
  for each row execute function public.traffic_ticket_auto_lock();

-- ── Add FK from demos to traffic tickets ────────────────────────────────────

alter table public.demos
  add column if not exists traffic_ticket_id_fk uuid references public.traffic_tickets(id) on delete set null;

-- ── Updated_at trigger ──────────────────────────────────────────────────────

drop trigger if exists set_traffic_tickets_updated_at on public.traffic_tickets;
create trigger set_traffic_tickets_updated_at
  before update on public.traffic_tickets for each row
  execute function public.set_updated_at();
