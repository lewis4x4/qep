-- ============================================================================
-- Migration 639: H8 comeback & warranty backend
--
-- Adds comeback linkage/fault attribution/no-rebill controls, warranty claim
-- lifecycle tables, per-line payer routing, machine warranty registration via
-- equipment_warranty_terms, and technician comeback-rate views.
-- Additive/backward-compatible: existing jobs
-- keep customer-pay behavior via nullable payer columns and NOT VALID checks.
-- ============================================================================

-- ── Comeback linkage and machine warranty registration -----------------------

alter table public.service_jobs
  add column if not exists original_service_job_id uuid references public.service_jobs(id) on delete set null,
  add column if not exists comeback_fault_attribution text,
  add column if not exists comeback_responsible_technician_id uuid references public.profiles(id) on delete set null,
  add column if not exists comeback_responsible_segment_id uuid references public.service_job_segments(id) on delete set null,
  add column if not exists comeback_no_rebill boolean not null default false,
  add column if not exists comeback_attributed_by uuid references public.profiles(id) on delete set null,
  add column if not exists comeback_attributed_at timestamptz,
  add column if not exists comeback_notes text;

comment on column public.service_jobs.original_service_job_id is
  'H8 comeback link to the original work order that caused this comeback/rework job.';
comment on column public.service_jobs.comeback_fault_attribution is
  'H8 comeback fault: qep_fault, customer_fault, oem_fault, vendor_fault, parts_defect, other, or unknown.';
comment on column public.service_jobs.comeback_responsible_technician_id is
  'H8 technician charged for QEP-fault comeback efficiency/comeback-rate reporting.';
comment on column public.service_jobs.comeback_no_rebill is
  'H8 no-rebill flag. True means QEP absorbs parts/labor and customer invoice generation excludes these lines.';

-- Machine warranty registration/coverage belongs in the existing
-- equipment_warranty_terms model (migration 409), keyed to qrm_equipment.
-- crm_equipment is a compatibility view, so H8 exposes the latest term there
-- instead of storing duplicate warranty columns on the view/base equipment row.
alter table public.equipment_warranty_terms
  add column if not exists coverage_terms text,
  add column if not exists coverage_notes jsonb not null default '{}'::jsonb,
  add column if not exists registered_at timestamptz,
  add column if not exists registered_by uuid references public.profiles(id) on delete set null;

comment on column public.equipment_warranty_terms.contract_number is
  'OEM/dealer warranty registration or policy number for this machine.';
comment on column public.equipment_warranty_terms.coverage_terms is
  'H8 free-text coverage terms surfaced during service intake.';
comment on column public.equipment_warranty_terms.coverage_notes is
  'H8 structured warranty coverage notes/limits for advisor intake context.';
comment on column public.equipment_warranty_terms.registered_at is
  'H8 timestamp when warranty registration/coverage was recorded.';
comment on column public.equipment_warranty_terms.registered_by is
  'H8 user who recorded warranty registration/coverage.';

create index if not exists idx_equipment_warranty_terms_h8_coverage
  on public.equipment_warranty_terms(workspace_id, equipment_id, end_date)
  where deleted_at is null;
comment on index public.idx_equipment_warranty_terms_h8_coverage is
  'Supports H8 service intake warranty-status lookups by machine.';

-- Existing service/intake users need read access to warranty coverage surfaced
-- through the security_invoker crm_equipment view.
drop policy if exists "equipment_warranty_terms_h8_service_intake_select" on public.equipment_warranty_terms;
create policy "equipment_warranty_terms_h8_service_intake_select"
  on public.equipment_warranty_terms for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin', 'parts_counter', 'dispatch', 'technician')
  );

