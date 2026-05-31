-- ============================================================================
-- Migration 642: J2.1 Workforce technician certification + pay-ladder backend
--
-- Adds structured technician OEM/in-house certification tracking, vendor-login
-- readiness, tool-count signals, owner-workbook Road/Shop/Grapple pay ladders,
-- and progression eligibility views fed by live H4 efficiency and H8 comeback
-- data. Uses constrained text and security_invoker views; no enum changes.
-- ============================================================================

-- ── Technician profile workforce fields --------------------------------------

alter table public.technician_profiles
  add column if not exists pay_ladder_role text,
  add column if not exists tenure_start_date date,
  add column if not exists tool_count integer,
  add column if not exists tool_count_updated_at timestamptz,
  add column if not exists tooling_verified_at timestamptz,
  add column if not exists tooling_notes text;

comment on column public.technician_profiles.pay_ladder_role is
  'J2.1 technician pay-ladder role: road, shop, or grapple. Defaults in views from road_technician/drag_and_stick when unset.';
comment on column public.technician_profiles.tenure_start_date is
  'Tenure anchor for pay-ladder gates. Falls back to employees.hire_date in progression views when null.';
comment on column public.technician_profiles.tool_count is
  'Structured tool-count signal required by J2.1 pay-ladder tracking; replaces free-form notes for tooling readiness.';
comment on column public.technician_profiles.tooling_verified_at is
  'Manager verification timestamp for workbook gates that require sufficient tooling but do not provide a numeric tool-count threshold.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_profiles_pay_ladder_role_chk'
      and conrelid = 'public.technician_profiles'::regclass
  ) then
    alter table public.technician_profiles
      add constraint technician_profiles_pay_ladder_role_chk
      check (pay_ladder_role is null or pay_ladder_role in ('road', 'shop', 'grapple')) not valid;
  end if;


  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_profiles_tool_count_nonnegative_chk'
      and conrelid = 'public.technician_profiles'::regclass
  ) then
    alter table public.technician_profiles
      add constraint technician_profiles_tool_count_nonnegative_chk
      check (tool_count is null or tool_count >= 0) not valid;
  end if;
end $$;

create index if not exists idx_technician_profiles_pay_ladder_role
  on public.technician_profiles(workspace_id, pay_ladder_role);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_profiles_id_workspace_uniq'
      and conrelid = 'public.technician_profiles'::regclass
  ) then
    alter table public.technician_profiles
      add constraint technician_profiles_id_workspace_uniq unique (id, workspace_id);
  end if;
end $$;

-- ── Source-of-truth tier definitions -----------------------------------------

create table if not exists public.technician_pay_ladder_tiers (
  id uuid primary key default gen_random_uuid(),
  ladder_role text not null,
  tier_key text not null,
  display_order integer not null,
  tier_name text not null,
  compensation_min_cents integer not null,
  compensation_max_cents integer not null,
  min_efficiency_pct numeric(6, 2),
  efficiency_window_days integer not null default 180,
  max_qep_fault_comebacks integer,
  comeback_window_days integer not null default 180,
  min_tenure_months integer,
  required_oem_certifications jsonb not null default '[]'::jsonb,
  required_in_house_cert_keys text[] not null default '{}'::text[],
  requires_vendor_logins boolean not null default false,
  vendor_login_required_vendors text[] not null default array['cummins','asv','yanmar','sennebogen','develon','asc']::text[],
  tool_requirement_key text,
  min_tool_count integer,
  skills_and_knowledge jsonb not null default '[]'::jsonb,
  source_document text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ladder_role, tier_key),
  unique (ladder_role, display_order),
  check (ladder_role in ('road', 'shop', 'grapple')),
  check (display_order >= 1),
  check (compensation_min_cents >= 0 and compensation_max_cents >= compensation_min_cents),
  check (min_efficiency_pct is null or (min_efficiency_pct >= 0 and min_efficiency_pct <= 200)),
  check (efficiency_window_days > 0),
  check (max_qep_fault_comebacks is null or max_qep_fault_comebacks >= 0),
  check (comeback_window_days > 0),
  check (min_tenure_months is null or min_tenure_months >= 0),
  check (min_tool_count is null or min_tool_count >= 0)
);

comment on table public.technician_pay_ladder_tiers is
  'J2.1 owner-workbook Road/Shop/Grapple technician pay-ladder tiers and progression gates.';
comment on column public.technician_pay_ladder_tiers.min_efficiency_pct is
  'Minimum H4 hold-excluded efficiency percentage. Road Master is 90%; Shop Master is intentionally 95% per owner workbooks.';
comment on column public.technician_pay_ladder_tiers.max_qep_fault_comebacks is
  'Strict upper bound on QEP-fault comeback count during comeback_window_days; value 1 encodes workbook language "less than 2 comebacks".';
comment on column public.technician_pay_ladder_tiers.required_oem_certifications is
  'JSON array of required OEM cert objects: vendor, min_status (started/completed), and optional in_person_required.';

