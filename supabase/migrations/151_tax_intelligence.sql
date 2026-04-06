-- ============================================================================
-- Migration 151: Tax & Incentive Intelligence
--
-- Moonshot 4: Ryan explained the tax exemption complexity.
-- Florida: equipment for fire suppression/mitigation exempt on machine
-- AND all future parts/service. Same mulcher could be residential or
-- fire mitigation — it's the customer's APPLICATION that determines it.
--
-- Section 179, manufacturer incentives, tariff timing — all in one system.
-- ============================================================================

-- ── 1. Tax treatments (jurisdiction + category rules) ───────────────────────

create table public.tax_treatments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  jurisdiction text not null, -- 'FL', 'GA', etc.
  tax_type text not null check (tax_type in ('sales_tax', 'use_tax', 'rental_tax', 'exemption')),
  rate numeric(8,5) not null default 0,
  applies_to text not null check (applies_to in ('equipment_new', 'equipment_used', 'parts', 'service', 'rental', 'attachments')),
  effective_date date,
  expiration_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tax_treatments is 'Jurisdiction-based tax rates. Application determines exemption (fire mitigation vs residential).';

alter table public.tax_treatments enable row level security;
create policy "tax_treatments_workspace" on public.tax_treatments for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "tax_treatments_service" on public.tax_treatments for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_tax_treatments_jurisdiction on public.tax_treatments(jurisdiction, applies_to, is_active) where is_active = true;

-- ── 2. Tax exemption certificates ───────────────────────────────────────────

create table public.tax_exemption_certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  customer_profile_id uuid references public.customer_profiles_extended(id) on delete cascade,
  crm_company_id uuid references public.crm_companies(id) on delete set null,

  certificate_number text not null,
  exemption_type text not null, -- 'fire_mitigation', 'agriculture', 'government', 'resale'
  issuing_state text not null,
  effective_date date not null,
  expiration_date date,
  document_url text,

  -- Application-based (Ryan's key insight)
  equipment_application text, -- 'fire_suppression', 'land_clearing', 'tree_service'
  covers_parts boolean default false,
  covers_service boolean default false,
  covers_equipment boolean default true,

  -- Verification
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'revoked')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tax_exemption_certificates is 'Customer tax exemptions. Application-based: same equipment, different tax treatment depending on use case.';

alter table public.tax_exemption_certificates enable row level security;
create policy "exemptions_workspace" on public.tax_exemption_certificates for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "exemptions_service" on public.tax_exemption_certificates for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_exemptions_customer on public.tax_exemption_certificates(customer_profile_id);
create index idx_exemptions_company on public.tax_exemption_certificates(crm_company_id) where crm_company_id is not null;
create index idx_exemptions_active on public.tax_exemption_certificates(status, expiration_date)
  where status = 'verified';

-- ── 3. Section 179 scenarios ────────────────────────────────────────────────

create table public.section_179_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.crm_deals(id) on delete cascade,

  tax_year integer not null,
  equipment_cost numeric not null,
  bonus_depreciation_pct numeric(5,2) default 100, -- 2026: 60% (phasing down)
  section_179_deduction numeric,
  bonus_depreciation_amount numeric,
  total_deduction numeric,
  effective_tax_rate numeric(5,2), -- customer's marginal rate
  tax_savings numeric,
  net_cost_after_tax numeric,
  assumptions jsonb default '{}',
  computed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.section_179_scenarios is 'Section 179 depreciation scenarios per deal. Sales enablement tool — shows effective cost after tax benefit.';

alter table public.section_179_scenarios enable row level security;
create policy "s179_workspace" on public.section_179_scenarios for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "s179_service" on public.section_179_scenarios for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_s179_deal on public.section_179_scenarios(deal_id);

-- ── 4. Tariff tracking ──────────────────────────────────────────────────────

create table public.tariff_tracking (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  hts_code text,
  description text not null,
  manufacturer text,
  origin_country text,
  tariff_rate numeric(5,2) not null,
  effective_date date not null,
  expiration_date date,
  impact_on_cost numeric, -- estimated $ impact per unit
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tariff_tracking is 'Tariff rate tracking. Ryan: "buy before the price goes up" is the biggest purchase motivator.';

alter table public.tariff_tracking enable row level security;
create policy "tariff_workspace" on public.tariff_tracking for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "tariff_service" on public.tariff_tracking for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_tariff_mfr_date on public.tariff_tracking(manufacturer, effective_date);

-- ── 5. Triggers ─────────────────────────────────────────────────────────────

create trigger set_tax_treatments_updated_at before update on public.tax_treatments for each row execute function public.set_updated_at();
create trigger set_exemptions_updated_at before update on public.tax_exemption_certificates for each row execute function public.set_updated_at();
create trigger set_s179_updated_at before update on public.section_179_scenarios for each row execute function public.set_updated_at();
create trigger set_tariff_updated_at before update on public.tariff_tracking for each row execute function public.set_updated_at();
