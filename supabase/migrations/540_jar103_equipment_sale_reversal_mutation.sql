-- 540_jar103_equipment_sale_reversal_mutation.sql
--
-- JAR-103: Atomic equipment sale reversal by stock number.
-- Policy source: user-approved 2026-05-04 equipment sale reversal policy.
--
-- This migration does not mark the parity workbook row BUILT. It adds the
-- runtime mutation and audit model required before workflow verification can
-- promote the row.

create table if not exists public.credit_memos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  reversal_id text not null,
  original_invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  qrm_equipment_id uuid references public.qrm_equipment(id) on delete set null,
  crm_company_id uuid,
  portal_customer_id uuid references public.portal_customers(id) on delete set null,
  rental_invoice_id uuid references public.rental_invoices(id) on delete set null,
  credit_memo_number text not null,
  policy_branch text not null check (policy_branch in (
    'unpaid_void',
    'partial_paid_credit_memo',
    'fully_paid_credit_memo',
    'gl_posted_open_period_credit_memo',
    'closed_period_adjusting_credit_memo'
  )),
  reason text not null,
  amount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  refund_amount numeric not null default 0,
  status text not null default 'issued' check (status in ('issued', 'queued', 'posted', 'failed', 'void')),
  quickbooks_sync_status text not null default 'not_required' check (quickbooks_sync_status in ('not_required', 'queued', 'processing', 'posted', 'failed')),
  quickbooks_txn_id text,
  quickbooks_last_error text,
  tax_reversal_source text not null default 'tax_calculator_credit_memo' check (tax_reversal_source = 'tax_calculator_credit_memo'),
  gl_journal_entry_id uuid references public.gl_journal_entries(id) on delete set null,
  original_invoice_status text not null,
  original_invoice_amount_paid numeric not null default 0,
  original_quickbooks_gl_status text not null default 'not_synced',
  original_gl_period_status text,
  prior_period_reversal boolean not null default false,
  prior_equipment_availability text,
  reverted_equipment_availability text,
  prior_equipment_in_out_state text,
  reverted_equipment_in_out_state text,
  prior_equipment_inventory_type text,
  reverted_equipment_inventory_type text,
  manager_approved_by uuid references public.profiles(id) on delete set null,
  finance_approved_by uuid references public.profiles(id) on delete set null,
  owner_approved_by uuid references public.profiles(id) on delete set null,
  issued_by uuid references public.profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, reversal_id),
  unique (workspace_id, credit_memo_number)
);

comment on table public.credit_memos is
  'Dedicated AR credit memo records for invoice reversals. JAR-103 equipment sale reversals always create a linked row here; original invoices are never deleted.';
comment on column public.credit_memos.reversal_id is
  'Caller-supplied idempotency key. Same workspace/reversal_id returns the same reversal and cannot reverse a different invoice.';
comment on column public.credit_memos.policy_branch is
  'Approved JAR-103 policy branch: unpaid void, paid credit memo/refund, GL-posted credit memo, or closed-period adjusting reversal.';
comment on column public.credit_memos.tax_reversal_source is
  'Tax reversal flows from credit memo handling through the tax-calculator edge function; no separate tax reversal path is modeled.';
comment on column public.credit_memos.prior_period_reversal is
  'True when the original invoice date falls in a hard-closed GL period; reversal posts in the current open period with owner approval metadata.';

create index if not exists idx_credit_memos_original_invoice
  on public.credit_memos (workspace_id, original_invoice_id, issued_at desc)
  where deleted_at is null;
comment on index public.idx_credit_memos_original_invoice is
  'Purpose: invoice reversal audit chain and idempotent credit memo lookup.';

create index if not exists idx_credit_memos_equipment
  on public.credit_memos (workspace_id, qrm_equipment_id, issued_at desc)
  where qrm_equipment_id is not null and deleted_at is null;
comment on index public.idx_credit_memos_equipment is
  'Purpose: stock-number/equipment reversal history.';

alter table public.credit_memos enable row level security;

drop policy if exists "credit_memos_service_all" on public.credit_memos;
create policy "credit_memos_service_all"
  on public.credit_memos for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "credit_memos_elevated_all" on public.credit_memos;
create policy "credit_memos_elevated_all"
  on public.credit_memos for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

drop policy if exists "credit_memos_rep_select" on public.credit_memos;
create policy "credit_memos_rep_select"
  on public.credit_memos for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

drop trigger if exists set_credit_memos_updated_at on public.credit_memos;
create trigger set_credit_memos_updated_at
  before update on public.credit_memos
  for each row execute function public.set_updated_at();

