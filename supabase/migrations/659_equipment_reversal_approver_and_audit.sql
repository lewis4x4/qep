-- 659_equipment_reversal_approver_and_audit.sql
--
-- Q4.4: EQUIPMENT-SALE REVERSAL APPROVER + AUDIT LOG.
--
-- Extends the JAR-103 reversal flow (migrations 536/537/540) WITHOUT changing
-- the existing signature or behavior of
-- public.reverse_equipment_sale_by_stock_number(...). This migration:
--   1. Adds a dedicated reversal audit table (there is no general audit table;
--      activity_log is HubSpot-specific).
--   2. Gates every equipment-sale reversal to an approver whose role is a
--      Sales Manager or Iron Manager -> canonical roles ('manager','owner').
--   3. Writes an audit-log row on every reversal attempt (approved/executed OR
--      rejected), so failed approval attempts are also recorded.
--
-- Enforcement is wired through a NEW wrapper RPC
-- public.reverse_equipment_sale_with_approval(...) that asserts the approver,
-- audits the outcome, then delegates to the untouched 540 base function.

begin;

-- ============================================================
-- 1. AUDIT TABLE
-- ============================================================
create table if not exists public.equipment_reversal_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  reversal_id text,
  stock_number text,
  original_invoice_id uuid,
  credit_memo_id uuid,
  action text not null check (action in ('approved', 'rejected', 'executed')),
  approver_id uuid references public.profiles(id) on delete set null,
  approver_role text,
  reason text,
  outcome text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.equipment_reversal_audit is
  'Q4.4 audit log for equipment-sale reversals. One row per reversal attempt: rejected (approval gate failed), approved, or executed. Manager+ visibility only.';
comment on column public.equipment_reversal_audit.action is
  'approved = approval gate passed; executed = base reversal RPC completed; rejected = approval gate raised and the reversal did not run.';
comment on column public.equipment_reversal_audit.approver_role is
  'Canonical role of the approver at audit time (manager/owner for accepted attempts). Captured for tamper-evident history.';

create index if not exists idx_equipment_reversal_audit_workspace_created
  on public.equipment_reversal_audit (workspace_id, created_at desc);
comment on index public.idx_equipment_reversal_audit_workspace_created is
  'Purpose: workspace-scoped reversal audit timeline for manager review.';

create index if not exists idx_equipment_reversal_audit_stock_number
  on public.equipment_reversal_audit (stock_number);
comment on index public.idx_equipment_reversal_audit_stock_number is
  'Purpose: per-stock-number reversal attempt history lookup.';

-- ============================================================
-- 1a. RLS (audit is manager+)
-- ============================================================
alter table public.equipment_reversal_audit enable row level security;

drop policy if exists "equipment_reversal_audit_service_all" on public.equipment_reversal_audit;
create policy "equipment_reversal_audit_service_all"
  on public.equipment_reversal_audit for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "equipment_reversal_audit_manager_select" on public.equipment_reversal_audit;
create policy "equipment_reversal_audit_manager_select"
  on public.equipment_reversal_audit for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

drop policy if exists "equipment_reversal_audit_manager_insert" on public.equipment_reversal_audit;
create policy "equipment_reversal_audit_manager_insert"
  on public.equipment_reversal_audit for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

