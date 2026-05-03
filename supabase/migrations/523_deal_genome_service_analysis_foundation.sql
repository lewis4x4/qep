-- 523_deal_genome_service_analysis_foundation.sql
--
-- Phase 5 Deal Genome service-analysis financial foundation.
-- Gap-audit blockers covered: Analysis Reports Billing, Days, Efficiency,
-- Quote Gain/Loss, WIP, and Credit Limit Analysis.
--
-- Additive/idempotent only: reuse service_jobs, service_job_segments,
-- service_timecards, service_quotes, employees, branches, customer_invoices,
-- qrm_companies, and existing Wave 4 AR/WIP views where available.

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'work_order_revenue_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.work_order_revenue_type as enum (
      'customer',
      'warranty',
      'internal',
      'contract',
      'rental',
      'policy',
      'goodwill',
      'unknown'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'work_order_billing_basis'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.work_order_billing_basis as enum (
      'time_and_material',
      'standard',
      'flat_rate',
      'warranty',
      'internal',
      'no_charge'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'work_order_billed_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.work_order_billed_status as enum (
      'unbilled',
      'ready_to_bill',
      'billing_hold',
      'billed',
      'paid',
      'void'
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'service_billing_row_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.service_billing_row_type as enum (
      'labor_adjustment',
      'part',
      'shop_supply',
      'haul',
      'sublet',
      'freight',
      'misc',
      'discount'
    );
  end if;
end $$;

alter table public.service_jobs
  add column if not exists revenue_type public.work_order_revenue_type,
  add column if not exists billing_basis public.work_order_billing_basis,
  add column if not exists billed_status public.work_order_billed_status not null default 'unbilled',
  add column if not exists opened_at timestamptz,
  add column if not exists promised_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists work_completed_at timestamptz,
  add column if not exists ready_to_bill_at timestamptz,
  add column if not exists billed_at timestamptz,
  add column if not exists posted_to_gl_at timestamptz,
  add column if not exists standard_hours numeric(8, 2),
  add column if not exists flat_rate_amount_cents bigint check (flat_rate_amount_cents is null or flat_rate_amount_cents >= 0),
  add column if not exists billing_hold_reason text;

comment on column public.service_jobs.revenue_type is
  'Phase 5 Deal Genome: work-order revenue type for Billing, WIP, Efficiency, and Quote Gain/Loss analysis.';
comment on column public.service_jobs.billing_basis is
  'Phase 5 Deal Genome: time-and-material, standard, flat-rate, warranty, internal, or no-charge billing basis.';
comment on column public.service_jobs.billed_status is
  'Phase 5 Deal Genome: service-analysis billed status without changing the existing service stage lifecycle.';
comment on column public.service_jobs.opened_at is
  'Phase 5 Days Analysis milestone. Nullable; falls back to created_at in reporting views.';
comment on column public.service_jobs.promised_at is
  'Phase 5 Days Analysis promised completion milestone for work-order cycle reporting.';
comment on column public.service_jobs.approved_at is
  'Phase 5 Quote Gain/Loss and Days Analysis customer/internal approval milestone.';
comment on column public.service_jobs.work_started_at is
  'Phase 5 Days Analysis first wrench/start milestone when service_timecards are not canonical yet.';
comment on column public.service_jobs.work_completed_at is
  'Phase 5 Days Analysis work-complete milestone distinct from administrative closed_at.';
comment on column public.service_jobs.ready_to_bill_at is
  'Phase 5 Billing Analysis milestone for work orders ready for invoice creation.';
comment on column public.service_jobs.billed_at is
  'Phase 5 Billing Analysis milestone for first billing/invoice completion.';
comment on column public.service_jobs.posted_to_gl_at is
  'Phase 5 Billing/WIP marker showing the work order has been posted to GL.';
comment on column public.service_jobs.standard_hours is
  'Phase 5 Efficiency Analysis standard hours at work-order header level when segment detail is unavailable.';
comment on column public.service_jobs.flat_rate_amount_cents is
  'Phase 5 flat-rate work-order amount in cents; nullable to avoid assumptions on existing jobs.';
comment on column public.service_jobs.billing_hold_reason is
  'Phase 5 Billing Analysis hold reason for unbilled or billing-hold work orders.';

alter table public.service_job_segments
  add column if not exists revenue_type public.work_order_revenue_type,
  add column if not exists billing_basis public.work_order_billing_basis,
  add column if not exists billed_status public.work_order_billed_status not null default 'unbilled',
  add column if not exists labor_started_at timestamptz,
  add column if not exists labor_completed_at timestamptz,
  add column if not exists standard_hours numeric(8, 2),
  add column if not exists flat_rate_amount_cents bigint check (flat_rate_amount_cents is null or flat_rate_amount_cents >= 0),
  add column if not exists posted_to_gl_at timestamptz,
  add column if not exists customer_invoice_id uuid references public.customer_invoices(id) on delete set null;