-- Recreate crm_equipment with H8 warranty columns appended at the end. Existing
-- columns stay in the same order to preserve dependent view compatibility.
create or replace view public.crm_equipment
  with (security_invoker = true)
  as
  select
    e.id,
    e.workspace_id,
    e.company_id,
    e.primary_contact_id,
    e.name,
    e.asset_tag,
    e.serial_number,
    e.metadata,
    e.created_at,
    e.updated_at,
    e.deleted_at,
    e.make,
    e.model,
    e.year,
    e.category,
    e.vin_pin,
    e.condition,
    e.availability,
    e.ownership,
    e.engine_hours,
    e.mileage,
    e.fuel_type,
    e.weight_class,
    e.operating_capacity,
    e.location_description,
    e.latitude,
    e.longitude,
    e.purchase_price,
    e.current_market_value,
    e.replacement_cost,
    e.daily_rental_rate,
    e.weekly_rental_rate,
    e.monthly_rental_rate,
    e.warranty_expires_on,
    e.last_inspection_at,
    e.next_service_due_at,
    e.notes,
    e.photo_urls,
    e.intake_stage,
    e.readiness_status,
    e.readiness_blocker_reason,
    e.sale_ready_at,
    e.aging_bucket,
    e.purchased_from_qep,
    e.purchase_date,
    (wt.id is not null) as warranty_registered,
    wt.contract_number as warranty_registration_number,
    wt.provider as warranty_provider,
    wt.start_date as warranty_start_date,
    wt.end_date as warranty_end_date,
    coalesce(
      wt.coverage_terms,
      nullif(concat_ws(
        ' ',
        wt.warranty_type,
        case when wt.max_hours is not null then wt.max_hours::text || ' hours' end,
        case when wt.max_months is not null then wt.max_months::text || ' months' end
      ), '')
    ) as warranty_coverage_terms,
    coalesce(wt.coverage_notes, '{}'::jsonb) as warranty_coverage_notes,
    wt.registered_at as warranty_registered_at,
    wt.registered_by as warranty_registered_by
  from public.qrm_equipment e
  left join lateral (
    select terms.*
    from public.equipment_warranty_terms terms
    where terms.workspace_id = e.workspace_id
      and terms.equipment_id = e.id
      and terms.deleted_at is null
    order by
      case when terms.end_date is null or terms.end_date >= current_date then 0 else 1 end,
      terms.start_date desc,
      terms.updated_at desc
    limit 1
  ) wt on true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h8_comeback_fault_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h8_comeback_fault_chk
      check (
        comeback_fault_attribution is null
        or comeback_fault_attribution in ('qep_fault', 'customer_fault', 'oem_fault', 'vendor_fault', 'parts_defect', 'other', 'unknown')
      ) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h8_comeback_original_not_self_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h8_comeback_original_not_self_chk
      check (original_service_job_id is null or original_service_job_id <> id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_jobs_h8_qep_fault_requires_responsible_tech_chk') then
    alter table public.service_jobs
      add constraint service_jobs_h8_qep_fault_requires_responsible_tech_chk
      check (comeback_fault_attribution is distinct from 'qep_fault' or comeback_responsible_technician_id is not null) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'equipment_warranty_terms_h8_dates_chk') then
    alter table public.equipment_warranty_terms
      add constraint equipment_warranty_terms_h8_dates_chk
      check (end_date is null or end_date >= start_date) not valid;
  end if;
end $$;

create index if not exists idx_service_jobs_h8_original_comeback
  on public.service_jobs(workspace_id, original_service_job_id, comeback_fault_attribution)
  where original_service_job_id is not null and deleted_at is null;
comment on index public.idx_service_jobs_h8_original_comeback is
  'Supports H8 lookup of comeback/rework jobs linked to their original work order.';

create index if not exists idx_service_jobs_h8_responsible_tech
  on public.service_jobs(workspace_id, comeback_responsible_technician_id, created_at)
  where comeback_responsible_technician_id is not null and deleted_at is null;
comment on index public.idx_service_jobs_h8_responsible_tech is
  'Supports H8 per-technician comeback-rate and efficiency attribution.';

-- ── Warranty claims and auditable lifecycle ----------------------------------

create table if not exists public.service_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  machine_id uuid references public.qrm_equipment(id) on delete set null,
  customer_id uuid references public.qrm_companies(id) on delete set null,
  original_service_job_id uuid references public.service_jobs(id) on delete set null,
  claim_number text,
  oem_name text,
  oem_reference text,
  status text not null default 'draft',
  complaint text,
  cause text,
  correction text,
  requested_amount_cents bigint not null default 0 check (requested_amount_cents >= 0),
  approved_amount_cents bigint check (approved_amount_cents is null or approved_amount_cents >= 0),
  paid_amount_cents bigint check (paid_amount_cents is null or paid_amount_cents >= 0),
  denied_reason text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  oem_evaluation_started_at timestamptz,
  approved_at timestamptz,
  denied_at timestamptz,
  paid_at timestamptz,
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.service_warranty_claims is
  'H8 warranty claim header assembled from one service job, tracked through OEM submission/evaluation/payment/denial.';
