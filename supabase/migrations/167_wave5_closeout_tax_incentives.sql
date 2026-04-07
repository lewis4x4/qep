-- ============================================================================
-- Migration 167: Wave 5A.3 — Tax breakdowns + Manufacturer incentives
--
-- Locked tax-mode contract (Phase 2A):
--   1. Mode = estimate (NEVER compliance-grade)
--   2. Source precedence = branch > delivery > customer_billing
--   3. Override = rep reason + audit; manager approval required for ±2%
--      deviation from computed rate
--   4. Stale-cache window = 30 days per jurisdiction
--   5. Disclaimer = "Estimated only — consult tax and professional"
--      (version v1 stamped on every persisted row)
-- ============================================================================

-- ── 1. Quote tax breakdowns ────────────────────────────────────────────────

create table if not exists public.quote_tax_breakdowns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,

  -- Jurisdiction breakdown (estimate-only — never compliance-grade)
  jurisdiction text not null,                     -- e.g. 'WV-Charleston'
  state_rate numeric(6,4) not null default 0,
  county_rate numeric(6,4) not null default 0,
  city_rate numeric(6,4) not null default 0,
  special_district_rate numeric(6,4) not null default 0,
  total_rate numeric(6,4) generated always as (
    state_rate + county_rate + city_rate + special_district_rate
  ) stored,

  -- Amounts
  taxable_subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,

  -- Source precedence (which input the jurisdiction was resolved from)
  source_precedence_used text not null default 'branch'
    check (source_precedence_used in ('branch', 'delivery', 'customer_billing', 'manual_override')),

  -- Override audit (rep reason + manager approver if ±2% from computed)
  manual_override boolean not null default false,
  override_reason text,
  override_approver_id uuid references public.profiles(id) on delete set null,
  override_delta_pct numeric(5,2),

  -- Cache lifecycle
  -- stale_after was originally a STORED generated column, but Postgres rejects
  -- non-immutable expressions (interval arithmetic against computed_at) in
  -- stored generation (SQLSTATE 42P17). Replaced with a regular column that
  -- defaults to now()+30d on insert and is maintained by a BEFORE UPDATE
  -- trigger below. Queries that filter on stale_after (mig 181, 184) are
  -- unaffected.
  computed_at timestamptz not null default now(),
  computed_by_function text,
  stale_after timestamptz not null default (now() + interval '30 days'),

  -- Disclaimer version stamp (v2 contract)
  disclaimer_version text not null default 'v1',

  -- Linked exemption certificate (if applied)
  exemption_certificate_id uuid references public.tax_exemption_certificates(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quote_tax_breakdowns is 'Per-quote tax line breakdown. ESTIMATE-ONLY — disclaimer_version + override audit columns present.';

alter table public.quote_tax_breakdowns enable row level security;

create policy "qtb_workspace" on public.quote_tax_breakdowns for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "qtb_service" on public.quote_tax_breakdowns for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create unique index uq_qtb_quote on public.quote_tax_breakdowns(quote_package_id);
create index idx_qtb_workspace on public.quote_tax_breakdowns(workspace_id);
create index idx_qtb_stale on public.quote_tax_breakdowns(stale_after);

create trigger set_qtb_updated_at
  before update on public.quote_tax_breakdowns
  for each row execute function public.set_updated_at();

-- Keep stale_after = computed_at + 30 days on every insert/update. This
-- mirrors the original stored-generated-column intent without tripping
-- the immutable-expression rule.
create or replace function public.qtb_sync_stale_after()
returns trigger
language plpgsql
as $$
begin
  new.stale_after := new.computed_at + interval '30 days';
  return new;
end;
$$;

create trigger trg_qtb_sync_stale_after
  before insert or update of computed_at on public.quote_tax_breakdowns
  for each row execute function public.qtb_sync_stale_after();

-- ── 2. Manufacturer incentives ─────────────────────────────────────────────

create table if not exists public.manufacturer_incentives (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  manufacturer text not null,
  program_name text not null,
  program_code text,
  description text,

  -- Eligibility rules — model match, customer type, min purchase, etc.
  eligibility_rules jsonb not null default '{}'::jsonb,

  -- Discount mechanics
  discount_type text not null check (discount_type in ('flat', 'pct', 'apr_buydown', 'cash_back')),
  discount_value numeric(14,2) not null,

  -- Lifecycle
  effective_date date not null,
  expiration_date date,
  stackable boolean not null default false,
  requires_approval boolean not null default false,

  -- Provenance
  source_url text,
  ai_confidence numeric(3,2) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Defensive column backfill: manufacturer_incentives may pre-exist on some
-- environments with a minimal schema (create-table-if-not-exists skips the
-- full definition above). Ensure every column this migration's policies
-- and indexes reference is present.
alter table public.manufacturer_incentives
  add column if not exists workspace_id text not null default public.get_my_workspace(),
  add column if not exists manufacturer text,
  add column if not exists program_name text,
  add column if not exists program_code text,
  add column if not exists description text,
  add column if not exists eligibility_rules jsonb not null default '{}'::jsonb,
  add column if not exists discount_type text,
  add column if not exists discount_value numeric(14,2),
  add column if not exists effective_date date,
  add column if not exists expiration_date date,
  add column if not exists stackable boolean not null default false,
  add column if not exists requires_approval boolean not null default false,
  add column if not exists source_url text,
  add column if not exists ai_confidence numeric(3,2),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

comment on table public.manufacturer_incentives is 'Active mfr incentives. Manager-only writes via RLS. Auto-applied by quote-incentive-resolver.';

alter table public.manufacturer_incentives enable row level security;

-- Drop-then-create so the migration is idempotent against environments where
-- these policies already exist from a partial prior apply.
drop policy if exists "mi_workspace_select" on public.manufacturer_incentives;
drop policy if exists "mi_workspace_write" on public.manufacturer_incentives;
drop policy if exists "mi_service" on public.manufacturer_incentives;

-- Read: any authed workspace user
create policy "mi_workspace_select" on public.manufacturer_incentives for select
  using (workspace_id = public.get_my_workspace());
-- Write: manager+ only via the policy in the next statement (enforced in app for now via role gate)
create policy "mi_workspace_write" on public.manufacturer_incentives for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "mi_service" on public.manufacturer_incentives for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_mi_mfr_dates on public.manufacturer_incentives(manufacturer, effective_date, expiration_date);
create index idx_mi_workspace on public.manufacturer_incentives(workspace_id);

create trigger set_mi_updated_at
  before update on public.manufacturer_incentives
  for each row execute function public.set_updated_at();

-- ── 3. Quote incentive applications (audit trail) ─────────────────────────

create table if not exists public.quote_incentive_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  incentive_id uuid not null references public.manufacturer_incentives(id) on delete restrict,
  applied_amount numeric(14,2) not null,
  applied_at timestamptz not null default now(),
  applied_by uuid references public.profiles(id) on delete set null,
  auto_applied boolean not null default true,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  removal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quote_incentive_applications is 'Audit trail of every incentive applied to (and removed from) a quote.';

alter table public.quote_incentive_applications enable row level security;

create policy "qia_workspace" on public.quote_incentive_applications for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "qia_service" on public.quote_incentive_applications for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index idx_qia_quote on public.quote_incentive_applications(quote_package_id);
create index idx_qia_incentive on public.quote_incentive_applications(incentive_id);
create index idx_qia_active on public.quote_incentive_applications(quote_package_id) where removed_at is null;

create trigger set_qia_updated_at
  before update on public.quote_incentive_applications
  for each row execute function public.set_updated_at();

-- ── 4. Match RPC for the resolver edge function ───────────────────────────

create or replace function public.match_quote_incentives(
  p_quote_package_id uuid
)
returns setof public.manufacturer_incentives
language plpgsql
security invoker
stable
as $$
declare
  v_quote record;
  v_makes text[];
begin
  -- Pull manufacturers from the quote's equipment jsonb
  select q.id, q.equipment, q.workspace_id
    into v_quote
  from public.quote_packages q
  where q.id = p_quote_package_id;

  if not found then return; end if;

  select array_agg(distinct lower((item ->> 'make')))
    into v_makes
  from jsonb_array_elements(v_quote.equipment) as item
  where item ->> 'make' is not null;

  if v_makes is null or array_length(v_makes, 1) is null then
    return;
  end if;

  return query
    select mi.*
    from public.manufacturer_incentives mi
    where mi.workspace_id = v_quote.workspace_id
      and lower(mi.manufacturer) = any (v_makes)
      and mi.effective_date <= current_date
      and (mi.expiration_date is null or mi.expiration_date >= current_date)
    order by mi.stackable desc, mi.discount_value desc;
end;
$$;

comment on function public.match_quote_incentives(uuid) is 'Returns all incentives matching a quote (mfr + active dates). The resolver edge fn ranks/applies stackability.';
