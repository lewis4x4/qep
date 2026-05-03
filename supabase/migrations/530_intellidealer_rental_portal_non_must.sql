-- 530_intellidealer_rental_portal_non_must.sql
--
-- Worker E non-must cleanup for Phase 6 rental/Phase 9 portal audit rows.
-- Additive/idempotent only. No raw IntelliDealer or COL artifacts touched.

alter table public.rental_contracts
  add column if not exists equipment_class text,
  add column if not exists equipment_subclass text,
  add column if not exists hard_closed_at timestamptz,
  add column if not exists hard_closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists hard_close_reason text,
  add column if not exists deleted_at timestamptz;

comment on column public.rental_contracts.equipment_class is
  'Rental request class within category for IntelliDealer Rental Counter class filtering and rate matching.';
comment on column public.rental_contracts.equipment_subclass is
  'Rental request subclass within class for IntelliDealer Rental Counter subclass filtering and substitution rules.';
comment on column public.rental_contracts.hard_closed_at is
  'Manager-gated hard-close timestamp for corrupt/voided rental contracts; prefer soft-delete via deleted_at over physical deletion.';
comment on column public.rental_contracts.hard_closed_by is
  'Profile that performed a manager-gated rental contract hard close.';
comment on column public.rental_contracts.hard_close_reason is
  'Required business reason for manager-gated rental contract hard close.';

alter table public.rental_rate_rules
  add column if not exists equipment_class text,
  add column if not exists equipment_subclass text;

comment on column public.rental_rate_rules.equipment_class is
  'Optional rental class qualifier used with category/make/model for rate-card matching.';
comment on column public.rental_rate_rules.equipment_subclass is
  'Optional rental subclass qualifier used with category/class for finer rate-card matching.';

create index if not exists idx_rental_contracts_class_subclass
  on public.rental_contracts (workspace_id, requested_category, equipment_class, equipment_subclass)
  where deleted_at is null;
comment on index public.idx_rental_contracts_class_subclass is
  'Purpose: Rental Counter category/class/subclass filters and requested-pool reporting.';

create index if not exists idx_rental_rate_rules_class_subclass
  on public.rental_rate_rules (workspace_id, category, equipment_class, equipment_subclass, priority_rank)
  where is_active = true;
comment on index public.idx_rental_rate_rules_class_subclass is
  'Purpose: rental rate lookup by category/class/subclass with priority ordering.';

create index if not exists idx_rental_contracts_hard_closed
  on public.rental_contracts (workspace_id, hard_closed_at desc)
  where hard_closed_at is not null;
comment on index public.idx_rental_contracts_hard_closed is
  'Purpose: audit review of manager-gated rental contract hard closes.';

create table if not exists public.rental_print_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  branch_id uuid references public.branches(id) on delete cascade,
  logo_url text,
  terms_template_id uuid,
  font_family text not null default 'Helvetica',
  accent_color text,
  show_serial_numbers boolean not null default true,
  show_rate_breakdown boolean not null default true,
  print_parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, branch_id)
);

comment on table public.rental_print_settings is
  'Branch-level default print settings for rental contract PDFs.';
comment on column public.rental_print_settings.print_parameters is
  'Structured IntelliDealer-style rental print parameter defaults beyond canonical branding fields.';

create index if not exists idx_rental_print_settings_active
  on public.rental_print_settings (workspace_id, branch_id)
  where deleted_at is null;
comment on index public.idx_rental_print_settings_active is
  'Purpose: resolve rental contract print defaults by workspace and branch.';

create table if not exists public.rental_contract_commissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  rental_contract_id uuid not null references public.rental_contracts(id) on delete cascade,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  split_pct numeric(5, 2) not null check (split_pct > 0 and split_pct <= 100),
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (rental_contract_id, salesperson_id)
);

comment on table public.rental_contract_commissions is
  'Multi-salesperson commission split allocation for rental contracts.';
comment on column public.rental_contract_commissions.split_pct is
  'Commission split percentage for a salesperson on the rental contract.';

create index if not exists idx_rental_contract_commissions_contract
  on public.rental_contract_commissions (workspace_id, rental_contract_id)
  where deleted_at is null;
comment on index public.idx_rental_contract_commissions_contract is
  'Purpose: rental contract commission split editor and audit.';