insert into public.technician_pay_ladder_tiers (
  ladder_role,
  tier_key,
  display_order,
  tier_name,
  compensation_min_cents,
  compensation_max_cents,
  min_efficiency_pct,
  max_qep_fault_comebacks,
  min_tenure_months,
  required_oem_certifications,
  required_in_house_cert_keys,
  requires_vendor_logins,
  tool_requirement_key,
  skills_and_knowledge,
  source_document
)
values
  ('road','apprentice_road_tech',1,'Apprentice Road Tech',1600,2100,null,null,null,'[]'::jsonb,'{}'::text[],false,null,
   '["Ride and assist master/lead tech with day-to-day jobs", "Assist changing oil and performing PDIs", "Run parts to techs", "Help tune heads/run machines", "Power wash machines", "Show dedication to QEP and retain information taught by the master"]'::jsonb,
   'road tech pay scale with pay.pdf'),
  ('road','level_1_road_tech',2,'Level 1 Road Tech',2100,2300,65,null,null,'[]'::jsonb,array['safety_standards','company_policies','qep_server_lookup']::text[],false,null,
   '["Mechanically inclined", "Clean driving record", "Change oil and service equipment", "Grease and perform routine inspections", "Complete PDIs and return inspections", "Write up and complete work orders independently", "Maintain tools/workspace and order correct parts through QEP parts team"]'::jsonb,
   'road tech pay scale with pay.pdf'),
  ('road','level_2_junior_road_tech',3,'Level 2 (Junior Road Tech)',2300,2600,70,null,null,'[]'::jsonb,'{}'::text[],true,null,
   '["Minimal independence", "Hydraulic-line replacements and cylinder rebuilds", "Troubleshoot basic mechanical issues under senior supervision", "Continue company-required certifications/training", "Begin diagnostics and inspections", "Give parts team the correct part needed"]'::jsonb,
   'road tech pay scale with pay.pdf'),
  ('road','level_3_experienced_road_tech',4,'Level 3 (Experienced Road Tech)',2600,3100,75,null,null,
   '[{"vendor":"cummins","min_status":"started"},{"vendor":"asv","min_status":"started"},{"vendor":"yanmar","min_status":"started"}]'::jsonb,'{}'::text[],false,null,
   '["Moderate independence", "Adapt and do remote training", "Diagnose and repair complex jobs like pumps, valve banks, leaks, relays, coils, motors", "Replace engines and large components", "Clean bay and detailed work-order stories"]'::jsonb,
   'road tech pay scale with pay.pdf'),
  ('road','level_4_senior_road_tech',5,'Level 4 (Senior Road Tech)',3200,3600,80,1,36,
   '[{"vendor":"cummins","min_status":"completed"},{"vendor":"yanmar","min_status":"completed"},{"vendor":"asv","min_status":"completed"},{"vendor":"sennebogen","min_status":"completed"},{"vendor":"develon","min_status":"completed"}]'::jsonb,'{}'::text[],false,null,
   '["High independence", "Rebuild engines per manufacturer spec", "Complex diagnostics and repairs for all brands", "Navigate hydraulic/electrical schematics with ease", "Positive customer relationships"]'::jsonb,
   'road tech pay scale with pay.pdf'),
  ('road','level_5_master_road_tech',6,'Level 5 (Master Road Tech)',3700,4100,90,null,48,
   '[{"vendor":"cummins","min_status":"completed","in_person_required":true},{"vendor":"asv","min_status":"completed","in_person_required":true},{"vendor":"yanmar","min_status":"completed","in_person_required":true},{"vendor":"sennebogen","min_status":"completed","in_person_required":true},{"vendor":"develon","min_status":"completed","in_person_required":true},{"vendor":"asc","min_status":"completed"}]'::jsonb,'{}'::text[],false,null,
   '["Fully independent", "Look up and verify correct parts fit", "Train and mentor all technician levels", "Top-level expert for repairs and diagnostics across vendors", "Keep team motivated"]'::jsonb,
   'road tech pay scale with pay.pdf'),

  ('shop','entry_porter',1,'Entry / Porter',1600,2000,null,null,null,'[]'::jsonb,'{}'::text[],false,null,
   '["Sweep floors/help pull machines into shop", "Assist changing oil and performing PDIs", "Run parts to techs", "Help tune heads/run machines", "Power wash machines"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),
  ('shop','lube_tech',2,'Lube Tech',2000,2200,65,null,null,'[]'::jsonb,array['safety_standards','company_policies','qep_server_lookup']::text[],false,null,
   '["Mechanically inclined", "Change oil and service equipment", "Grease and perform routine inspections", "Write up and complete work orders", "Maintain vehicle safety, tools, and workspace"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),
  ('shop','level_1_junior_tech',3,'Level 1 (Junior Tech)',2300,2500,70,null,null,'[]'::jsonb,'{}'::text[],true,'tool_count_recorded',
   '["Minimal independence", "Hydraulic-line replacements and cylinder rebuilds", "Troubleshoot basic mechanical issues under senior supervision", "Continue company-required certifications/training", "Begin diagnostics and inspections"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),
  ('shop','level_2_experienced_tech',4,'Level 2 (Experienced Tech)',2600,3000,75,null,null,
   '[{"vendor":"cummins","min_status":"started"},{"vendor":"asv","min_status":"started"},{"vendor":"yanmar","min_status":"started"}]'::jsonb,'{}'::text[],false,'sufficient_tooling_verified',
   '["Moderate independence", "Remote training", "Diagnose and repair pumps and valves", "Replace engines and large components", "Clean bay and detailed work-order stories"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),
  ('shop','level_3_senior_tech',5,'Level 3 (Senior Tech)',3100,3600,80,1,36,
   '[{"vendor":"cummins","min_status":"completed"},{"vendor":"yanmar","min_status":"completed"},{"vendor":"asv","min_status":"completed"},{"vendor":"sennebogen","min_status":"completed"},{"vendor":"develon","min_status":"completed"}]'::jsonb,'{}'::text[],false,null,
   '["High independence", "Rebuild engines per manufacturer spec", "Complex diagnostics and repairs for all brands", "Navigate hydraulic/electrical schematics with ease", "Positive customer relationships"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),
  ('shop','level_4_master_tech',6,'Level 4 (Master Tech)',3700,4100,95,null,48,
   '[{"vendor":"cummins","min_status":"completed","in_person_required":true},{"vendor":"asv","min_status":"completed","in_person_required":true},{"vendor":"yanmar","min_status":"completed","in_person_required":true},{"vendor":"sennebogen","min_status":"completed","in_person_required":true},{"vendor":"develon","min_status":"completed","in_person_required":true},{"vendor":"asc","min_status":"completed"}]'::jsonb,'{}'::text[],false,null,
   '["Fully independent", "Train and mentor all technician levels", "Top-level expert for repairs and diagnostics across vendors", "Keep team motivated"]'::jsonb,
   'shop tech advancement strategy (w pay).pdf'),

  ('grapple','entry_level',1,'Entry Level',1600,1800,null,null,null,'[]'::jsonb,'{}'::text[],false,null,
   '["Mechanically inclined", "Shows initiative", "Change oil and service trucks", "Write up and complete work orders including parts sheets", "Minimal independence"]'::jsonb,
   'Grapple Truck Pay Advancement Strategy (w pay).pdf'),
  ('grapple','level_1',2,'Level 1',1900,2400,70,null,null,'[]'::jsonb,'{}'::text[],false,null,
   '["Inspect and operate loaders to check for leaks", "Fill out GTB inspection form", "Install and mount grapple-truck accessories like tanks, coolers, and extensions"]'::jsonb,
   'Grapple Truck Pay Advancement Strategy (w pay).pdf'),
  ('grapple','level_2',3,'Level 2',2500,2700,80,null,null,'[]'::jsonb,'{}'::text[],false,null,
   '["Moderate independence", "Diagnose most hydraulic and electrical circuits on all trucks with minimal help", "Weld bumpers/rear plates on chassis"]'::jsonb,
   'Grapple Truck Pay Advancement Strategy (w pay).pdf'),
  ('grapple','level_3_lead',4,'Level 3 (Lead)',2800,3100,95,null,48,'[]'::jsonb,'{}'::text[],false,null,
   '["Guide, train, and lead a crew", "Make executive calls on technical questions", "Maintain/update build-progress sheets for sales/service", "Sign off final QC checklist of all builds"]'::jsonb,
   'Grapple Truck Pay Advancement Strategy (w pay).pdf')
on conflict (ladder_role, tier_key) do update
set
  display_order = excluded.display_order,
  tier_name = excluded.tier_name,
  compensation_min_cents = excluded.compensation_min_cents,
  compensation_max_cents = excluded.compensation_max_cents,
  min_efficiency_pct = excluded.min_efficiency_pct,
  efficiency_window_days = excluded.efficiency_window_days,
  max_qep_fault_comebacks = excluded.max_qep_fault_comebacks,
  comeback_window_days = excluded.comeback_window_days,
  min_tenure_months = excluded.min_tenure_months,
  required_oem_certifications = excluded.required_oem_certifications,
  required_in_house_cert_keys = excluded.required_in_house_cert_keys,
  requires_vendor_logins = excluded.requires_vendor_logins,
  vendor_login_required_vendors = excluded.vendor_login_required_vendors,
  tool_requirement_key = excluded.tool_requirement_key,
  min_tool_count = excluded.min_tool_count,
  skills_and_knowledge = excluded.skills_and_knowledge,
  source_document = excluded.source_document,
  active = true,
  updated_at = now();

-- ── HR-scoped current tier and wage assignment -------------------------------

create table if not exists public.technician_pay_ladder_assignment (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  technician_profile_id uuid not null references public.technician_profiles(id) on delete cascade,
  current_pay_ladder_tier_key text,
  hourly_wage_cents integer,
  effective_from date not null default current_date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (technician_profile_id),
  check (hourly_wage_cents is null or hourly_wage_cents >= 0)
);

comment on table public.technician_pay_ladder_assignment is
  'J2.1 HR-scoped current pay-ladder tier and wage assignment. Kept separate from technician_profiles so operational profile reads remain workspace-wide.';
comment on column public.technician_pay_ladder_assignment.current_pay_ladder_tier_key is
  'Current workbook pay-ladder tier key. This implies a compensation band and is manager/own scoped, not workspace-readable.';
comment on column public.technician_pay_ladder_assignment.hourly_wage_cents is
  'Current hourly wage in cents. HR-sensitive and never exposed through workspace-wide technician_profiles reads.';

create index if not exists idx_technician_pay_ladder_assignment_workspace
  on public.technician_pay_ladder_assignment(workspace_id, technician_profile_id, current_pay_ladder_tier_key);

-- ── Structured technician certifications and readiness -----------------------

create table if not exists public.technician_oem_certifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  technician_profile_id uuid not null references public.technician_profiles(id) on delete cascade,
  vendor text not null,
  certification_key text,
  certification_name text not null,
  status text not null default 'not_started',
  is_in_person boolean not null default false,
  issued_at date,
  expires_at date,
  credential_url text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vendor in ('cummins','asv','yanmar','sennebogen','develon','asc')),
  check (status in ('not_started','started','completed','expired')),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

comment on table public.technician_oem_certifications is
  'J2.1 structured OEM certification records for Cummins, ASV, Yanmar, Sennebogen, Develon, and ASC.';

create table if not exists public.technician_in_house_certifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  technician_profile_id uuid not null references public.technician_profiles(id) on delete cascade,
  certification_key text not null,
  certification_name text not null,
  status text not null default 'not_started',
  issued_at date,
  expires_at date,
  instructor_profile_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('not_started','started','completed','expired')),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

comment on table public.technician_in_house_certifications is
  'J2.1 in-house technician certifications such as safety standards, company policies, and QEP server lookup training.';

create table if not exists public.technician_vendor_logins (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  technician_profile_id uuid not null references public.technician_profiles(id) on delete cascade,
  vendor text not null,
  login_identifier text,
  status text not null default 'active',
  verified_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vendor in ('cummins','asv','yanmar','sennebogen','develon','asc')),
  check (status in ('active','pending','disabled','unknown'))
);

comment on table public.technician_vendor_logins is
  'J2.1 non-secret vendor-login readiness records. Stores identifiers/status only; never stores passwords or API secrets.';

create unique index if not exists uq_technician_oem_cert_key
  on public.technician_oem_certifications(technician_profile_id, vendor, certification_key)
  where certification_key is not null;
create index if not exists idx_technician_oem_cert_lookup
  on public.technician_oem_certifications(workspace_id, technician_profile_id, vendor, status);

create unique index if not exists uq_technician_in_house_cert_key
  on public.technician_in_house_certifications(technician_profile_id, certification_key);
create index if not exists idx_technician_in_house_cert_lookup
  on public.technician_in_house_certifications(workspace_id, technician_profile_id, status);

create unique index if not exists uq_technician_vendor_login
  on public.technician_vendor_logins(technician_profile_id, vendor);
create index if not exists idx_technician_vendor_login_lookup
  on public.technician_vendor_logins(workspace_id, technician_profile_id, vendor, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_pay_ladder_assignment_profile_workspace_fk'
      and conrelid = 'public.technician_pay_ladder_assignment'::regclass
  ) then
    alter table public.technician_pay_ladder_assignment
      add constraint technician_pay_ladder_assignment_profile_workspace_fk
      foreign key (technician_profile_id, workspace_id)
      references public.technician_profiles(id, workspace_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_oem_certifications_profile_workspace_fk'
      and conrelid = 'public.technician_oem_certifications'::regclass
  ) then
    alter table public.technician_oem_certifications
      add constraint technician_oem_certifications_profile_workspace_fk
      foreign key (technician_profile_id, workspace_id)
      references public.technician_profiles(id, workspace_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_in_house_certifications_profile_workspace_fk'
      and conrelid = 'public.technician_in_house_certifications'::regclass
  ) then
    alter table public.technician_in_house_certifications
      add constraint technician_in_house_certifications_profile_workspace_fk
      foreign key (technician_profile_id, workspace_id)
      references public.technician_profiles(id, workspace_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_vendor_logins_profile_workspace_fk'
      and conrelid = 'public.technician_vendor_logins'::regclass
  ) then
    alter table public.technician_vendor_logins
      add constraint technician_vendor_logins_profile_workspace_fk
      foreign key (technician_profile_id, workspace_id)
      references public.technician_profiles(id, workspace_id)
      on delete cascade;
  end if;
end $$;

-- ── RLS helper functions ------------------------------------------------------

create or replace function public.technician_pay_ladder_current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.workspace_id = (select public.get_my_workspace())
    and e.profile_id = (select auth.uid())
    and e.deleted_at is null
  order by e.termination_date nulls first, e.created_at desc
  limit 1;
$$;

comment on function public.technician_pay_ladder_current_employee_id() is
  'J2.1 RLS helper: maps the caller profile to the current workspace employee row without relying on employees RLS.';

create or replace function public.technician_pay_ladder_can_manage(
  p_workspace_id text,
  p_technician_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce((select public.get_my_role())::text, '');
  v_caller_employee_id uuid;
begin
  if (select auth.role()) = 'service_role' then
    return true;
  end if;

  if p_workspace_id is distinct from (select public.get_my_workspace()) then
    return false;
  end if;

  if v_role in ('admin', 'owner') then
    return true;
  end if;

  if v_role <> 'manager' then
    return false;
  end if;

  v_caller_employee_id := public.technician_pay_ladder_current_employee_id();

  return exists (
    select 1
    from public.employees e
    where e.workspace_id = p_workspace_id
      and e.profile_id = p_technician_user_id
      and e.deleted_at is null
      and e.supervisor_id = v_caller_employee_id
  );
end;
$$;

comment on function public.technician_pay_ladder_can_manage(text, uuid) is
  'J2.1 HR-sensitive manager gate. Admin/owner see workspace-wide; managers see direct-report technicians only.';

create or replace function public.technician_pay_ladder_can_read(
  p_workspace_id text,
  p_technician_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.role()) = 'service_role'
    or (
      p_workspace_id = (select public.get_my_workspace())
      and (
        p_technician_user_id = (select auth.uid())
        or public.technician_pay_ladder_can_manage(p_workspace_id, p_technician_user_id)
      )
    );
$$;

comment on function public.technician_pay_ladder_can_read(text, uuid) is
  'J2.1 RLS helper: technicians read their own ladder/certs; managers read direct reports; admin/owner read all in workspace.';

create or replace function public.technician_pay_ladder_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_status, ''))
    when 'completed' then 2
    when 'started' then 1
    else 0
  end;
$$;

create or replace function public.technician_pay_ladder_missing_requirements(
  p_technician_profile_id uuid,
  p_efficiency_pct numeric,
  p_qep_fault_comebacks integer,
  p_tenure_months integer,
  p_tool_count integer,
  p_tooling_verified_at timestamptz,
  p_min_efficiency_pct numeric,
  p_max_qep_fault_comebacks integer,
  p_min_tenure_months integer,
  p_required_oem_certifications jsonb,
  p_required_in_house_cert_keys text[],
  p_requires_vendor_logins boolean,
  p_vendor_login_required_vendors text[],
  p_tool_requirement_key text,
  p_min_tool_count integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_missing jsonb := '[]'::jsonb;
  v_req jsonb;
  v_vendor text;
  v_min_status text;
  v_min_rank integer;
  v_in_person_required boolean;
  v_cert_name text;
  v_missing_vendors text[];
  v_missing_in_house text[];
begin
  if p_min_efficiency_pct is not null and (p_efficiency_pct is null or p_efficiency_pct < p_min_efficiency_pct) then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'efficiency_pct',
      'required', p_min_efficiency_pct,
      'actual', p_efficiency_pct,
      'source', 'v_deal_genome_service_efficiency_analysis.efficiency_pct'
    ));
  end if;

  if p_max_qep_fault_comebacks is not null and coalesce(p_qep_fault_comebacks, 0) > p_max_qep_fault_comebacks then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'qep_fault_comebacks',
      'required_max', p_max_qep_fault_comebacks,
      'actual', coalesce(p_qep_fault_comebacks, 0),
      'source', 'H8 comeback accountability'
    ));
  end if;

  if p_min_tenure_months is not null and (p_tenure_months is null or p_tenure_months < p_min_tenure_months) then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'tenure_months',
      'required', p_min_tenure_months,
      'actual', p_tenure_months
    ));
  end if;

  for v_req in select value from jsonb_array_elements(coalesce(p_required_oem_certifications, '[]'::jsonb)) loop
    v_vendor := lower(v_req ->> 'vendor');
    v_min_status := lower(coalesce(v_req ->> 'min_status', 'completed'));
    v_min_rank := public.technician_pay_ladder_status_rank(v_min_status);
    v_in_person_required := coalesce((v_req ->> 'in_person_required')::boolean, false);
    v_cert_name := coalesce(v_req ->> 'name', v_vendor);

    if not exists (
      select 1
      from public.technician_oem_certifications c
      where c.technician_profile_id = p_technician_profile_id
        and c.vendor = v_vendor
        and public.technician_pay_ladder_status_rank(c.status) >= v_min_rank
        and (c.expires_at is null or c.expires_at >= current_date)
        and (not v_in_person_required or c.is_in_person = true)
    ) then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'key', 'oem_certification',
        'vendor', v_vendor,
        'certification', v_cert_name,
        'min_status', v_min_status,
        'in_person_required', v_in_person_required
      ));
    end if;
  end loop;

  select array_agg(cert_key order by cert_key)
  into v_missing_in_house
  from unnest(coalesce(p_required_in_house_cert_keys, '{}'::text[])) as req(cert_key)
  where not exists (
    select 1
    from public.technician_in_house_certifications c
    where c.technician_profile_id = p_technician_profile_id
      and c.certification_key = req.cert_key
      and public.technician_pay_ladder_status_rank(c.status) >= 2
      and (c.expires_at is null or c.expires_at >= current_date)
  );

  if coalesce(array_length(v_missing_in_house, 1), 0) > 0 then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'in_house_certifications',
      'missing', v_missing_in_house
    ));
  end if;

  if p_requires_vendor_logins then
    select array_agg(vendor order by vendor)
    into v_missing_vendors
    from unnest(coalesce(p_vendor_login_required_vendors, '{}'::text[])) as req(vendor)
    where not exists (
      select 1
      from public.technician_vendor_logins l
      where l.technician_profile_id = p_technician_profile_id
        and l.vendor = req.vendor
        and l.status = 'active'
    );

    if coalesce(array_length(v_missing_vendors, 1), 0) > 0 then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object(
        'key', 'vendor_logins',
        'missing_vendors', v_missing_vendors
      ));
    end if;
  end if;

  if p_min_tool_count is not null and (p_tool_count is null or p_tool_count < p_min_tool_count) then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'tool_count',
      'required', p_min_tool_count,
      'actual', p_tool_count
    ));
  elsif p_tool_requirement_key = 'tool_count_recorded' and p_tool_count is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'tool_count_recorded',
      'required', 'recorded_tool_count'
    ));
  elsif p_tool_requirement_key = 'sufficient_tooling_verified' and p_tooling_verified_at is null then
    v_missing := v_missing || jsonb_build_array(jsonb_build_object(
      'key', 'sufficient_tooling_verified',
      'required', 'manager_tooling_verification'
    ));
  end if;

  return v_missing;
