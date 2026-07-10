-- 811_rental_billing_resumable_batches.sql
-- RB-BILLING-RUNNER-SCALE
--
-- Replaces the edge runner's silent 500-contract ceiling with a durable,
-- workspace-scoped work queue. Each HTTP invocation claims a bounded batch;
-- concurrent workers use SKIP LOCKED leases, expired claims are resumable,
-- and terminal item rows are the per-contract checkpoint/audit record.
--
-- The active contract-period unique index closes the select-then-insert race
-- across concurrent workers/runs while continuing to permit a replacement
-- after an invoice is voided, reversed, or soft-deleted.
--
-- Rollback (manual, after draining active runs):
--   drop function if exists public.finalize_rental_billing_run(uuid);
--   drop function if exists public.complete_rental_billing_item(uuid, uuid, text, uuid, bigint, bigint, boolean, text);
--   drop function if exists public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb);
--   drop function if exists public.claim_rental_billing_batch(uuid, uuid, integer, integer);
--   drop function if exists public.start_or_resume_rental_billing_run(text, integer, uuid, boolean, uuid[]);
--   drop table if exists public.rental_billing_run_items;
--   drop index if exists public.uq_rental_invoices_active_contract_period;

begin;

-- Return assessments can be corrected by superseding rows. Give operators a
-- reversible soft-delete path as well, and ensure the billing runner excludes
-- retired assessments instead of charging a row hidden from normal history.
alter table public.rental_returns
  add column if not exists deleted_at timestamptz;

create index if not exists idx_rental_returns_active_contract_equipment
  on public.rental_returns (workspace_id, rental_contract_id, equipment_id, updated_at desc, created_at desc)
  where deleted_at is null;

-- The existing run header remains the operator-facing audit spine. Counts are
-- persisted, not reconstructed from one short-lived edge invocation.
alter table public.rental_billing_runs
  drop constraint if exists rental_billing_runs_status_check;

alter table public.rental_billing_runs
  add constraint rental_billing_runs_status_check
  check (status in (
    'draft', 'running', 'partial', 'resumed', 'completed', 'failed', 'rolled_back'
  ));

alter table public.rental_billing_runs
  add column if not exists examined_count integer not null default 0 check (examined_count >= 0),
  add column if not exists skipped_count integer not null default 0 check (skipped_count >= 0),
  add column if not exists failed_count integer not null default 0 check (failed_count >= 0),
  add column if not exists mirror_skipped_count integer not null default 0 check (mirror_skipped_count >= 0),
  add column if not exists total_tax_cents bigint not null default 0 check (total_tax_cents >= 0),
  add column if not exists batch_size integer not null default 25 check (batch_size between 1 and 100),
  add column if not exists batch_count integer not null default 0 check (batch_count >= 0),
  add column if not exists resume_count integer not null default 0 check (resume_count >= 0),
  add column if not exists last_batch_at timestamptz;

comment on column public.rental_billing_runs.examined_count is
  'Durable terminal-item count (invoiced + skipped + failed) across every bounded request in the run.';
comment on column public.rental_billing_runs.resume_count is
  'Number of claims after the first batch; proves a partial run resumed rather than silently restarting.';

create table if not exists public.rental_billing_run_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  rental_billing_run_id uuid not null references public.rental_billing_runs(id) on delete cascade,
  rental_contract_id uuid not null references public.rental_contracts(id),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'invoiced', 'skipped', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  worker_token uuid,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  rental_invoice_id uuid references public.rental_invoices(id) on delete set null,
  billed_cents bigint not null default 0 check (billed_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  mirror_skipped boolean not null default false,
  error_detail text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rental_billing_run_id, rental_contract_id)
);

comment on table public.rental_billing_run_items is
  'Durable per-contract checkpoints for resumable rental billing batches. A lease owns processing; terminal states never requeue automatically.';

create index if not exists idx_rental_billing_run_items_claim
  on public.rental_billing_run_items (rental_billing_run_id, status, rental_contract_id)
  where status in ('pending', 'processing');

create index if not exists idx_rental_billing_run_items_expired_lease
  on public.rental_billing_run_items (rental_billing_run_id, lease_expires_at)
  where status = 'processing';

