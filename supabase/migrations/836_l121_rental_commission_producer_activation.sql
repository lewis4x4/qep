-- 836_l121_rental_commission_producer_activation.sql
--
-- Activates migration 830 through five reviewed producer boundaries only:
-- canonical payment evidence, approved refund/credit, negotiated conversion
-- approval, approved negative correction, and two-person legacy payroll import.
-- The underlying commission ledger remains append-only and L12.1 remains
-- in_progress until UAT is attached.

begin;

create table if not exists public.rental_rent_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  rental_invoice_id uuid not null references public.rental_invoices(id) on delete restrict,
  rental_contract_id uuid not null references public.rental_contracts(id) on delete restrict,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  source_kind text not null check (source_kind in (
    'credit_memo', 'correction', 'goodwill_refund',
    'cash_refund', 'other_rent_refund'
  )),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  source_reference text not null check (btrim(source_reference) <> ''),
  refunded_rent_cents bigint not null check (refunded_rent_cents > 0),
  corrects_source_event_key text,
  reason text not null check (btrim(reason) <> ''),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint rental_rent_adjustments_correction_evidence_ck check (
    (source_kind = 'correction' and nullif(btrim(coalesce(corrects_source_event_key, '')), '') is not null)
    or
    (source_kind <> 'correction' and corrects_source_event_key is null)
  )
);

comment on table public.rental_rent_adjustments is
  'L12.1 canonical rent-only refund, credit, and negative correction evidence. Each approved row atomically produces migration 830 clawback entries.';

create index if not exists idx_rental_rent_adjustments_invoice
  on public.rental_rent_adjustments (workspace_id, rental_invoice_id, created_at desc);

alter table public.rental_rent_adjustments enable row level security;

create policy rental_rent_adjustments_service_all
  on public.rental_rent_adjustments for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy rental_rent_adjustments_finance_select
  on public.rental_rent_adjustments for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('finance_admin', 'manager', 'admin', 'owner')
  );

revoke all on table public.rental_rent_adjustments from public, anon, authenticated;
grant select on table public.rental_rent_adjustments to authenticated, service_role;

create table if not exists public.rental_legacy_payroll_commission_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id) on delete restrict,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  rental_contract_commission_id uuid not null
    references public.rental_contract_commissions(id) on delete restrict,
  rent_basis_cents bigint not null check (rent_basis_cents > 0),
  commission_cents bigint generated always as (
    round(rent_basis_cents::numeric * 0.050000)::bigint
  ) stored,
  paid_at timestamptz not null,
  payroll_reference text not null check (btrim(payroll_reference) <> ''),
  source_document_reference text not null check (btrim(source_document_reference) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  notes text,
  status text not null default 'staged' check (status in ('staged', 'posted')),
  staged_by uuid not null references public.profiles(id) on delete restrict,
  staged_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  approval_reason text,
  ledger_entry_id uuid references public.rental_unit_commission_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint rental_legacy_payroll_approval_ck check (
    (status = 'staged' and approved_by is null and approved_at is null
      and approval_reason is null and ledger_entry_id is null)
    or
    (status = 'posted' and approved_by is not null and approved_at is not null
      and nullif(btrim(coalesce(approval_reason, '')), '') is not null
      and ledger_entry_id is not null and approved_by <> staged_by)
  )
);

comment on table public.rental_legacy_payroll_commission_imports is
  'L12.1 reviewed historical rental payroll staging. A different finance/admin/owner must approve before one exact 5% legacy ledger row is appended.';

create index if not exists idx_rental_legacy_payroll_pending
  on public.rental_legacy_payroll_commission_imports (workspace_id, staged_at)
  where status = 'staged';

alter table public.rental_legacy_payroll_commission_imports enable row level security;

create policy rental_legacy_payroll_service_all
  on public.rental_legacy_payroll_commission_imports for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy rental_legacy_payroll_finance_select
  on public.rental_legacy_payroll_commission_imports for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('finance_admin', 'manager', 'admin', 'owner')
  );

revoke all on table public.rental_legacy_payroll_commission_imports
  from public, anon, authenticated;