end;
$$;

comment on function public.technician_pay_ladder_missing_requirements(uuid, numeric, integer, integer, integer, timestamptz, numeric, integer, integer, jsonb, text[], boolean, text[], text, integer) is
  'J2.1 progression gate evaluator for efficiency, comeback count, tenure, OEM/in-house certs, vendor logins, and tooling.';

-- ── Metrics and progression views --------------------------------------------

create or replace view public.v_technician_pay_ladder_metric_snapshot
  with (security_invoker = true) as
with efficiency_180d as (
  select
    e.workspace_id,
    e.technician_id,
    round((sum(e.standard_hours) / nullif(sum(e.actual_hours), 0)) * 100, 2) as efficiency_pct_180d,
    round(sum(e.standard_hours), 2) as standard_hours_180d,
    round(sum(e.actual_hours), 2) as actual_hours_180d,
    count(distinct e.service_job_id)::integer as efficiency_job_count_180d
  from public.v_deal_genome_service_efficiency_analysis e
  join public.service_jobs j
    on j.id = e.service_job_id
   and j.workspace_id = e.workspace_id
  where j.deleted_at is null
    and j.created_at >= now() - interval '180 days'
    and e.technician_id is not null
  group by e.workspace_id, e.technician_id
), h8_rates_90d as (
  select
    workspace_id,
    technician_id,
    sum(qep_fault_comeback_jobs_90d)::integer as h8_qep_fault_comebacks_90d,
    max(latest_comeback_at) as h8_latest_comeback_at
  from public.v_service_comeback_technician_rates
  group by workspace_id, technician_id
)
select
  tp.workspace_id,
  tp.id as technician_profile_id,
  tp.user_id as technician_user_id,
  coalesce(nullif(p.full_name, ''), nullif(p.email, ''), e.display_name, 'Unknown technician') as technician_name,
  coalesce(tp.pay_ladder_role, case when tp.drag_and_stick then 'grapple' when tp.road_technician then 'road' else 'shop' end) as pay_ladder_role,
  pla.current_pay_ladder_tier_key,
  pla.hourly_wage_cents,
  coalesce(tp.tenure_start_date, e.hire_date) as tenure_start_date,
  case
    when coalesce(tp.tenure_start_date, e.hire_date) is null then null::integer
    else (
      date_part('year', age(current_date, coalesce(tp.tenure_start_date, e.hire_date)))::integer * 12
      + date_part('month', age(current_date, coalesce(tp.tenure_start_date, e.hire_date)))::integer
    )
  end as tenure_months,
  tp.tool_count,
  tp.tool_count_updated_at,
  tp.tooling_verified_at,
  eff.efficiency_pct_180d,
  eff.standard_hours_180d,
  eff.actual_hours_180d,
  eff.efficiency_job_count_180d,
  coalesce(h8.h8_qep_fault_comebacks_90d, 0) as h8_qep_fault_comebacks_90d,
  coalesce(h8.h8_qep_fault_comebacks_90d, 0) as comeback_gate_count,
  h8.h8_latest_comeback_at,
  now() as snapshot_at