comment on column public.service_job_segments.revenue_type is
  'Phase 5 segment-level work-order revenue type for Billing, WIP, and Efficiency reporting.';
comment on column public.service_job_segments.billing_basis is
  'Phase 5 segment-level standard/flat-rate/time-and-material billing basis.';
comment on column public.service_job_segments.billed_status is
  'Phase 5 segment-level billed status for WIP and billing queue analysis.';
comment on column public.service_job_segments.labor_started_at is
  'Phase 5 labor date foundation: first labor start timestamp for this segment.';
comment on column public.service_job_segments.labor_completed_at is
  'Phase 5 labor date foundation: labor completion timestamp for this segment.';
comment on column public.service_job_segments.standard_hours is
  'Phase 5 Efficiency Analysis standard hours for this segment.';
comment on column public.service_job_segments.flat_rate_amount_cents is
  'Phase 5 flat-rate segment amount in cents; nullable for legacy jobs.';
comment on column public.service_job_segments.posted_to_gl_at is
  'Phase 5 posted-to-GL marker for segment-level billing/WIP rows.';
comment on column public.service_job_segments.customer_invoice_id is
  'Phase 5 link from service segment to canonical customer_invoices header.';

alter table public.customer_invoices
  add column if not exists posted_to_gl_at timestamptz,
  add column if not exists gl_posting_reference text;

comment on column public.customer_invoices.posted_to_gl_at is
  'Phase 5 Billing Analysis marker that the canonical customer invoice header has posted to GL.';
comment on column public.customer_invoices.gl_posting_reference is
  'Phase 5 Billing Analysis GL batch, journal, or external posting reference.';

alter table public.service_quotes
  add column if not exists outcome_at timestamptz,
  add column if not exists outcome_by uuid references public.profiles(id) on delete set null,
  add column if not exists quote_result_reason text;

comment on column public.service_quotes.outcome_at is
  'Phase 5 Quote Gain/Loss outcome timestamp; nullable and falls back to approval/status dates in reporting.';
comment on column public.service_quotes.outcome_by is
  'Phase 5 Quote Gain/Loss user who recorded the quote outcome.';
comment on column public.service_quotes.quote_result_reason is
  'Phase 5 Quote Gain/Loss reason text for won/lost/expired service quotes.';

alter table public.qrm_companies
  add column if not exists credit_hold boolean not null default false,
  add column if not exists credit_hold_reason text,
  add column if not exists credit_hold_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists credit_hold_set_at timestamptz,
  add column if not exists credit_hold_expires_at timestamptz;

comment on column public.qrm_companies.credit_hold is
  'Phase 5 Credit Limit Analysis explicit hold flag. Does not duplicate Wave 2 credit limit/current AR columns.';
comment on column public.qrm_companies.credit_hold_reason is
  'Phase 5 Credit Limit Analysis reason for explicit customer credit hold.';
comment on column public.qrm_companies.credit_hold_set_by is
  'Phase 5 Credit Limit Analysis user who set the explicit customer credit hold.';
comment on column public.qrm_companies.credit_hold_set_at is
  'Phase 5 Credit Limit Analysis timestamp when explicit customer credit hold was set.';
comment on column public.qrm_companies.credit_hold_expires_at is
  'Phase 5 Credit Limit Analysis optional expiry timestamp for explicit customer credit hold.';

