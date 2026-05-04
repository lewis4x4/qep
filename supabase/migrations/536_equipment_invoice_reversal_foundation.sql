-- 536_equipment_invoice_reversal_foundation.sql
--
-- Slice 6 foundation for IntelliDealer Action & Button Parity:
-- "Reverse the sales of a stock number".
--
-- This migration intentionally stops short of executing financial reversals.
-- It creates the auditable stock-number -> equipment -> invoice linkage and
-- conservative reversal readiness checks needed before an atomic reversal RPC
-- can safely create credit memo / GL reversal records.
--
-- Rollback notes:
--   drop function if exists public.find_equipment_invoice_reversal_candidate(text);
--   create or replace view public.equipment_invoices as select ... -- restore 471_equipment_invoice_view.sql shape if rollback needs the original placeholder view.
--   drop index if exists public.idx_customer_invoices_equipment_open_reversal;
--   drop index if exists public.idx_customer_invoices_reversal_chain;
--   drop index if exists public.idx_customer_invoices_qrm_equipment;
--   alter table public.customer_invoices drop constraint if exists customer_invoices_status_wave3_chk;
--   alter table public.customer_invoices add constraint customer_invoices_status_wave3_chk
--     check (status::text in ('pending', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void'));
--   alter table public.customer_invoices drop column if exists reversal_gl_journal_entry_id;
--   alter table public.customer_invoices drop column if exists reversed_by;
--   alter table public.customer_invoices drop column if exists reversed_at;
--   alter table public.customer_invoices drop column if exists reversal_reason;
--   alter table public.customer_invoices drop column if exists reversed_by_invoice_id;
--   alter table public.customer_invoices drop column if exists reversal_of_invoice_id;
--   alter table public.customer_invoices drop column if exists qrm_equipment_id;

alter table public.customer_invoices
  add column if not exists qrm_equipment_id uuid references public.qrm_equipment(id) on delete set null,
  add column if not exists reversal_of_invoice_id uuid references public.customer_invoices(id) on delete restrict,
  add column if not exists reversed_by_invoice_id uuid references public.customer_invoices(id) on delete restrict,
  add column if not exists reversal_reason text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reversal_gl_journal_entry_id uuid references public.gl_journal_entries(id) on delete set null;

comment on column public.customer_invoices.qrm_equipment_id is
  'Direct QRM equipment FK for IntelliDealer equipment invoices. Enables stock-number reversal lookup without heuristics.';
comment on column public.customer_invoices.reversal_of_invoice_id is
  'If this row is a reversal/credit memo, points to the original customer invoice.';
comment on column public.customer_invoices.reversed_by_invoice_id is
  'If this row is the original invoice, points to its generated reversal/credit memo invoice.';
comment on column public.customer_invoices.reversal_reason is
  'Required business reason captured by future equipment invoice reversal RPC.';
comment on column public.customer_invoices.reversal_gl_journal_entry_id is
  'GL reversal journal header associated with an equipment invoice reversal.';

alter table public.customer_invoices
  drop constraint if exists customer_invoices_status_check;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_status_wave3_chk;

alter table public.customer_invoices
  add constraint customer_invoices_status_wave3_chk
  check (status::text in ('pending', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'void', 'reversed'));

create index if not exists idx_customer_invoices_qrm_equipment
  on public.customer_invoices (workspace_id, qrm_equipment_id, invoice_date desc)
  where qrm_equipment_id is not null;
comment on index public.idx_customer_invoices_qrm_equipment is
  'Purpose: exact stock-number -> qrm_equipment -> equipment invoice lookup for reversal and equipment invoice history.';

create index if not exists idx_customer_invoices_reversal_chain
  on public.customer_invoices (workspace_id, reversal_of_invoice_id, reversed_by_invoice_id)
  where reversal_of_invoice_id is not null or reversed_by_invoice_id is not null;
comment on index public.idx_customer_invoices_reversal_chain is
  'Purpose: audit customer invoice reversal and credit memo chains.';

create index if not exists idx_customer_invoices_equipment_open_reversal
  on public.customer_invoices (workspace_id, qrm_equipment_id, status, invoice_date desc)
  where invoice_type = 'equipment'
    and qrm_equipment_id is not null
    and status not in ('void', 'reversed');
comment on index public.idx_customer_invoices_equipment_open_reversal is
  'Purpose: locate active equipment invoices eligible for stock-number reversal readiness checks.';

create or replace view public.equipment_invoices
  with (security_invoker = true) as
select
  ci.id,
  ci.workspace_id,
  ci.crm_company_id as company_id,
  ci.portal_customer_id,
  ci.deal_id,
  ci.qrm_equipment_id as equipment_id,
  ci.invoice_number as reference_number,
  e.make,
  e.model,
  round(ci.total * 100)::bigint as invoice_total_cents,
  ci.invoice_date,
  ci.status,
  ci.created_at,
  ci.updated_at,
  e.stock_number,
  ci.reversal_of_invoice_id,
  ci.reversed_by_invoice_id,
  ci.reversed_at,
  ci.reversal_gl_journal_entry_id
from public.customer_invoices ci
left join public.qrm_equipment e on e.id = ci.qrm_equipment_id
where ci.invoice_type = 'equipment';

comment on view public.equipment_invoices is
  'IntelliDealer equipment invoice compatibility view over customer_invoices where invoice_type = equipment. Direct qrm_equipment_id linkage enables stock-number reversal lookup.';
comment on column public.equipment_invoices.equipment_id is
  'Mapped from customer_invoices.qrm_equipment_id; no longer a placeholder.';
comment on column public.equipment_invoices.reference_number is
  'Mapped from customer_invoices.invoice_number.';
comment on column public.equipment_invoices.stock_number is
  'Mapped from qrm_equipment.stock_number for IntelliDealer stock-number reversal evidence.';
comment on column public.equipment_invoices.invoice_total_cents is
  'Mapped from customer_invoices.total decimal amount to cents for audit compatibility.';

create or replace function public.find_equipment_invoice_reversal_candidate(p_stock_number text)
returns table (
  stock_number text,
  equipment_id uuid,
  invoice_id uuid,
  invoice_number text,
  invoice_status text,
  quickbooks_gl_status text,
  posting_period_status text,
  equipment_in_out_state text,
  candidate_status text,
  blockers text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id text := public.get_my_workspace();
  v_stock_number text := nullif(trim(p_stock_number), '');
  v_equipment_id uuid;
  v_equipment_stock_number text;
  v_equipment_state text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_invoice_status text;
  v_quickbooks_gl_status text;
  v_invoice_date date;
  v_posting_period_status text;
  v_blockers text[] := array[]::text[];
begin
  if v_stock_number is null then
    return query
    select
      null::text,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      'blocked'::text,
      array['missing_stock_number']::text[];
    return;
  end if;

  select e.id, e.stock_number, e.in_out_state::text
    into v_equipment_id, v_equipment_stock_number, v_equipment_state
  from public.qrm_equipment e
  where e.workspace_id = v_workspace_id
    and e.stock_number = v_stock_number
    and e.deleted_at is null
  limit 1;

  if v_equipment_id is null then
    v_blockers := array_append(v_blockers, 'equipment_not_found');
  else
    select ci.id,
           ci.invoice_number,
           ci.status::text,
           coalesce(ci.quickbooks_gl_status::text, 'not_synced'),
           ci.invoice_date
      into v_invoice_id,
           v_invoice_number,
           v_invoice_status,
           v_quickbooks_gl_status,
           v_invoice_date
    from public.customer_invoices ci
    where ci.workspace_id = v_workspace_id
      and ci.qrm_equipment_id = v_equipment_id
      and ci.invoice_type = 'equipment'
      and ci.reversal_of_invoice_id is null
    order by ci.invoice_date desc, ci.created_at desc
    limit 1;

    if v_invoice_id is null then
      v_blockers := array_append(v_blockers, 'no_direct_equipment_invoice');
    else
      if v_invoice_status in ('paid', 'void', 'reversed') then
        v_blockers := array_append(v_blockers, 'invoice_status_blocks_reversal');
      end if;

      if v_quickbooks_gl_status = 'posted' then
        v_blockers := array_append(v_blockers, 'quickbooks_posted_invoice_requires_finance_policy');
      end if;

      select gp.status::text
        into v_posting_period_status
      from public.gl_periods gp
      where gp.workspace_id = v_workspace_id
        and gp.deleted_at is null
        and v_invoice_date between gp.period_start and gp.period_end
      order by case when gp.status = 'hard_closed' then 0 else 1 end,
               gp.period_start desc
      limit 1;

      if v_posting_period_status is null then
        v_blockers := array_append(v_blockers, 'no_gl_period_for_invoice_date');
      elsif v_posting_period_status = 'hard_closed' then
        v_blockers := array_append(v_blockers, 'hard_closed_gl_period');
      end if;
    end if;

    if v_equipment_state is distinct from 'sold' then
      v_blockers := array_append(v_blockers, 'equipment_not_marked_sold');
    end if;
  end if;

  return query
  select
    coalesce(v_equipment_stock_number, v_stock_number),
    v_equipment_id,
    v_invoice_id,
    v_invoice_number,
    v_invoice_status,
    v_quickbooks_gl_status,
    v_posting_period_status,
    v_equipment_state,
    case when cardinality(v_blockers) = 0 then 'ready' else 'blocked' end,
    v_blockers;
end;
$$;

comment on function public.find_equipment_invoice_reversal_candidate(text) is
  'Read-only readiness check for IntelliDealer stock-number sale reversal. It verifies direct equipment invoice linkage, invoice lifecycle, QuickBooks posting state, GL period openness, and equipment sold state before a future atomic reversal RPC is allowed.';

revoke execute on function public.find_equipment_invoice_reversal_candidate(text) from public;
grant execute on function public.find_equipment_invoice_reversal_candidate(text) to authenticated;
