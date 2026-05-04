-- 537_equipment_invoice_reversal_candidate_partial_guard.sql
--
-- Follow-up guardrail for Slice 6 review: partially paid customer invoices
-- must not be returned as reversal-ready while refund/credit policy remains
-- unresolved.
--
-- Rollback notes:
--   restore public.find_equipment_invoice_reversal_candidate(text) from
--   536_equipment_invoice_reversal_foundation.sql if the business later
--   approves partial-paid reversal behavior.

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
      if v_invoice_status in ('partial', 'paid', 'void', 'reversed') then
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
  'Read-only readiness check for IntelliDealer stock-number sale reversal. It verifies direct equipment invoice linkage, blocks partial/paid/void/reversed invoices while finance policy is unresolved, reports QuickBooks posting state, GL period status, and equipment sold state before a future atomic reversal RPC is allowed.';

revoke execute on function public.find_equipment_invoice_reversal_candidate(text) from public;
grant execute on function public.find_equipment_invoice_reversal_candidate(text) to authenticated;
