-- ============================================================================
-- 542_qrm_quote_wizard_foundation.sql
--
-- Additive foundation for the QRM Quote Wizard. Extends the existing
-- quote_packages / quote_package_line_items / approval / incentive model;
-- intentionally does not introduce a parallel quotes table.
-- ============================================================================

set statement_timeout = 0;

-- ── Quote package wizard/details/tax override fields ───────────────────────

alter table public.quote_packages
  add column if not exists wizard_step integer,
  add column if not exists expires_at timestamptz,
  add column if not exists follow_up_at timestamptz,
  add column if not exists deposit_required_amount numeric(14,2),
  add column if not exists delivery_eta text,
  add column if not exists delivery_state text,
  add column if not exists delivery_county text,
  add column if not exists special_terms text,
  add column if not exists why_this_machine text,
  add column if not exists why_this_machine_confirmed boolean not null default false,
  add column if not exists tax_jurisdiction_id uuid,
  add column if not exists tax_override_amount numeric(14,2),
  add column if not exists tax_override_reason text,
  add column if not exists selected_promotion_ids uuid[] not null default '{}'::uuid[];

alter table public.quote_packages
  drop constraint if exists quote_packages_wizard_step_check;
alter table public.quote_packages
  add constraint quote_packages_wizard_step_check
  check (wizard_step is null or (wizard_step >= 1 and wizard_step <= 11));

comment on column public.quote_packages.wizard_step is
  'Last completed QRM quote wizard step, 1-11. Nullable for legacy quote packages.';
comment on column public.quote_packages.delivery_state is
  'Customer delivery state used for estimated tax preview; overrides branch state when present.';
comment on column public.quote_packages.delivery_county is
  'Customer delivery county used for Florida discretionary surtax preview.';
comment on column public.quote_packages.tax_override_amount is
  'Manual estimated tax override amount. Requires tax_override_reason in wizard/API.';

-- ── Tax jurisdictions for county-capped Florida preview math ────────────────

create table if not exists public.tax_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'global',
  state_code text not null,
  county_name text,
  jurisdiction_name text not null,
  state_rate numeric(8,6) not null default 0,
  county_surtax_rate numeric(8,6) not null default 0,
  surtax_cap_amount numeric(14,2),
  source_label text,
  effective_date date not null default current_date,
  expires_at date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, state_code, county_name, effective_date)
);

alter table public.tax_jurisdictions
  alter column workspace_id set default 'global';