create index if not exists idx_rental_contract_commissions_salesperson
  on public.rental_contract_commissions (workspace_id, salesperson_id, created_at desc)
  where deleted_at is null;
comment on index public.idx_rental_contract_commissions_salesperson is
  'Purpose: salesperson rental commission attribution reporting.';

create table if not exists public.rental_billing_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  run_date date not null default current_date,
  billing_cycle public.rental_billing_cycle,
  status text not null default 'draft' check (status in ('draft', 'running', 'completed', 'failed', 'rolled_back')),
  invoice_count integer not null default 0 check (invoice_count >= 0),
  total_billed_cents bigint not null default 0 check (total_billed_cents >= 0),
  triggered_by uuid references public.profiles(id) on delete set null default auth.uid(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  rollback_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.rental_billing_runs is
  'Batch header for rental cycle-billing invoice generation and rollback audit.';
comment on column public.rental_billing_runs.total_billed_cents is
  'Total billed in cents across invoices generated by this rental billing run.';

alter table public.rental_invoices
  add column if not exists rental_billing_run_id uuid references public.rental_billing_runs(id) on delete set null;

comment on column public.rental_invoices.rental_billing_run_id is
  'Batch run that generated this rental invoice for cycle-billing audit and rollback tracing.';

create index if not exists idx_rental_billing_runs_workspace_date
  on public.rental_billing_runs (workspace_id, run_date desc, status)
  where deleted_at is null;
comment on index public.idx_rental_billing_runs_workspace_date is
  'Purpose: rental billing dashboard batch run history.';

create index if not exists idx_rental_invoices_billing_run
  on public.rental_invoices (workspace_id, rental_billing_run_id)
  where rental_billing_run_id is not null and deleted_at is null;
comment on index public.idx_rental_invoices_billing_run is
  'Purpose: list invoices created by a rental cycle-billing run.';

alter table public.rental_print_settings enable row level security;
alter table public.rental_contract_commissions enable row level security;
alter table public.rental_billing_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_print_settings'
      and policyname = 'rental_print_settings_service_all'
  ) then
    create policy "rental_print_settings_service_all"
      on public.rental_print_settings for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_print_settings'
      and policyname = 'rental_print_settings_internal_all'
  ) then
    create policy "rental_print_settings_internal_all"
      on public.rental_print_settings for all
      using (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('admin', 'manager', 'owner')
      )
      with check (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('admin', 'manager', 'owner')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_contract_commissions'
      and policyname = 'rental_contract_commissions_service_all'
  ) then
    create policy "rental_contract_commissions_service_all"
      on public.rental_contract_commissions for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_contract_commissions'
      and policyname = 'rental_contract_commissions_internal_all'
  ) then
    create policy "rental_contract_commissions_internal_all"
      on public.rental_contract_commissions for all
      using (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_contract_commissions.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('admin', 'manager', 'owner')
        )
      )
      with check (
        exists (
          select 1
          from public.rental_contracts rc
          where rc.id = rental_contract_commissions.rental_contract_id
            and rc.workspace_id = (select public.get_my_workspace())
            and (select public.get_my_role()) in ('admin', 'manager', 'owner')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_billing_runs'
      and policyname = 'rental_billing_runs_service_all'
  ) then
    create policy "rental_billing_runs_service_all"
      on public.rental_billing_runs for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rental_billing_runs'
      and policyname = 'rental_billing_runs_internal_all'
  ) then
    create policy "rental_billing_runs_internal_all"
      on public.rental_billing_runs for all
      using (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('admin', 'manager', 'owner')
      )
      with check (
        workspace_id = (select public.get_my_workspace())
        and (select public.get_my_role()) in ('admin', 'manager', 'owner')
      );
  end if;
end $$;

drop trigger if exists set_rental_print_settings_updated_at on public.rental_print_settings;
create trigger set_rental_print_settings_updated_at
  before update on public.rental_print_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_rental_contract_commissions_updated_at on public.rental_contract_commissions;
create trigger set_rental_contract_commissions_updated_at
  before update on public.rental_contract_commissions
  for each row execute function public.set_updated_at();

drop trigger if exists set_rental_billing_runs_updated_at on public.rental_billing_runs;
create trigger set_rental_billing_runs_updated_at
  before update on public.rental_billing_runs
  for each row execute function public.set_updated_at();