grant select on table public.rental_legacy_payroll_commission_imports
  to authenticated, service_role;

create or replace function public.rental_reject_commission_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'rental commission source evidence is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.rental_reject_commission_source_mutation()
  from public, anon, authenticated, service_role;

create trigger trg_rental_rent_adjustments_reject_update
  before update on public.rental_rent_adjustments
  for each row execute function public.rental_reject_commission_source_mutation();
create trigger trg_rental_rent_adjustments_reject_delete
  before delete on public.rental_rent_adjustments
  for each row execute function public.rental_reject_commission_source_mutation();
create trigger trg_rental_legacy_payroll_reject_delete
  before delete on public.rental_legacy_payroll_commission_imports
  for each row execute function public.rental_reject_commission_source_mutation();

-- A service boundary may accept only evidence already committed by the two
-- canonical payment ledgers. It derives both unit and rent basis; callers do
-- not supply either economic input.
create or replace function public.rental_activate_paid_invoice_commission(
  p_workspace_id text,
  p_rental_invoice_id uuid,
  p_payment_source_kind text,
  p_payment_source_id uuid,
  p_actor_id uuid default null
)
returns setof public.rental_unit_commission_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.rental_invoices%rowtype;
  v_customer public.customer_invoices%rowtype;
  v_contract public.rental_contracts%rowtype;
  v_equipment_id uuid;
  v_equipment_count integer;
  v_paid_at timestamptz;
  v_source_key text;
  v_source_reference text;
  v_payment_actor uuid;
  v_application record;
  v_intent record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_activate_paid_invoice_commission requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_workspace_id, '')), '') is null
     or p_rental_invoice_id is null or p_payment_source_id is null
     or p_payment_source_kind not in ('customer_payment_application', 'stripe_payment_intent') then
    raise exception 'workspace, rental invoice, and canonical payment evidence are required'
      using errcode = '22023';
  end if;

  select * into v_invoice
  from public.rental_invoices i
  where i.id = p_rental_invoice_id
    and i.workspace_id = p_workspace_id
    and i.deleted_at is null
  for update;
  if not found or v_invoice.customer_invoice_id is null then
    raise exception 'mapped rental invoice not found in workspace'
      using errcode = 'P0002';
  end if;
  if v_invoice.status::text in ('void', 'reversed') then
    raise exception 'void or reversed rental invoice cannot activate commission'
      using errcode = '22023';
  end if;
  if v_invoice.rental_charge_cents <= 0 then
    raise exception 'positive canonical rental charge is required'
      using errcode = '22023';
  end if;

  select * into v_customer
  from public.customer_invoices ci
  where ci.id = v_invoice.customer_invoice_id
    and ci.workspace_id = p_workspace_id
    and ci.invoice_type = 'rental'
  for update;
  if not found or v_customer.status <> 'paid'
     or coalesce(v_customer.amount_paid, 0) < coalesce(v_customer.total, 0)
     or v_customer.paid_at is null then
    raise exception 'canonical customer invoice must be fully paid'
      using errcode = '22023';
  end if;

  if p_payment_source_kind = 'customer_payment_application' then
    select
      a.id, a.customer_invoice_id, a.workspace_id,
      p.id as payment_id, p.reference, p.received_at, p.received_by
    into v_application
    from public.customer_payment_applications a
    join public.customer_payments p on p.id = a.customer_payment_id
    where a.id = p_payment_source_id
      and a.workspace_id = p_workspace_id
      and p.workspace_id = p_workspace_id
      and a.customer_invoice_id = v_customer.id;
    if not found then
      raise exception 'customer payment application does not prove this rental invoice payment'
        using errcode = '22023';
    end if;
    v_paid_at := v_customer.paid_at;
    v_payment_actor := coalesce(p_actor_id, v_application.received_by);
    v_source_key := 'rental-payment:ar-application:' || p_payment_source_id::text;
    v_source_reference := 'ar-payment:' || v_application.payment_id::text
      || ':application:' || p_payment_source_id::text;
  else
    select id, stripe_payment_intent_id, succeeded_at
    into v_intent
    from public.portal_payment_intents pi
    where pi.id = p_payment_source_id
      and pi.workspace_id = p_workspace_id
      and pi.invoice_id = v_customer.id
      and pi.status = 'succeeded'
      and pi.webhook_signature_verified = true
      and pi.succeeded_at is not null;
    if not found then
      raise exception 'signature-verified successful Stripe intent does not prove this rental invoice payment'
        using errcode = '22023';
    end if;
    v_paid_at := v_intent.succeeded_at;
    v_payment_actor := p_actor_id;
    v_source_key := 'rental-payment:stripe-intent:' || p_payment_source_id::text;
    v_source_reference := 'stripe:' || v_intent.stripe_payment_intent_id;
  end if;

  select * into v_contract
  from public.rental_contracts c
  where c.id = v_invoice.rental_contract_id
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for share;
  if not found then
    raise exception 'rental contract not found in invoice workspace'
      using errcode = 'P0002';
  end if;

  select count(*), (array_agg(x.equipment_id order by x.equipment_id))[1]
  into v_equipment_count, v_equipment_id
  from (
    select v_contract.equipment_id as equipment_id
    where v_contract.equipment_id is not null
    union
    select l.equipment_id
    from public.rental_contract_lines l
    where l.workspace_id = p_workspace_id
      and l.rental_contract_id = v_contract.id
      and l.deleted_at is null
      and l.equipment_id is not null
  ) x;
  if v_equipment_count <> 1 or v_equipment_id is null then
    raise exception 'exactly one canonical equipment unit is required; multi-unit rent allocation is not inferred'
      using errcode = '22023';
  end if;

  update public.rental_invoices
  set amount_paid_cents = least(
        total_cents,
        greatest(0, round(coalesce(v_customer.amount_paid, 0) * 100)::bigint)
      ),
      status = 'paid',
      paid_at = coalesce(paid_at, v_paid_at),
      updated_at = now()
  where id = v_invoice.id;

  return query
  select * from public.rental_record_unit_commission_paid(
    p_workspace_id,
    v_contract.id,
    v_equipment_id,
    v_invoice.rental_charge_cents,
    v_source_key,
    v_paid_at,
    v_invoice.id,
    'invoice_payment',
    v_source_reference,
    v_payment_actor,
    jsonb_build_object(
      'producer', 'l12.1-canonical-payment',
      'payment_source_kind', p_payment_source_kind,
      'payment_source_id', p_payment_source_id,
      'customer_invoice_id', v_customer.id
    )
  );
