-- 815_rental_service_parts_transactional_hardening.sql
--
-- Fix-forward hardening for the already-applied 810/811 migrations:
--   * reject rental money computed from a stale contract/line/return/prior-
--     invoice snapshot while holding the source rows stable through insert;
--   * keep a billing item nonterminal until its AR header, line, backlink, and
--     GL outbox row commit atomically, with an explicit retry/defer path;
--   * reopen legacy durable-batch items whose downstream mirror is incomplete;
--   * deterministically quarantine any duplicate active contract-period rows
--     before rebuilding the database uniqueness guard; and
--   * reject incomplete service-parts plans before the m810 reconciler can
--     release a reservation or cancel a PO demand.

begin;

-- Record any historical duplicate that must be retired to restore the active
-- money invariant. The original invoice is deterministic: earliest posted,
-- then earliest created, then UUID. Quarantined rows remain auditable as void
-- rental invoices rather than being physically deleted.
create table if not exists public.rental_invoice_period_quarantine (
  rental_invoice_id uuid primary key references public.rental_invoices(id),
  canonical_rental_invoice_id uuid not null references public.rental_invoices(id),
  workspace_id text not null,
  rental_contract_id uuid not null references public.rental_contracts(id),
  period_start date not null,
  period_end date not null,
  reason text not null,
  invoice_snapshot jsonb not null,
  quarantined_at timestamptz not null default now()
);

comment on table public.rental_invoice_period_quarantine is
  'Audit evidence for non-canonical active rental invoices retired before enforcing one active invoice per contract-period.';

alter table public.rental_invoice_period_quarantine enable row level security;

create policy "rental_invoice_period_quarantine_service_all"
  on public.rental_invoice_period_quarantine for all to service_role
  using (true) with check (true);

create policy "rental_invoice_period_quarantine_internal_read"
  on public.rental_invoice_period_quarantine for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  );

-- A duplicate that has taken payment or escaped into an external journal is a
-- finance incident, not a row the migration may choose to void. Abort before
-- dropping/rebuilding the invariant so an operator must reverse it explicitly.
do $$
begin
  if exists (
    with ranked as (
      select
        ri.*,
        row_number() over (
          partition by ri.rental_contract_id, ri.period_start, ri.period_end
          order by ri.posted_at asc nulls last, ri.created_at asc, ri.id asc
        ) as duplicate_rank
      from public.rental_invoices ri
      where ri.deleted_at is null
        and ri.status not in (
          'void'::public.rental_invoice_status,
          'reversed'::public.rental_invoice_status
        )
    )
    select 1
    from ranked r
    left join public.customer_invoices ci on ci.id = r.customer_invoice_id
    left join public.quickbooks_gl_sync_jobs gl on gl.invoice_id = ci.id
    where r.duplicate_rank > 1
      and (
        r.amount_paid_cents > 0
        or coalesce(ci.amount_paid, 0) > 0
        or ci.quickbooks_gl_status in ('processing', 'posted')
        or gl.status in ('processing', 'posted')
        or gl.quickbooks_txn_id is not null
      )
  ) then
    raise exception 'RENTAL_DUPLICATE_PERIOD_FINANCIALLY_ESCAPED: reverse paid or QuickBooks-posted duplicates before migration 815';
  end if;
end;
$$;

drop index if exists public.uq_rental_invoices_active_contract_period;

with ranked as (
  select
    ri.*,
    first_value(ri.id) over (
      partition by ri.rental_contract_id, ri.period_start, ri.period_end
      order by ri.posted_at asc nulls last, ri.created_at asc, ri.id asc
    ) as canonical_id,
    row_number() over (
      partition by ri.rental_contract_id, ri.period_start, ri.period_end
      order by ri.posted_at asc nulls last, ri.created_at asc, ri.id asc
    ) as duplicate_rank
  from public.rental_invoices ri
  where ri.deleted_at is null
    and ri.status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    )
), quarantined as (
  insert into public.rental_invoice_period_quarantine (
    rental_invoice_id,
    canonical_rental_invoice_id,
    workspace_id,
    rental_contract_id,
    period_start,
    period_end,
    reason,
    invoice_snapshot
  )
  select
    r.id,
    r.canonical_id,
    r.workspace_id,
    r.rental_contract_id,
    r.period_start,
    r.period_end,
    'duplicate_active_contract_period_preflight',
    to_jsonb(r) - 'duplicate_rank' - 'canonical_id'
  from ranked r
  where r.duplicate_rank > 1
  on conflict (rental_invoice_id) do nothing
  returning rental_invoice_id, canonical_rental_invoice_id
)
update public.rental_invoices ri
set status = 'void'::public.rental_invoice_status,
    reversal_reason = 'Quarantined by m815: duplicate active contract-period invoice; canonical invoice ' || q.canonical_rental_invoice_id,
    metadata = ri.metadata || jsonb_build_object(
      'quarantined_by_migration', 815,
      'quarantine_reason', 'duplicate_active_contract_period_preflight',
      'canonical_rental_invoice_id', q.canonical_rental_invoice_id,
      'quarantined_at', now()
    ),
    updated_at = now()