-- Database-enforced final guard for concurrent runs or an expired worker that
-- finishes after its replacement. Invoice numbering is already atomic in
-- next_invoice_number; this index makes contract-period idempotency atomic too.
create unique index if not exists uq_rental_invoices_active_contract_period
  on public.rental_invoices (rental_contract_id, period_start, period_end)
  where deleted_at is null
    and status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    );

alter table public.rental_billing_run_items enable row level security;

create policy "rental_billing_run_items_service_all"
  on public.rental_billing_run_items for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "rental_billing_run_items_internal_read"
  on public.rental_billing_run_items for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

drop trigger if exists set_rental_billing_run_items_updated_at
  on public.rental_billing_run_items;
create trigger set_rental_billing_run_items_updated_at
  before update on public.rental_billing_run_items
  for each row execute function public.set_updated_at();

-- Create a production-shaped cohort once, then resume that same immutable
-- cohort. p_force_new exists for explicit load/acceptance runs only; normal
-- cron/manual calls reuse the oldest active protocol run, or today's terminal
-- run for replay-idempotent no-op behavior.
create or replace function public.start_or_resume_rental_billing_run(
  p_workspace_id text default 'default',
  p_batch_size integer default 25,
  p_run_id uuid default null,
  p_force_new boolean default false,
  p_contract_ids uuid[] default null
)
returns table (
  billing_run_id uuid,
  run_status text,
  created_new boolean,
  total_items integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.rental_billing_runs%rowtype;
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_created boolean := false;
  v_total integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_workspace_id is null or btrim(p_workspace_id) = '' then
    raise exception 'workspace_id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rental-billing:' || p_workspace_id, 0)
  );

  if p_run_id is not null then
    select r.* into v_run
    from public.rental_billing_runs r
    where r.id = p_run_id
      and r.workspace_id = p_workspace_id
      and r.deleted_at is null
    for update;
    if not found then
      raise exception 'rental billing run not found in workspace';
    end if;
    if coalesce(v_run.metadata ->> 'protocol', '') <> 'durable_batch_v1' then
      raise exception 'rental billing run does not use durable_batch_v1';
    end if;
  elsif not coalesce(p_force_new, false) then
    -- A prior-day partial run must drain before a fresh cohort is opened.
    select r.* into v_run
    from public.rental_billing_runs r
    where r.workspace_id = p_workspace_id
      and r.deleted_at is null
      and r.metadata ->> 'protocol' = 'durable_batch_v1'
      and r.status in ('draft', 'running', 'partial', 'resumed')
    order by r.created_at asc, r.id asc
    limit 1
    for update;

    if not found then
      -- A replay later the same day returns the terminal run instead of
      -- rebuilding the cohort and re-examining every contract.
      select r.* into v_run
      from public.rental_billing_runs r
      where r.workspace_id = p_workspace_id
        and r.run_date = current_date
        and r.deleted_at is null
        and r.metadata ->> 'protocol' = 'durable_batch_v1'
      order by r.created_at desc, r.id desc
      limit 1
      for update;
    end if;
  end if;

  if v_run.id is null then
    insert into public.rental_billing_runs (
      workspace_id,
      run_date,
      billing_cycle,
      status,
      triggered_by,
      batch_size,
      metadata
    ) values (
      p_workspace_id,
      current_date,
      'cycle_28_day',
      'running',
      null,
      v_batch_size,
      jsonb_build_object(
        'triggered_by', 'rental-billing-runner',
        'protocol', 'durable_batch_v1',
        'ordering', 'rental_contract_id_asc',
        'contract_scope', case when p_contract_ids is null then 'workspace' else 'explicit_ids' end
      )
    )
    returning * into v_run;
    v_created := true;

    insert into public.rental_billing_run_items (
      workspace_id,
      rental_billing_run_id,
      rental_contract_id
    )
    select c.workspace_id, v_run.id, c.id
    from public.rental_contracts c
    where c.workspace_id = p_workspace_id
      and c.lifecycle_state in ('on_rent', 'off_rent', 'returned')
      and c.deleted_at is null
      and (p_contract_ids is null or c.id = any(p_contract_ids))
    order by c.id
    on conflict (rental_billing_run_id, rental_contract_id) do nothing;

    get diagnostics v_total = row_count;

    update public.rental_billing_runs r
    set status = case when v_total = 0 then 'completed' else 'running' end,
        completed_at = case when v_total = 0 then now() else null end,
        metadata = r.metadata || jsonb_build_object('cohort_size', v_total)
    where r.id = v_run.id
    returning * into v_run;
  else
    select count(*)::integer into v_total
    from public.rental_billing_run_items i
    where i.rental_billing_run_id = v_run.id;
  end if;

  return query
  select v_run.id, v_run.status, v_created, v_total;