end;
$$;

revoke all on function public.rental_activate_paid_invoice_commission(
  text, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.rental_activate_paid_invoice_commission(
  text, uuid, text, uuid, uuid
) to service_role;

create or replace function public.rental_record_approved_rent_adjustment(
  p_workspace_id text,
  p_rental_invoice_id uuid,
  p_refunded_rent_cents bigint,
  p_source_kind text,
  p_idempotency_key text,
  p_source_reference text,
  p_reason text,
  p_corrects_source_event_key text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.rental_invoices%rowtype;
  v_contract public.rental_contracts%rowtype;
  v_equipment_id uuid;
  v_equipment_count integer;
  v_adjustment public.rental_rent_adjustments%rowtype;
  v_rows jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_record_approved_rent_adjustment requires service_role'
      using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.profiles p
    join public.profile_workspaces pw on pw.profile_id = p.id
    where p.id = p_actor_id and p.is_active = true
      and p.role::text in ('finance_admin', 'manager', 'admin', 'owner')
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'active finance, manager, admin, or owner approval is required'
      using errcode = '42501';
  end if;
  if p_rental_invoice_id is null or p_refunded_rent_cents is null
     or p_refunded_rent_cents <= 0
     or p_source_kind not in (
       'credit_memo', 'correction', 'goodwill_refund',
       'cash_refund', 'other_rent_refund'
     )
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or nullif(btrim(coalesce(p_source_reference, '')), '') is null
     or nullif(btrim(coalesce(p_reason, '')), '') is null
     or (p_source_kind = 'correction'
       and nullif(btrim(coalesce(p_corrects_source_event_key, '')), '') is null)
     or (p_source_kind <> 'correction' and p_corrects_source_event_key is not null) then
    raise exception 'complete approved rent adjustment evidence is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-adjustment:' || p_workspace_id || ':' || btrim(p_idempotency_key), 0
    )
  );

  select * into v_invoice from public.rental_invoices i
  where i.id = p_rental_invoice_id and i.workspace_id = p_workspace_id
    and i.deleted_at is null
  for update;
  if not found then
    raise exception 'rental invoice not found in workspace' using errcode = 'P0002';
  end if;
  select * into v_contract from public.rental_contracts c
  where c.id = v_invoice.rental_contract_id and c.workspace_id = p_workspace_id
    and c.deleted_at is null;
  if not found then
    raise exception 'rental contract not found in workspace' using errcode = 'P0002';
  end if;

  select count(*), (array_agg(x.equipment_id order by x.equipment_id))[1]
  into v_equipment_count, v_equipment_id
  from (
    select v_contract.equipment_id as equipment_id where v_contract.equipment_id is not null
    union
    select l.equipment_id from public.rental_contract_lines l
    where l.workspace_id = p_workspace_id
      and l.rental_contract_id = v_contract.id and l.deleted_at is null
      and l.equipment_id is not null
  ) x;
  if v_equipment_count <> 1 or v_equipment_id is null then
    raise exception 'exactly one canonical equipment unit is required; multi-unit rent allocation is not inferred'
      using errcode = '22023';
  end if;

  if p_source_kind = 'correction' and not exists (
    select 1 from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.rental_invoice_id = p_rental_invoice_id
      and l.equipment_id = v_equipment_id
      and l.entry_kind = 'rental_commission_paid'
      and l.source_event_key = btrim(p_corrects_source_event_key)
  ) then
    raise exception 'correction must reference an attributable paid commission source'
      using errcode = '22023';
  end if;

  insert into public.rental_rent_adjustments (
    workspace_id, rental_invoice_id, rental_contract_id, equipment_id,
    source_kind, idempotency_key, source_reference, refunded_rent_cents,
    corrects_source_event_key, reason, approved_by
  ) values (
    p_workspace_id, p_rental_invoice_id, v_contract.id, v_equipment_id,
    p_source_kind, btrim(p_idempotency_key), btrim(p_source_reference),
    p_refunded_rent_cents,
    case when p_source_kind = 'correction'
      then btrim(p_corrects_source_event_key) else null end,
    btrim(p_reason), p_actor_id
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_adjustment;

  if not found then
    select * into v_adjustment from public.rental_rent_adjustments a
    where a.workspace_id = p_workspace_id
      and a.idempotency_key = btrim(p_idempotency_key);
    if v_adjustment.rental_invoice_id <> p_rental_invoice_id
       or v_adjustment.equipment_id <> v_equipment_id
       or v_adjustment.source_kind <> p_source_kind
       or v_adjustment.source_reference <> btrim(p_source_reference)
       or v_adjustment.refunded_rent_cents <> p_refunded_rent_cents
       or v_adjustment.corrects_source_event_key
          is distinct from (case when p_source_kind = 'correction'
            then btrim(p_corrects_source_event_key) else null end)
       or v_adjustment.reason <> btrim(p_reason)
       or v_adjustment.approved_by <> p_actor_id then
      raise exception 'idempotency key already exists with different rent adjustment evidence'
        using errcode = '23505';
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.salesperson_id, x.id), '[]'::jsonb)
  into v_rows
  from public.rental_record_rent_refund_clawback(
    p_workspace_id, v_contract.id, v_equipment_id, p_rental_invoice_id,
    p_refunded_rent_cents, p_source_kind,
    'rental-adjustment:' || btrim(p_idempotency_key),
    btrim(p_source_reference), p_actor_id, v_adjustment.approved_at,
    jsonb_build_object(
      'producer', 'l12.1-rent-adjustment',
      'adjustment_id', v_adjustment.id,
      'reason', v_adjustment.reason,
      'corrects_source_event_key', v_adjustment.corrects_source_event_key
    )
  ) x;

  return jsonb_build_object('adjustment', to_jsonb(v_adjustment), 'ledger_entries', v_rows);