comment on column public.service_warranty_claims.status is
  'H8 warranty lifecycle: draft, submitted, oem_evaluation, approved, paid, denied, cancelled.';
comment on column public.service_warranty_claims.complaint is
  'H8 claim Three-C complaint snapshot from the service job.';
comment on column public.service_warranty_claims.cause is
  'H8 claim Three-C cause snapshot from the service job.';
comment on column public.service_warranty_claims.correction is
  'H8 claim Three-C correction snapshot from the service job.';

create table if not exists public.service_warranty_claim_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  warranty_claim_id uuid not null references public.service_warranty_claims(id) on delete cascade,
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  service_job_segment_id uuid references public.service_job_segments(id) on delete set null,
  service_quote_line_id uuid references public.service_quote_lines(id) on delete set null,
  service_labor_ledger_id uuid references public.service_labor_ledger(id) on delete set null,
  service_billing_row_id uuid references public.service_billing_rows(id) on delete set null,
  source_table text not null,
  source_id uuid not null,
  line_type text not null,
  description text,
  quantity numeric(12, 2) not null default 1 check (quantity >= 0),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  payer_type text not null default 'warranty_claim',
  included boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  assembled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_warranty_claim_lines is
  'H8 auditable warranty-claim source-line snapshots from quote lines, labor ledger rows, billing rows, and H5 warranty-parts turn-in segments.';
comment on column public.service_warranty_claim_lines.source_table is
  'H8 source table name for the claim line snapshot: service_quote_lines, service_labor_ledger, service_billing_rows, or service_job_segments.';
comment on column public.service_warranty_claim_lines.included is
  'True when this source line is included in the latest claim assembly snapshot; false when superseded by a later assembly.';

