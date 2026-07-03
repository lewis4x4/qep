-- 660_finance_foundation_equipment_reversal_approvals.sql
--
-- Finance foundation Part 6: immutable equipment reversal manager approval
-- audit and an approved reversal wrapper.
--
-- Rollback notes:
--   drop function if exists public.reverse_equipment_sale_by_stock_number_with_approval(text, text, text, uuid, text, text, text, text, uuid, uuid, jsonb);
--   drop function if exists public.record_equipment_reversal_manager_approval(uuid, uuid, text, jsonb);
--   drop function if exists public.qep_is_equipment_reversal_manager_approver(uuid);
--   drop trigger if exists equipment_reversal_approval_audit_append_only on public.equipment_reversal_approval_audit;
--   drop function if exists public.prevent_equipment_reversal_approval_audit_mutation();
--   drop table if exists public.equipment_reversal_approval_audit;

create table if not exists public.equipment_reversal_approval_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  credit_memo_id uuid not null references public.credit_memos(id) on delete restrict,
  original_invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  qrm_equipment_id uuid references public.qrm_equipment(id) on delete set null,
  reversal_id text not null,
  approval_type text not null default 'manager_reversal_approval'
    check (approval_type in ('manager_reversal_approval')),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_by_role text,
  approved_by_iron_role text,
  reason text not null,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_by_role text,
  source_function text not null default 'record_equipment_reversal_manager_approval',
  approved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.equipment_reversal_approval_audit is
  'Append-only who/why/when approval evidence for equipment sale reversals. Approver must be a Sales Manager or Iron Manager profile.';
comment on column public.equipment_reversal_approval_audit.reason is
  'Business reason supplied by the approving Sales Manager/Iron Manager.';
comment on column public.equipment_reversal_approval_audit.approved_by_iron_role is
  'Profiles.iron_role snapshot at approval time; iron_manager is accepted without adding a new user_role enum value.';

create index if not exists idx_equipment_reversal_approval_credit_memo
  on public.equipment_reversal_approval_audit (workspace_id, credit_memo_id, approved_at desc);

create index if not exists idx_equipment_reversal_approval_equipment
  on public.equipment_reversal_approval_audit (workspace_id, qrm_equipment_id, approved_at desc)
  where qrm_equipment_id is not null;

alter table public.equipment_reversal_approval_audit enable row level security;

create policy "equipment_reversal_approval_audit_service_all"
  on public.equipment_reversal_approval_audit for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "equipment_reversal_approval_audit_finance_read"
  on public.equipment_reversal_approval_audit for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      public.qep_finance_can_read()
      or coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner')
    )
  );

create policy "equipment_reversal_approval_audit_elevated_insert"
  on public.equipment_reversal_approval_audit for insert
  with check (
    workspace_id = (select public.get_my_workspace())
    and coalesce((select public.get_my_role())::text, '') in ('admin', 'manager', 'owner', 'finance_admin')
  );

create or replace function public.prevent_equipment_reversal_approval_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'VALIDATION_EQUIPMENT_REVERSAL_APPROVAL_AUDIT_APPEND_ONLY';
end;
$$;

drop trigger if exists equipment_reversal_approval_audit_append_only on public.equipment_reversal_approval_audit;
create trigger equipment_reversal_approval_audit_append_only
  before update or delete on public.equipment_reversal_approval_audit
  for each row execute function public.prevent_equipment_reversal_approval_audit_mutation();

create or replace function public.qep_is_equipment_reversal_manager_approver(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and (
        p.role::text = 'manager'
        or p.iron_role = 'iron_manager'
      )
  );
$$;

revoke execute on function public.qep_is_equipment_reversal_manager_approver(uuid) from public;
grant execute on function public.qep_is_equipment_reversal_manager_approver(uuid) to authenticated;
grant execute on function public.qep_is_equipment_reversal_manager_approver(uuid) to service_role;

