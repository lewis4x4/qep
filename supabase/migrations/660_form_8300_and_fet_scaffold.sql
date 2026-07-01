-- ============================================================================
-- 660_form_8300_and_fet_scaffold.sql
--
-- Two finance-compliance capabilities for QEP OS equipment/parts sales+rental:
--
-- A) IRS FORM 8300 (cash > $10,000) FLAG
--    Any single cash payment recorded on public.customer_invoices that exceeds
--    the $10,000 reporting threshold is automatically flagged for IRS Form 8300
--    ("Report of Cash Payments Over $10,000 Received in a Trade or Business").
--    The flag is a compliance signal for corporate operations / finance — it
--    captures the cash amount and links back to the invoice so the filing
--    workflow (out of scope here) can pick it up. Idempotent per invoice.
--
-- B) FEDERAL EXCISE TAX (FET) 12% SCAFFOLD (Form 720)
--    FET is a FEDERAL excise tax on the first retail sale of certain heavy
--    vehicles / bodies (grapple trucks, truck bodies, chassis) — distinct from
--    state SALES tax. This migration scaffolds the FET path only:
--      - fet_taxable_categories : which unit categories carry the 12% FET
--      - fet_exemption_certificates : FET-specific exemption docs (SEPARATE from
--        the sales-tax tax_exemption_certificates table in migration 151)
--      - fet_liability_lines : per-invoice FET liability with a generated amount
--      - compute_fet() : pure 12% calculation helper
--    "Scaffold" == schema + calculation + exemption linkage. Filing / IRS Form
--    720 export is intentionally OUT OF SCOPE.
--
-- Conventions: uuid pk, created_at/updated_at defaults, deleted_at where
-- applicable, idempotent seeds, RLS on every user-facing table with helper
-- refs wrapped in (select ...) for init-plan efficiency, security definer
-- functions pinned to search_path public.
-- ============================================================================

BEGIN;

set statement_timeout = 0;

-- ────────────────────────────────────────────────────────────────────────────
-- A) IRS FORM 8300 (cash > $10,000) FLAG
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.form_8300_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  invoice_id uuid references public.customer_invoices(id) on delete set null,
  crm_company_id uuid,
  cash_amount numeric(14,2) not null check (cash_amount >= 0),
  payment_method text,
  threshold_amount numeric(14,2) not null default 10000,
  status text not null default 'flagged' check (status in ('flagged','filed','void','exempt')),
  flagged_at timestamptz not null default now(),
  filed_at timestamptz,
  filed_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.form_8300_reports is
  'IRS Form 8300 flags for cash payments over $10,000 recorded on customer_invoices. Flag only; filing workflow is separate.';

-- One live flag per invoice (idempotent upsert target for the trigger).
create unique index if not exists form_8300_reports_invoice_uidx
  on public.form_8300_reports(invoice_id)
  where invoice_id is not null and deleted_at is null;
create index if not exists form_8300_reports_workspace_status_idx
  on public.form_8300_reports(workspace_id, status);
create index if not exists form_8300_reports_invoice_idx
  on public.form_8300_reports(invoice_id);