create table if not exists public.service_warranty_claim_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  warranty_claim_id uuid not null references public.service_warranty_claims(id) on delete cascade,
  service_job_id uuid references public.service_jobs(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id) on delete set null default auth.uid(),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.service_warranty_claim_events is
  'H8 immutable audit trail for warranty claim assembly and OEM lifecycle status changes.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_warranty_claims_h8_status_chk') then
    alter table public.service_warranty_claims
      add constraint service_warranty_claims_h8_status_chk
      check (status in ('draft', 'submitted', 'oem_evaluation', 'approved', 'paid', 'denied', 'cancelled')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_warranty_claims_h8_closed_status_chk') then
    alter table public.service_warranty_claims
      add constraint service_warranty_claims_h8_closed_status_chk
      check (closed_at is null or status in ('paid', 'denied', 'cancelled')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_warranty_claim_lines_h8_payer_chk') then
    alter table public.service_warranty_claim_lines
      add constraint service_warranty_claim_lines_h8_payer_chk
      check (payer_type = 'warranty_claim') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_warranty_claim_lines_h8_source_chk') then
    alter table public.service_warranty_claim_lines
      add constraint service_warranty_claim_lines_h8_source_chk
      check (source_table in ('service_quote_lines', 'service_labor_ledger', 'service_billing_rows', 'service_job_segments')) not valid;
  end if;
end $$;

create unique index if not exists uq_service_warranty_claims_active_job
  on public.service_warranty_claims(workspace_id, service_job_id)
  where deleted_at is null and status <> 'cancelled';
comment on index public.uq_service_warranty_claims_active_job is
  'One active H8 warranty claim lifecycle per service job; cancelled claims do not block a replacement.';

create unique index if not exists uq_service_warranty_claim_lines_source
  on public.service_warranty_claim_lines(warranty_claim_id, source_table, source_id);
comment on index public.uq_service_warranty_claim_lines_source is
  'Idempotent H8 warranty claim assembly by source row.';

create index if not exists idx_service_warranty_claims_status
  on public.service_warranty_claims(workspace_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_service_warranty_claim_lines_claim_included
  on public.service_warranty_claim_lines(workspace_id, warranty_claim_id, included);

create index if not exists idx_service_warranty_claim_events_claim
  on public.service_warranty_claim_events(workspace_id, warranty_claim_id, created_at desc);

-- ── Per-line payer routing ---------------------------------------------------

alter table public.service_quote_lines
  add column if not exists payer_type text,
  add column if not exists warranty_claim_id uuid references public.service_warranty_claims(id) on delete set null,
  add column if not exists payer_notes text;

alter table public.service_labor_ledger
  add column if not exists payer_type text,
  add column if not exists warranty_claim_id uuid references public.service_warranty_claims(id) on delete set null,
  add column if not exists payer_notes text;

alter table public.service_billing_rows
  add column if not exists payer_type text,
  add column if not exists warranty_claim_id uuid references public.service_warranty_claims(id) on delete set null,
  add column if not exists payer_notes text;

comment on column public.service_quote_lines.payer_type is
  'H8 per-line payer: customer, warranty_claim, qep_internal, oem_policy, goodwill, or other. Null legacy lines behave as customer-pay.';
comment on column public.service_labor_ledger.payer_type is
  'H8 per-labor-row payer. QEP-fault comeback rows are qep_internal; warranty labor is warranty_claim.';
comment on column public.service_billing_rows.payer_type is
  'H8 per-parts/other-row payer. Warranty rows feed service_warranty_claim_lines; customer rows feed invoices.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_quote_lines_h8_payer_type_chk') then
    alter table public.service_quote_lines
      add constraint service_quote_lines_h8_payer_type_chk
      check (payer_type is null or payer_type in ('customer', 'warranty_claim', 'qep_internal', 'oem_policy', 'goodwill', 'other')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_labor_ledger_h8_payer_type_chk') then
    alter table public.service_labor_ledger
      add constraint service_labor_ledger_h8_payer_type_chk
      check (payer_type is null or payer_type in ('customer', 'warranty_claim', 'qep_internal', 'oem_policy', 'goodwill', 'other')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'service_billing_rows_h8_payer_type_chk') then
    alter table public.service_billing_rows
      add constraint service_billing_rows_h8_payer_type_chk
      check (payer_type is null or payer_type in ('customer', 'warranty_claim', 'qep_internal', 'oem_policy', 'goodwill', 'other')) not valid;
  end if;
end $$;

create index if not exists idx_service_quote_lines_h8_payer
  on public.service_quote_lines(workspace_id, payer_type, warranty_claim_id)
  where payer_type is not null;
create index if not exists idx_service_labor_ledger_h8_payer
  on public.service_labor_ledger(workspace_id, payer_type, warranty_claim_id)
  where deleted_at is null and payer_type is not null;
create index if not exists idx_service_billing_rows_h8_payer
  on public.service_billing_rows(workspace_id, payer_type, warranty_claim_id)
  where deleted_at is null and payer_type is not null;

-- ── RLS ----------------------------------------------------------------------

alter table public.service_warranty_claims enable row level security;
alter table public.service_warranty_claim_lines enable row level security;
alter table public.service_warranty_claim_events enable row level security;

drop policy if exists "service_warranty_claims_service_all" on public.service_warranty_claims;
drop policy if exists "service_warranty_claims_staff_all" on public.service_warranty_claims;
drop policy if exists "service_warranty_claims_technician_select" on public.service_warranty_claims;
drop policy if exists "service_warranty_claims_parts_select" on public.service_warranty_claims;

create policy "service_warranty_claims_service_all"
  on public.service_warranty_claims for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_warranty_claims_staff_all"
  on public.service_warranty_claims for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin')
  );

create policy "service_warranty_claims_technician_select"
  on public.service_warranty_claims for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') = 'technician'
    and exists (
      select 1 from public.service_jobs j
      where j.id = service_warranty_claims.service_job_id
        and j.workspace_id = (select public.get_my_workspace())
        and (j.technician_id = (select auth.uid()) or j.comeback_responsible_technician_id = (select auth.uid()))
    )
  );

create policy "service_warranty_claims_parts_select"
  on public.service_warranty_claims for select
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('parts_counter', 'dispatch')
  );

-- Claim lines inherit claim access.
drop policy if exists "service_warranty_claim_lines_service_all" on public.service_warranty_claim_lines;
drop policy if exists "service_warranty_claim_lines_staff_all" on public.service_warranty_claim_lines;
drop policy if exists "service_warranty_claim_lines_select" on public.service_warranty_claim_lines;
drop policy if exists "service_warranty_claim_lines_claim_access" on public.service_warranty_claim_lines;

create policy "service_warranty_claim_lines_service_all"
  on public.service_warranty_claim_lines for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_warranty_claim_lines_staff_all"
  on public.service_warranty_claim_lines for all
  using (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin')
  );