end;
$$;

-- Claim rows in stable contract-id order. SKIP LOCKED permits bounded parallel
-- workers; an expired processing lease is eligible for deterministic replay.
create or replace function public.claim_rental_billing_batch(
  p_run_id uuid,
  p_worker_token uuid,
  p_batch_size integer default 25,
  p_lease_seconds integer default 120
)
returns table (
  item_id uuid,
  rental_contract_id uuid,
  claim_attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.rental_billing_runs%rowtype;
  v_limit integer;
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 600));
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_token is null then
    raise exception 'worker_token is required';
  end if;

  select r.* into v_run
  from public.rental_billing_runs r
  where r.id = p_run_id and r.deleted_at is null
  for update;
  if not found then
    raise exception 'rental billing run not found';
  end if;
  if v_run.status in ('completed', 'failed', 'rolled_back') then
    return;
  end if;

  v_limit := greatest(
    1,
    least(coalesce(p_batch_size, v_run.batch_size, 25), v_run.batch_size, 100)
  );

  update public.rental_billing_runs r
  set status = case when r.batch_count = 0 then 'running' else 'resumed' end,
      batch_count = r.batch_count + 1,
      resume_count = r.resume_count + case when r.batch_count = 0 then 0 else 1 end,
      last_batch_at = now()
  where r.id = p_run_id;

  return query
  with candidates as (
    select i.id
    from public.rental_billing_run_items i
    where i.rental_billing_run_id = p_run_id
      and (
        i.status = 'pending'
        or (
          i.status = 'processing'
          and i.lease_expires_at is not null
          and i.lease_expires_at <= now()
        )
      )
    order by i.rental_contract_id asc, i.id asc
    limit v_limit
    for update skip locked
  )
  update public.rental_billing_run_items i
  set status = 'processing',
      worker_token = p_worker_token,
      lease_started_at = now(),
      lease_expires_at = now() + pg_catalog.make_interval(secs => v_lease_seconds),
      attempt_count = i.attempt_count + 1,
      error_detail = null,
      completed_at = null
  from candidates c
  where i.id = c.id
  returning i.id, i.rental_contract_id, i.attempt_count;
end;
$$;