alter table public.customer_invoices
  add column if not exists credit_memo_id uuid references public.credit_memos(id) on delete set null;

comment on column public.customer_invoices.credit_memo_id is
  'Dedicated credit_memos row generated by an equipment sale reversal. Original invoices remain intact for audit.';

alter table public.qrm_equipment
  add column if not exists sale_reversal_credit_memo_id uuid references public.credit_memos(id) on delete set null,
  add column if not exists sale_reversal_at timestamptz,
  add column if not exists sale_reversal_reason text;

comment on column public.qrm_equipment.sale_reversal_credit_memo_id is
  'Latest JAR-103 sale reversal credit memo that returned this stock number to inventory/rental state.';
comment on column public.qrm_equipment.sale_reversal_reason is
  'Business reason captured when a stock-number sale reversal reverts equipment state.';

create or replace function public.reverse_equipment_sale_by_stock_number(
  p_stock_number text,
  p_reversal_id text,
  p_reason text,
  p_revert_availability text default 'available',
  p_revert_in_out_state text default 'in',
  p_revert_inventory_type text default null,
  p_manager_approved_by uuid default null,
  p_finance_approved_by uuid default null,
  p_owner_approved_by uuid default null
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
  idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id text := public.get_my_workspace();
  v_actor uuid := auth.uid();
  v_role text := public.get_my_role();
  v_stock_number text := nullif(trim(p_stock_number), '');
  v_reversal_id text := nullif(trim(p_reversal_id), '');
  v_reason text := nullif(trim(p_reason), '');
  v_invoice public.customer_invoices%rowtype;
  v_equipment public.qrm_equipment%rowtype;
  v_existing public.credit_memos%rowtype;
  v_credit_memo public.credit_memos%rowtype;
  v_invoice_period_id uuid;
  v_invoice_period_status text;
  v_reversal_period_id uuid;
  v_policy_branch text;
  v_credit_amount numeric := 0;
  v_credit_tax numeric := 0;
  v_credit_total numeric := 0;
  v_refund_amount numeric := 0;
  v_prior_period boolean := false;
  v_requires_qb_sync boolean := false;
  v_credit_memo_number text;
  v_gl_journal_entry_id uuid;
  v_rental_invoice_id uuid;
  v_rental_branch boolean := false;
  v_revert_availability text := nullif(trim(coalesce(p_revert_availability, 'available')), '');
  v_revert_in_out_state text := nullif(trim(coalesce(p_revert_in_out_state, 'in')), '');
  v_revert_inventory_type text := nullif(trim(p_revert_inventory_type), '');
  v_manager_approved_by uuid := coalesce(p_manager_approved_by, v_actor);
  v_quickbooks_sync_status text := 'not_required';
  v_reversal_posting_date date := current_date;
begin
  if auth.role() <> 'service_role' and coalesce(v_role, '') not in ('admin', 'manager', 'owner') then
    raise exception 'VALIDATION_EQUIPMENT_REVERSAL_ELEVATED_ROLE_REQUIRED';
  end if;

  if v_stock_number is null then
    raise exception 'VALIDATION_STOCK_NUMBER_REQUIRED';
  end if;
  if v_reversal_id is null then
    raise exception 'VALIDATION_REVERSAL_ID_REQUIRED';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_REVERSAL_REASON_REQUIRED';
  end if;

  if v_revert_availability is not null and not exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'crm_equipment_availability'
      and e.enumlabel = v_revert_availability
  ) then
    raise exception 'VALIDATION_REVERT_AVAILABILITY_INVALID';
  end if;

  if v_revert_in_out_state is not null and not exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'equipment_in_out'
      and e.enumlabel = v_revert_in_out_state
  ) then
    raise exception 'VALIDATION_REVERT_IN_OUT_STATE_INVALID';
  end if;

  if v_revert_inventory_type is not null and not exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'inventory_type'
      and e.enumlabel = v_revert_inventory_type
  ) then
    raise exception 'VALIDATION_REVERT_INVENTORY_TYPE_INVALID';
  end if;

  select * into v_equipment
  from public.qrm_equipment e
  where e.workspace_id = v_workspace_id
    and e.stock_number = v_stock_number
    and e.deleted_at is null
  for update;

  if v_equipment.id is null then
    raise exception 'VALIDATION_EQUIPMENT_NOT_FOUND';
  end if;

  select * into v_invoice
  from public.customer_invoices ci
  where ci.workspace_id = v_workspace_id
    and ci.qrm_equipment_id = v_equipment.id
    and ci.invoice_type = 'equipment'
    and ci.reversal_of_invoice_id is null
  order by ci.invoice_date desc, ci.created_at desc
  limit 1
  for update;

  if v_invoice.id is null then
    raise exception 'VALIDATION_EQUIPMENT_INVOICE_NOT_FOUND';
  end if;

  select * into v_existing
  from public.credit_memos cm
  where cm.workspace_id = v_workspace_id
    and cm.reversal_id = v_reversal_id
    and cm.deleted_at is null
  for update;

  if v_existing.id is not null then
    if v_existing.original_invoice_id is distinct from v_invoice.id then
      raise exception 'VALIDATION_REVERSAL_ID_CONFLICT';
    end if;

    return query
    select
      cm.id,
      cm.reversal_id,
      cm.credit_memo_number,
      e.stock_number,
      cm.qrm_equipment_id,
      cm.original_invoice_id,
      ci.invoice_number,
      cm.policy_branch,
      ci.status::text,
      e.availability::text,
      e.in_out_state::text,
      cm.quickbooks_sync_status,
      cm.gl_journal_entry_id,
      cm.prior_period_reversal,
      cm.rental_invoice_id,
      cm.refund_amount,
      true
    from public.credit_memos cm
    join public.customer_invoices ci on ci.id = cm.original_invoice_id
    left join public.qrm_equipment e on e.id = cm.qrm_equipment_id
    where cm.id = v_existing.id;
    return;
  end if;

  if v_invoice.status in ('void', 'reversed') then
    raise exception 'VALIDATION_INVOICE_ALREADY_VOID_OR_REVERSED';
  end if;
  if v_invoice.credit_memo_id is not null or v_invoice.reversed_at is not null then
    raise exception 'VALIDATION_INVOICE_ALREADY_HAS_REVERSAL';
  end if;
  if v_equipment.in_out_state is distinct from 'sold'::public.equipment_in_out then
    raise exception 'VALIDATION_EQUIPMENT_NOT_MARKED_SOLD';
  end if;

  select gp.id, gp.status::text
    into v_invoice_period_id, v_invoice_period_status
  from public.gl_periods gp
  where gp.workspace_id = v_workspace_id
    and gp.deleted_at is null
    and v_invoice.invoice_date between gp.period_start and gp.period_end
  order by case when gp.company_id is null then 0 else 1 end,
           gp.period_start desc
  limit 1;

  if v_invoice_period_id is null then
    raise exception 'VALIDATION_GL_PERIOD_REQUIRED';
  end if;

  v_prior_period := v_invoice_period_status = 'hard_closed';

  if v_invoice.quickbooks_gl_status = 'posted' or v_prior_period then
    v_credit_amount := coalesce(v_invoice.amount, 0);
    v_credit_tax := coalesce(v_invoice.tax, 0);
    v_policy_branch := case
      when v_prior_period then 'closed_period_adjusting_credit_memo'
      else 'gl_posted_open_period_credit_memo'
    end;
    v_requires_qb_sync := true;
  elsif coalesce(v_invoice.amount_paid, 0) <= 0 then
    v_credit_amount := 0;
    v_credit_tax := 0;
    v_policy_branch := 'unpaid_void';
  elsif coalesce(v_invoice.amount_paid, 0) < coalesce(v_invoice.total, 0) then
    v_credit_amount := coalesce(v_invoice.amount_paid, 0);
    v_credit_tax := case
      when coalesce(v_invoice.total, 0) = 0 then 0
      else round(coalesce(v_invoice.tax, 0) * (coalesce(v_invoice.amount_paid, 0) / v_invoice.total), 2)
    end;
    v_policy_branch := 'partial_paid_credit_memo';
  else
    v_credit_amount := coalesce(v_invoice.amount, 0);
    v_credit_tax := coalesce(v_invoice.tax, 0);
    v_policy_branch := 'fully_paid_credit_memo';
  end if;

  v_credit_total := v_credit_amount + v_credit_tax;
  v_refund_amount := least(coalesce(v_invoice.amount_paid, 0), greatest(v_credit_total, 0));

  if v_policy_branch in ('partial_paid_credit_memo', 'fully_paid_credit_memo', 'gl_posted_open_period_credit_memo', 'closed_period_adjusting_credit_memo')
     and p_finance_approved_by is null then
    raise exception 'VALIDATION_FINANCE_APPROVAL_REQUIRED';
  end if;

  if v_prior_period and p_owner_approved_by is null then
    raise exception 'VALIDATION_OWNER_APPROVAL_REQUIRED';
  end if;

  if v_requires_qb_sync then
    v_quickbooks_sync_status := 'queued';
  end if;

  select ri.id into v_rental_invoice_id
  from public.rental_invoices ri
  where ri.workspace_id = v_workspace_id
    and ri.customer_invoice_id = v_invoice.id
    and ri.deleted_at is null
  order by ri.created_at desc
  limit 1
  for update;

  v_rental_branch := v_rental_invoice_id is not null
    or v_equipment.ownership = 'rental_fleet'::public.crm_equipment_ownership
    or v_equipment.inventory_type = 'rental_fleet'::public.inventory_type;

  if v_rental_branch then
    v_revert_availability := coalesce(v_revert_availability, 'available');
    v_revert_in_out_state := coalesce(v_revert_in_out_state, 'in');
    v_revert_inventory_type := coalesce(v_revert_inventory_type, 'rental_fleet');
  end if;

  if v_prior_period then
    select gp.id into v_reversal_period_id
    from public.gl_periods gp
    where gp.workspace_id = v_workspace_id
      and gp.deleted_at is null
      and current_date between gp.period_start and gp.period_end
      and gp.status in ('open', 'soft_closed')
    order by case when gp.company_id is null then 0 else 1 end,
             gp.period_start desc
    limit 1;

    if v_reversal_period_id is null then
      raise exception 'VALIDATION_CURRENT_OPEN_GL_PERIOD_REQUIRED';
    end if;
  else
    v_reversal_period_id := v_invoice_period_id;
    v_reversal_posting_date := v_invoice.invoice_date;
  end if;

  if v_requires_qb_sync or v_prior_period then
    insert into public.gl_journal_entries (
      workspace_id,
      journal_number,
      journal_type,
      source_module,
      source_reference,
      posting_date,
      period_id,
      memo,
      status
    ) values (
      v_workspace_id,
      'REV-' || left(regexp_replace(v_reversal_id, '[^A-Za-z0-9]+', '', 'g'), 24),
      case when v_prior_period then 'adjusting' else 'reversal' end,
      'equipment_sale_reversal',
      v_reversal_id,
      case when v_prior_period then current_date else v_reversal_posting_date end,
      v_reversal_period_id,
      case when v_prior_period then 'Prior-period equipment sale reversal for stock ' else 'Equipment sale reversal for stock ' end || v_stock_number,
      'unposted'
    )
    returning id into v_gl_journal_entry_id;
  end if;

  v_credit_memo_number := 'CM-' || v_invoice.invoice_number || '-' || left(regexp_replace(v_reversal_id, '[^A-Za-z0-9]+', '', 'g'), 8);

  insert into public.credit_memos (
    workspace_id,
    reversal_id,
    original_invoice_id,
    qrm_equipment_id,
    crm_company_id,
    portal_customer_id,
    rental_invoice_id,
    credit_memo_number,
    policy_branch,
    reason,
    amount,
    tax,
    total,
    refund_amount,
    status,
    quickbooks_sync_status,
    gl_journal_entry_id,
    original_invoice_status,
    original_invoice_amount_paid,
    original_quickbooks_gl_status,
    original_gl_period_status,
    prior_period_reversal,
    prior_equipment_availability,
    reverted_equipment_availability,
    prior_equipment_in_out_state,
    reverted_equipment_in_out_state,
    prior_equipment_inventory_type,
    reverted_equipment_inventory_type,
    manager_approved_by,
    finance_approved_by,
    owner_approved_by,
    issued_by,
    metadata
  ) values (
    v_workspace_id,
    v_reversal_id,
    v_invoice.id,
    v_equipment.id,
    v_invoice.crm_company_id,
    v_invoice.portal_customer_id,
    v_rental_invoice_id,
    v_credit_memo_number,
    v_policy_branch,
    v_reason,
    v_credit_amount,
    v_credit_tax,
    v_credit_total,
    v_refund_amount,
    case when v_requires_qb_sync then 'queued' else 'issued' end,
    v_quickbooks_sync_status,
    v_gl_journal_entry_id,
    v_invoice.status::text,
    coalesce(v_invoice.amount_paid, 0),
    coalesce(v_invoice.quickbooks_gl_status, 'not_synced'),
    v_invoice_period_status,
    v_prior_period,
    v_equipment.availability::text,
    v_revert_availability,
    v_equipment.in_out_state::text,
    v_revert_in_out_state,
    v_equipment.inventory_type::text,
    v_revert_inventory_type,
    v_manager_approved_by,
    p_finance_approved_by,
    p_owner_approved_by,
    v_actor,
    jsonb_build_object(
      'policy_source', 'JAR-103 approved equipment sale reversal policy 2026-05-04',
      'tax_policy', 'tax reversal flows through tax-calculator credit memo handling',
      'rental_branch', v_rental_branch,
      'original_invoice_total', v_invoice.total,
      'original_invoice_tax', v_invoice.tax,
      'original_invoice_quickbooks_txn_id', v_invoice.quickbooks_gl_txn_id
    )
  ) returning * into v_credit_memo;

  update public.customer_invoices ci
  set
    status = case when v_policy_branch = 'unpaid_void' then 'void' else 'reversed' end,
    reversal_reason = v_reason,
    reversed_at = now(),
    reversed_by = v_actor,
    reversal_gl_journal_entry_id = v_gl_journal_entry_id,
    credit_memo_id = v_credit_memo.id,
    updated_at = now()
  where ci.id = v_invoice.id;

  if v_rental_invoice_id is not null then
    update public.rental_invoices ri
    set
      status = 'reversed',
      reversal_reason = v_reason,
      reversed_at = now(),
      metadata = coalesce(ri.metadata, '{}'::jsonb) || jsonb_build_object(
        'equipment_sale_reversal_id', v_reversal_id,
        'credit_memo_id', v_credit_memo.id,
        'rental_branch_reversal', true
      ),
      updated_at = now()
    where ri.id = v_rental_invoice_id;
  end if;

  update public.qrm_equipment e
  set
    availability = coalesce(v_revert_availability, 'available')::public.crm_equipment_availability,
    in_out_state = coalesce(v_revert_in_out_state, 'in')::public.equipment_in_out,
    inventory_type = coalesce(v_revert_inventory_type, e.inventory_type::text)::public.inventory_type,
    ownership = case when v_rental_branch then 'rental_fleet'::public.crm_equipment_ownership else e.ownership end,
    sale_reversal_credit_memo_id = v_credit_memo.id,
    sale_reversal_at = now(),
    sale_reversal_reason = v_reason,
    updated_at = now()
  where e.id = v_equipment.id;

  return query
  select
    cm.id,
    cm.reversal_id,
    cm.credit_memo_number,
    e.stock_number,
    cm.qrm_equipment_id,
    cm.original_invoice_id,
    ci.invoice_number,
    cm.policy_branch,
    ci.status::text,
    e.availability::text,
    e.in_out_state::text,
    cm.quickbooks_sync_status,
    cm.gl_journal_entry_id,
    cm.prior_period_reversal,
    cm.rental_invoice_id,
    cm.refund_amount,
    false
  from public.credit_memos cm
  join public.customer_invoices ci on ci.id = cm.original_invoice_id
  left join public.qrm_equipment e on e.id = cm.qrm_equipment_id
  where cm.id = v_credit_memo.id;