from quarantined q
where ri.id = q.rental_invoice_id;

-- A queued-but-not-externally-posted mirror must not remain collectible after
-- its duplicate rental invoice is quarantined. Preserve the void AR header and
-- line evidence, but remove its unsent GL job. Never touch an AR header still
-- referenced by another active rental invoice.
delete from public.quickbooks_gl_sync_jobs gl
using public.rental_invoices ri
where ri.customer_invoice_id = gl.invoice_id
  and ri.status = 'void'::public.rental_invoice_status
  and ri.metadata ->> 'quarantined_by_migration' = '815'
  and gl.status in ('queued', 'failed')
  and gl.quickbooks_txn_id is null
  and not exists (
    select 1
    from public.rental_invoices active_ri
    where active_ri.customer_invoice_id = gl.invoice_id
      and active_ri.id <> ri.id
      and active_ri.deleted_at is null
      and active_ri.status not in (
        'void'::public.rental_invoice_status,
        'reversed'::public.rental_invoice_status
      )
  );

update public.customer_invoices ci
set status = 'void',
    quickbooks_gl_status = 'not_synced',
    quickbooks_gl_last_error = 'Rental mirror quarantined by migration 815 before external posting',
    updated_at = now()
from public.rental_invoices ri
where ri.customer_invoice_id = ci.id
  and ri.status = 'void'::public.rental_invoice_status
  and ri.metadata ->> 'quarantined_by_migration' = '815'
  and coalesce(ci.amount_paid, 0) = 0
  and ci.quickbooks_gl_status not in ('processing', 'posted')
  and not exists (
    select 1
    from public.rental_invoices active_ri
    where active_ri.customer_invoice_id = ci.id
      and active_ri.id <> ri.id
      and active_ri.deleted_at is null
      and active_ri.status not in (
        'void'::public.rental_invoice_status,
        'reversed'::public.rental_invoice_status
      )
  );

create unique index uq_rental_invoices_active_contract_period
  on public.rental_invoices (rental_contract_id, period_start, period_end)
  where deleted_at is null
    and status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    );