-- Commit the money row and its durable checkpoint in the same transaction.
-- This closes the crash/lease-steal window where an invoice could exist while
-- the run item remained replayable. The AR mirror is deliberately downstream;
-- until the worker confirms it, mirror_skipped/error_detail keep that gap loud.
create or replace function public.post_rental_invoice_for_billing_item(
  p_item_id uuid,
  p_worker_token uuid,
  p_invoice jsonb
)
returns table (invoice_id uuid, created_new boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run public.rental_billing_runs%rowtype;
  v_item public.rental_billing_run_items%rowtype;
  v_contract public.rental_contracts%rowtype;
  v_invoice public.rental_invoices%rowtype;
  v_charge_sum bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_token is null
     or jsonb_typeof(p_invoice) is distinct from 'object' then
    raise exception 'worker_token and invoice object are required';
  end if;

  -- Match claim/finalize lock order (run -> item -> contract) so an invoice
  -- post cannot deadlock a concurrent claimer while still validating that the
  -- run remained billable after the worker's read phase.
  select i.rental_billing_run_id into v_run_id
  from public.rental_billing_run_items i
  where i.id = p_item_id;
  if not found then
    raise exception 'rental billing item not found';
  end if;

  select r.* into v_run
  from public.rental_billing_runs r
  where r.id = v_run_id and r.deleted_at is null
  for update;
  if not found then
    raise exception 'rental billing run not found';
  end if;

  select i.* into v_item
  from public.rental_billing_run_items i
  where i.id = p_item_id
    and i.rental_billing_run_id = v_run.id
  for update;
  if not found then
    raise exception 'rental billing item moved during invoice post';
  end if;

  if v_item.status = 'invoiced' and v_item.rental_invoice_id is not null then
    return query select v_item.rental_invoice_id, false;
    return;
  end if;
  if v_item.status <> 'processing' or v_item.worker_token is distinct from p_worker_token then
    raise exception 'rental billing lease is no longer owned by this worker';
  end if;
  if v_run.status not in ('running', 'partial', 'resumed') then
    raise exception 'rental billing run is no longer active';
  end if;
  if nullif(p_invoice ->> 'workspace_id', '') is distinct from v_item.workspace_id
     or nullif(p_invoice ->> 'rental_contract_id', '')::uuid is distinct from v_item.rental_contract_id
     or nullif(p_invoice ->> 'rental_billing_run_id', '')::uuid is distinct from v_item.rental_billing_run_id then
    raise exception 'invoice payload does not match claimed billing item';
  end if;

  select c.* into v_contract
  from public.rental_contracts c
  where c.id = v_item.rental_contract_id
    and c.workspace_id = v_item.workspace_id
    and c.deleted_at is null
  for share;
  if not found then
    raise exception 'rental contract is missing, deleted, or cross-workspace';
  end if;

  if nullif(p_invoice ->> 'invoice_number', '') is null
     or nullif(p_invoice ->> 'period_start', '') is null
     or nullif(p_invoice ->> 'period_end', '') is null
     or (p_invoice ->> 'period_end')::date < (p_invoice ->> 'period_start')::date
     or coalesce(nullif(p_invoice ->> 'status', ''), 'posted') <> 'posted'
     or jsonb_typeof(coalesce(p_invoice -> 'metadata', '{}'::jsonb))
        is distinct from 'object'
     or jsonb_typeof(coalesce(p_invoice -> 'tax_breakdown', '{}'::jsonb))
        is distinct from 'object' then
    raise exception 'invoice identity, period, status, and JSON evidence are invalid';
  end if;

  if exists (
    select 1
    from jsonb_each_text(jsonb_build_object(
      'rental_charge_cents', coalesce(p_invoice ->> 'rental_charge_cents', '0'),
      'overage_charge_cents', coalesce(p_invoice ->> 'overage_charge_cents', '0'),
      'delivery_charge_cents', coalesce(p_invoice ->> 'delivery_charge_cents', '0'),
      'pickup_charge_cents', coalesce(p_invoice ->> 'pickup_charge_cents', '0'),
      'damage_waiver_charge_cents', coalesce(p_invoice ->> 'damage_waiver_charge_cents', '0'),
      'fuel_charge_cents', coalesce(p_invoice ->> 'fuel_charge_cents', '0'),
      'cleaning_charge_cents', coalesce(p_invoice ->> 'cleaning_charge_cents', '0'),
      'damage_charge_cents', coalesce(p_invoice ->> 'damage_charge_cents', '0'),
      'other_charge_cents', coalesce(p_invoice ->> 'other_charge_cents', '0'),
      'discount_cents', coalesce(p_invoice ->> 'discount_cents', '0'),
      'taxable_amount_cents', coalesce(p_invoice ->> 'taxable_amount_cents', '0'),
      'tax_cents', coalesce(p_invoice ->> 'tax_cents', '0'),
      'total_cents', coalesce(p_invoice ->> 'total_cents', '0'),
      'amount_paid_cents', coalesce(p_invoice ->> 'amount_paid_cents', '0')
    )) amount
    where amount.value::bigint < 0
  ) then
    raise exception 'invoice cents fields must be nonnegative';
  end if;

  v_charge_sum :=
    coalesce((p_invoice ->> 'rental_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'overage_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'delivery_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'pickup_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'damage_waiver_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'fuel_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'cleaning_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'damage_charge_cents')::bigint, 0)
    + coalesce((p_invoice ->> 'other_charge_cents')::bigint, 0);
  if coalesce((p_invoice ->> 'discount_cents')::bigint, 0) > v_charge_sum
     or coalesce((p_invoice ->> 'taxable_amount_cents')::bigint, 0)
        <> v_charge_sum - coalesce((p_invoice ->> 'discount_cents')::bigint, 0)
     or coalesce((p_invoice ->> 'total_cents')::bigint, 0)
        <> coalesce((p_invoice ->> 'taxable_amount_cents')::bigint, 0)
           + coalesce((p_invoice ->> 'tax_cents')::bigint, 0)
     or coalesce((p_invoice ->> 'amount_paid_cents')::bigint, 0)
        > coalesce((p_invoice ->> 'total_cents')::bigint, 0) then
    raise exception 'invoice cents do not reconcile to canonical charge, tax, and payment totals';
  end if;

  insert into public.rental_invoices (
    workspace_id,
    rental_contract_id,
    rental_billing_run_id,
    invoice_number,
    period_start,
    period_end,
    billing_cycle,
    rental_charge_cents,
    overage_charge_cents,
    delivery_charge_cents,
    pickup_charge_cents,
    damage_waiver_charge_cents,
    fuel_charge_cents,
    cleaning_charge_cents,
    damage_charge_cents,
    other_charge_cents,
    discount_cents,
    taxable_amount_cents,
    tax_cents,
    total_cents,
    amount_paid_cents,
    status,
    posted_at,
    due_date,
    ship_to_address_id,
    tax_jurisdiction_id,
    tax_breakdown,
    dr15_county_name,
    dr15_reporting_period,
    metadata
  ) values (
    v_item.workspace_id,
    v_item.rental_contract_id,
    v_item.rental_billing_run_id,
    nullif(p_invoice ->> 'invoice_number', ''),
    (p_invoice ->> 'period_start')::date,
    (p_invoice ->> 'period_end')::date,
    coalesce(nullif(p_invoice ->> 'billing_cycle', ''), 'cycle_28_day')::public.rental_billing_cycle,
    coalesce((p_invoice ->> 'rental_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'overage_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'delivery_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'pickup_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'damage_waiver_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'fuel_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'cleaning_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'damage_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'other_charge_cents')::bigint, 0),
    coalesce((p_invoice ->> 'discount_cents')::bigint, 0),
    coalesce((p_invoice ->> 'taxable_amount_cents')::bigint, 0),
    coalesce((p_invoice ->> 'tax_cents')::bigint, 0),
    coalesce((p_invoice ->> 'total_cents')::bigint, 0),
    coalesce((p_invoice ->> 'amount_paid_cents')::bigint, 0),
    coalesce(nullif(p_invoice ->> 'status', ''), 'posted')::public.rental_invoice_status,
    coalesce(nullif(p_invoice ->> 'posted_at', '')::timestamptz, now()),
    nullif(p_invoice ->> 'due_date', '')::date,
    nullif(p_invoice ->> 'ship_to_address_id', '')::uuid,
    nullif(p_invoice ->> 'tax_jurisdiction_id', '')::uuid,
    coalesce(p_invoice -> 'tax_breakdown', '{}'::jsonb),
    nullif(p_invoice ->> 'dr15_county_name', ''),
    nullif(p_invoice ->> 'dr15_reporting_period', '')::date,
    coalesce(p_invoice -> 'metadata', '{}'::jsonb)
  )
  returning * into v_invoice;

  update public.rental_billing_run_items i
  set status = 'invoiced',
      rental_invoice_id = v_invoice.id,
      billed_cents = greatest(v_invoice.taxable_amount_cents, 0),
      tax_cents = greatest(v_invoice.tax_cents, 0),
      mirror_skipped = true,
      error_detail = 'AR mirror pending after atomic invoice post',
      completed_at = now()
  where i.id = v_item.id;

  return query select v_invoice.id, true;
end;
$$;

-- Only the current lease owner can finish a row. A stale worker that lost its
-- lease cannot overwrite its replacement's result.
create or replace function public.complete_rental_billing_item(
  p_item_id uuid,
  p_worker_token uuid,
  p_status text,
  p_invoice_id uuid default null,
  p_billed_cents bigint default 0,
  p_tax_cents bigint default 0,
  p_mirror_skipped boolean default false,
  p_error_detail text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_status not in ('invoiced', 'skipped', 'failed') then
    raise exception 'terminal rental billing item status required';
  end if;

  update public.rental_billing_run_items i
  set status = p_status,
      rental_invoice_id = case when p_status = 'invoiced' then p_invoice_id else null end,
      billed_cents = case when p_status = 'invoiced' then greatest(coalesce(p_billed_cents, 0), 0) else 0 end,
      tax_cents = case when p_status = 'invoiced' then greatest(coalesce(p_tax_cents, 0), 0) else 0 end,
      mirror_skipped = coalesce(p_mirror_skipped, false),
      error_detail = p_error_detail,
      completed_at = now(),
      worker_token = null,
      lease_started_at = null,
      lease_expires_at = null
  where i.id = p_item_id
    and i.worker_token = p_worker_token
    and (
      i.status = 'processing'
      or (
        p_status = 'invoiced'
        and i.status = 'invoiced'
        and i.rental_invoice_id = p_invoice_id
      )
    );

  return found;
end;
$$;

-- Recompute truthful cumulative counts after every bounded request. Pending or
-- leased work is partial; any drained run with poison rows is failed; a fully
-- drained clean run is completed. The item table remains the exact checkpoint.
create or replace function public.finalize_rental_billing_run(p_run_id uuid)
returns table (
  billing_run_id uuid,
  run_status text,
  total_items integer,
  examined_count integer,
  invoiced_count integer,
  skipped_count integer,
  failed_count integer,
  processing_count integer,
  pending_count integer,
  claimable_count integer,
  mirror_skipped_count integer,
  total_billed_cents bigint,
  total_tax_cents bigint,
  batch_count integer,
  resume_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.rental_billing_runs%rowtype;
  v_total integer;
  v_invoiced integer;
  v_skipped integer;
  v_failed integer;
  v_processing integer;
  v_pending integer;
  v_claimable integer;
  v_mirror_skipped integer;
  v_billed bigint;
  v_tax bigint;
  v_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;

  select r.* into v_run
  from public.rental_billing_runs r
  where r.id = p_run_id and r.deleted_at is null
  for update;
  if not found then
    raise exception 'rental billing run not found';
  end if;

  select
    count(*)::integer,
    count(*) filter (where i.status = 'invoiced')::integer,
    count(*) filter (where i.status = 'skipped')::integer,
    count(*) filter (where i.status = 'failed')::integer,
    count(*) filter (where i.status = 'processing')::integer,
    count(*) filter (where i.status = 'pending')::integer,
    count(*) filter (
      where i.status = 'pending'
         or (i.status = 'processing' and i.lease_expires_at <= now())
    )::integer,
    count(*) filter (where i.mirror_skipped)::integer,
    coalesce(sum(i.billed_cents) filter (where i.status = 'invoiced'), 0)::bigint,
    coalesce(sum(i.tax_cents) filter (where i.status = 'invoiced'), 0)::bigint
  into
    v_total, v_invoiced, v_skipped, v_failed, v_processing, v_pending,
    v_claimable, v_mirror_skipped, v_billed, v_tax
  from public.rental_billing_run_items i
  where i.rental_billing_run_id = p_run_id;

  v_status := case
    when v_pending + v_processing > 0 then 'partial'
    when v_failed > 0 then 'failed'
    else 'completed'
  end;

  update public.rental_billing_runs r
  set status = v_status,
      examined_count = v_invoiced + v_skipped + v_failed,
      invoice_count = v_invoiced,
      skipped_count = v_skipped,
      failed_count = v_failed,
      mirror_skipped_count = v_mirror_skipped,
      total_billed_cents = v_billed,
      total_tax_cents = v_tax,
      completed_at = case when v_status in ('completed', 'failed') then now() else null end,
      metadata = r.metadata || jsonb_build_object(
        'total_items', v_total,
        'processing_count', v_processing,
        'pending_count', v_pending,
        'claimable_count', v_claimable,
        'last_checkpoint_at', now()
      )
  where r.id = p_run_id
  returning * into v_run;

  return query select
    v_run.id,
    v_run.status,
    v_total,
    v_run.examined_count,
    v_invoiced,
    v_skipped,
    v_failed,
    v_processing,
    v_pending,
    v_claimable,
    v_mirror_skipped,
    v_billed,
    v_tax,
    v_run.batch_count,
    v_run.resume_count;
end;
$$;

revoke execute on function public.start_or_resume_rental_billing_run(text, integer, uuid, boolean, uuid[])
  from public, anon, authenticated;
revoke execute on function public.claim_rental_billing_batch(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.complete_rental_billing_item(uuid, uuid, text, uuid, bigint, bigint, boolean, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_rental_billing_run(uuid)
  from public, anon, authenticated;

grant execute on function public.start_or_resume_rental_billing_run(text, integer, uuid, boolean, uuid[])
  to service_role;
grant execute on function public.claim_rental_billing_batch(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.complete_rental_billing_item(uuid, uuid, text, uuid, bigint, bigint, boolean, text)
  to service_role;
grant execute on function public.finalize_rental_billing_run(uuid)
  to service_role;

commit;