end;
$$;

revoke all on function public.rental_record_approved_rent_adjustment(
  text, uuid, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.rental_record_approved_rent_adjustment(
  text, uuid, bigint, text, text, text, text, text, uuid
) to service_role;

create or replace function public.rental_approve_conversion_commission(
  p_workspace_id text,
  p_qb_deal_id uuid,
  p_equipment_id uuid,
  p_negotiated_rent_credit_cents bigint,
  p_idempotency_key text,
  p_actor_id uuid,
  p_approval_reason text
)
returns public.rental_conversion_commission_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settlement public.rental_conversion_commission_settlements%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_approve_conversion_commission requires service_role'
      using errcode = '42501';
  end if;
  if p_actor_id is null
     or nullif(btrim(coalesce(p_approval_reason, '')), '') is null then
    raise exception 'conversion approval actor and reason are required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.profile_workspaces pw on pw.profile_id = p.id
    where p.id = p_actor_id and p.is_active = true
      and p.role::text in ('manager', 'admin', 'owner')
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'active manager, admin, or owner approval is required'
      using errcode = '42501';
  end if;

  v_settlement := public.rental_calculate_conversion_commission(
    p_workspace_id, p_qb_deal_id, p_equipment_id,
    p_negotiated_rent_credit_cents, p_idempotency_key, p_actor_id,
    jsonb_build_object(
      'producer', 'l12.1-negotiated-conversion-approval',
      'approval_reason', btrim(p_approval_reason),
      'approved_by', p_actor_id
    )
  );
  return public.rental_post_conversion_commission(
    p_workspace_id, v_settlement.id, p_actor_id
  );
end;
$$;

revoke all on function public.rental_approve_conversion_commission(
  text, uuid, uuid, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.rental_approve_conversion_commission(
  text, uuid, uuid, bigint, text, uuid, text
) to service_role;

create or replace function public.rental_stage_legacy_payroll_commission(
  p_workspace_id text,
  p_contract_id uuid,
  p_equipment_id uuid,
  p_salesperson_id uuid,
  p_rental_contract_commission_id uuid,
  p_rent_basis_cents bigint,
  p_paid_at timestamptz,
  p_payroll_reference text,
  p_source_document_reference text,
  p_idempotency_key text,
  p_staged_by uuid,
  p_notes text default null
)
returns public.rental_legacy_payroll_commission_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rental_legacy_payroll_commission_imports%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_stage_legacy_payroll_commission requires service_role'
      using errcode = '42501';
  end if;
  if p_rent_basis_cents is null or p_rent_basis_cents <= 0 or p_paid_at is null
     or nullif(btrim(coalesce(p_payroll_reference, '')), '') is null
     or nullif(btrim(coalesce(p_source_document_reference, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'complete legacy payroll source, payee, date, and rent basis are required'
      using errcode = '22023';
  end if;
  if p_staged_by is null or not exists (
    select 1 from public.profiles p
    join public.profile_workspaces pw on pw.profile_id = p.id
    where p.id = p_staged_by and p.is_active = true
      and p.role::text in ('finance_admin', 'admin', 'owner')
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'active finance, admin, or owner staging actor is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.rental_contracts c
    where c.id = p_contract_id and c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and (
        c.equipment_id = p_equipment_id or exists (
          select 1 from public.rental_contract_lines l
          where l.workspace_id = p_workspace_id
            and l.rental_contract_id = c.id and l.equipment_id = p_equipment_id
            and l.deleted_at is null
        )
      )
  ) or not exists (
    select 1 from public.rental_contract_commissions rc
    where rc.id = p_rental_contract_commission_id
      and rc.workspace_id = p_workspace_id
      and rc.rental_contract_id = p_contract_id
      and rc.salesperson_id = p_salesperson_id
  ) then
    raise exception 'legacy payroll contract, unit, payee, or split provenance is invalid'
      using errcode = '22023';
  end if;

  insert into public.rental_legacy_payroll_commission_imports (
    workspace_id, rental_contract_id, equipment_id, salesperson_id,
    rental_contract_commission_id, rent_basis_cents, paid_at,
    payroll_reference, source_document_reference, idempotency_key,
    notes, staged_by
  ) values (
    p_workspace_id, p_contract_id, p_equipment_id, p_salesperson_id,
    p_rental_contract_commission_id, p_rent_basis_cents, p_paid_at,
    btrim(p_payroll_reference), btrim(p_source_document_reference),
    btrim(p_idempotency_key), nullif(btrim(coalesce(p_notes, '')), ''), p_staged_by
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.rental_legacy_payroll_commission_imports i
    where i.workspace_id = p_workspace_id
      and i.idempotency_key = btrim(p_idempotency_key);
    if v_row.rental_contract_id <> p_contract_id
       or v_row.equipment_id <> p_equipment_id
       or v_row.salesperson_id <> p_salesperson_id
       or v_row.rental_contract_commission_id <> p_rental_contract_commission_id
       or v_row.rent_basis_cents <> p_rent_basis_cents
       or v_row.paid_at <> p_paid_at
       or v_row.payroll_reference <> btrim(p_payroll_reference)
       or v_row.source_document_reference <> btrim(p_source_document_reference)
       or v_row.staged_by <> p_staged_by then
      raise exception 'idempotency key already exists with different legacy payroll evidence'
        using errcode = '23505';
    end if;
  end if;
  return v_row;
end;
$$;

revoke all on function public.rental_stage_legacy_payroll_commission(
  text, uuid, uuid, uuid, uuid, bigint, timestamptz, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.rental_stage_legacy_payroll_commission(
  text, uuid, uuid, uuid, uuid, bigint, timestamptz, text, text, text, uuid, text
) to service_role;

create or replace function public.rental_approve_legacy_payroll_commission(
  p_workspace_id text,
  p_import_id uuid,
  p_approved_by uuid,
  p_approval_reason text
)
returns public.rental_legacy_payroll_commission_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rental_legacy_payroll_commission_imports%rowtype;
  v_split public.rental_contract_commissions%rowtype;
  v_ledger public.rental_unit_commission_ledger%rowtype;
  v_source_key text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_approve_legacy_payroll_commission requires service_role'
      using errcode = '42501';
  end if;
  if p_approved_by is null
     or nullif(btrim(coalesce(p_approval_reason, '')), '') is null
     or not exists (
       select 1 from public.profiles p
       join public.profile_workspaces pw on pw.profile_id = p.id
       where p.id = p_approved_by and p.is_active = true
         and p.role::text in ('finance_admin', 'admin', 'owner')
         and pw.workspace_id = p_workspace_id
     ) then
    raise exception 'active finance, admin, or owner approval and reason are required'
      using errcode = '42501';
  end if;

  select * into v_row
  from public.rental_legacy_payroll_commission_imports i
  where i.id = p_import_id and i.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'legacy payroll import not found in workspace'
      using errcode = 'P0002';
  end if;
  if v_row.staged_by = p_approved_by then
    raise exception 'legacy payroll import requires a different approver'
      using errcode = '42501';
  end if;
  if v_row.status = 'posted' then
    if v_row.approved_by = p_approved_by
       and v_row.approval_reason = btrim(p_approval_reason) then
      return v_row;
    end if;
    raise exception 'legacy payroll import was already approved with different evidence'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.rental_conversion_commission_settlements s
    where s.workspace_id = p_workspace_id
      and s.equipment_id = v_row.equipment_id
      and s.status = 'posted'
  ) then
    raise exception 'unit conversion commission is posted; use a finance correction workflow'
      using errcode = '55000';
  end if;

  select * into v_split from public.rental_contract_commissions rc
  where rc.id = v_row.rental_contract_commission_id
    and rc.workspace_id = p_workspace_id
    and rc.rental_contract_id = v_row.rental_contract_id
    and rc.salesperson_id = v_row.salesperson_id;
  if not found then
    raise exception 'legacy payroll payee split provenance is no longer valid'
      using errcode = '22023';
  end if;

  v_source_key := 'legacy-payroll:' || v_row.idempotency_key;
  insert into public.rental_unit_commission_ledger (
    workspace_id, equipment_id, rental_contract_id, rental_invoice_id,
    salesperson_id, rental_contract_commission_id, split_pct_snapshot,
    origin_paid_entry_id, entry_kind, source_kind, source_event_key,
    source_reference, source_rent_basis_cents, rent_basis_cents,
    commission_cents, recognized_at, actor_id, metadata
  ) values (
    p_workspace_id, v_row.equipment_id, v_row.rental_contract_id, null,
    v_row.salesperson_id, v_row.rental_contract_commission_id, v_split.split_pct,
    null, 'rental_commission_paid', 'legacy_paid_commission', v_source_key,
    v_row.payroll_reference, v_row.rent_basis_cents, v_row.rent_basis_cents,
    v_row.commission_cents, v_row.paid_at, p_approved_by,
    jsonb_build_object(
      'producer', 'l12.1-legacy-payroll-import',
      'import_id', v_row.id,
      'source_document_reference', v_row.source_document_reference,
      'approval_reason', btrim(p_approval_reason),
      'staged_by', v_row.staged_by,
      'approved_by', p_approved_by
    )
  )
  on conflict (
    workspace_id, source_event_key, rental_contract_commission_id
  ) where entry_kind = 'rental_commission_paid'
  do nothing
  returning * into v_ledger;

  if not found then
    select * into v_ledger from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.source_event_key = v_source_key
      and l.rental_contract_commission_id = v_row.rental_contract_commission_id;
    if not found or v_ledger.equipment_id <> v_row.equipment_id
       or v_ledger.rental_contract_id <> v_row.rental_contract_id
       or v_ledger.salesperson_id <> v_row.salesperson_id
       or v_ledger.rent_basis_cents <> v_row.rent_basis_cents
       or v_ledger.commission_cents <> v_row.commission_cents then
      raise exception 'legacy payroll source key already exists with different commission economics'
        using errcode = '23505';
    end if;
  end if;

  update public.rental_legacy_payroll_commission_imports
  set status = 'posted', approved_by = p_approved_by, approved_at = now(),
      approval_reason = btrim(p_approval_reason), ledger_entry_id = v_ledger.id,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.rental_approve_legacy_payroll_commission(
  text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.rental_approve_legacy_payroll_commission(
  text, uuid, uuid, text
) to service_role;

update public.qep_roadmap_tasks
set ship_state = 'in_progress',
    blocking_decision = 'BLK-RENTAL-COMMISSION-UAT',
    evidence_link = 'supabase/migrations/836_l121_rental_commission_producer_activation.sql',
    notes = coalesce(notes, '') ||
      E'\n[2026-08-14] Code-owned L12.1 producers active: canonical AR/verified-Stripe payment evidence, approved refund/credit, negotiated conversion approval, correction, and two-person legacy payroll import now invoke the append-only migration 830 ledger with exact replay checks. Missing source evidence, unit allocation, payee split, approval, or rent basis fails closed. L12.1 remains in_progress pending operator UAT; multi-unit invoice commission allocation remains blocked until canonical per-unit rent basis exists.',
    updated_at = now()
where task_id = 'L12.1';

insert into public.qep_roadmap_sync_events (
  direction, task_id, action, changed_fields, actor
) values (
  'outbound', 'L12.1', 'upsert',
  jsonb_build_object(
    'ship_state', 'in_progress',
    'blocking_decision', 'BLK-RENTAL-COMMISSION-UAT',
    'code_state', 'producer_active_uat_pending',
    'evidence_link', 'supabase/migrations/836_l121_rental_commission_producer_activation.sql',
    'mission_alignment', 'pass: governed rental compensation now follows durable payment, refund, conversion, correction, and reviewed import evidence without inventing unit economics'
  ),
  'migration:836_l121_rental_commission_producer_activation'
);

commit;

-- Rollback/fix-forward:
--   Disable rental-ops producer actions and Stripe invocation first. Revoke
--   the five service RPC grants. Preserve every adjustment, import, ledger,
--   and settlement row; correct compensation only with reversing entries.
--   L12.1 must remain in_progress if producer code or UAT is rolled back.
