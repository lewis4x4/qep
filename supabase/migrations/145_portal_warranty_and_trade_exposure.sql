-- ============================================================================
-- Migration 145: Portal Warranty Claims + Trade-In Exposure
--
-- Moonshot 6 completion:
-- - Warranty claim submission with photo evidence
-- - Trade-in interest toggle on customer fleet equipment
-- - View joining trade-in interest with fleet intelligence predictions
-- ============================================================================

-- ── 1. Portal warranty claims ───────────────────────────────────────────────

create table public.portal_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  portal_customer_id uuid not null references public.portal_customers(id) on delete cascade,
  fleet_id uuid references public.customer_fleet(id) on delete set null,

  -- Claim
  claim_type text not null check (claim_type in (
    'manufacturer_defect', 'premature_failure', 'warranty_repair', 'recall', 'other'
  )),
  description text not null,
  photos jsonb default '[]',

  -- Status
  status text not null default 'submitted' check (status in (
    'submitted', 'under_review', 'approved', 'denied', 'completed'
  )),
  resolution_notes text,
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.portal_warranty_claims is 'Customer-submitted warranty claims via portal. Bobby''s vision: customers see status without calling.';

-- ── 2. RLS — dual access (portal customer + internal staff) ─────────────────

alter table public.portal_warranty_claims enable row level security;

create policy "warranty_claims_internal" on public.portal_warranty_claims for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());

create policy "warranty_claims_self_select" on public.portal_warranty_claims for select
  using (portal_customer_id = public.get_portal_customer_id());

create policy "warranty_claims_self_insert" on public.portal_warranty_claims for insert
  with check (portal_customer_id = public.get_portal_customer_id());

create policy "warranty_claims_service" on public.portal_warranty_claims for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 3. Indexes ──────────────────────────────────────────────────────────────

create index idx_warranty_claims_workspace on public.portal_warranty_claims(workspace_id);
create index idx_warranty_claims_customer on public.portal_warranty_claims(portal_customer_id);
create index idx_warranty_claims_status on public.portal_warranty_claims(status)
  where status in ('submitted', 'under_review');
create index idx_warranty_claims_fleet on public.portal_warranty_claims(fleet_id)
  where fleet_id is not null;

-- ── 4. Trade-in interest on customer fleet ──────────────────────────────────

alter table public.customer_fleet
  add column if not exists trade_in_interest boolean default false,
  add column if not exists trade_in_notes text;

comment on column public.customer_fleet.trade_in_interest is 'Customer flagged interest in trading this equipment — feeds Deal Timing Engine alerts';

-- ── 5. Trade-in opportunities view (feeds into Deal Timing Engine) ──────────

create or replace view public.portal_trade_in_opportunities as
select
  cf.id as fleet_id,
  cf.portal_customer_id,
  cf.make,
  cf.model,
  cf.year,
  cf.current_hours,
  cf.trade_in_notes,
  cf.warranty_expiry,
  pc.first_name || ' ' || pc.last_name as customer_name,
  pc.email as customer_email,
  pc.crm_contact_id,
  pc.crm_company_id,
  fi.predicted_replacement_date,
  fi.replacement_confidence,
  fi.outreach_status
from public.customer_fleet cf
join public.portal_customers pc on pc.id = cf.portal_customer_id
left join public.fleet_intelligence fi
  on fi.customer_name = (pc.first_name || ' ' || pc.last_name)
  and fi.make = cf.make
  and fi.model = cf.model
where cf.trade_in_interest = true
  and cf.is_active = true;

comment on view public.portal_trade_in_opportunities is 'Customers who flagged trade-in interest — joined with fleet intelligence predictions for Deal Timing Engine.';

-- ── 6. Trigger ──────────────────────────────────────────────────────────────

create trigger set_warranty_claims_updated_at
  before update on public.portal_warranty_claims for each row
  execute function public.set_updated_at();