-- The caller builds this exact JSON object from the rows used by the pure
-- planner. jsonb equality handles numeric scale while retaining exact IDs and
-- timestamps for latest-return selection and prior-invoice reconciliation.
create or replace function public.rental_billing_source_snapshot(
  p_workspace_id text,
  p_rental_contract_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with contract_row as materialized (
    select c.*
    from public.rental_contracts c
    where c.id = p_rental_contract_id
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
      and (
        c.qrm_company_id is null
        or exists (
          select 1
          from public.qrm_companies company
          where company.id = c.qrm_company_id
            and company.workspace_id = p_workspace_id
            and company.deleted_at is null
        )
      )
      and (
        c.portal_customer_id is null
        or exists (
          select 1
          from public.portal_customers portal
          where portal.id = c.portal_customer_id
            and portal.workspace_id = p_workspace_id
        )
      )
      and not exists (
        select 1
        from public.portal_customers portal
        where portal.id = c.portal_customer_id
          and portal.workspace_id = p_workspace_id
          and c.qrm_company_id is not null
          and portal.crm_company_id is not null
          and portal.crm_company_id is distinct from c.qrm_company_id
      )
  ), resolved_portal as materialized (
    select pc.*
    from contract_row c
    join public.portal_customers pc
      on pc.id = c.portal_customer_id
     and pc.workspace_id = p_workspace_id
  ), resolved_company as materialized (
    select company.*
    from contract_row c
    join public.qrm_companies company
      on company.id = c.qrm_company_id
     and company.workspace_id = p_workspace_id
     and company.deleted_at is null
  ), resolved_branch as materialized (
    select
      b.*,
      case
        when c.branch_id is not null then 'explicit'
        else 'workspace_fallback'
      end as resolution
    from contract_row c
    cross join lateral (
      select candidate.*
      from public.branches candidate
      where candidate.workspace_id = p_workspace_id
        and candidate.deleted_at is null
        and (
          (c.branch_id is not null and candidate.id = c.branch_id)
          or (c.branch_id is null and candidate.legacy_code is not null)
        )
      order by candidate.created_at asc, candidate.id asc
      limit 1
    ) b
  ), resolved_ship_to as materialized (
    select
      sta.*,
      case
        when c.ship_to_address_id is not null then 'explicit'
        else 'company_default'
      end as resolution
    from contract_row c
    left join resolved_portal pc on true
    cross join lateral (
      select candidate.*
      from public.qrm_company_ship_to_addresses candidate
      where coalesce(c.tax_sourcing_method, 'destination_ship_to') = 'destination_ship_to'
        and candidate.workspace_id = p_workspace_id
        and candidate.deleted_at is null
        and (
          (
            c.ship_to_address_id is not null
            and candidate.id = c.ship_to_address_id
            and (
              coalesce(c.qrm_company_id, pc.crm_company_id) is null
              or candidate.company_id = coalesce(c.qrm_company_id, pc.crm_company_id)
            )
          )
          or (
            c.ship_to_address_id is null
            and candidate.company_id = coalesce(c.qrm_company_id, pc.crm_company_id)
            and candidate.is_active = true
          )
        )
      order by candidate.is_default desc, candidate.created_at asc, candidate.id asc
      limit 1
    ) sta
  ), resolved_jurisdiction as materialized (
    select tj.*
    from resolved_ship_to sta
    join public.tax_jurisdictions tj
      on tj.state_code = 'FL'
     and lower(tj.county_name) = lower(coalesce(
       nullif(sta.county_name, ''),
       nullif(sta.tax_jurisdiction_override, '')
     ))
     and tj.is_active = true
     and tj.effective_date <= current_date
     and (tj.expires_at is null or tj.expires_at >= current_date)
     and (tj.workspace_id = p_workspace_id or tj.workspace_id = 'global')
    order by
      case when tj.workspace_id = p_workspace_id then 0 else 1 end,
      tj.effective_date desc,
      tj.id asc
    limit 1
  )
  select jsonb_build_object(
    'version', 2,
    'contract', jsonb_build_object(
      'id', c.id,
      'workspace_id', c.workspace_id,
      'contract_number', c.contract_number,
      'contract_type', c.contract_type,
      'lifecycle_state', c.lifecycle_state,
      'on_rent_at', c.on_rent_at,
      'off_rent_at', c.off_rent_at,
      'returned_at', c.returned_at,
      'agreed_daily_rate', c.agreed_daily_rate,
      'agreed_weekly_rate', c.agreed_weekly_rate,
      'agreed_monthly_rate', c.agreed_monthly_rate,
      'delivery_fee_cents', c.delivery_fee_cents,
      'pickup_fee_cents', c.pickup_fee_cents,
      'damage_waiver_accepted', c.damage_waiver_accepted,
      'damage_waiver_rate_pct', c.damage_waiver_rate_pct,
      'deposit_status', c.deposit_status,
      'deposit_amount', c.deposit_amount,
      'portal_customer_id', c.portal_customer_id,
      'qrm_company_id', c.qrm_company_id,
      'branch_id', c.branch_id,
      'ship_to_address_id', c.ship_to_address_id,
      'tax_sourcing_method', c.tax_sourcing_method
    ),
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'included_hours', l.included_hours,
          'outbound_meter_hours', l.outbound_meter_hours,
          'return_meter_hours', l.return_meter_hours,
          'overage_hourly_rate_cents', l.overage_hourly_rate_cents
        ) order by l.id
      )
      from public.rental_contract_lines l
      where l.workspace_id = p_workspace_id
        and l.rental_contract_id = p_rental_contract_id
        and l.deleted_at is null
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'workspace_id', r.workspace_id,
          'rental_contract_id', r.rental_contract_id,
          'equipment_id', r.equipment_id,
          'created_at', r.created_at,
          'updated_at', r.updated_at,
          'deleted_at', r.deleted_at,
          'fuel_charge_cents', r.fuel_charge_cents,
          'cleaning_charge_cents', r.cleaning_charge_cents,
          'damage_charge_cents', r.damage_charge_cents,
          'environmental_fee_cents', r.environmental_fee_cents,
          'damage_disposition', r.damage_disposition
        ) order by r.id
      )
      from public.rental_returns r
      where r.workspace_id = p_workspace_id
        and r.rental_contract_id = p_rental_contract_id
        and r.deleted_at is null
    ), '[]'::jsonb),
    'prior_invoices', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ri.id,
          'period_end', ri.period_end,
          'rental_charge_cents', ri.rental_charge_cents,
          'status', ri.status,
          'kind', ri.metadata ->> 'kind'
        ) order by ri.id
      )
      from public.rental_invoices ri
      where ri.workspace_id = p_workspace_id
        and ri.rental_contract_id = p_rental_contract_id
        and ri.deleted_at is null
        and ri.status not in (
          'void'::public.rental_invoice_status,
          'reversed'::public.rental_invoice_status
        )
    ), '[]'::jsonb),
    'numbering_branch', (
      select jsonb_build_object(
        'id', b.id,
        'workspace_id', b.workspace_id,
        'slug', b.slug,
        'legacy_code', b.legacy_code,
        'state_province', b.state_province,
        'created_at', b.created_at,
        'updated_at', b.updated_at,
        'deleted_at', b.deleted_at,
        'resolution', b.resolution
      )
      from resolved_branch b
    ),
    'tax_resolution', jsonb_build_object(
      'effective_date', current_date,
      'company', (
        select jsonb_build_object(
          'id', company.id,
          'workspace_id', company.workspace_id,
          'deleted_at', company.deleted_at,
          'created_at', company.created_at,
          'updated_at', company.updated_at
        )
        from resolved_company company
      ),
      'portal_customer', (
        select jsonb_build_object(
          'id', pc.id,
          'workspace_id', pc.workspace_id,
          'crm_company_id', pc.crm_company_id,
          'created_at', pc.created_at,
          'updated_at', pc.updated_at
        )
        from resolved_portal pc
      ),
      'ship_to_address', (
        select jsonb_build_object(
          'id', sta.id,
          'workspace_id', sta.workspace_id,
          'company_id', sta.company_id,
          'is_default', sta.is_default,
          'is_active', sta.is_active,
          'county_name', sta.county_name,
          'state', sta.state,
          'tax_jurisdiction_override', sta.tax_jurisdiction_override,
          'created_at', sta.created_at,
          'updated_at', sta.updated_at,
          'deleted_at', sta.deleted_at,
          'resolution', sta.resolution
        )
        from resolved_ship_to sta
      ),
      'tax_jurisdiction', (
        select to_jsonb(j)
        from resolved_jurisdiction j
      )
    )
  )
  from contract_row c