create or replace function public.record_equipment_reversal_manager_approval(
  p_credit_memo_id uuid,
  p_approved_by uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := public.get_my_workspace();
  v_actor uuid := auth.uid();
  v_actor_role text := coalesce((select public.get_my_role())::text, '');
  v_reason text := nullif(trim(p_reason), '');
  v_credit_memo public.credit_memos%rowtype;
  v_approver_role text;
  v_approver_iron_role text;
  v_audit_id uuid;
begin
  if (select auth.role()) <> 'service_role'
     and v_actor_role not in ('admin', 'manager', 'owner', 'finance_admin') then
    raise exception 'VALIDATION_EQUIPMENT_REVERSAL_APPROVAL_ELEVATED_ROLE_REQUIRED';
  end if;

  if p_credit_memo_id is null then
    raise exception 'VALIDATION_CREDIT_MEMO_ID_REQUIRED';
  end if;
  if p_approved_by is null then
    raise exception 'VALIDATION_MANAGER_APPROVER_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_MANAGER_APPROVAL_REASON_REQUIRED';
  end if;
  if not public.qep_is_equipment_reversal_manager_approver(p_approved_by) then
    raise exception 'VALIDATION_MANAGER_OR_IRON_MANAGER_APPROVER_REQUIRED';
  end if;

  select * into v_credit_memo
  from public.credit_memos cm
  where cm.id = p_credit_memo_id
    and cm.workspace_id = v_workspace_id
    and cm.deleted_at is null
  for update;

  if v_credit_memo.id is null then
    raise exception 'VALIDATION_CREDIT_MEMO_NOT_FOUND';
  end if;

  select p.role::text, p.iron_role
    into v_approver_role, v_approver_iron_role
  from public.profiles p
  where p.id = p_approved_by;

  insert into public.equipment_reversal_approval_audit (
    workspace_id,
    credit_memo_id,
    original_invoice_id,
    qrm_equipment_id,
    reversal_id,
    approved_by,
    approved_by_role,
    approved_by_iron_role,
    reason,
    requested_by,
    requested_by_role,
    metadata
  ) values (
    v_credit_memo.workspace_id,
    v_credit_memo.id,
    v_credit_memo.original_invoice_id,
    v_credit_memo.qrm_equipment_id,
    v_credit_memo.reversal_id,
    p_approved_by,
    v_approver_role,
    v_approver_iron_role,
    v_reason,
    v_actor,
    v_actor_role,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_audit_id;

  update public.credit_memos cm
  set
    manager_approved_by = p_approved_by,
    metadata = coalesce(cm.metadata, '{}'::jsonb) || jsonb_build_object(
      'manager_approval_audit_id', v_audit_id,
      'manager_approval_reason', v_reason,
      'manager_approval_recorded_at', now()
    ),
    updated_at = now()
  where cm.id = v_credit_memo.id;

  return v_audit_id;
end;
$$;

revoke execute on function public.record_equipment_reversal_manager_approval(uuid, uuid, text, jsonb) from public;
grant execute on function public.record_equipment_reversal_manager_approval(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.record_equipment_reversal_manager_approval(uuid, uuid, text, jsonb) to service_role;

create or replace function public.reverse_equipment_sale_by_stock_number_with_approval(
  p_stock_number text,
  p_reversal_id text,
  p_reason text,
  p_manager_approved_by uuid,
  p_manager_approval_reason text,
  p_revert_availability text default 'available',
  p_revert_in_out_state text default 'in',
  p_revert_inventory_type text default null,
  p_finance_approved_by uuid default null,
  p_owner_approved_by uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  credit_memo_id uuid,
  reversal_id text,
  credit_memo_number text,
  stock_number text,
  equipment_id uuid,
  invoice_id uuid,
  invoice_number text,
  policy_branch text,
  invoice_status text,
  equipment_availability text,
  equipment_in_out_state text,
  quickbooks_sync_status text,
  gl_journal_entry_id uuid,
  prior_period_reversal boolean,
  rental_invoice_id uuid,
  refund_amount numeric,
  idempotent boolean,
  manager_approval_audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reversal record;
  v_audit_id uuid;
begin
  if p_manager_approved_by is null then
    raise exception 'VALIDATION_MANAGER_APPROVER_REQUIRED';
  end if;
  if nullif(trim(p_manager_approval_reason), '') is null then
    raise exception 'VALIDATION_MANAGER_APPROVAL_REASON_REQUIRED';
  end if;
  if not public.qep_is_equipment_reversal_manager_approver(p_manager_approved_by) then
    raise exception 'VALIDATION_MANAGER_OR_IRON_MANAGER_APPROVER_REQUIRED';
  end if;

  select * into v_reversal
  from public.reverse_equipment_sale_by_stock_number(
    p_stock_number,
    p_reversal_id,
    p_reason,
    p_revert_availability,
    p_revert_in_out_state,
    p_revert_inventory_type,
    p_manager_approved_by,
    p_finance_approved_by,
    p_owner_approved_by
  );

  v_audit_id := public.record_equipment_reversal_manager_approval(
    v_reversal.credit_memo_id,
    p_manager_approved_by,
    p_manager_approval_reason,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source_function', 'reverse_equipment_sale_by_stock_number_with_approval',
      'stock_number', p_stock_number,
      'idempotent', v_reversal.idempotent
    )
  );

  return query
  select
    v_reversal.credit_memo_id::uuid,
    v_reversal.reversal_id::text,
    v_reversal.credit_memo_number::text,
    v_reversal.stock_number::text,
    v_reversal.equipment_id::uuid,
    v_reversal.invoice_id::uuid,
    v_reversal.invoice_number::text,
    v_reversal.policy_branch::text,
    v_reversal.invoice_status::text,
    v_reversal.equipment_availability::text,
    v_reversal.equipment_in_out_state::text,
    v_reversal.quickbooks_sync_status::text,
    v_reversal.gl_journal_entry_id::uuid,
    v_reversal.prior_period_reversal::boolean,
    v_reversal.rental_invoice_id::uuid,
    v_reversal.refund_amount::numeric,
    v_reversal.idempotent::boolean,
    v_audit_id;
end;
$$;

revoke execute on function public.reverse_equipment_sale_by_stock_number_with_approval(text, text, text, uuid, text, text, text, text, uuid, uuid, jsonb) from public;
grant execute on function public.reverse_equipment_sale_by_stock_number_with_approval(text, text, text, uuid, text, text, text, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.reverse_equipment_sale_by_stock_number_with_approval(text, text, text, uuid, text, text, text, text, uuid, uuid, jsonb) to service_role;

drop policy if exists "credit_memos_elevated_all" on public.credit_memos;
create policy "credit_memos_elevated_all"
  on public.credit_memos for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner', 'finance_admin')
    and workspace_id = (select public.get_my_workspace())
  );