create policy "service_warranty_claim_lines_select"
  on public.service_warranty_claim_lines for select
  using (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1 from public.service_warranty_claims c
      where c.id = service_warranty_claim_lines.warranty_claim_id
        and c.workspace_id = (select public.get_my_workspace())
        and (
          coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin', 'parts_counter', 'dispatch')
          or (
            coalesce((select public.get_my_role())::text, '') = 'technician'
            and exists (
              select 1 from public.service_jobs j
              where j.id = c.service_job_id
                and j.workspace_id = (select public.get_my_workspace())
                and (j.technician_id = (select auth.uid()) or j.comeback_responsible_technician_id = (select auth.uid()))
            )
          )
        )
    )
  );

-- Claim events are append-only for staff; readable with claim access.
drop policy if exists "service_warranty_claim_events_service_all" on public.service_warranty_claim_events;
drop policy if exists "service_warranty_claim_events_select" on public.service_warranty_claim_events;
drop policy if exists "service_warranty_claim_events_insert_staff" on public.service_warranty_claim_events;

create policy "service_warranty_claim_events_service_all"
  on public.service_warranty_claim_events for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "service_warranty_claim_events_select"
  on public.service_warranty_claim_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and exists (
      select 1 from public.service_warranty_claims c
      where c.id = service_warranty_claim_events.warranty_claim_id
        and c.workspace_id = (select public.get_my_workspace())
        and (
          coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin', 'parts_counter', 'dispatch')
          or (
            coalesce((select public.get_my_role())::text, '') = 'technician'
            and exists (
              select 1 from public.service_jobs j
              where j.id = c.service_job_id
                and j.workspace_id = (select public.get_my_workspace())
                and (j.technician_id = (select auth.uid()) or j.comeback_responsible_technician_id = (select auth.uid()))
            )
          )
        )
    )
  );

create policy "service_warranty_claim_events_insert_staff"
  on public.service_warranty_claim_events for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'service_writer', 'finance_admin')
  );

drop trigger if exists set_service_warranty_claims_updated_at on public.service_warranty_claims;
create trigger set_service_warranty_claims_updated_at
  before update on public.service_warranty_claims
  for each row execute function public.set_updated_at();

drop trigger if exists set_service_warranty_claim_lines_updated_at on public.service_warranty_claim_lines;
create trigger set_service_warranty_claim_lines_updated_at
  before update on public.service_warranty_claim_lines
  for each row execute function public.set_updated_at();

-- ── H8 reporting views -------------------------------------------------------

create or replace view public.v_service_comeback_technician_rates
  with (security_invoker = true) as
with scoped_jobs as (
  select j.*
  from public.service_jobs j
  where j.deleted_at is null
    and public.service_can_view_metrics()
    and (
      (select auth.role()) = 'service_role'
      or j.workspace_id = (select public.get_my_workspace())
    )
), base_jobs as (
  select
    workspace_id,
    technician_id,
    request_type::text as request_type,
    created_at
  from scoped_jobs
  where created_at >= now() - interval '90 days'
    and technician_id is not null
    and request_type::text <> 'comeback_rework'
), comeback_jobs as (
  select
    c.workspace_id,
    coalesce(c.comeback_responsible_technician_id, c.technician_id) as technician_id,
    coalesce(o.request_type::text, 'unknown_original') as request_type,
    c.comeback_fault_attribution,
    c.created_at
  from scoped_jobs c
  left join scoped_jobs o on o.id = c.original_service_job_id
  where c.request_type::text = 'comeback_rework'
    and c.created_at >= now() - interval '90 days'
    and coalesce(c.comeback_responsible_technician_id, c.technician_id) is not null
), base_counts as (
  select
    workspace_id,
    technician_id,
    request_type,
    count(*)::integer as total_jobs_90d
  from base_jobs
  group by workspace_id, technician_id, request_type
), comeback_counts as (
  select
    workspace_id,
    technician_id,
    request_type,
    count(*)::integer as comeback_jobs_90d,
    count(*) filter (where comeback_fault_attribution = 'qep_fault')::integer as qep_fault_comeback_jobs_90d,
    max(created_at) as latest_comeback_at
  from comeback_jobs
  group by workspace_id, technician_id, request_type
)
select
  coalesce(b.workspace_id, c.workspace_id) as workspace_id,
  coalesce(b.technician_id, c.technician_id) as technician_id,
  coalesce(b.request_type, c.request_type) as request_type,
  coalesce(b.total_jobs_90d, 0) as total_jobs_90d,
  coalesce(c.comeback_jobs_90d, 0) as comeback_jobs_90d,
  coalesce(c.qep_fault_comeback_jobs_90d, 0) as qep_fault_comeback_jobs_90d,
  round((coalesce(c.comeback_jobs_90d, 0)::numeric / nullif(coalesce(b.total_jobs_90d, 0), 0)) * 100, 2) as comeback_rate_pct,
  round((coalesce(c.qep_fault_comeback_jobs_90d, 0)::numeric / nullif(coalesce(b.total_jobs_90d, 0), 0)) * 100, 2) as qep_fault_comeback_rate_pct,
  c.latest_comeback_at