create table if not exists public.service_labor_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  service_job_segment_id uuid references public.service_job_segments(id) on delete set null,
  service_timecard_id uuid references public.service_timecards(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  technician_id uuid references public.profiles(id) on delete set null,
  labor_date date,
  started_at timestamptz,
  ended_at timestamptz,
  actual_hours numeric(8, 2) check (actual_hours is null or actual_hours >= 0),
  billable_hours numeric(8, 2) check (billable_hours is null or billable_hours >= 0),
  standard_hours numeric(8, 2) check (standard_hours is null or standard_hours >= 0),
  assist_hours numeric(8, 2) check (assist_hours is null or assist_hours >= 0),
  revenue_type public.work_order_revenue_type,
  billing_basis public.work_order_billing_basis,
  labor_rate_cents bigint check (labor_rate_cents is null or labor_rate_cents >= 0),
  labor_cost_rate_cents bigint check (labor_cost_rate_cents is null or labor_cost_rate_cents >= 0),
  labor_sale_cents bigint not null default 0 check (labor_sale_cents >= 0),
  labor_cost_cents bigint not null default 0 check (labor_cost_cents >= 0),
  billed_status public.work_order_billed_status not null default 'unbilled',
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  posted_to_gl_at timestamptz,
  gl_labor_account text,
  source_system text,
  source_key text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

comment on table public.service_labor_ledger is
  'Phase 5 Deal Genome labor ledger for Billing, Days, Efficiency, and WIP analysis. Links optional timecards/employees without replacing them.';
comment on column public.service_labor_ledger.service_timecard_id is
  'Optional source timecard when labor came from service_timecards; nullable for imported IntelliDealer labor rows.';
comment on column public.service_labor_ledger.employee_id is
  'Optional employee master link for payroll/cost reporting; technician_id preserves existing profile-based service assignments.';
comment on column public.service_labor_ledger.labor_date is
  'Labor accounting date used by Analysis Reports Billing/Days/Efficiency.';
comment on column public.service_labor_ledger.standard_hours is
  'Standard or flat-rate allowed hours for efficiency comparison.';
comment on column public.service_labor_ledger.labor_sale_cents is
  'Billable labor revenue in cents for service billing/WIP reporting.';
comment on column public.service_labor_ledger.labor_cost_cents is
  'Labor cost in cents for technician recovery and margin reporting.';
comment on column public.service_labor_ledger.billed_status is
  'Billing lifecycle for this labor row: unbilled, ready_to_bill, hold, billed, paid, or void.';
comment on column public.service_labor_ledger.posted_to_gl_at is
  'Posted-to-GL marker for this labor ledger row.';

create table if not exists public.service_billing_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  service_job_segment_id uuid references public.service_job_segments(id) on delete set null,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  parts_invoice_line_id uuid references public.parts_invoice_lines(id) on delete set null,
  row_type public.service_billing_row_type not null,
  description text,
  quantity numeric(12, 2) not null default 1 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents >= 0),
  extended_cost_cents bigint not null default 0 check (extended_cost_cents >= 0),
  extended_price_cents bigint not null default 0 check (extended_price_cents >= 0),
  revenue_type public.work_order_revenue_type,
  billing_basis public.work_order_billing_basis,
  billed_status public.work_order_billed_status not null default 'unbilled',
  taxable boolean,
  posted_to_gl_at timestamptz,
  gl_revenue_account text,
  gl_cost_account text,
  source_system text,
  source_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.service_billing_rows is
  'Phase 5 Deal Genome parts/other service billing ledger rows for Billing Analysis and WIP. Reuses customer_invoices and parts_invoice_lines when present.';
comment on column public.service_billing_rows.parts_invoice_line_id is
  'Optional link to canonical parts_invoice_lines; nullable for imported service shop supplies, sublet, freight, and adjustments.';
comment on column public.service_billing_rows.row_type is
  'Service billing row category for Analysis Reports Billing: part, shop_supply, haul, sublet, freight, misc, discount, or labor_adjustment.';
comment on column public.service_billing_rows.extended_price_cents is
  'Billable row revenue in cents used by service billing and WIP analysis.';
comment on column public.service_billing_rows.extended_cost_cents is
  'Cost basis in cents for service margin/recovery analysis.';
comment on column public.service_billing_rows.billed_status is
  'Billing lifecycle for this parts/other row: unbilled, ready_to_bill, hold, billed, paid, or void.';
comment on column public.service_billing_rows.posted_to_gl_at is
  'Posted-to-GL marker for this parts/other billing row.';

create index if not exists idx_service_jobs_phase5_billing
  on public.service_jobs (workspace_id, billed_status, revenue_type, ready_to_bill_at)
  where deleted_at is null;
comment on index public.idx_service_jobs_phase5_billing is
  'Purpose: Phase 5 Analysis Reports Billing filters by billed status, revenue type, and ready-to-bill date.';

create index if not exists idx_service_jobs_phase5_days
  on public.service_jobs (workspace_id, opened_at, work_completed_at, billed_at)
  where deleted_at is null;
comment on index public.idx_service_jobs_phase5_days is
  'Purpose: Phase 5 Days Analysis cycle-time scans across open, complete, and billed milestones.';

create index if not exists idx_service_job_segments_phase5_billing
  on public.service_job_segments (workspace_id, service_job_id, billed_status, revenue_type)
  where deleted_at is null;
comment on index public.idx_service_job_segments_phase5_billing is
  'Purpose: Phase 5 segment billing/WIP rollups by work order and revenue type.';

create index if not exists idx_customer_invoices_phase5_service_gl
  on public.customer_invoices (workspace_id, service_job_id, posted_to_gl_at)
  where service_job_id is not null;
comment on index public.idx_customer_invoices_phase5_service_gl is
  'Purpose: Phase 5 Billing Analysis service invoice and posted-to-GL reconciliation.';

create index if not exists idx_qrm_companies_phase5_credit_hold
  on public.qrm_companies (workspace_id, credit_hold, credit_hold_expires_at)
  where credit_hold = true and deleted_at is null;