from public.technician_profiles tp
left join public.profiles p on p.id = tp.user_id
left join lateral (
  select emp.*
  from public.employees emp
  where emp.workspace_id = tp.workspace_id
    and emp.profile_id = tp.user_id
    and emp.deleted_at is null
  order by emp.termination_date nulls first, emp.created_at desc
  limit 1
) e on true
left join efficiency_180d eff
  on eff.workspace_id = tp.workspace_id
 and eff.technician_id = tp.user_id
left join h8_rates_90d h8
  on h8.workspace_id = tp.workspace_id
 and h8.technician_id = tp.user_id
left join public.technician_pay_ladder_assignment pla
  on pla.workspace_id = tp.workspace_id
 and pla.technician_profile_id = tp.id
where public.technician_pay_ladder_can_read(tp.workspace_id, tp.user_id);

comment on view public.v_technician_pay_ladder_metric_snapshot is
  'J2.1 technician pay-ladder metrics. Efficiency aggregates H4 v_deal_genome_service_efficiency_analysis over 180 days; H8 v_service_comeback_technician_rates supplies the comeback count used for workbook gates.';

create or replace view public.v_technician_pay_ladder_progression
  with (security_invoker = true) as
select
  m.workspace_id,
  m.technician_profile_id,
  m.technician_user_id,
  m.technician_name,
  m.pay_ladder_role,
  ct.tier_key as current_tier_key,
  ct.tier_name as current_tier_name,
  ct.display_order as current_tier_order,
  nt.tier_key as next_tier_key,
  nt.tier_name as next_tier_name,
  nt.display_order as next_tier_order,
  m.hourly_wage_cents,
  nt.compensation_min_cents as next_compensation_min_cents,
  nt.compensation_max_cents as next_compensation_max_cents,
  m.tenure_start_date,
  m.tenure_months,
  m.tool_count,
  m.tooling_verified_at,
  m.efficiency_pct_180d,
  m.standard_hours_180d,
  m.actual_hours_180d,
  m.efficiency_job_count_180d,
  m.h8_qep_fault_comebacks_90d,
  m.comeback_gate_count,
  nt.min_efficiency_pct as required_efficiency_pct,
  nt.efficiency_window_days,
  nt.max_qep_fault_comebacks as required_max_qep_fault_comebacks,
  nt.comeback_window_days,
  nt.min_tenure_months as required_tenure_months,
  nt.required_oem_certifications,
  nt.required_in_house_cert_keys,
  nt.requires_vendor_logins,
  nt.vendor_login_required_vendors,
  nt.tool_requirement_key,
  nt.min_tool_count,
  missing.missing_requirements,
  (nt.id is not null and missing.missing_requirements = '[]'::jsonb) as eligible_for_next_tier,
  case when nt.id is null and not (m.current_pay_ladder_tier_key is not null and ct.id is null) then true else false end as top_tier_reached,
  m.snapshot_at