-- ============================================================
-- 2. APPROVER ASSERTION
-- ============================================================
-- Returns the approver's canonical role; raises if the approver is not a
-- Sales Manager or Iron Manager (roles 'manager' or 'owner'). get_my_role()
-- only resolves the CURRENT user, so we read profiles.role by id directly.
create or replace function public.assert_reversal_approver(p_approver_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_approver_id is null then
    raise exception 'reversal requires Sales Manager or Iron Manager approval';
  end if;

  select p.role::text
    into v_role
  from public.profiles p
  where p.id = p_approver_id;

  if v_role is null or v_role not in ('manager', 'owner') then
    raise exception 'reversal requires Sales Manager or Iron Manager approval';
  end if;

  return v_role;
end;
$$;

comment on function public.assert_reversal_approver(uuid) is
  'Q4.4 approval gate: returns the approver role or raises when the approver is not a Sales Manager / Iron Manager (roles manager/owner).';

revoke execute on function public.assert_reversal_approver(uuid) from public;
grant execute on function public.assert_reversal_approver(uuid) to authenticated;
grant execute on function public.assert_reversal_approver(uuid) to service_role;

-- ============================================================
-- 3. AUDIT INSERT HELPER
-- ============================================================
create or replace function public.audit_equipment_reversal(
  p_workspace_id text,
  p_reversal_id text,
  p_stock_number text,
  p_original_invoice_id uuid,
  p_credit_memo_id uuid,
  p_action text,
  p_approver_id uuid,
  p_approver_role text,
  p_reason text,
  p_outcome text,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit_id uuid;
begin
  insert into public.equipment_reversal_audit (
    workspace_id,
    reversal_id,
    stock_number,
    original_invoice_id,
    credit_memo_id,
    action,
    approver_id,
    approver_role,
    reason,
    outcome,
    detail
  ) values (
    coalesce(nullif(p_workspace_id, ''), public.get_my_workspace()),
    p_reversal_id,
    p_stock_number,
    p_original_invoice_id,
    p_credit_memo_id,
    p_action,
    p_approver_id,
    p_approver_role,
    p_reason,
    p_outcome,
    coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

comment on function public.audit_equipment_reversal(text, text, text, uuid, uuid, text, uuid, text, text, text, jsonb) is
  'Q4.4 audit writer: inserts one equipment_reversal_audit row (approved/executed/rejected) and returns its id. Security definer so rejected attempts are recorded even when the reversal aborts.';

revoke execute on function public.audit_equipment_reversal(text, text, text, uuid, uuid, text, uuid, text, text, text, jsonb) from public;
grant execute on function public.audit_equipment_reversal(text, text, text, uuid, uuid, text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.audit_equipment_reversal(text, text, text, uuid, uuid, text, uuid, text, text, text, jsonb) to service_role;

-- ============================================================
-- 4. ENFORCEMENT WRAPPER
-- ============================================================
-- Same params as reverse_equipment_sale_by_stock_number(...) plus p_approver_id.
-- (a) gate the approver -> on rejection write a 'rejected' audit row and
--     return {approved:false} WITHOUT raising (so the audit row commits);
-- (b) call the untouched 540 base function, passing the approver as the manager
--     approval (and, when the approver is an owner, also the owner approval);
-- (c) write an 'executed' audit row.
-- The base function RETURNS TABLE, so we capture its row into a record and
-- return a jsonb summary {reversal_id, credit_memo_id, approver_role, ...}.
create or replace function public.reverse_equipment_sale_with_approval(
  p_stock_number text,
  p_reversal_id text,
  p_reason text,
  p_revert_availability text default 'available',
  p_revert_in_out_state text default 'in',
  p_revert_inventory_type text default null,
  p_manager_approved_by uuid default null,
  p_finance_approved_by uuid default null,
  p_owner_approved_by uuid default null,
  p_approver_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id text := public.get_my_workspace();
  v_approver_role text;
  v_result record;
  v_manager_approved_by uuid;
  v_owner_approved_by uuid;
begin
  -- (a) Approval gate. Read the approver's role directly (get_my_role only
  -- resolves the CURRENT user). We deliberately do NOT raise on rejection:
  -- a raise would roll back the rejected-attempt audit row written in this
  -- same transaction (SECURITY DEFINER does not open a subtransaction), and
  -- Q4.4 requires EVERY attempt — including rejected ones — to be recorded.
  -- Instead we persist the rejected audit and return a rejection result; the
  -- base reversal is never invoked, so the Sales Manager / Iron Manager gate
  -- still holds hard.
  select p.role::text
    into v_approver_role
  from public.profiles p
  where p.id = p_approver_id;

  if p_approver_id is null
     or v_approver_role is null
     or v_approver_role not in ('manager', 'owner') then
    perform public.audit_equipment_reversal(
      v_workspace_id,
      nullif(trim(coalesce(p_reversal_id, '')), ''),
      nullif(trim(coalesce(p_stock_number, '')), ''),
      null,
      null,
      'rejected',
      p_approver_id,
      v_approver_role,
      nullif(trim(coalesce(p_reason, '')), ''),
      'approval_denied',
      jsonb_build_object(
        'gate', 'reversal_approver',
        'approver_role', v_approver_role
      )
    );
    return jsonb_build_object(
      'approved', false,
      'outcome', 'rejected',
      'reason', 'reversal requires Sales Manager or Iron Manager approval',
      'approver_id', p_approver_id,
      'approver_role', v_approver_role
    );
  end if;

  -- Approval gate passed.
  perform public.audit_equipment_reversal(
    v_workspace_id,
    nullif(trim(coalesce(p_reversal_id, '')), ''),
    nullif(trim(coalesce(p_stock_number, '')), ''),
    null,
    null,
    'approved',
    p_approver_id,
    v_approver_role,
    nullif(trim(coalesce(p_reason, '')), ''),
    'approval_gate_passed',
    jsonb_build_object('approver_role', v_approver_role)
  );

  -- Route the approver into the correct approval slot for the base RPC.
  -- Owners satisfy both owner and manager approval; managers satisfy manager.
  v_manager_approved_by := coalesce(p_manager_approved_by, p_approver_id);
  v_owner_approved_by := case
    when v_approver_role = 'owner' then coalesce(p_owner_approved_by, p_approver_id)
    else p_owner_approved_by
  end;

  -- (b) Delegate to the untouched 540 base function.
  select *
    into v_result
  from public.reverse_equipment_sale_by_stock_number(
    p_stock_number,
    p_reversal_id,
    p_reason,
    p_revert_availability,
    p_revert_in_out_state,
    p_revert_inventory_type,
    v_manager_approved_by,
    p_finance_approved_by,
    v_owner_approved_by
  );

  -- (c) Record the executed reversal.
  perform public.audit_equipment_reversal(
    v_workspace_id,
    v_result.reversal_id,
    v_result.stock_number,
    v_result.invoice_id,
    v_result.credit_memo_id,
    'executed',
    p_approver_id,
    v_approver_role,
    nullif(trim(coalesce(p_reason, '')), ''),
    case when v_result.idempotent then 'idempotent_replay' else 'reversal_executed' end,
    jsonb_build_object(
      'policy_branch', v_result.policy_branch,
      'invoice_status', v_result.invoice_status,
      'quickbooks_sync_status', v_result.quickbooks_sync_status,
      'idempotent', v_result.idempotent
    )
  );

  return jsonb_build_object(
    'reversal_id', v_result.reversal_id,
    'credit_memo_id', v_result.credit_memo_id,
    'credit_memo_number', v_result.credit_memo_number,
    'approver_role', v_approver_role,
    'stock_number', v_result.stock_number,
    'invoice_id', v_result.invoice_id,
    'policy_branch', v_result.policy_branch,
    'invoice_status', v_result.invoice_status,
    'quickbooks_sync_status', v_result.quickbooks_sync_status,
    'idempotent', v_result.idempotent
  );
end;
$$;

comment on function public.reverse_equipment_sale_with_approval(text, text, text, text, text, text, uuid, uuid, uuid, uuid) is
  'Q4.4 enforcement wrapper for equipment-sale reversals: asserts a Sales Manager / Iron Manager approver, audits rejected/approved/executed outcomes, then delegates to the untouched reverse_equipment_sale_by_stock_number RPC. Returns a jsonb summary.';

revoke execute on function public.reverse_equipment_sale_with_approval(text, text, text, text, text, text, uuid, uuid, uuid, uuid) from public;
grant execute on function public.reverse_equipment_sale_with_approval(text, text, text, text, text, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.reverse_equipment_sale_with_approval(text, text, text, text, text, text, uuid, uuid, uuid, uuid) to service_role;

commit;