comment on index public.idx_qrm_companies_phase5_credit_hold is
  'Purpose: Phase 5 Credit Limit Analysis explicit hold queue without duplicating AR tables.';

create index if not exists idx_service_labor_ledger_job
  on public.service_labor_ledger (workspace_id, service_job_id, labor_date)
  where deleted_at is null;
comment on index public.idx_service_labor_ledger_job is
  'Purpose: Phase 5 Billing/Days/Efficiency labor rollup by work order and labor date.';

create index if not exists idx_service_labor_ledger_segment
  on public.service_labor_ledger (workspace_id, service_job_segment_id, labor_date)
  where service_job_segment_id is not null and deleted_at is null;
comment on index public.idx_service_labor_ledger_segment is
  'Purpose: Phase 5 segment efficiency and recovery analysis from labor ledger rows.';

create index if not exists idx_service_labor_ledger_employee
  on public.service_labor_ledger (workspace_id, employee_id, labor_date desc)
  where employee_id is not null and deleted_at is null;
comment on index public.idx_service_labor_ledger_employee is
  'Purpose: Phase 5 employee/technician labor efficiency reporting.';

create index if not exists idx_service_labor_ledger_unbilled
  on public.service_labor_ledger (workspace_id, billed_status, posted_to_gl_at)
  where deleted_at is null and billed_status in ('unbilled', 'ready_to_bill', 'billing_hold');
comment on index public.idx_service_labor_ledger_unbilled is
  'Purpose: Phase 5 WIP and unposted billing analysis for labor rows.';

create index if not exists idx_service_billing_rows_job
  on public.service_billing_rows (workspace_id, service_job_id, row_type)
  where deleted_at is null;
comment on index public.idx_service_billing_rows_job is
  'Purpose: Phase 5 Billing Analysis rollup of parts/other rows by work order.';

create index if not exists idx_service_billing_rows_invoice
  on public.service_billing_rows (workspace_id, customer_invoice_id)
  where customer_invoice_id is not null and deleted_at is null;
comment on index public.idx_service_billing_rows_invoice is
  'Purpose: Phase 5 service billing row to customer invoice reconciliation.';

create index if not exists idx_service_billing_rows_unbilled
  on public.service_billing_rows (workspace_id, billed_status, posted_to_gl_at)
  where deleted_at is null and billed_status in ('unbilled', 'ready_to_bill', 'billing_hold');
comment on index public.idx_service_billing_rows_unbilled is
  'Purpose: Phase 5 WIP and unposted billing analysis for parts/other rows.';