from public.v_technician_pay_ladder_metric_snapshot m
left join public.technician_pay_ladder_tiers ct
  on ct.ladder_role = m.pay_ladder_role
 and ct.tier_key = m.current_pay_ladder_tier_key
 and ct.active = true
left join lateral (
  select t.*
  from public.technician_pay_ladder_tiers t
  where t.ladder_role = m.pay_ladder_role
    and t.active = true
    and not (m.current_pay_ladder_tier_key is not null and ct.id is null)
    and t.display_order > coalesce(ct.display_order, 0)
  order by t.display_order
  limit 1
) nt on true
cross join lateral (
  select case
    when m.current_pay_ladder_tier_key is not null and ct.id is null then jsonb_build_array(jsonb_build_object(
      'key', 'current_tier_not_found',
      'configured_current_tier_key', m.current_pay_ladder_tier_key,
      'pay_ladder_role', m.pay_ladder_role
    ))
    when nt.id is null then jsonb_build_array(jsonb_build_object('key', 'top_tier_reached'))
    else public.technician_pay_ladder_missing_requirements(
      m.technician_profile_id,
      m.efficiency_pct_180d,
      m.comeback_gate_count,
      m.tenure_months,
      m.tool_count,
      m.tooling_verified_at,
      nt.min_efficiency_pct,
      nt.max_qep_fault_comebacks,
      nt.min_tenure_months,
      nt.required_oem_certifications,
      nt.required_in_house_cert_keys,
      nt.requires_vendor_logins,
      nt.vendor_login_required_vendors,
      nt.tool_requirement_key,
      nt.min_tool_count
    )
  end as missing_requirements
) missing;

