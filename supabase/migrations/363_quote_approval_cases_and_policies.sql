-- ============================================================================
-- Migration 363: Quote approval versions, cases, conditions, and policies
-- ============================================================================

create table if not exists public.quote_approval_policies (
  workspace_id text primary key default public.get_my_workspace(),
  branch_manager_min_margin_pct numeric not null default 8.0,
  standard_margin_floor_pct numeric not null default 10.0,
  branch_manager_max_quote_amount numeric not null default 250000,
  submit_sla_hours integer not null default 24,
  escalation_sla_hours integer not null default 48,
  owner_escalation_role text not null default 'owner'
    check (owner_escalation_role in ('owner', 'admin')),
  named_branch_sales_manager_primary boolean not null default true,
  named_branch_general_manager_fallback boolean not null default true,
  allowed_condition_types jsonb not null default
    '["min_margin_pct","max_trade_allowance","required_cash_down","required_finance_scenario","remove_attachment","expiry_hours"]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_quote_approval_policies_updated_at
  before update on public.quote_approval_policies
  for each row execute function public.set_updated_at();

alter table public.quote_approval_policies enable row level security;

create policy "qap_select" on public.quote_approval_policies
  for select using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qap_manage" on public.quote_approval_policies
  for all using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = public.get_my_workspace());

create policy "qap_service_all" on public.quote_approval_policies
  for all to service_role using (true) with check (true);

insert into public.quote_approval_policies (workspace_id)
values ('default')
on conflict (workspace_id) do nothing;

create table if not exists public.quote_package_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  version_number integer not null,
  snapshot_json jsonb not null,
  computed_metrics_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (quote_package_id, version_number)
);

create index if not exists idx_quote_package_versions_quote_created
  on public.quote_package_versions (quote_package_id, created_at desc);
create index if not exists idx_quote_package_versions_active
  on public.quote_package_versions (quote_package_id)
  where superseded_at is null;

alter table public.quote_package_versions enable row level security;

create policy "qpv_select" on public.quote_package_versions
  for select using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qpv_service_all" on public.quote_package_versions
  for all to service_role using (true) with check (true);

create table if not exists public.quote_approval_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  quote_package_version_id uuid not null references public.quote_package_versions(id) on delete restrict,
  version_number integer not null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  quote_number text,
  branch_slug text,
  branch_name text,
  customer_name text,
  customer_company text,
  net_total numeric,
  margin_pct numeric,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_by_name text,
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_to_name text,
  assigned_role text,
  route_mode text not null
    check (route_mode in ('branch_sales_manager', 'branch_general_manager', 'owner_direct', 'admin_direct', 'owner_queue', 'manager_queue')),
  policy_snapshot_json jsonb not null default '{}'::jsonb,
  reason_summary_json jsonb not null default '{}'::jsonb,
  status text not null
    check (status in ('pending', 'approved', 'approved_with_conditions', 'changes_requested', 'rejected', 'escalated', 'cancelled', 'superseded', 'expired')),
  decision_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  due_at timestamptz,
  escalate_at timestamptz,
  flow_approval_id uuid references public.flow_approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_quote_approval_cases_updated_at
  before update on public.quote_approval_cases
  for each row execute function public.set_updated_at();

create index if not exists idx_quote_approval_cases_quote_created
  on public.quote_approval_cases (quote_package_id, created_at desc);
create index if not exists idx_quote_approval_cases_status
  on public.quote_approval_cases (workspace_id, status, created_at desc);
create index if not exists idx_quote_approval_cases_assigned
  on public.quote_approval_cases (assigned_to, status)
  where assigned_to is not null;

alter table public.quote_approval_cases enable row level security;

create policy "qac_select" on public.quote_approval_cases
  for select using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qac_manage" on public.quote_approval_cases
  for all using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = public.get_my_workspace());

create policy "qac_service_all" on public.quote_approval_cases
  for all to service_role using (true) with check (true);

create table if not exists public.quote_approval_case_conditions (
  id uuid primary key default gen_random_uuid(),
  approval_case_id uuid not null references public.quote_approval_cases(id) on delete cascade,
  condition_type text not null
    check (condition_type in ('min_margin_pct', 'max_trade_allowance', 'required_cash_down', 'required_finance_scenario', 'remove_attachment', 'expiry_hours')),
  condition_payload_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_quote_approval_case_conditions_case
  on public.quote_approval_case_conditions (approval_case_id, sort_order, created_at);

alter table public.quote_approval_case_conditions enable row level security;

create policy "qacc_select" on public.quote_approval_case_conditions
  for select using (
    exists (
      select 1
      from public.quote_approval_cases c
      where c.id = approval_case_id
        and c.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    )
  );

create policy "qacc_manage" on public.quote_approval_case_conditions
  for all using (
    exists (
      select 1
      from public.quote_approval_cases c
      where c.id = approval_case_id
        and c.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('admin', 'manager', 'owner')
    )
  )
  with check (
    exists (
      select 1
      from public.quote_approval_cases c
      where c.id = approval_case_id
        and c.workspace_id = public.get_my_workspace()
        and public.get_my_role() in ('admin', 'manager', 'owner')
    )
  );

create policy "qacc_service_all" on public.quote_approval_case_conditions
  for all to service_role using (true) with check (true);

create or replace function public.sync_quote_status_from_flow_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_package_id uuid;
  v_case_status text;
  v_next_status text;
begin
  if NEW.workflow_slug <> 'quote-manager-approval' then
    return NEW;
  end if;

  if NEW.status = OLD.status then
    return NEW;
  end if;

  select c.quote_package_id, c.status
    into v_quote_package_id, v_case_status
  from public.quote_approval_cases c
  where c.flow_approval_id = NEW.id
  order by c.created_at desc
  limit 1;

  if v_quote_package_id is null then
    v_quote_package_id := nullif(NEW.context_summary ->> 'quote_package_id', '')::uuid;
  end if;
  if v_quote_package_id is null then
    return NEW;
  end if;

  v_next_status := case
    when v_case_status = 'approved' then 'approved'
    when v_case_status = 'approved_with_conditions' then 'approved_with_conditions'
    when v_case_status = 'changes_requested' then 'changes_requested'
    when v_case_status = 'rejected' then 'rejected'
    when v_case_status = 'pending' or v_case_status = 'escalated' then 'pending_approval'
    when v_case_status in ('cancelled', 'superseded', 'expired') then 'draft'
    when NEW.status = 'approved' then 'approved'
    when NEW.status in ('rejected', 'cancelled', 'expired') then 'draft'
    when NEW.status in ('pending', 'escalated') then 'pending_approval'
    else null
  end;

  if v_next_status is null then
    return NEW;
  end if;

  update public.quote_packages
  set status = v_next_status
  where id = v_quote_package_id;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_quote_status_from_flow_approval on public.flow_approvals;

create trigger trg_sync_quote_status_from_flow_approval
  after update on public.flow_approvals
  for each row
  execute function public.sync_quote_status_from_flow_approval();