from base_counts b
full join comeback_counts c
  on c.workspace_id = b.workspace_id
 and c.technician_id = b.technician_id
 and c.request_type = b.request_type;

comment on view public.v_service_comeback_technician_rates is
  'H8 per-technician/per-original-request-type comeback rate. QEP-fault rows use comeback_responsible_technician_id for accountability and exclude comeback work orders from the base-job denominator.';

grant select on public.v_service_comeback_technician_rates to authenticated, service_role;

create or replace view public.v_service_warranty_claim_lifecycle
  with (security_invoker = true) as
select
  c.workspace_id,
  c.id as warranty_claim_id,
  c.service_job_id,
  j.wo_number,
  j.request_type::text as request_type,
  c.machine_id,
  c.customer_id,
  c.claim_number,
  c.oem_name,
  c.oem_reference,
  c.status,
  c.requested_amount_cents,
  c.approved_amount_cents,
  c.paid_amount_cents,
  c.submitted_at,
  c.oem_evaluation_started_at,
  c.approved_at,
  c.denied_at,
  c.paid_at,
  c.closed_at,
  count(l.id) filter (where l.included)::integer as included_line_count,
  coalesce(sum(l.amount_cents) filter (where l.included), 0)::bigint as included_amount_cents,
  coalesce(sum(l.cost_cents) filter (where l.included), 0)::bigint as included_cost_cents,
  max(e.created_at) as latest_event_at,
  c.updated_at
from public.service_warranty_claims c
join public.service_jobs j
  on j.id = c.service_job_id
 and j.workspace_id = c.workspace_id
left join public.service_warranty_claim_lines l
  on l.warranty_claim_id = c.id
 and l.workspace_id = c.workspace_id
left join public.service_warranty_claim_events e
  on e.warranty_claim_id = c.id
 and e.workspace_id = c.workspace_id
where c.deleted_at is null
  and public.service_can_view_metrics()
  and (
    (select auth.role()) = 'service_role'
    or c.workspace_id = (select public.get_my_workspace())
  )
group by c.workspace_id, c.id, c.service_job_id, j.wo_number, j.request_type, c.machine_id, c.customer_id, c.claim_number, c.oem_name, c.oem_reference, c.status, c.requested_amount_cents, c.approved_amount_cents, c.paid_amount_cents, c.submitted_at, c.oem_evaluation_started_at, c.approved_at, c.denied_at, c.paid_at, c.closed_at, c.updated_at;

comment on view public.v_service_warranty_claim_lifecycle is
  'H8 warranty claim lifecycle/audit rollup for Service/Finance dashboards.';

grant select on public.v_service_warranty_claim_lifecycle to authenticated, service_role;