alter table public.service_labor_ledger enable row level security;
alter table public.service_billing_rows enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_labor_ledger' and policyname = 'service_labor_ledger_service_all'
  ) then
    create policy "service_labor_ledger_service_all"
      on public.service_labor_ledger for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_labor_ledger' and policyname = 'service_labor_ledger_all_elevated'
  ) then
    create policy "service_labor_ledger_all_elevated"
      on public.service_labor_ledger for all
      using (
        (select public.get_my_role()) in ('admin', 'manager', 'owner')
        and workspace_id = (select public.get_my_workspace())
      )
      with check (
        (select public.get_my_role()) in ('admin', 'manager', 'owner')
        and workspace_id = (select public.get_my_workspace())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_labor_ledger' and policyname = 'service_labor_ledger_rep_scope'
  ) then
    create policy "service_labor_ledger_rep_scope"
      on public.service_labor_ledger for all
      using (
        (select public.get_my_role()) = 'rep'
        and workspace_id = (select public.get_my_workspace())
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_id
            and j.workspace_id = (select public.get_my_workspace())
            and (
              j.advisor_id = (select auth.uid())
              or j.technician_id = (select auth.uid())
              or j.service_manager_id = (select auth.uid())
              or public.crm_rep_can_access_company(j.customer_id)
            )
        )
      )
      with check (
        (select public.get_my_role()) = 'rep'
        and workspace_id = (select public.get_my_workspace())
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_id
            and j.workspace_id = (select public.get_my_workspace())
            and (
              j.advisor_id = (select auth.uid())
              or j.technician_id = (select auth.uid())
              or j.service_manager_id = (select auth.uid())
              or public.crm_rep_can_access_company(j.customer_id)
            )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_billing_rows' and policyname = 'service_billing_rows_service_all'
  ) then
    create policy "service_billing_rows_service_all"
      on public.service_billing_rows for all
      using ((select auth.role()) = 'service_role')
      with check ((select auth.role()) = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_billing_rows' and policyname = 'service_billing_rows_all_elevated'
  ) then
    create policy "service_billing_rows_all_elevated"
      on public.service_billing_rows for all
      using (
        (select public.get_my_role()) in ('admin', 'manager', 'owner')
        and workspace_id = (select public.get_my_workspace())
      )
      with check (
        (select public.get_my_role()) in ('admin', 'manager', 'owner')
        and workspace_id = (select public.get_my_workspace())
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_billing_rows' and policyname = 'service_billing_rows_rep_scope'
  ) then
    create policy "service_billing_rows_rep_scope"
      on public.service_billing_rows for all
      using (
        (select public.get_my_role()) = 'rep'
        and workspace_id = (select public.get_my_workspace())
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_id
            and j.workspace_id = (select public.get_my_workspace())
            and (
              j.advisor_id = (select auth.uid())
              or j.technician_id = (select auth.uid())
              or j.service_manager_id = (select auth.uid())
              or public.crm_rep_can_access_company(j.customer_id)
            )
        )
      )
      with check (
        (select public.get_my_role()) = 'rep'
        and workspace_id = (select public.get_my_workspace())
        and exists (
          select 1
          from public.service_jobs j
          where j.id = service_job_id
            and j.workspace_id = (select public.get_my_workspace())
            and (
              j.advisor_id = (select auth.uid())
              or j.technician_id = (select auth.uid())
              or j.service_manager_id = (select auth.uid())
              or public.crm_rep_can_access_company(j.customer_id)
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_service_labor_ledger_updated_at'
      and tgrelid = 'public.service_labor_ledger'::regclass
  ) then
    create trigger set_service_labor_ledger_updated_at
      before update on public.service_labor_ledger
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_service_billing_rows_updated_at'
      and tgrelid = 'public.service_billing_rows'::regclass
  ) then
    create trigger set_service_billing_rows_updated_at
      before update on public.service_billing_rows
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace view public.v_deal_genome_service_billing_analysis
  with (security_invoker = true) as
with labor as (
  select
    service_job_id,
    sum(labor_sale_cents)::bigint as labor_sale_cents,
    sum(labor_cost_cents)::bigint as labor_cost_cents,
    sum(labor_sale_cents) filter (where billed_status in ('billed', 'paid'))::bigint as billed_labor_cents,
    count(*) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold'))::integer as unbilled_labor_rows,
    count(*) filter (where posted_to_gl_at is null and billed_status in ('billed', 'paid'))::integer as unposted_labor_rows,
    min(labor_date) as first_labor_date,
    max(labor_date) as last_labor_date
  from public.service_labor_ledger
  where deleted_at is null
  group by service_job_id
), billing as (
  select
    service_job_id,
    sum(extended_price_cents)::bigint as billing_row_revenue_cents,
    sum(extended_cost_cents)::bigint as billing_row_cost_cents,
    sum(extended_price_cents) filter (where row_type = 'part')::bigint as parts_revenue_cents,
    sum(extended_price_cents) filter (where row_type <> 'part')::bigint as other_revenue_cents,
    count(*) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold'))::integer as unbilled_billing_rows,
    count(*) filter (where posted_to_gl_at is null and billed_status in ('billed', 'paid'))::integer as unposted_billing_rows
  from public.service_billing_rows
  where deleted_at is null
  group by service_job_id
), invoices as (
  select
    service_job_id,
    count(*)::integer as invoice_count,
    sum(round(total * 100))::bigint as invoice_total_cents,
    sum(round(balance_due * 100))::bigint as invoice_balance_cents,
    min(invoice_date) as first_invoice_date,
    max(invoice_date) as last_invoice_date,
    count(*) filter (where posted_to_gl_at is null and status <> 'void')::integer as unposted_invoice_count
  from public.customer_invoices
  where service_job_id is not null
    and status <> 'void'
  group by service_job_id
)
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  j.revenue_type,
  j.billing_basis,
  j.billed_status,
  j.billing_hold_reason,
  coalesce(l.labor_sale_cents, 0)::bigint as labor_sale_cents,
  coalesce(l.labor_cost_cents, 0)::bigint as labor_cost_cents,
  coalesce(b.parts_revenue_cents, 0)::bigint as parts_revenue_cents,
  coalesce(b.other_revenue_cents, 0)::bigint as other_revenue_cents,
  (coalesce(l.labor_sale_cents, 0) + coalesce(b.billing_row_revenue_cents, 0))::bigint as analysis_revenue_cents,
  (coalesce(l.labor_cost_cents, 0) + coalesce(b.billing_row_cost_cents, 0))::bigint as analysis_cost_cents,
  coalesce(i.invoice_total_cents, round(coalesce(j.invoice_total, 0) * 100), 0)::bigint as invoice_total_cents,
  coalesce(i.invoice_balance_cents, 0)::bigint as invoice_balance_cents,
  coalesce(i.invoice_count, 0)::integer as invoice_count,
  coalesce(l.unbilled_labor_rows, 0)::integer as unbilled_labor_rows,
  coalesce(b.unbilled_billing_rows, 0)::integer as unbilled_billing_rows,
  coalesce(l.unposted_labor_rows, 0)::integer
    + coalesce(b.unposted_billing_rows, 0)::integer
    + coalesce(i.unposted_invoice_count, 0)::integer as unposted_financial_row_count,
  l.first_labor_date,
  l.last_labor_date,
  i.first_invoice_date,
  i.last_invoice_date,
  j.ready_to_bill_at,
  j.billed_at,
  j.posted_to_gl_at
from public.service_jobs j
left join labor l on l.service_job_id = j.id
left join billing b on b.service_job_id = j.id
left join invoices i on i.service_job_id = j.id
where j.deleted_at is null;

comment on view public.v_deal_genome_service_billing_analysis is
  'Phase 5 Deal Genome Analysis Reports Billing view. Reconciles work orders to labor ledger, parts/other billing rows, customer_invoices, billed status, and posted-to-GL markers.';

create or replace view public.v_deal_genome_service_days_analysis
  with (security_invoker = true) as
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  j.current_stage,
  j.billed_status,
  coalesce(j.opened_at, j.created_at) as opened_at,
  j.promised_at,
  j.approved_at,
  coalesce(j.work_started_at, min(ll.started_at), min(tc.clocked_in_at)) as work_started_at,
  coalesce(j.work_completed_at, max(ll.ended_at), max(tc.clocked_out_at), j.closed_at) as work_completed_at,
  j.ready_to_bill_at,
  coalesce(j.billed_at, min(ci.invoice_date)::timestamptz) as billed_at,
  j.closed_at,
  round(extract(epoch from (coalesce(j.closed_at, now()) - coalesce(j.opened_at, j.created_at))) / 86400.0, 2) as days_open,
  round(extract(epoch from (j.approved_at - coalesce(j.opened_at, j.created_at))) / 86400.0, 2) as days_to_approval,
  round(extract(epoch from (coalesce(j.work_started_at, min(ll.started_at), min(tc.clocked_in_at)) - coalesce(j.opened_at, j.created_at))) / 86400.0, 2) as days_to_start,
  round(extract(epoch from (coalesce(j.work_completed_at, max(ll.ended_at), max(tc.clocked_out_at), j.closed_at) - coalesce(j.work_started_at, min(ll.started_at), min(tc.clocked_in_at)))) / 86400.0, 2) as labor_cycle_days,
  round(extract(epoch from (j.ready_to_bill_at - coalesce(j.work_completed_at, max(ll.ended_at), max(tc.clocked_out_at), j.closed_at))) / 86400.0, 2) as days_complete_to_ready_bill,
  round(extract(epoch from (coalesce(j.billed_at, min(ci.invoice_date)::timestamptz) - j.ready_to_bill_at)) / 86400.0, 2) as days_ready_bill_to_billed
from public.service_jobs j
left join public.service_labor_ledger ll
  on ll.service_job_id = j.id
 and ll.deleted_at is null
left join public.service_timecards tc
  on tc.service_job_id = j.id
left join public.customer_invoices ci
  on ci.service_job_id = j.id
 and ci.status <> 'void'
where j.deleted_at is null
group by
  j.workspace_id,
  j.id,
  j.wo_number,
  j.customer_id,
  j.branch_id,
  j.current_stage,
  j.billed_status,
  j.opened_at,
  j.created_at,
  j.promised_at,
  j.approved_at,
  j.work_started_at,
  j.work_completed_at,
  j.ready_to_bill_at,
  j.billed_at,
  j.closed_at;

comment on view public.v_deal_genome_service_days_analysis is
  'Phase 5 Deal Genome Days Analysis view. Computes work-order cycle milestones from additive milestone columns with safe labor/timecard/invoice fallbacks.';

create or replace view public.v_deal_genome_service_efficiency_analysis
  with (security_invoker = true) as
with ledger as (
  select
    service_job_id,
    service_job_segment_id,
    technician_id,
    employee_id,
    sum(actual_hours)::numeric as actual_hours,
    sum(billable_hours)::numeric as billable_hours,
    sum(standard_hours)::numeric as ledger_standard_hours,
    sum(labor_sale_cents)::bigint as labor_sale_cents,
    sum(labor_cost_cents)::bigint as labor_cost_cents
  from public.service_labor_ledger
  where deleted_at is null
  group by service_job_id, service_job_segment_id, technician_id, employee_id
), timecards as (
  select
    service_job_id,
    segment_id as service_job_segment_id,
    technician_id,
    sum(hours)::numeric as timecard_hours
  from public.service_timecards
  group by service_job_id, segment_id, technician_id
)
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  s.id as service_job_segment_id,
  s.segment_number,
  coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id) as technician_id,
  l.employee_id,
  coalesce(s.revenue_type, j.revenue_type) as revenue_type,
  coalesce(s.billing_basis, j.billing_basis) as billing_basis,
  coalesce(s.estimated_hours, j.standard_hours, 0)::numeric as estimated_hours,
  coalesce(s.standard_hours, l.ledger_standard_hours, j.standard_hours, s.estimated_hours, 0)::numeric as standard_hours,
  coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0)::numeric as actual_hours,
  coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric as billable_hours,
  case
    when coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0) = 0 then null::numeric
    else round((coalesce(s.standard_hours, l.ledger_standard_hours, j.standard_hours, s.estimated_hours, 0)::numeric / nullif(coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0), 0)::numeric) * 100, 2)
  end as efficiency_pct,
  case
    when coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0) = 0 then null::numeric
    else round((coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric / nullif(coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0), 0)::numeric) * 100, 2)
  end as recovery_pct,
  coalesce(l.labor_sale_cents, 0)::bigint as labor_sale_cents,
  coalesce(l.labor_cost_cents, 0)::bigint as labor_cost_cents