comment on view public.v_technician_pay_ladder_progression is
  'J2.1 next-tier eligibility view for Road/Shop/Grapple technicians. Encodes Shop Master 95% vs Road Master 90% efficiency divergence and surfaces missing gates.';

-- ── RLS ----------------------------------------------------------------------

alter table public.technician_pay_ladder_tiers enable row level security;
alter table public.technician_pay_ladder_assignment enable row level security;
alter table public.technician_oem_certifications enable row level security;
alter table public.technician_in_house_certifications enable row level security;
alter table public.technician_vendor_logins enable row level security;

drop policy if exists "technician_pay_ladder_tiers_select" on public.technician_pay_ladder_tiers;
create policy "technician_pay_ladder_tiers_select"
  on public.technician_pay_ladder_tiers for select
  using ((select auth.role()) in ('authenticated', 'service_role'));

drop policy if exists "technician_pay_ladder_tiers_service_all" on public.technician_pay_ladder_tiers;
create policy "technician_pay_ladder_tiers_service_all"
  on public.technician_pay_ladder_tiers for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- Keep technician_profiles operationally workspace-readable; wage/current tier
-- live in technician_pay_ladder_assignment below.
drop policy if exists "tech_profiles_select" on public.technician_profiles;
drop policy if exists "tech_profiles_insert" on public.technician_profiles;
drop policy if exists "tech_profiles_update" on public.technician_profiles;
drop policy if exists "tech_profiles_service_all" on public.technician_profiles;
drop policy if exists "tech_profiles_select_j2_pay_ladder_scoped" on public.technician_profiles;
drop policy if exists "tech_profiles_insert_j2_pay_ladder_manager" on public.technician_profiles;
drop policy if exists "tech_profiles_update_j2_pay_ladder_manager" on public.technician_profiles;