end;
$$;

comment on function public.reverse_equipment_sale_by_stock_number(text, text, text, text, text, text, uuid, uuid, uuid) is
  'Atomic JAR-103 stock-number sale reversal. Creates a dedicated credit_memos record, applies unpaid/paid/posted/closed-period policy, queues QuickBooks credit memo sync metadata, reverts equipment state, handles rental branch invoice history, and is idempotent by reversal_id.';

revoke execute on function public.reverse_equipment_sale_by_stock_number(text, text, text, text, text, text, uuid, uuid, uuid) from public;
grant execute on function public.reverse_equipment_sale_by_stock_number(text, text, text, text, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.reverse_equipment_sale_by_stock_number(text, text, text, text, text, text, uuid, uuid, uuid) to service_role;

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
    select null::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text,
           'blocked'::text, array['missing_stock_number']::text[];
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
      if v_invoice_status in ('void', 'reversed') then
        v_blockers := array_append(v_blockers, 'invoice_status_blocks_reversal');
      end if;

      select gp.status::text
        into v_posting_period_status
      from public.gl_periods gp
      where gp.workspace_id = v_workspace_id
        and gp.deleted_at is null
        and v_invoice_date between gp.period_start and gp.period_end
      order by case when gp.company_id is null then 0 else 1 end,
               gp.period_start desc
      limit 1;

      if v_posting_period_status is null then
        v_blockers := array_append(v_blockers, 'no_gl_period_for_invoice_date');
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
  'Read-only JAR-103 stock-number sale reversal readiness check after approved finance policy. Paid, QuickBooks-posted, and closed-period invoices are no longer hard blockers; the execution RPC enforces finance/owner approval metadata.';