-- H8 updates the H4 efficiency view so QEP-fault comeback labor is charged to
-- the responsible technician with zero billable/standard hours (absorbed work).
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
    sum(actual_hours) filter (where is_rework = true)::numeric as rework_hours,
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
), job_holds as (
  select
    service_job_id,
    workspace_id,
    sum(hold_duration_hours)::numeric as total_hold_hours
  from public.v_service_job_hold_durations
  group by service_job_id, workspace_id
), row_base as (
  select
    j.workspace_id,
    j.id as service_job_id,
    j.wo_number,
    j.customer_id as company_id,
    j.branch_id,
    s.id as service_job_segment_id,
    s.segment_number,
    case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault'
        then coalesce(j.comeback_responsible_technician_id, l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
      else coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
    end as technician_id,
    l.employee_id,
    coalesce(s.revenue_type, j.revenue_type) as revenue_type,
    coalesce(s.billing_basis, j.billing_basis) as billing_basis,
    coalesce(s.estimated_hours, j.standard_hours, 0)::numeric as estimated_hours,
    case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault' then 0::numeric
      else coalesce(s.standard_hours, l.ledger_standard_hours, j.standard_hours, s.estimated_hours, 0)::numeric
    end as standard_hours,
    coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0)::numeric as actual_hours_before_hold,
    case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault' then 0::numeric
      else coalesce(l.billable_hours, s.quantity, s.estimated_hours, j.standard_hours, 0)::numeric
    end as billable_hours,
    case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault' then 0::bigint
      else coalesce(l.labor_sale_cents, 0)::bigint
    end as labor_sale_cents,
    coalesce(l.labor_cost_cents, 0)::bigint as labor_cost_cents,
    case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault'
        then coalesce(l.actual_hours, tc.timecard_hours, s.hours_actual, 0)::numeric
      else coalesce(l.rework_hours, 0)::numeric
    end as rework_hours,
    tp.inside_outside_shift,
    tp.shop_class,
    emp.shift_code
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
  left join public.technician_profiles tp
    on tp.workspace_id = j.workspace_id
   and tp.user_id = case
      when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault'
        then coalesce(j.comeback_responsible_technician_id, l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
      else coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
    end
  left join lateral (
    select e.shift_code
    from public.employees e
    where e.workspace_id = j.workspace_id
      and e.deleted_at is null
      and (
        e.id = l.employee_id
        or e.profile_id = case
          when j.request_type::text = 'comeback_rework' and j.comeback_fault_attribution = 'qep_fault'
            then coalesce(j.comeback_responsible_technician_id, l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
          else coalesce(l.technician_id, tc.technician_id, s.technician_id, j.technician_id)
        end
      )
    order by case when e.id = l.employee_id then 0 else 1 end
    limit 1
  ) emp on true
  where j.deleted_at is null
), job_actuals as (
  select
    workspace_id,
    service_job_id,
    sum(actual_hours_before_hold)::numeric as job_actual_hours_before_hold
  from row_base
  group by workspace_id, service_job_id
), adjusted as (
  select
    rb.*,
    coalesce(jh.total_hold_hours, 0)::numeric as job_hold_hours,
    case
      when coalesce(ja.job_actual_hours_before_hold, 0) = 0 then 0::numeric
      else round(
        (
          least(coalesce(jh.total_hold_hours, 0), ja.job_actual_hours_before_hold)
          * (rb.actual_hours_before_hold / nullif(ja.job_actual_hours_before_hold, 0))
        )::numeric,
        2
      )
    end as hold_hours_excluded
  from row_base rb
  left join job_actuals ja
    on ja.workspace_id = rb.workspace_id
   and ja.service_job_id = rb.service_job_id
  left join job_holds jh
    on jh.workspace_id = rb.workspace_id
   and jh.service_job_id = rb.service_job_id
)
select
  workspace_id,
  service_job_id,
  wo_number,
  company_id,
  branch_id,
  service_job_segment_id,
  segment_number,
  technician_id,
  employee_id,
  revenue_type,
  billing_basis,
  estimated_hours,
  standard_hours,
  greatest(actual_hours_before_hold - hold_hours_excluded, 0)::numeric as actual_hours,
  billable_hours,
  case
    when greatest(actual_hours_before_hold - hold_hours_excluded, 0) = 0 then null::numeric
    else round((standard_hours / nullif(greatest(actual_hours_before_hold - hold_hours_excluded, 0), 0)) * 100, 2)
  end as efficiency_pct,
  case
    when greatest(actual_hours_before_hold - hold_hours_excluded, 0) = 0 then null::numeric
    else round((billable_hours / nullif(greatest(actual_hours_before_hold - hold_hours_excluded, 0), 0)) * 100, 2)
  end as recovery_pct,
  labor_sale_cents,
  labor_cost_cents,
  rework_hours,
  inside_outside_shift,
  shop_class,
  shift_code,
  actual_hours_before_hold,
  hold_hours_excluded,
  job_hold_hours
from adjusted;

comment on view public.v_deal_genome_service_efficiency_analysis is
  'Phase 5 Deal Genome Efficiency Analysis view. H4 excludes named service hold duration; H8 charges QEP-fault comeback actual/rework hours to comeback_responsible_technician_id with zero billable/standard hours so the responsible technician absorbs the efficiency hit.';