comment on column public.tax_jurisdictions.workspace_id is
  '''global'' rows are shared reference rates; workspace rows override them for tenant-specific tax policy.';

alter table public.tax_jurisdictions enable row level security;

drop policy if exists "tax_jurisdictions_select" on public.tax_jurisdictions;
drop policy if exists "tax_jurisdictions_manage" on public.tax_jurisdictions;
drop policy if exists "tax_jurisdictions_service" on public.tax_jurisdictions;

create policy "tax_jurisdictions_select" on public.tax_jurisdictions
  for select using (workspace_id = public.get_my_workspace() or workspace_id = 'global');
create policy "tax_jurisdictions_manage" on public.tax_jurisdictions
  for all using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = public.get_my_workspace());
create policy "tax_jurisdictions_service" on public.tax_jurisdictions
  for all to service_role using (true) with check (true);

create index if not exists idx_tax_jurisdictions_lookup
  on public.tax_jurisdictions (workspace_id, state_code, lower(county_name), is_active);

create trigger trg_tax_jurisdictions_updated_at
  before update on public.tax_jurisdictions
  for each row execute function public.set_updated_at();

-- Seed only the acceptance-test county; a data pass can add all FL counties.
insert into public.tax_jurisdictions (
  workspace_id,
  state_code,
  county_name,
  jurisdiction_name,
  state_rate,
  county_surtax_rate,
  surtax_cap_amount,
  source_label,
  metadata
) values (
  'global',
  'FL',
  'Columbia',
  'Columbia County, FL',
  0.06,
  0.01,
  5000,
  'QRM wizard foundation seed; verify against FL DOR before compliance use',
  '{"estimate_only": true}'::jsonb
)
on conflict (workspace_id, state_code, county_name, effective_date) do nothing;

alter table public.quote_packages
  drop constraint if exists quote_packages_tax_jurisdiction_fk;
alter table public.quote_packages
  add constraint quote_packages_tax_jurisdiction_fk
  foreign key (tax_jurisdiction_id) references public.tax_jurisdictions(id) on delete set null;

-- ── Expanded line items ────────────────────────────────────────────────────

alter table public.quote_package_line_items
  add column if not exists reason_code text,
  add column if not exists approval_required boolean not null default false;

alter table public.quote_package_line_items
  drop constraint if exists quote_package_line_items_line_type_check;
alter table public.quote_package_line_items
  add constraint quote_package_line_items_line_type_check
  check (line_type in (
    'equipment', 'attachment', 'option', 'accessory', 'warranty', 'financing',
    'pdi', 'freight', 'good_faith', 'doc_fee', 'title', 'tag', 'registration',
    'discount', 'trade_allowance', 'rebate_mfg', 'rebate_dealer',
    'loyalty_discount', 'tax_state', 'tax_county', 'custom'
  ));

alter table public.quote_package_line_items
  drop constraint if exists quote_package_line_items_reason_code_check;
alter table public.quote_package_line_items
  add constraint quote_package_line_items_reason_code_check
  check (reason_code is null or reason_code in (
    'competitive_match', 'volume_buyer', 'aged_inventory', 'loyalty', 'other'
  ));

create index if not exists idx_qp_line_items_approval_required
  on public.quote_package_line_items (workspace_id, approval_required)
  where approval_required = true;

-- ── Normalized financing scenarios ─────────────────────────────────────────

create table if not exists public.quote_financing_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  scenario_label text not null,
  kind text not null check (kind in ('cash', 'finance', 'lease_fmv', 'lease_fppo')),
  down_payment numeric(14,2),
  term_months integer,
  apr numeric(8,4),
  residual_amount numeric(14,2),
  money_factor numeric(12,8),
  monthly_payment numeric(14,2),
  total_cost numeric(14,2),
  lender text,
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quote_financing_scenarios enable row level security;

drop policy if exists "qfs_package_access" on public.quote_financing_scenarios;
drop policy if exists "qfs_service_all" on public.quote_financing_scenarios;
create policy "qfs_package_access" on public.quote_financing_scenarios
  for all using (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
  );
create policy "qfs_service_all" on public.quote_financing_scenarios
  for all to service_role using (true) with check (true);

create index if not exists idx_quote_financing_scenarios_quote
  on public.quote_financing_scenarios (quote_package_id, is_default desc, created_at);
create unique index if not exists uq_quote_financing_scenarios_one_default
  on public.quote_financing_scenarios (quote_package_id)
  where is_default = true;

create trigger trg_quote_financing_scenarios_updated_at
  before update on public.quote_financing_scenarios
  for each row execute function public.set_updated_at();

-- ── Document artifacts and delivery events (skeleton persistence) ───────────

create table if not exists public.quote_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  quote_package_version_id uuid references public.quote_package_versions(id) on delete set null,
  artifact_type text not null default 'customer_quote_pdf'
    check (artifact_type in ('customer_quote_pdf')),
  storage_bucket text,
  storage_key text,
  status text not null default 'pending'
    check (status in ('pending', 'generated', 'failed')),
  generated_at timestamptz,
  generated_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quote_document_artifacts enable row level security;

drop policy if exists "qda_package_access" on public.quote_document_artifacts;
drop policy if exists "qda_service_all" on public.quote_document_artifacts;
create policy "qda_package_access" on public.quote_document_artifacts
  for all using (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
  );
create policy "qda_service_all" on public.quote_document_artifacts
  for all to service_role using (true) with check (true);

create index if not exists idx_quote_document_artifacts_latest
  on public.quote_document_artifacts (quote_package_id, created_at desc);

create trigger trg_quote_document_artifacts_updated_at
  before update on public.quote_document_artifacts
  for each row execute function public.set_updated_at();

create table if not exists public.quote_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  document_artifact_id uuid references public.quote_document_artifacts(id) on delete set null,
  channel text not null check (channel in ('preview', 'email', 'text', 'link', 'print')),
  status text not null default 'draft' check (status in ('draft', 'attempted', 'sent', 'failed')),
  recipient text,
  subject text,
  message_body text,
  provider text,
  provider_message_id text,
  error_message text,
  follow_up_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.quote_delivery_events enable row level security;

drop policy if exists "qde_package_access" on public.quote_delivery_events;
drop policy if exists "qde_package_select" on public.quote_delivery_events;
drop policy if exists "qde_client_preview_insert" on public.quote_delivery_events;
drop policy if exists "qde_service_all" on public.quote_delivery_events;
create policy "qde_package_select" on public.quote_delivery_events
  for select using (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
  );
create policy "qde_client_preview_insert" on public.quote_delivery_events
  for insert with check (
    workspace_id = public.get_my_workspace()
    and public.quote_package_accessible_to_me(quote_package_id)
    and channel = 'preview'
    and status = 'draft'
    and coalesce(provider, '') = 'local_preview'
  );
create policy "qde_service_all" on public.quote_delivery_events
  for all to service_role using (true) with check (true);

create index if not exists idx_quote_delivery_events_quote_created
  on public.quote_delivery_events (quote_package_id, created_at desc);

-- ── Approval and incentive extensions ──────────────────────────────────────

alter table public.quote_approval_policies
  add column if not exists trade_credit_max numeric(14,2),
  add column if not exists rep_discount_max_pct numeric(8,4);

alter table public.manufacturer_incentives
  add column if not exists source text not null default 'manufacturer';

alter table public.manufacturer_incentives
  drop constraint if exists manufacturer_incentives_source_check;
alter table public.manufacturer_incentives
  add constraint manufacturer_incentives_source_check
  check (source in ('manufacturer', 'dealer', 'loyalty'));

comment on column public.manufacturer_incentives.source is
  'Promotion owner/source for QRM wizard selection: manufacturer, dealer, or loyalty.';