from public.service_jobs j
left join public.service_job_segments s
  on s.service_job_id = j.id
 and s.deleted_at is null
left join ledger l
  on l.service_job_id = j.id
 and (
   l.service_job_segment_id = s.id
   or (l.service_job_segment_id is null and s.id is null)
 )
left join timecards tc
  on tc.service_job_id = j.id
 and (
   tc.service_job_segment_id = s.id
   or (tc.service_job_segment_id is null and s.id is null)
 )
where j.deleted_at is null;

comment on view public.v_deal_genome_service_efficiency_analysis is
  'Phase 5 Deal Genome Efficiency Analysis view. Compares estimated/standard/billable hours to actual labor using service_job_segments, service_labor_ledger, and service_timecards.';

create or replace view public.v_deal_genome_service_quote_gain_loss
  with (security_invoker = true) as
with approvals as (
  select
    quote_id,
    min(approved_at) as first_approved_at
  from public.service_quote_approvals
  group by quote_id
), invoice_revenue as (
  select
    service_job_id,
    sum(round(total * 100))::bigint as invoice_total_cents
  from public.customer_invoices
  where service_job_id is not null
    and status <> 'void'
  group by service_job_id
)
select
  sq.workspace_id,
  sq.id as service_quote_id,
  sq.quote_number,
  sq.job_id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  sq.assigned_salesperson_id,
  sq.status,
  case
    when sq.status = 'approved' then 'won'
    when sq.status in ('rejected', 'expired', 'superseded') then 'lost'
    else 'open'
  end as quote_outcome,
  sq.quote_result_reason,
  sq.sent_at,
  sq.expires_at,
  coalesce(sq.outcome_at, approvals.first_approved_at) as outcome_at,
  round(sq.labor_total * 100)::bigint as quoted_labor_cents,
  round(sq.parts_total * 100)::bigint as quoted_parts_cents,
  round((sq.haul_total + sq.shop_supplies) * 100)::bigint as quoted_other_cents,
  round(sq.total * 100)::bigint as quoted_total_cents,
  coalesce(ir.invoice_total_cents, round(coalesce(j.invoice_total, 0) * 100), 0)::bigint as converted_invoice_total_cents,
  case
    when sq.status = 'approved' and sq.total > 0 then
      round((coalesce(ir.invoice_total_cents, round(coalesce(j.invoice_total, 0) * 100), 0)::numeric / nullif(round(sq.total * 100), 0)::numeric) * 100, 2)
    else null::numeric
  end as quote_to_invoice_pct