$$;

revoke execute on function public.rental_billing_source_snapshot(text, uuid)
  from public, anon, authenticated;
grant execute on function public.rental_billing_source_snapshot(text, uuid)
  to service_role;

-- Preserve m811 as an internal implementation and put a transactional source
-- validation wrapper at its public RPC name. All locks remain held across the
-- nested insert because PostgreSQL functions execute in the caller transaction.
alter function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
  rename to post_rental_invoice_for_billing_item_v1_unchecked;

revoke execute on function public.post_rental_invoice_for_billing_item_v1_unchecked(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

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
  v_source_snapshot jsonb;
  v_source_fingerprint text;
  v_payload jsonb;
  v_post record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_token is null or jsonb_typeof(p_invoice) is distinct from 'object' then
    raise exception 'worker_token and invoice object are required';
  end if;

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
  where i.id = p_item_id and i.rental_billing_run_id = v_run.id
  for update;
  if not found
     or v_item.status <> 'processing'
     or v_item.worker_token is distinct from p_worker_token then
    raise exception 'rental billing lease is no longer owned by this worker';
  end if;

  -- FOR UPDATE on the FK parent blocks new child inserts; ordered FOR SHARE
  -- locks block changes to every existing source row until the invoice insert
  -- and nonterminal checkpoint transition have committed.
  select c.* into v_contract
  from public.rental_contracts c
  where c.id = v_item.rental_contract_id
    and c.workspace_id = v_item.workspace_id
    and c.deleted_at is null
  for update;
  if not found then
    raise exception 'rental contract is missing, deleted, or cross-workspace';
  end if;

  perform l.id
  from public.rental_contract_lines l
  where l.workspace_id = v_item.workspace_id
    and l.rental_contract_id = v_item.rental_contract_id
    and l.deleted_at is null
  order by l.id
  for share;

  perform rr.id
  from public.rental_returns rr
  where rr.workspace_id = v_item.workspace_id
    and rr.rental_contract_id = v_item.rental_contract_id
    and rr.deleted_at is null
  order by rr.id
  for share;

  perform ri.id
  from public.rental_invoices ri
  where ri.workspace_id = v_item.workspace_id
    and ri.rental_contract_id = v_item.rental_contract_id
    and ri.deleted_at is null
    and ri.status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    )
  order by ri.id
  for share;

  -- Numbering and tax inputs are money sources too. Lock every eligible row
  -- in a stable table/id order so an update cannot change the branch prefix,
  -- customer resolution, destination, or effective rate after validation.
  perform company.id
  from public.qrm_companies company
  where v_contract.qrm_company_id is not null
    and company.id = v_contract.qrm_company_id
    and company.workspace_id = v_item.workspace_id
    and company.deleted_at is null
  order by company.id
  for share;
  if v_contract.qrm_company_id is not null and not found then
    raise exception 'RENTAL_BILLING_SOURCE_INCOMPLETE: company is missing, deleted, or cross-workspace';
  end if;

  perform b.id
  from public.branches b
  where b.workspace_id = v_item.workspace_id
    and b.deleted_at is null
    and (
      (v_contract.branch_id is not null and b.id = v_contract.branch_id)
      or (v_contract.branch_id is null and b.legacy_code is not null)
    )
  order by b.id
  for share;

  perform pc.id
  from public.portal_customers pc
  where pc.workspace_id = v_item.workspace_id
    and pc.id = v_contract.portal_customer_id
  order by pc.id
  for share;

  perform sta.id
  from public.qrm_company_ship_to_addresses sta
  where coalesce(v_contract.tax_sourcing_method, 'destination_ship_to') = 'destination_ship_to'
    and sta.workspace_id = v_item.workspace_id
    and sta.deleted_at is null
    and (
      (v_contract.ship_to_address_id is not null and sta.id = v_contract.ship_to_address_id)
      or (
        v_contract.ship_to_address_id is null
        and sta.company_id = coalesce(
          v_contract.qrm_company_id,
          (
            select pc.crm_company_id
            from public.portal_customers pc
            where pc.id = v_contract.portal_customer_id
              and pc.workspace_id = v_item.workspace_id
          )
        )
        and sta.is_active = true
      )
    )
  order by sta.id
  for share;

  perform tj.id
  from public.tax_jurisdictions tj
  where tj.state_code = 'FL'
    and tj.is_active = true
    and tj.effective_date <= current_date
    and (tj.expires_at is null or tj.expires_at >= current_date)
    and (tj.workspace_id = v_item.workspace_id or tj.workspace_id = 'global')
  order by tj.id
  for share;

  v_source_snapshot := public.rental_billing_source_snapshot(
    v_item.workspace_id,
    v_item.rental_contract_id
  );
  if jsonb_typeof(p_invoice -> 'billing_source_snapshot') is distinct from 'object'
     or (p_invoice -> 'billing_source_snapshot') is distinct from v_source_snapshot then
    raise exception 'RENTAL_BILLING_SOURCE_STALE: contract, line, return, invoice, numbering, or tax source changed after planning'
      using errcode = '40001';
  end if;

  v_source_fingerprint := encode(
    extensions.digest(convert_to(v_source_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_payload := jsonb_set(
    p_invoice,
    '{metadata}',
    coalesce(p_invoice -> 'metadata', '{}'::jsonb) || jsonb_build_object(
      'billing_source_snapshot_version', 2,
      'billing_source_fingerprint', v_source_fingerprint
    )
  ) - 'billing_source_snapshot';

  select p.invoice_id, p.created_new into v_post
  from public.post_rental_invoice_for_billing_item_v1_unchecked(
    p_item_id,
    p_worker_token,
    v_payload
  ) p;

  -- The rental invoice is money truth, but the item remains reclaimable until
  -- the downstream AR graph commits in mirror_rental_invoice_for_billing_item.
  update public.rental_billing_run_items i
  set status = 'processing',
      rental_invoice_id = v_post.invoice_id,
      mirror_skipped = true,
      error_detail = 'AR header, line, backlink, and GL outbox pending',
      completed_at = null
  where i.id = p_item_id
    and i.worker_token = p_worker_token;

  return query select v_post.invoice_id::uuid, v_post.created_new::boolean;
end;
$$;

comment on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb) is
  'Validates the exact planner source snapshot under locks, posts rental money, and leaves the item nonterminal until its AR graph commits.';

revoke execute on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.post_rental_invoice_for_billing_item(uuid, uuid, jsonb)
  to service_role;

create or replace function public.attach_rental_invoice_to_billing_item(
  p_item_id uuid,
  p_worker_token uuid,
  p_rental_invoice_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run public.rental_billing_runs%rowtype;
  v_item public.rental_billing_run_items%rowtype;
  v_invoice public.rental_invoices%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_token is null or p_rental_invoice_id is null then
    raise exception 'worker_token and rental_invoice_id are required';
  end if;

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
  where i.id = p_item_id and i.rental_billing_run_id = v_run.id
  for update;
  if not found
     or v_item.status <> 'processing'
     or v_item.worker_token is distinct from p_worker_token then
    raise exception 'rental billing lease is no longer owned by this worker';
  end if;

  select ri.* into v_invoice
  from public.rental_invoices ri
  where ri.id = p_rental_invoice_id
    and ri.workspace_id = v_item.workspace_id
    and ri.rental_contract_id = v_item.rental_contract_id
    and ri.rental_billing_run_id = v_item.rental_billing_run_id
    and ri.deleted_at is null
    and ri.status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    )
  for update;
  if not found then
    raise exception 'rental invoice does not belong to claimed run item';
  end if;

  update public.rental_billing_run_items i
  set rental_invoice_id = v_invoice.id,
      billed_cents = greatest(v_invoice.taxable_amount_cents, 0),
      tax_cents = greatest(v_invoice.tax_cents, 0),
      mirror_skipped = true,
      error_detail = 'AR header, line, backlink, and GL outbox pending',
      completed_at = null
  where i.id = v_item.id
    and i.worker_token = p_worker_token
    and i.status = 'processing';

  return found;
end;
$$;

revoke execute on function public.attach_rental_invoice_to_billing_item(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.attach_rental_invoice_to_billing_item(uuid, uuid, uuid)
  to service_role;

create or replace function public.mirror_rental_invoice_for_billing_item(
  p_item_id uuid,
  p_worker_token uuid
)
returns table (rental_invoice_id uuid, customer_invoice_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run public.rental_billing_runs%rowtype;
  v_item public.rental_billing_run_items%rowtype;
  v_invoice public.rental_invoices%rowtype;
  v_contract public.rental_contracts%rowtype;
  v_customer public.customer_invoices%rowtype;
  v_portal_customer_id uuid;
  v_portal_company_id uuid;
  v_company_id uuid;
  v_branch_slug text;
  v_description text;
  v_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_token is null then
    raise exception 'worker_token is required';
  end if;

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
  where i.id = p_item_id and i.rental_billing_run_id = v_run.id
  for update;
  if not found
     or v_item.status <> 'processing'
     or v_item.worker_token is distinct from p_worker_token
     or v_item.rental_invoice_id is null then
    raise exception 'rental mirror lease or posted invoice is unavailable';
  end if;

  select ri.* into v_invoice
  from public.rental_invoices ri
  where ri.id = v_item.rental_invoice_id
    and ri.workspace_id = v_item.workspace_id
    and ri.rental_contract_id = v_item.rental_contract_id
    and ri.deleted_at is null
    and ri.status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    )
  for update;
  if not found then
    raise exception 'posted rental invoice is missing or inactive';
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

  v_portal_customer_id := v_contract.portal_customer_id;
  if v_portal_customer_id is not null then
    select pc.crm_company_id
    into v_portal_company_id
    from public.portal_customers pc
    where pc.id = v_portal_customer_id
      and pc.workspace_id = v_item.workspace_id;
    if not found then
      raise exception 'RENTAL_AR_ANCHOR_PENDING: explicit portal customer is missing or cross-workspace';
    end if;
  end if;
  if v_contract.qrm_company_id is not null then
    select c.id
    into v_company_id
    from public.qrm_companies c
    where c.id = v_contract.qrm_company_id
      and c.workspace_id = v_item.workspace_id
      and c.deleted_at is null;
    if not found then
      raise exception 'RENTAL_AR_ANCHOR_PENDING: explicit company is missing, deleted, or cross-workspace';
    end if;
  end if;
  if v_company_id is not null
     and v_portal_company_id is not null
     and v_company_id is distinct from v_portal_company_id then
    raise exception 'RENTAL_AR_MIRROR_CONFLICT: contract company and portal customer company differ';
  end if;
  v_company_id := coalesce(v_company_id, v_portal_company_id);
  if v_portal_customer_id is null and v_company_id is null then
    raise exception 'RENTAL_AR_ANCHOR_PENDING: contract has neither a same-workspace portal customer nor company';
  end if;

  select b.slug into v_branch_slug
  from public.branches b
  where b.id = v_contract.branch_id
    and b.workspace_id = v_item.workspace_id;

  v_description := format(
    'Rental %s invoice · %s · %s → %s',
    coalesce(v_invoice.metadata ->> 'kind', 'cycle'),
    coalesce(v_contract.contract_number, v_contract.id::text),
    v_invoice.period_start,
    v_invoice.period_end
  );
  v_status := case
    when v_invoice.total_cents > 0 and v_invoice.amount_paid_cents >= v_invoice.total_cents then 'paid'
    when v_invoice.amount_paid_cents > 0 then 'partial'
    else 'pending'
  end;

  if v_invoice.customer_invoice_id is not null then
    select ci.* into v_customer
    from public.customer_invoices ci
    where ci.id = v_invoice.customer_invoice_id
      and ci.workspace_id = v_item.workspace_id
    for update;
  else
    -- Recover an orphan created by the pre-m815 non-atomic helper before
    -- inserting a new AR header. Stable ordering makes legacy duplicates loud
    -- and deterministic rather than creating another one.
    select ci.* into v_customer
    from public.customer_invoices ci
    where ci.workspace_id = v_item.workspace_id
      and ci.invoice_number = v_invoice.invoice_number
      and ci.invoice_type = 'rental'
      and ci.status <> 'void'
    order by ci.created_at asc, ci.id asc
    limit 1
    for update;
  end if;

  if v_customer.id is null then
    insert into public.customer_invoices (
      workspace_id,
      portal_customer_id,
      crm_company_id,
      invoice_number,
      invoice_date,
      due_date,
      description,
      amount,
      tax,
      total,
      amount_paid,
      status,
      invoice_type,
      invoice_source_code,
      branch_id,
      ship_to_address_id,
      tax_breakdown,
      tax_code_1,
      tax_code_2,
      dr15_county_name,
      tax_jurisdiction_id
    ) values (
      v_item.workspace_id,
      v_portal_customer_id,
      v_company_id,
      v_invoice.invoice_number,
      coalesce(v_invoice.posted_at::date, current_date),
      coalesce(v_invoice.due_date, v_invoice.period_end),
      v_description,
      v_invoice.taxable_amount_cents / 100.0,
      v_invoice.tax_cents / 100.0,
      v_invoice.total_cents / 100.0,
      least(v_invoice.amount_paid_cents, v_invoice.total_cents) / 100.0,
      v_status,
      'rental',
      'RENTAL',
      v_branch_slug,
      v_invoice.ship_to_address_id,
      v_invoice.tax_breakdown,
      v_invoice.tax_breakdown ->> 'state_code',
      v_invoice.dr15_county_name,
      v_invoice.dr15_county_name,
      v_invoice.tax_jurisdiction_id
    )
    returning * into v_customer;
  elsif round(v_customer.amount * 100)::bigint <> v_invoice.taxable_amount_cents
     or round(coalesce(v_customer.tax, 0) * 100)::bigint <> v_invoice.tax_cents
     or round(v_customer.total * 100)::bigint <> v_invoice.total_cents
     or round(coalesce(v_customer.amount_paid, 0) * 100)::bigint
        <> least(v_invoice.amount_paid_cents, v_invoice.total_cents) then
    raise exception 'RENTAL_AR_MIRROR_CONFLICT: existing customer invoice totals differ from rental invoice';
  end if;

  if exists (
    select 1
    from public.customer_invoice_line_items li
    where li.invoice_id = v_customer.id and li.line_number = 1
      and (
        li.workspace_id is distinct from v_item.workspace_id
        or li.quantity is distinct from 1::numeric
        or round(li.unit_price * 100)::bigint is distinct from v_invoice.taxable_amount_cents
      )
  ) then
    raise exception 'RENTAL_AR_LINE_CONFLICT: existing line 1 differs from rental invoice';
  end if;

  insert into public.customer_invoice_line_items (
    workspace_id, invoice_id, line_number, description, quantity, unit_price
  )
  select
    v_item.workspace_id, v_customer.id, 1, v_description, 1,
    v_invoice.taxable_amount_cents / 100.0
  where not exists (
    select 1 from public.customer_invoice_line_items li
    where li.invoice_id = v_customer.id and li.line_number = 1
  );

  update public.rental_invoices ri
  set customer_invoice_id = v_customer.id,
      updated_at = now()
  where ri.id = v_invoice.id;

  insert into public.quickbooks_gl_sync_jobs (
    workspace_id, invoice_id, source_type, posting_mode, status
  ) values (
    v_item.workspace_id, v_customer.id, 'customer_invoice', 'journal_entry', 'queued'
  )
  on conflict (invoice_id) do nothing;

  update public.customer_invoices ci
  set quickbooks_gl_status = case
        when ci.quickbooks_gl_status in ('processing', 'posted') then ci.quickbooks_gl_status
        else 'queued'
      end,
      quickbooks_gl_last_error = case
        when ci.quickbooks_gl_status in ('processing', 'posted') then ci.quickbooks_gl_last_error
        else null
      end,
      updated_at = now()
  where ci.id = v_customer.id;

  update public.rental_billing_run_items i
  set status = 'invoiced',
      rental_invoice_id = v_invoice.id,
      billed_cents = greatest(v_invoice.taxable_amount_cents, 0),
      tax_cents = greatest(v_invoice.tax_cents, 0),
      mirror_skipped = false,
      error_detail = null,
      completed_at = now(),
      worker_token = null,
      lease_started_at = null,
      lease_expires_at = null
  where i.id = v_item.id
    and i.worker_token = p_worker_token
    and i.status = 'processing';

  if not found then
    raise exception 'rental mirror lease was lost before checkpoint';
  end if;

  return query select v_invoice.id, v_customer.id;
end;
$$;

comment on function public.mirror_rental_invoice_for_billing_item(uuid, uuid) is
  'Atomically persists or repairs the rental AR header, line, backlink, GL outbox, and terminal billing checkpoint.';

revoke execute on function public.mirror_rental_invoice_for_billing_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mirror_rental_invoice_for_billing_item(uuid, uuid)
  to service_role;

create or replace function public.defer_rental_billing_mirror(
  p_item_id uuid,
  p_worker_token uuid,
  p_error_detail text,
  p_retry_seconds integer default 300
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

  update public.rental_billing_run_items i
  set status = 'processing',
      mirror_skipped = true,
      error_detail = left(coalesce(p_error_detail, 'AR mirror retry pending'), 4000),
      worker_token = null,
      lease_started_at = null,
      lease_expires_at = now() + pg_catalog.make_interval(
        secs => greatest(30, least(coalesce(p_retry_seconds, 300), 86400))
      ),
      completed_at = null
  where i.id = p_item_id
    and i.status = 'processing'
    and i.worker_token = p_worker_token;

  return found;
end;
$$;

revoke execute on function public.defer_rental_billing_mirror(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.defer_rental_billing_mirror(uuid, uuid, text, integer)
  to service_role;

-- Existing m811 items could have terminalized after only the rental invoice
-- committed. Re-open exactly those incomplete AR graphs and their run headers;
-- claim_rental_billing_batch will reclaim the expired processing lease.
with incomplete as (
  select i.id, i.rental_billing_run_id
  from public.rental_billing_run_items i
  join public.rental_invoices ri on ri.id = i.rental_invoice_id
  where i.status = 'invoiced'
    and ri.deleted_at is null
    and ri.status not in (
      'void'::public.rental_invoice_status,
      'reversed'::public.rental_invoice_status
    )
    and (
      ri.customer_invoice_id is null
      or not exists (
        select 1 from public.customer_invoice_line_items li
        where li.invoice_id = ri.customer_invoice_id
      )
      or not exists (
        select 1 from public.quickbooks_gl_sync_jobs gl
        where gl.invoice_id = ri.customer_invoice_id
      )
    )
), reopened_items as (
  update public.rental_billing_run_items i
  set status = 'processing',
      worker_token = null,
      lease_started_at = null,
      lease_expires_at = now() - interval '1 second',
      mirror_skipped = true,
      error_detail = 'm815 reopened incomplete AR mirror for durable retry',
      completed_at = null
  from incomplete x
  where i.id = x.id
  returning i.rental_billing_run_id
)
update public.rental_billing_runs r
set status = 'partial',
    completed_at = null,
    metadata = r.metadata || jsonb_build_object(
      'm815_mirror_reopened_at', now()
    )
where r.id in (select distinct rental_billing_run_id from reopened_items)
  and r.deleted_at is null
  and r.status in ('completed', 'failed');

-- Put a completeness gate in front of the already-applied m810 reconciler.
-- The old implementation remains private and runs under the same transaction
-- after the wrapper locks every requirement and proves set equality.
alter function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
  rename to reconcile_service_parts_plan_v1_unchecked;

revoke execute on function public.reconcile_service_parts_plan_v1_unchecked(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.reconcile_service_parts_plan(
  p_workspace_id text,
  p_job_id uuid,
  p_actor_id uuid,
  p_plan_batch_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_workspace_id is null
     or btrim(p_workspace_id) = ''
     or p_workspace_id is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_job_id is null or p_plan_batch_id is null then
    raise exception 'job_id and plan_batch_id are required' using errcode = '22023';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' then
    raise exception 'plan must be a JSON array' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('service_parts_plan:' || p_workspace_id),
    hashtext(p_job_id::text)
  );

  perform r.id
  from public.service_parts_requirements r
  where r.workspace_id = p_workspace_id and r.job_id = p_job_id
  order by r.id
  for update;

  perform j.id
  from public.service_jobs j
  where j.id = p_job_id and j.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'service job not found in workspace' using errcode = '22023';
  end if;

  if exists (
    (
      select r.id
      from public.service_parts_requirements r
      where r.workspace_id = p_workspace_id
        and r.job_id = p_job_id
        and r.status in ('pending', 'picking', 'transferring', 'ordering')
        and coalesce(r.intake_line_status, 'accepted') <> 'suggested'
      except
      select (item ->> 'requirement_id')::uuid
      from jsonb_array_elements(p_plan) item
    )
    union all
    (
      select (item ->> 'requirement_id')::uuid
      from jsonb_array_elements(p_plan) item
      except
      select r.id
      from public.service_parts_requirements r
      where r.workspace_id = p_workspace_id
        and r.job_id = p_job_id
        and r.status in ('pending', 'picking', 'transferring', 'ordering')
        and coalesce(r.intake_line_status, 'accepted') <> 'suggested'
    )
  ) then
    raise exception 'SERVICE_PARTS_PLAN_STALE_OR_INCOMPLETE: plan must contain every current eligible requirement exactly once'
      using errcode = '40001';
  end if;

  select public.reconcile_service_parts_plan_v1_unchecked(
    p_workspace_id,
    p_job_id,
    p_actor_id,
    p_plan_batch_id,
    p_plan
  ) into v_result;
  return v_result;
end;
$$;

comment on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb) is
  'm815 complete-snapshot wrapper: set-equality validates every current eligible service-parts requirement before m810 can release or supersede demand.';

revoke execute on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.reconcile_service_parts_plan(text, uuid, uuid, uuid, jsonb)
  to authenticated;

commit;