-- Core evaluator: given an invoice id, upsert (or return existing) a Form 8300
-- flag when the recorded payment is cash-like AND over the $10,000 threshold.
-- Returns the report id, or null when the invoice is not reportable.
create or replace function public.evaluate_form_8300(p_invoice_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv          public.customer_invoices%rowtype;
  v_report_id    uuid;
  v_threshold    numeric(14,2) := 10000;
  v_is_cash      boolean;
begin
  if p_invoice_id is null then
    return null;
  end if;

  select * into v_inv from public.customer_invoices where id = p_invoice_id;
  if not found then
    return null;
  end if;

  v_is_cash := v_inv.payment_method is not null
    and (
      lower(v_inv.payment_method) in ('cash', 'currency')
      or v_inv.payment_method ilike '%cash%'
    );

  if not v_is_cash or coalesce(v_inv.amount_paid, 0) <= v_threshold then
    return null;
  end if;

  -- Idempotent per invoice: refresh the existing live flag if present.
  select id into v_report_id
  from public.form_8300_reports
  where invoice_id = p_invoice_id and deleted_at is null
  limit 1;

  if v_report_id is not null then
    update public.form_8300_reports
    set cash_amount = v_inv.amount_paid,
        payment_method = v_inv.payment_method,
        crm_company_id = v_inv.crm_company_id,
        updated_at = now()
    where id = v_report_id;
    return v_report_id;
  end if;

  insert into public.form_8300_reports (
    workspace_id,
    invoice_id,
    crm_company_id,
    cash_amount,
    payment_method,
    threshold_amount,
    status
  ) values (
    coalesce(v_inv.workspace_id, public.get_my_workspace()),
    p_invoice_id,
    v_inv.crm_company_id,
    v_inv.amount_paid,
    v_inv.payment_method,
    v_threshold,
    'flagged'
  )
  returning id into v_report_id;

  return v_report_id;
end;
$$;

-- Trigger wrapper: fires AFTER INSERT OR UPDATE on customer_invoices.
create or replace function public.flag_form_8300_if_cash_over_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_cash boolean;
begin
  v_is_cash := NEW.payment_method is not null
    and (
      lower(NEW.payment_method) in ('cash', 'currency')
      or NEW.payment_method ilike '%cash%'
    );

  if v_is_cash and coalesce(NEW.amount_paid, 0) > 10000 then
    perform public.evaluate_form_8300(NEW.id);
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_flag_form_8300_cash on public.customer_invoices;
create trigger trg_flag_form_8300_cash
  after insert or update on public.customer_invoices
  for each row
  execute function public.flag_form_8300_if_cash_over_threshold();

-- ────────────────────────────────────────────────────────────────────────────
-- B) FEDERAL EXCISE TAX (FET) 12% SCAFFOLD (Form 720)
-- ────────────────────────────────────────────────────────────────────────────

-- Which unit categories carry the 12% FET.
create table if not exists public.fet_taxable_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  category_code text not null,
  description text,
  fet_rate numeric(6,4) not null default 0.12,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, category_code)
);

comment on table public.fet_taxable_categories is
  'FET-eligible unit categories (12% federal excise tax, IRS Form 720). Sales-tax exemptions are unrelated.';

-- Idempotent seed for the shared/global workspace.
insert into public.fet_taxable_categories (workspace_id, category_code, description, fet_rate, is_active)
values
  ('global', 'GRAPPLE_TRUCK', 'Grapple truck (complete unit) subject to 12% federal excise tax on first retail sale, IRS Form 720', 0.12, true),
  ('global', 'TRUCK_BODY',    'Truck body subject to 12% federal excise tax on first retail sale, IRS Form 720', 0.12, true),
  ('global', 'CHASSIS',       'Truck chassis subject to 12% federal excise tax on first retail sale, IRS Form 720', 0.12, true)
on conflict (workspace_id, category_code) do update set
  description = excluded.description,
  fet_rate = excluded.fet_rate,
  is_active = excluded.is_active,
  updated_at = now();