from public.service_quotes sq
left join public.service_jobs j on j.id = sq.job_id
left join approvals on approvals.quote_id = sq.id
left join invoice_revenue ir on ir.service_job_id = sq.job_id;

comment on view public.v_deal_genome_service_quote_gain_loss is
  'Phase 5 Deal Genome Quote Gain/Loss view for service quotes. Classifies approved quotes as won, rejected/expired/superseded as lost, and compares quote to invoice revenue.';

create or replace view public.v_deal_genome_service_wip_aging
  with (security_invoker = true) as
with ledger_wip as (
  select
    service_job_id,
    sum(labor_sale_cents) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold'))::bigint as unbilled_labor_cents,
    min(coalesce(started_at, labor_date::timestamptz, created_at)) as first_labor_wip_at,
    max(updated_at) as last_labor_wip_at
  from public.service_labor_ledger
  where deleted_at is null
  group by service_job_id
), billing_wip as (
  select
    service_job_id,
    sum(extended_price_cents) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold'))::bigint as unbilled_billing_cents,
    min(created_at) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold')) as first_billing_wip_at,
    max(updated_at) filter (where billed_status in ('unbilled', 'ready_to_bill', 'billing_hold')) as last_billing_wip_at
  from public.service_billing_rows
  where deleted_at is null
  group by service_job_id
)
select
  j.workspace_id,
  j.id as service_job_id,
  j.wo_number,
  j.customer_id as company_id,
  j.branch_id,
  j.current_stage,
  j.billed_status,
  coalesce(lw.unbilled_labor_cents, 0)::bigint as ledger_unbilled_labor_cents,
  coalesce(bw.unbilled_billing_cents, 0)::bigint as ledger_unbilled_parts_other_cents,
  coalesce(mv.labor_wip_cents, 0)::bigint as wave4_labor_wip_cents,
  coalesce(mv.parts_wip_cents, 0)::bigint as wave4_parts_wip_cents,
  greatest(
    coalesce(lw.unbilled_labor_cents, 0) + coalesce(bw.unbilled_billing_cents, 0),
    coalesce(mv.wip_value_cents, 0)
  )::bigint as analysis_wip_cents,
  coalesce(
    least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at),
    lw.first_labor_wip_at,
    bw.first_billing_wip_at,
    mv.earliest_activity_at,
    j.opened_at,
    j.created_at
  ) as wip_started_at,
  coalesce(
    greatest(lw.last_labor_wip_at, bw.last_billing_wip_at, mv.last_activity_at, j.updated_at),
    j.updated_at
  ) as last_wip_activity_at,
  current_date - coalesce(
    least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at),
    lw.first_labor_wip_at,
    bw.first_billing_wip_at,
    mv.earliest_activity_at,
    j.opened_at,
    j.created_at
  )::date as wip_age_days,
  case
    when current_date - coalesce(least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at), j.created_at)::date <= 30 then 'current'
    when current_date - coalesce(least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at), j.created_at)::date <= 60 then '31_60'
    when current_date - coalesce(least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at), j.created_at)::date <= 90 then '61_90'
    when current_date - coalesce(least(lw.first_labor_wip_at, bw.first_billing_wip_at, mv.earliest_activity_at), j.created_at)::date <= 120 then '91_120'
    else 'over_120'
  end as wip_age_bucket