create policy "tech_profiles_service_all" on public.technician_profiles for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "tech_profiles_select" on public.technician_profiles for select
  using (workspace_id = (select public.get_my_workspace()));

create policy "tech_profiles_insert" on public.technician_profiles for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
  );

create policy "tech_profiles_update" on public.technician_profiles for update
  using (workspace_id = (select public.get_my_workspace()))
  with check (workspace_id = (select public.get_my_workspace()));

-- HR-sensitive current tier/wage assignment stays scoped.
drop policy if exists "technician_pay_ladder_assignment_service_all" on public.technician_pay_ladder_assignment;
drop policy if exists "technician_pay_ladder_assignment_select_scoped" on public.technician_pay_ladder_assignment;
drop policy if exists "technician_pay_ladder_assignment_write_manager" on public.technician_pay_ladder_assignment;

create policy "technician_pay_ladder_assignment_service_all"
  on public.technician_pay_ladder_assignment for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "technician_pay_ladder_assignment_select_scoped"
  on public.technician_pay_ladder_assignment for select
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_pay_ladder_assignment.technician_profile_id
        and public.technician_pay_ladder_can_read(tp.workspace_id, tp.user_id)
    )
  );

create policy "technician_pay_ladder_assignment_write_manager"
  on public.technician_pay_ladder_assignment for all
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_pay_ladder_assignment.technician_profile_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_pay_ladder_assignment.technician_profile_id
        and tp.workspace_id = technician_pay_ladder_assignment.workspace_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  );

drop policy if exists "technician_oem_certs_service_all" on public.technician_oem_certifications;
drop policy if exists "technician_oem_certs_select_scoped" on public.technician_oem_certifications;
drop policy if exists "technician_oem_certs_write_manager" on public.technician_oem_certifications;

create policy "technician_oem_certs_service_all"
  on public.technician_oem_certifications for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "technician_oem_certs_select_scoped"
  on public.technician_oem_certifications for select
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_oem_certifications.technician_profile_id
        and public.technician_pay_ladder_can_read(tp.workspace_id, tp.user_id)
    )
  );

create policy "technician_oem_certs_write_manager"
  on public.technician_oem_certifications for all
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_oem_certifications.technician_profile_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_oem_certifications.technician_profile_id
        and tp.workspace_id = technician_oem_certifications.workspace_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  );

drop policy if exists "technician_in_house_certs_service_all" on public.technician_in_house_certifications;
drop policy if exists "technician_in_house_certs_select_scoped" on public.technician_in_house_certifications;
drop policy if exists "technician_in_house_certs_write_manager" on public.technician_in_house_certifications;