-- FET-specific exemption certificates (SEPARATE from sales-tax
-- tax_exemption_certificates in migration 151).
create table if not exists public.fet_exemption_certificates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  crm_company_id uuid,
  certificate_number text,
  exemption_basis text,
  issuing_authority text,
  effective_date date,
  expiration_date date,
  document_url text,
  status text not null default 'pending' check (status in ('pending','verified','expired','revoked')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.fet_exemption_certificates is
  'Federal excise tax (FET) exemption certificates. Distinct from sales-tax exemptions (migration 151).';

create index if not exists fet_exemption_certificates_workspace_idx
  on public.fet_exemption_certificates(workspace_id, status);
create index if not exists fet_exemption_certificates_company_idx
  on public.fet_exemption_certificates(crm_company_id)
  where crm_company_id is not null;

-- Per-invoice FET liability lines with a generated fet_amount.
create table if not exists public.fet_liability_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  invoice_id uuid references public.customer_invoices(id) on delete cascade,
  category_code text,
  taxable_amount numeric(14,2) not null default 0,
  fet_rate numeric(6,4) not null default 0.12,
  fet_amount numeric(14,2) generated always as (round(taxable_amount * fet_rate, 2)) stored,
  exemption_certificate_id uuid references public.fet_exemption_certificates(id),
  is_exempt boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fet_liability_lines is
  'Per-invoice 12% FET liability lines. fet_amount is generated as round(taxable_amount * fet_rate, 2).';

create index if not exists fet_liability_lines_workspace_invoice_idx
  on public.fet_liability_lines(workspace_id, invoice_id);

-- Pure 12% FET calculation helper. Returns 0 when exempt.
create or replace function public.compute_fet(
  p_taxable_amount numeric,
  p_rate numeric default 0.12,
  p_is_exempt boolean default false
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_is_exempt then 0::numeric
    else round(coalesce(p_taxable_amount, 0) * coalesce(p_rate, 0.12), 2)
  end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS (mandatory) on all four new tables
-- ────────────────────────────────────────────────────────────────────────────

-- form_8300_reports: finance-sensitive; writes gated to admin/manager/owner.
alter table public.form_8300_reports enable row level security;

drop policy if exists form_8300_reports_select on public.form_8300_reports;
create policy form_8300_reports_select on public.form_8300_reports
  for select
  using (workspace_id = (select public.get_my_workspace()));

drop policy if exists form_8300_reports_insert on public.form_8300_reports;
create policy form_8300_reports_insert on public.form_8300_reports
  for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists form_8300_reports_update on public.form_8300_reports;
create policy form_8300_reports_update on public.form_8300_reports
  for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists form_8300_reports_service on public.form_8300_reports;
create policy form_8300_reports_service on public.form_8300_reports
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- fet_taxable_categories: workspace read; writes gated to admin/manager/owner.
alter table public.fet_taxable_categories enable row level security;

drop policy if exists fet_taxable_categories_select on public.fet_taxable_categories;
create policy fet_taxable_categories_select on public.fet_taxable_categories
  for select
  using (workspace_id = (select public.get_my_workspace()));

drop policy if exists fet_taxable_categories_insert on public.fet_taxable_categories;
create policy fet_taxable_categories_insert on public.fet_taxable_categories
  for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists fet_taxable_categories_update on public.fet_taxable_categories;
create policy fet_taxable_categories_update on public.fet_taxable_categories
  for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists fet_taxable_categories_service on public.fet_taxable_categories;
create policy fet_taxable_categories_service on public.fet_taxable_categories
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- fet_exemption_certificates: finance-sensitive; writes gated to admin/manager/owner.
alter table public.fet_exemption_certificates enable row level security;

drop policy if exists fet_exemption_certificates_select on public.fet_exemption_certificates;
create policy fet_exemption_certificates_select on public.fet_exemption_certificates
  for select
  using (workspace_id = (select public.get_my_workspace()));

drop policy if exists fet_exemption_certificates_insert on public.fet_exemption_certificates;
create policy fet_exemption_certificates_insert on public.fet_exemption_certificates
  for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists fet_exemption_certificates_update on public.fet_exemption_certificates;
create policy fet_exemption_certificates_update on public.fet_exemption_certificates
  for update
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin','manager','owner')
  );

drop policy if exists fet_exemption_certificates_service on public.fet_exemption_certificates;
create policy fet_exemption_certificates_service on public.fet_exemption_certificates
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- fet_liability_lines: workspace read; workspace-scoped writes.
alter table public.fet_liability_lines enable row level security;

drop policy if exists fet_liability_lines_select on public.fet_liability_lines;
create policy fet_liability_lines_select on public.fet_liability_lines
  for select
  using (workspace_id = (select public.get_my_workspace()));

drop policy if exists fet_liability_lines_insert on public.fet_liability_lines;
create policy fet_liability_lines_insert on public.fet_liability_lines
  for insert
  with check (workspace_id = (select public.get_my_workspace()));

drop policy if exists fet_liability_lines_update on public.fet_liability_lines;
create policy fet_liability_lines_update on public.fet_liability_lines
  for update
  using (workspace_id = (select public.get_my_workspace()))
  with check (workspace_id = (select public.get_my_workspace()));

drop policy if exists fet_liability_lines_service on public.fet_liability_lines;
create policy fet_liability_lines_service on public.fet_liability_lines
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

COMMIT;