from public.service_jobs j
left join ledger_wip lw on lw.service_job_id = j.id
left join billing_wip bw on bw.service_job_id = j.id
left join public.mv_service_jobs_wip mv on mv.id = j.id
where j.deleted_at is null
  and j.closed_at is null;

comment on view public.v_deal_genome_service_wip_aging is
  'Phase 5 Deal Genome WIP Aging view. Uses new unbilled labor/billing ledgers and falls back to existing Wave 4 mv_service_jobs_wip without double-counting.';

create or replace view public.v_deal_genome_credit_limit_analysis
  with (security_invoker = true) as
with open_items as (
  select
    workspace_id,
    company_id,
    sum(balance_cents)::bigint as ar_open_item_cents,
    max(days_outstanding)::integer as max_days_outstanding
  from public.qrm_ar_open_items
  where deleted_at is null
    and status in ('open', 'partial', 'disputed', 'promised')
    and balance_cents > 0
  group by workspace_id, company_id
)
select
  c.workspace_id,
  c.id as company_id,
  c.name,
  c.credit_limit_cents,
  coalesce(vac.total_ar_cents, oi.ar_open_item_cents, c.total_ar_cents, round(coalesce(c.current_ar_balance, 0) * 100), 0)::bigint as current_ar_cents,
  vac.open_commit_cents,
  vac.available_credit_cents,
  case
    when c.credit_limit_cents is null or c.credit_limit_cents = 0 then null::numeric
    else round((coalesce(vac.total_ar_cents, oi.ar_open_item_cents, c.total_ar_cents, round(coalesce(c.current_ar_balance, 0) * 100), 0)::numeric / c.credit_limit_cents::numeric) * 100, 2)
  end as pct_credit_used,
  case
    when c.credit_limit_cents is null then false
    else coalesce(vac.total_ar_cents, oi.ar_open_item_cents, c.total_ar_cents, round(coalesce(c.current_ar_balance, 0) * 100), 0)::bigint > c.credit_limit_cents
  end as is_over_credit_limit,
  c.credit_hold,
  c.credit_hold_reason,
  c.credit_hold_set_at,
  c.credit_hold_expires_at,
  c.credit_rating,
  c.payment_terms_id,
  c.payment_terms_code,
  c.terms_code,
  oi.max_days_outstanding,
  c.credit_limit_review_at
from public.qrm_companies c
left join public.v_customer_available_credit vac
  on vac.workspace_id = c.workspace_id
 and vac.company_id = c.id
left join open_items oi
  on oi.workspace_id = c.workspace_id
 and oi.company_id = c.id
where c.deleted_at is null;

comment on view public.v_deal_genome_credit_limit_analysis is
  'Phase 5 Credit Limit Analysis view built only from qrm_companies Wave 2 AR/credit fields, qrm_ar_open_items, and existing v_customer_available_credit; no fake AR module is introduced.';