create policy "technician_in_house_certs_service_all"
  on public.technician_in_house_certifications for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "technician_in_house_certs_select_scoped"
  on public.technician_in_house_certifications for select
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_in_house_certifications.technician_profile_id
        and public.technician_pay_ladder_can_read(tp.workspace_id, tp.user_id)
    )
  );

create policy "technician_in_house_certs_write_manager"
  on public.technician_in_house_certifications for all
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_in_house_certifications.technician_profile_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_in_house_certifications.technician_profile_id
        and tp.workspace_id = technician_in_house_certifications.workspace_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  );

drop policy if exists "technician_vendor_logins_service_all" on public.technician_vendor_logins;
drop policy if exists "technician_vendor_logins_select_scoped" on public.technician_vendor_logins;
drop policy if exists "technician_vendor_logins_write_manager" on public.technician_vendor_logins;

create policy "technician_vendor_logins_service_all"
  on public.technician_vendor_logins for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "technician_vendor_logins_select_scoped"
  on public.technician_vendor_logins for select
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_vendor_logins.technician_profile_id
        and public.technician_pay_ladder_can_read(tp.workspace_id, tp.user_id)
    )
  );

create policy "technician_vendor_logins_write_manager"
  on public.technician_vendor_logins for all
  using (
    exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_vendor_logins.technician_profile_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1
      from public.technician_profiles tp
      where tp.id = technician_vendor_logins.technician_profile_id
        and tp.workspace_id = technician_vendor_logins.workspace_id
        and public.technician_pay_ladder_can_manage(tp.workspace_id, tp.user_id)
    )
  );

-- ── Updated-at triggers -------------------------------------------------------

create or replace function public.set_technician_profiles_tool_count_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tool_count is distinct from old.tool_count then
    new.tool_count_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_technician_profiles_tool_count_updated_at on public.technician_profiles;
create trigger set_technician_profiles_tool_count_updated_at
  before update of tool_count on public.technician_profiles
  for each row execute function public.set_technician_profiles_tool_count_updated_at();

drop trigger if exists set_technician_pay_ladder_tiers_updated_at on public.technician_pay_ladder_tiers;
create trigger set_technician_pay_ladder_tiers_updated_at
  before update on public.technician_pay_ladder_tiers
  for each row execute function public.set_updated_at();

drop trigger if exists set_technician_pay_ladder_assignment_updated_at on public.technician_pay_ladder_assignment;
create trigger set_technician_pay_ladder_assignment_updated_at
  before update on public.technician_pay_ladder_assignment
  for each row execute function public.set_updated_at();

drop trigger if exists set_technician_oem_certifications_updated_at on public.technician_oem_certifications;
create trigger set_technician_oem_certifications_updated_at
  before update on public.technician_oem_certifications
  for each row execute function public.set_updated_at();

drop trigger if exists set_technician_in_house_certifications_updated_at on public.technician_in_house_certifications;
create trigger set_technician_in_house_certifications_updated_at
  before update on public.technician_in_house_certifications
  for each row execute function public.set_updated_at();

drop trigger if exists set_technician_vendor_logins_updated_at on public.technician_vendor_logins;
create trigger set_technician_vendor_logins_updated_at
  before update on public.technician_vendor_logins
  for each row execute function public.set_updated_at();

-- ── Grants -------------------------------------------------------------------

grant select on public.technician_pay_ladder_tiers to authenticated, service_role;
grant select on public.technician_pay_ladder_assignment to authenticated, service_role;
grant select on public.technician_oem_certifications to authenticated, service_role;
grant select on public.technician_in_house_certifications to authenticated, service_role;
grant select on public.technician_vendor_logins to authenticated, service_role;
grant select on public.v_technician_pay_ladder_metric_snapshot to authenticated, service_role;
grant select on public.v_technician_pay_ladder_progression to authenticated, service_role;

grant insert, update, delete on public.technician_pay_ladder_assignment to authenticated, service_role;
grant insert, update, delete on public.technician_oem_certifications to authenticated, service_role;
grant insert, update, delete on public.technician_in_house_certifications to authenticated, service_role;
grant insert, update, delete on public.technician_vendor_logins to authenticated, service_role;

grant execute on function public.technician_pay_ladder_current_employee_id() to authenticated, service_role;
grant execute on function public.technician_pay_ladder_can_manage(text, uuid) to authenticated, service_role;
grant execute on function public.technician_pay_ladder_can_read(text, uuid) to authenticated, service_role;
grant execute on function public.technician_pay_ladder_status_rank(text) to authenticated, service_role;
grant execute on function public.technician_pay_ladder_missing_requirements(uuid, numeric, integer, integer, integer, timestamptz, numeric, integer, integer, jsonb, text[], boolean, text[], text, integer) to authenticated, service_role;
grant execute on function public.set_technician_profiles_tool_count_updated_at() to authenticated, service_role;

revoke execute on function public.technician_pay_ladder_current_employee_id() from public;
revoke execute on function public.technician_pay_ladder_can_manage(text, uuid) from public;
revoke execute on function public.technician_pay_ladder_can_read(text, uuid) from public;
revoke execute on function public.technician_pay_ladder_missing_requirements(uuid, numeric, integer, integer, integer, timestamptz, numeric, integer, integer, jsonb, text[], boolean, text[], text, integer) from public;
revoke execute on function public.set_technician_profiles_tool_count_updated_at() from public;
