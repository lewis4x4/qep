-- 819_rental_worldclass_desk_money.sql
--
-- Wave-1 rental world-class: deposit settlement statuses for final billing,
-- and a workspace-scoped close_contract helper that enforces returned→closed
-- with an optional hard-close path.

begin;

-- Expand deposit_status so final billing can honestly leave applied / refund_due
-- states instead of forever-paid after the deposit has been consumed on invoice.
alter table public.rental_contracts
  drop constraint if exists rental_contracts_deposit_status_check;

alter table public.rental_contracts
  add constraint rental_contracts_deposit_status_check
  check (
    deposit_status is null
    or deposit_status in (
      'not_required',
      'pending',
      'processing',
      'paid',
      'failed',
      'applied',
      'partially_applied',
      'refund_due',
      'refunded'
    )
  );

comment on column public.rental_contracts.deposit_status is
  'Deposit lifecycle: pending/processing/paid until final invoice applies it; applied when fully consumed; partially_applied/refund_due when remainder must be returned; refunded when cash has left.';

-- Atomic close from returned (or audited hard-close). Keeps the lifecycle
-- trigger as the authority for timestamps and illegal edges.
create or replace function public.rental_close_contract(
  p_workspace_id text,
  p_contract_id uuid,
  p_actor_id uuid,
  p_hard_close boolean default false,
  p_hard_close_reason text default null
)
returns public.rental_contracts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.rental_contracts%rowtype;
  v_has_final boolean := false;
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'service_role') then
    raise exception 'rental_close_contract requires authenticated or service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_workspace_id), '') is null or p_contract_id is null then
    raise exception 'workspace and contract are required' using errcode = '22023';
  end if;

  select * into v_contract
  from public.rental_contracts c
  where c.id = p_contract_id
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for update;
  if not found then
    raise exception 'rental contract not found' using errcode = 'P0002';
  end if;

  if v_contract.lifecycle_state = 'closed' then
    return v_contract;
  end if;

  if p_hard_close then
    if nullif(btrim(coalesce(p_hard_close_reason, '')), '') is null then
      raise exception 'hard close requires a reason' using errcode = '22023';
    end if;
    update public.rental_contracts
    set lifecycle_state = 'closed',
        hard_closed_at = coalesce(hard_closed_at, now()),
        hard_close_reason = btrim(p_hard_close_reason),
        hard_closed_by = coalesce(hard_closed_by, p_actor_id)
    where id = p_contract_id
    returning * into v_contract;
    return v_contract;
  end if;

  if v_contract.lifecycle_state is distinct from 'returned' then
    raise exception 'contract must be returned before close (state: %)', v_contract.lifecycle_state
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.rental_invoices ri
    where ri.rental_contract_id = p_contract_id
      and ri.workspace_id = p_workspace_id
      and ri.deleted_at is null
      and ri.status in ('posted', 'sent', 'paid')
      and coalesce(ri.metadata->>'kind', '') = 'final'
  ) into v_has_final;

  if not v_has_final then
    raise exception 'final rental invoice must be posted before close'
      using errcode = '22023';
  end if;

  if coalesce(v_contract.deposit_status, 'not_required') in (
    'pending', 'processing', 'failed'
  ) then
    raise exception 'deposit must be settled or not required before close (status: %)',
      v_contract.deposit_status
      using errcode = '22023';
  end if;
  -- refund_due is allowed: the final invoice already posted and the exception
  -- queue holds the refund work item; do not block contract close on cash-out.

  update public.rental_contracts
  set lifecycle_state = 'closed'
  where id = p_contract_id
  returning * into v_contract;

  return v_contract;
end;
$$;

revoke all on function public.rental_close_contract(text, uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.rental_close_contract(text, uuid, uuid, boolean, text)
  to authenticated, service_role;

comment on function public.rental_close_contract(text, uuid, uuid, boolean, text) is
  'Closes a returned rental after a posted final invoice, or hard-closes with an audited reason.';

commit;
