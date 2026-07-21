-- 830_rental_conversion_commission_and_refund_clawback.sql
--
-- RN9 + RN10 owner-answer unlock:
--   * Rental commission truth is tied to BOTH the rental contract and the
--     physical equipment unit. Paid-rent commission is 5% of its rent basis.
--   * A rent refund of any supported kind records an immediate, proportional
--     negative 5% commission clawback. Idempotency keys make every source
--     refund safe to retry without double-clawing commission.
--   * A rental-to-purchase settlement freezes negotiated rent credit and
--     calculates exactly 15% of the equipment-sale gross margin LESS net
--     rental commission on that unit after attributable clawbacks.
--
-- Accounting boundary (one asset cost / two ledgers): this migration never
-- changes qrm_equipment.current_cost_cents, net_book_value_cents, purchase_price,
-- rental invoices, or GL entries. The unit commission ledger is compensation
-- truth; qb_deals remains the canonical equipment-sale commission field after
-- a finance-controlled post. No historical money is guessed or backfilled.

begin;

-- ---------------------------------------------------------------------------
-- 1. Append-only unit commission ledger
-- ---------------------------------------------------------------------------

create table if not exists public.rental_unit_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  rental_contract_id uuid not null references public.rental_contracts(id) on delete restrict,
  rental_invoice_id uuid references public.rental_invoices(id) on delete restrict,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  rental_contract_commission_id uuid not null
    references public.rental_contract_commissions(id) on delete restrict,
  split_pct_snapshot numeric(5, 2) not null
    check (split_pct_snapshot > 0 and split_pct_snapshot <= 100),
  origin_paid_entry_id uuid
    references public.rental_unit_commission_ledger(id) on delete restrict,
  entry_kind text not null check (
    entry_kind in ('rental_commission_paid', 'rent_refund_clawback')
  ),
  source_kind text not null check (
    source_kind in (
      'invoice_payment',
      'legacy_paid_commission',
      'credit_memo',
      'correction',
      'goodwill_refund',
      'cash_refund',
      'other_rent_refund'
    )
  ),
  source_event_key text not null check (btrim(source_event_key) <> ''),
  source_reference text,
  source_rent_basis_cents bigint not null check (source_rent_basis_cents > 0),
  rent_basis_cents bigint not null check (rent_basis_cents > 0),
  commission_rate_pct numeric(7, 6) not null default 0.050000
    check (commission_rate_pct = 0.050000),
  commission_cents bigint not null,
  recognized_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rental_unit_commission_ledger_source_kind_ck check (
    (
      entry_kind = 'rental_commission_paid'
      and source_kind in ('invoice_payment', 'legacy_paid_commission')
    )
    or (
      entry_kind = 'rent_refund_clawback'
      and source_kind in (
        'credit_memo', 'correction', 'goodwill_refund',
        'cash_refund', 'other_rent_refund'
      )
    )
  ),
  constraint rental_unit_commission_ledger_invoice_source_ck check (
    (
      source_kind = 'legacy_paid_commission'
      and rental_invoice_id is null
      and nullif(btrim(coalesce(source_reference, '')), '') is not null
    )
    or (
      source_kind <> 'legacy_paid_commission'
      and rental_invoice_id is not null
    )
  ),
  constraint rental_unit_commission_ledger_origin_ck check (
    (entry_kind = 'rental_commission_paid' and origin_paid_entry_id is null
      and commission_cents >= 0)
    or
    (entry_kind = 'rent_refund_clawback' and origin_paid_entry_id is not null
      and commission_cents <= 0)
  )
);

comment on table public.rental_unit_commission_ledger is
  'RN9/RN10 append-only compensation truth by physical unit + rental contract. Positive rows are paid 5% rental commission; negative rows are exact 5% clawbacks on refunded rent. This is not an asset-cost or GL ledger.';
comment on column public.rental_unit_commission_ledger.rent_basis_cents is
  'This salesperson/payee allocation of the paid or refunded RENT component only; tax, deposit, damage, hauling, fuel, and other charges are excluded.';
comment on column public.rental_unit_commission_ledger.source_rent_basis_cents is
  'Whole source-event rent basis before payee allocation. Repeated on each payee line so retries can prove source-semantic identity.';
comment on column public.rental_unit_commission_ledger.commission_cents is
  'Exact allocated cents. All payee rows in one source event sum to +round(source rent x 5%) or its exact negative; refund rows can never exceed their referenced paid entry.';
comment on column public.rental_unit_commission_ledger.source_event_key is
  'Stable upstream idempotency key. Reusing a key with different economics is rejected.';

create index if not exists idx_rental_unit_commission_ledger_unit
  on public.rental_unit_commission_ledger
    (workspace_id, equipment_id, recognized_at desc);

create index if not exists idx_rental_unit_commission_ledger_contract
  on public.rental_unit_commission_ledger
    (workspace_id, rental_contract_id, recognized_at desc);

create index if not exists idx_rental_unit_commission_ledger_invoice
  on public.rental_unit_commission_ledger
    (workspace_id, rental_invoice_id)
  where rental_invoice_id is not null;

create index if not exists idx_rental_unit_commission_ledger_salesperson
  on public.rental_unit_commission_ledger
    (workspace_id, salesperson_id, recognized_at desc);

create index if not exists idx_rental_unit_commission_ledger_equipment_fk
  on public.rental_unit_commission_ledger (equipment_id);

create index if not exists idx_rental_unit_commission_ledger_contract_fk
  on public.rental_unit_commission_ledger (rental_contract_id);

create index if not exists idx_rental_unit_commission_ledger_invoice_fk
  on public.rental_unit_commission_ledger (rental_invoice_id)
  where rental_invoice_id is not null;

create index if not exists idx_rental_unit_commission_ledger_split_fk
  on public.rental_unit_commission_ledger (rental_contract_commission_id);

create index if not exists idx_rental_unit_commission_ledger_origin_fk
  on public.rental_unit_commission_ledger (origin_paid_entry_id)
  where origin_paid_entry_id is not null;

create index if not exists idx_rental_unit_commission_ledger_source_replay
  on public.rental_unit_commission_ledger (workspace_id, source_event_key);

create unique index if not exists uq_rental_unit_commission_paid_source_payee
  on public.rental_unit_commission_ledger
    (workspace_id, source_event_key, rental_contract_commission_id)
  where entry_kind = 'rental_commission_paid';

create unique index if not exists uq_rental_unit_commission_refund_source_origin
  on public.rental_unit_commission_ledger
    (workspace_id, source_event_key, origin_paid_entry_id)
  where entry_kind = 'rent_refund_clawback';

alter table public.rental_unit_commission_ledger enable row level security;

create policy "rental_unit_commission_ledger_service_all"
  on public.rental_unit_commission_ledger for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "rental_unit_commission_ledger_finance_select"
  on public.rental_unit_commission_ledger for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'finance_admin', 'manager', 'owner')
  );

revoke all on table public.rental_unit_commission_ledger
  from public, anon, authenticated, service_role;
grant select on table public.rental_unit_commission_ledger
  to authenticated, service_role;

-- Every direct insert, including service-role inserts, must prove same-workspace
-- unit/contract/invoice provenance. That keeps a polymorphic source reference
-- from becoming a cross-tenant escape hatch.
create or replace function public.rental_validate_unit_commission_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract_workspace text;
  v_equipment_workspace text;
  v_invoice record;
  v_split public.rental_contract_commissions%rowtype;
  v_origin public.rental_unit_commission_ledger%rowtype;
begin
  select c.workspace_id into v_contract_workspace
  from public.rental_contracts c
  where c.id = new.rental_contract_id
    and c.deleted_at is null;

  if v_contract_workspace is null
     or v_contract_workspace is distinct from new.workspace_id then
    raise exception 'rental commission contract/workspace mismatch'
      using errcode = '23514';
  end if;

  select e.workspace_id into v_equipment_workspace
  from public.qrm_equipment e
  where e.id = new.equipment_id
    and e.deleted_at is null;

  if v_equipment_workspace is null
     or v_equipment_workspace is distinct from new.workspace_id then
    raise exception 'rental commission equipment/workspace mismatch'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.rental_contracts c
    where c.id = new.rental_contract_id
      and c.workspace_id = new.workspace_id
      and c.deleted_at is null
      and (
        c.equipment_id = new.equipment_id
        or exists (
          select 1
          from public.rental_contract_lines l
          where l.rental_contract_id = c.id
            and l.workspace_id = c.workspace_id
            and l.equipment_id = new.equipment_id
            and l.deleted_at is null
        )
      )
  ) then
    raise exception 'equipment is not assigned to rental contract'
      using errcode = '23514';
  end if;

  if new.rental_invoice_id is not null then
    select i.workspace_id, i.rental_contract_id
    into v_invoice
    from public.rental_invoices i
    where i.id = new.rental_invoice_id
      and i.deleted_at is null;

    if not found
       or v_invoice.workspace_id is distinct from new.workspace_id
       or v_invoice.rental_contract_id is distinct from new.rental_contract_id then
      raise exception 'rental commission invoice provenance mismatch'
        using errcode = '23514';
    end if;
  end if;

  select * into v_split
  from public.rental_contract_commissions rc
  where rc.id = new.rental_contract_commission_id
    and rc.workspace_id = new.workspace_id
    and rc.rental_contract_id = new.rental_contract_id
    and rc.salesperson_id = new.salesperson_id;

  if not found then
    raise exception 'rental commission payee/split provenance mismatch'
      using errcode = '23514';
  end if;

  if new.entry_kind = 'rent_refund_clawback' then
    select * into v_origin
    from public.rental_unit_commission_ledger l
    where l.id = new.origin_paid_entry_id;

    if not found
       or v_origin.entry_kind <> 'rental_commission_paid'
       or v_origin.workspace_id is distinct from new.workspace_id
       or v_origin.equipment_id is distinct from new.equipment_id
       or v_origin.rental_contract_id is distinct from new.rental_contract_id
       or v_origin.rental_invoice_id is distinct from new.rental_invoice_id
       or v_origin.salesperson_id is distinct from new.salesperson_id
       or v_origin.rental_contract_commission_id is distinct from new.rental_contract_commission_id then
      raise exception 'refund clawback must reference the original attributable paid commission'
        using errcode = '23514';
    end if;
  elsif v_split.deleted_at is not null then
    raise exception 'paid commission requires an active contract commission split'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.rental_unit_commission_ledger l
    where l.workspace_id = new.workspace_id
      and l.source_event_key = new.source_event_key
      and (
        l.entry_kind is distinct from new.entry_kind
        or l.source_kind is distinct from new.source_kind
        or l.equipment_id is distinct from new.equipment_id
        or l.rental_contract_id is distinct from new.rental_contract_id
        or l.rental_invoice_id is distinct from new.rental_invoice_id
        or l.source_reference is distinct from new.source_reference
        or l.source_rent_basis_cents is distinct from new.source_rent_basis_cents
      )
  ) then
    raise exception 'source event key already exists with different commission economics'
      using errcode = '23505';
  end if;

  if new.actor_id is not null and not exists (
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = new.actor_id
      and pw.workspace_id = new.workspace_id
  ) then
    raise exception 'rental commission actor is not a workspace member'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.rental_validate_unit_commission_provenance()
  from public, anon, authenticated, service_role;

create trigger trg_rental_validate_unit_commission_provenance
  before insert on public.rental_unit_commission_ledger
  for each row execute function public.rental_validate_unit_commission_provenance();

create or replace function public.rental_reject_unit_commission_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'rental unit commission ledger is append-only'
    using errcode = '55000';
end;
$$;

revoke all on function public.rental_reject_unit_commission_mutation()
  from public, anon, authenticated, service_role;

create trigger trg_rental_reject_unit_commission_update
  before update on public.rental_unit_commission_ledger
  for each row execute function public.rental_reject_unit_commission_mutation();

create trigger trg_rental_reject_unit_commission_delete
  before delete on public.rental_unit_commission_ledger
  for each row execute function public.rental_reject_unit_commission_mutation();

-- Backend-only paid-commission boundary. QEP-native rows must point to a fully
-- paid rental invoice and stable payment reference. Historical payroll import
-- is intentionally not accepted until a reviewed source/payee staging flow exists.
create or replace function public.rental_record_unit_commission_paid(
  p_workspace_id text,
  p_contract_id uuid,
  p_equipment_id uuid,
  p_rent_basis_cents bigint,
  p_source_event_key text,
  p_paid_at timestamptz,
  p_invoice_id uuid default null,
  p_source_kind text default 'invoice_payment',
  p_source_reference text default null,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns setof public.rental_unit_commission_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.rental_invoices%rowtype;
  v_contract public.rental_contracts%rowtype;
  v_split public.rental_contract_commissions%rowtype;
  v_split_count integer;
  v_split_position integer := 0;
  v_split_total numeric;
  v_recorded_basis bigint;
  v_total_commission bigint;
  v_remaining_basis bigint;
  v_remaining_commission bigint;
  v_remaining_pct numeric;
  v_allocated_basis bigint;
  v_allocated_commission bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_record_unit_commission_paid requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_workspace_id, '')), '') is null
     or p_contract_id is null
     or p_equipment_id is null
     or p_rent_basis_cents is null
     or p_rent_basis_cents <= 0
     or nullif(btrim(coalesce(p_source_event_key, '')), '') is null
     or nullif(btrim(coalesce(p_source_reference, '')), '') is null
     or p_paid_at is null then
    raise exception 'workspace, contract, equipment, positive rent basis, source key/reference, and paid_at are required'
      using errcode = '22023';
  end if;
  if p_source_kind <> 'invoice_payment' then
    raise exception 'historical paid commission requires a reviewed source/payee import flow'
      using errcode = '22023';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice_payment requires a rental invoice'
      using errcode = '22023';
  end if;
  -- One source-key lock makes first-write and same-key retry semantics
  -- deterministic before the invoice and unit locks are acquired.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-source:' || p_workspace_id || ':' || btrim(p_source_event_key),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-unit:' || p_workspace_id || ':' || p_equipment_id::text,
      0
    )
  );

  if exists (
    select 1 from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.source_event_key = btrim(p_source_event_key)
  ) then
    if exists (
      select 1 from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
        and (
          l.entry_kind <> 'rental_commission_paid'
          or l.equipment_id <> p_equipment_id
          or l.rental_contract_id <> p_contract_id
          or l.rental_invoice_id is distinct from p_invoice_id
          or l.source_kind <> p_source_kind
          or l.source_reference is distinct from btrim(p_source_reference)
          or l.source_rent_basis_cents <> p_rent_basis_cents
        )
    ) or (
      select coalesce(sum(l.rent_basis_cents), 0)
      from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
    ) <> p_rent_basis_cents or (
      select coalesce(sum(l.commission_cents), 0)
      from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
    ) <> round(p_rent_basis_cents::numeric * 0.050000)::bigint then
      raise exception 'source event key already exists with different commission economics'
        using errcode = '23505';
    end if;

    return query
    select l.* from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.source_event_key = btrim(p_source_event_key)
    order by l.salesperson_id, l.id;
    return;
  end if;

  if exists (
    select 1
    from public.rental_conversion_commission_settlements s
    where s.workspace_id = p_workspace_id
      and s.equipment_id = p_equipment_id
      and s.status = 'posted'
  ) then
    raise exception 'unit conversion commission is posted; use a finance correction workflow'
      using errcode = '55000';
  end if;

  select * into v_contract
  from public.rental_contracts c
  where c.id = p_contract_id
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for update;

  if not found then
    raise exception 'rental contract not found in workspace'
      using errcode = 'P0002';
  end if;

  if p_invoice_id is not null then
    select * into v_invoice
    from public.rental_invoices i
    where i.id = p_invoice_id
      and i.workspace_id = p_workspace_id
      and i.rental_contract_id = p_contract_id
      and i.deleted_at is null
    for update;

    if not found then
      raise exception 'rental invoice not found in contract workspace'
        using errcode = 'P0002';
    end if;
    if v_invoice.status::text <> 'paid' then
      raise exception 'commission can be recorded only after rental invoice is paid'
        using errcode = '22023';
    end if;

    select coalesce(sum(l.rent_basis_cents), 0)::bigint into v_recorded_basis
    from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.rental_invoice_id = p_invoice_id
      and l.entry_kind = 'rental_commission_paid';

    if v_recorded_basis + p_rent_basis_cents > v_invoice.rental_charge_cents then
      raise exception 'paid commission rent basis exceeds invoice rental charge'
        using errcode = '23514';
    end if;
  end if;

  select count(*), coalesce(sum(rc.split_pct), 0)
  into v_split_count, v_split_total
  from public.rental_contract_commissions rc
  where rc.workspace_id = p_workspace_id
    and rc.rental_contract_id = p_contract_id
    and rc.deleted_at is null;

  if v_split_count = 0 or abs(v_split_total - 100) > 0.01 then
    raise exception 'active rental contract commission splits must total 100 before commission can be recorded'
      using errcode = '23514';
  end if;

  v_total_commission := round(p_rent_basis_cents::numeric * 0.050000)::bigint;
  v_remaining_basis := p_rent_basis_cents;
  v_remaining_commission := v_total_commission;
  v_remaining_pct := v_split_total;

  for v_split in
    select rc.*
    from public.rental_contract_commissions rc
    where rc.workspace_id = p_workspace_id
      and rc.rental_contract_id = p_contract_id
      and rc.deleted_at is null
    order by rc.split_pct desc, rc.created_at, rc.id
  loop
    v_split_position := v_split_position + 1;
    if v_split_position = v_split_count then
      v_allocated_basis := v_remaining_basis;
      v_allocated_commission := v_remaining_commission;
    else
      v_allocated_basis := least(
        v_remaining_basis,
        greatest(
          0,
          round(v_remaining_basis::numeric * v_split.split_pct / v_remaining_pct)::bigint
        )
      );
      v_allocated_commission := least(
        v_remaining_commission,
        greatest(
          0,
          round(v_remaining_commission::numeric * v_split.split_pct / v_remaining_pct)::bigint
        )
      );
    end if;

    if v_allocated_basis > 0 then
      insert into public.rental_unit_commission_ledger (
        workspace_id, equipment_id, rental_contract_id, rental_invoice_id,
        salesperson_id, rental_contract_commission_id, split_pct_snapshot,
        origin_paid_entry_id, entry_kind, source_kind, source_event_key,
        source_reference, source_rent_basis_cents, rent_basis_cents,
        commission_cents, recognized_at, actor_id, metadata
      ) values (
        p_workspace_id, p_equipment_id, p_contract_id, p_invoice_id,
        v_split.salesperson_id, v_split.id, v_split.split_pct,
        null, 'rental_commission_paid', p_source_kind, btrim(p_source_event_key),
        btrim(p_source_reference),
        p_rent_basis_cents, v_allocated_basis, v_allocated_commission,
        p_paid_at, p_actor_id, coalesce(p_metadata, '{}'::jsonb)
      );
    end if;

    v_remaining_basis := v_remaining_basis - v_allocated_basis;
    v_remaining_commission := v_remaining_commission - v_allocated_commission;
    v_remaining_pct := v_remaining_pct - v_split.split_pct;
  end loop;

  if v_remaining_basis <> 0 or v_remaining_commission <> 0 then
    raise exception 'commission split allocation did not reconcile to the source event'
      using errcode = '23514';
  end if;

  return query
  select l.* from public.rental_unit_commission_ledger l
  where l.workspace_id = p_workspace_id
    and l.source_event_key = btrim(p_source_event_key)
  order by l.salesperson_id, l.id;
end;
$$;

revoke all on function public.rental_record_unit_commission_paid(
  text, uuid, uuid, bigint, text, timestamptz, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.rental_record_unit_commission_paid(
  text, uuid, uuid, bigint, text, timestamptz, uuid, text, text, uuid, jsonb
) to service_role;

-- Backend-only refund boundary. It intentionally has no producer until QEP has
-- a canonical rent-refund/credit source event; callers may not manufacture one.
-- The invoice and source/unit advisory locks make approved source retries safe.
create or replace function public.rental_record_rent_refund_clawback(
  p_workspace_id text,
  p_contract_id uuid,
  p_equipment_id uuid,
  p_invoice_id uuid,
  p_refunded_rent_cents bigint,
  p_refund_kind text,
  p_source_event_key text,
  p_source_reference text default null,
  p_actor_id uuid default null,
  p_refunded_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns setof public.rental_unit_commission_ledger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.rental_invoices%rowtype;
  v_origin record;
  v_origin_count integer;
  v_origin_position integer := 0;
  v_available_basis bigint;
  v_available_commission bigint;
  v_remaining_available_basis bigint;
  v_remaining_available_commission bigint;
  v_total_clawback bigint;
  v_remaining_refund_basis bigint;
  v_remaining_clawback bigint;
  v_allocated_basis bigint;
  v_allocated_clawback bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_record_rent_refund_clawback requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_workspace_id, '')), '') is null
     or p_contract_id is null
     or p_equipment_id is null
     or p_invoice_id is null
     or p_refunded_rent_cents is null
     or p_refunded_rent_cents <= 0
     or nullif(btrim(coalesce(p_source_event_key, '')), '') is null
     or nullif(btrim(coalesce(p_source_reference, '')), '') is null
     or p_refunded_at is null then
    raise exception 'workspace, contract, equipment, invoice, positive refunded rent, source key/reference, and refunded_at are required'
      using errcode = '22023';
  end if;
  if p_refund_kind not in (
    'credit_memo', 'correction', 'goodwill_refund',
    'cash_refund', 'other_rent_refund'
  ) then
    raise exception 'unsupported rent refund kind'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-source:' || p_workspace_id || ':' || btrim(p_source_event_key),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-unit:' || p_workspace_id || ':' || p_equipment_id::text,
      0
    )
  );

  if exists (
    select 1 from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.source_event_key = btrim(p_source_event_key)
  ) then
    if exists (
      select 1 from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
        and (
          l.entry_kind <> 'rent_refund_clawback'
          or l.equipment_id <> p_equipment_id
          or l.rental_contract_id <> p_contract_id
          or l.rental_invoice_id <> p_invoice_id
          or l.source_kind <> p_refund_kind
          or l.source_reference is distinct from btrim(p_source_reference)
          or l.source_rent_basis_cents <> p_refunded_rent_cents
        )
    ) or (
      select coalesce(sum(l.rent_basis_cents), 0)
      from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
    ) <> p_refunded_rent_cents or (
      select coalesce(sum(l.commission_cents), 0)
      from public.rental_unit_commission_ledger l
      where l.workspace_id = p_workspace_id
        and l.source_event_key = btrim(p_source_event_key)
    ) <> -round(p_refunded_rent_cents::numeric * 0.050000)::bigint then
      raise exception 'source event key already exists with different clawback economics'
        using errcode = '23505';
    end if;

    return query
    select l.* from public.rental_unit_commission_ledger l
    where l.workspace_id = p_workspace_id
      and l.source_event_key = btrim(p_source_event_key)
    order by l.salesperson_id, l.origin_paid_entry_id, l.id;
    return;
  end if;

  if exists (
    select 1
    from public.rental_conversion_commission_settlements s
    where s.workspace_id = p_workspace_id
      and s.equipment_id = p_equipment_id
      and s.status = 'posted'
  ) then
    raise exception 'unit conversion commission is posted; use a finance correction workflow'
      using errcode = '55000';
  end if;

  select * into v_invoice
  from public.rental_invoices i
  where i.id = p_invoice_id
    and i.workspace_id = p_workspace_id
    and i.rental_contract_id = p_contract_id
    and i.deleted_at is null
  for update;

  if not found then
    raise exception 'rental invoice not found in contract workspace'
      using errcode = 'P0002';
  end if;

  select
    count(*),
    coalesce(sum(x.remaining_basis), 0)::bigint,
    coalesce(sum(x.remaining_commission), 0)::bigint
  into v_origin_count, v_available_basis, v_available_commission
  from (
    select
      paid.id,
      paid.rent_basis_cents
        - coalesce(sum(refund.rent_basis_cents), 0)::bigint as remaining_basis,
      paid.commission_cents
        + coalesce(sum(refund.commission_cents), 0)::bigint as remaining_commission
    from public.rental_unit_commission_ledger paid
    left join public.rental_unit_commission_ledger refund
      on refund.origin_paid_entry_id = paid.id
     and refund.entry_kind = 'rent_refund_clawback'
    where paid.workspace_id = p_workspace_id
      and paid.rental_contract_id = p_contract_id
      and paid.equipment_id = p_equipment_id
      and paid.rental_invoice_id = p_invoice_id
      and paid.entry_kind = 'rental_commission_paid'
    group by paid.id
  ) x
  where x.remaining_basis > 0;

  v_total_clawback := round(p_refunded_rent_cents::numeric * 0.050000)::bigint;
  if v_origin_count = 0
     or p_refunded_rent_cents > v_available_basis
     or v_total_clawback > v_available_commission then
    raise exception 'refund clawback exceeds attributable prior paid commission'
      using errcode = '23514';
  end if;

  v_remaining_refund_basis := p_refunded_rent_cents;
  v_remaining_clawback := v_total_clawback;
  v_remaining_available_basis := v_available_basis;
  v_remaining_available_commission := v_available_commission;

  for v_origin in
    select
      paid.*,
      paid.rent_basis_cents
        - coalesce(sum(refund.rent_basis_cents), 0)::bigint as remaining_basis,
      paid.commission_cents
        + coalesce(sum(refund.commission_cents), 0)::bigint as remaining_commission
    from public.rental_unit_commission_ledger paid
    left join public.rental_unit_commission_ledger refund
      on refund.origin_paid_entry_id = paid.id
     and refund.entry_kind = 'rent_refund_clawback'
    where paid.workspace_id = p_workspace_id
      and paid.rental_contract_id = p_contract_id
      and paid.equipment_id = p_equipment_id
      and paid.rental_invoice_id = p_invoice_id
      and paid.entry_kind = 'rental_commission_paid'
    group by paid.id
    having paid.rent_basis_cents - coalesce(sum(refund.rent_basis_cents), 0) > 0
    order by paid.recognized_at, paid.id
  loop
    v_origin_position := v_origin_position + 1;
    if v_origin_position = v_origin_count then
      v_allocated_basis := v_remaining_refund_basis;
      v_allocated_clawback := v_remaining_clawback;
    else
      v_allocated_basis := least(
        v_origin.remaining_basis,
        v_remaining_refund_basis,
        greatest(
          0,
          round(
            v_remaining_refund_basis::numeric * v_origin.remaining_basis
              / v_remaining_available_basis
          )::bigint
        )
      );
      v_allocated_clawback := least(
        v_origin.remaining_commission,
        v_remaining_clawback,
        greatest(
          0,
          case
            when v_remaining_available_commission = 0 then 0
            else round(
              v_remaining_clawback::numeric * v_origin.remaining_commission
                / v_remaining_available_commission
            )::bigint
          end
        )
      );
      if v_allocated_basis = 0 then
        v_allocated_clawback := 0;
      end if;
    end if;

    if v_allocated_basis > 0 then
      insert into public.rental_unit_commission_ledger (
        workspace_id, equipment_id, rental_contract_id, rental_invoice_id,
        salesperson_id, rental_contract_commission_id, split_pct_snapshot,
        origin_paid_entry_id, entry_kind, source_kind, source_event_key,
        source_reference, source_rent_basis_cents, rent_basis_cents,
        commission_cents, recognized_at, actor_id, metadata
      ) values (
        p_workspace_id, p_equipment_id, p_contract_id, p_invoice_id,
        v_origin.salesperson_id, v_origin.rental_contract_commission_id,
        v_origin.split_pct_snapshot, v_origin.id,
        'rent_refund_clawback', p_refund_kind, btrim(p_source_event_key),
        btrim(p_source_reference), p_refunded_rent_cents,
        v_allocated_basis, -v_allocated_clawback,
        p_refunded_at, p_actor_id, coalesce(p_metadata, '{}'::jsonb)
      );
    end if;

    v_remaining_refund_basis := v_remaining_refund_basis - v_allocated_basis;
    v_remaining_clawback := v_remaining_clawback - v_allocated_clawback;
    v_remaining_available_basis :=
      v_remaining_available_basis - v_origin.remaining_basis;
    v_remaining_available_commission :=
      v_remaining_available_commission - v_origin.remaining_commission;
  end loop;

  if v_remaining_refund_basis <> 0 or v_remaining_clawback <> 0 then
    raise exception 'refund clawback allocation did not reconcile to prior paid commission'
      using errcode = '23514';
  end if;

  return query
  select l.* from public.rental_unit_commission_ledger l
  where l.workspace_id = p_workspace_id
    and l.source_event_key = btrim(p_source_event_key)
  order by l.salesperson_id, l.origin_paid_entry_id, l.id;
end;
$$;

revoke all on function public.rental_record_rent_refund_clawback(
  text, uuid, uuid, uuid, bigint, text, text, text, uuid, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.rental_record_rent_refund_clawback(
  text, uuid, uuid, uuid, bigint, text, text, text, uuid, timestamptz, jsonb
) to service_role;

create or replace view public.v_rental_unit_commission_truth
with (security_invoker = true) as
select
  l.workspace_id,
  l.equipment_id,
  coalesce(sum(l.rent_basis_cents) filter (
    where l.entry_kind = 'rental_commission_paid'
  ), 0)::bigint as paid_rent_basis_cents,
  coalesce(sum(l.commission_cents) filter (
    where l.entry_kind = 'rental_commission_paid'
  ), 0)::bigint as rental_commission_paid_cents,
  coalesce(sum(l.rent_basis_cents) filter (
    where l.entry_kind = 'rent_refund_clawback'
  ), 0)::bigint as refunded_rent_basis_cents,
  coalesce(sum(l.commission_cents) filter (
    where l.entry_kind = 'rent_refund_clawback'
  ), 0)::bigint as refund_clawback_cents,
  coalesce(sum(l.commission_cents), 0)::bigint as net_unit_commission_cents,
  max(l.recognized_at) as latest_commission_event_at
from public.rental_unit_commission_ledger l
group by l.workspace_id, l.equipment_id;

comment on view public.v_rental_unit_commission_truth is
  'Finance-readable unit rollup: prior paid rental commission, exact refund clawbacks, and net compensation. RLS is inherited from the append-only ledger.';

revoke all on table public.v_rental_unit_commission_truth from public, anon;
grant select on table public.v_rental_unit_commission_truth
  to authenticated, service_role;

create or replace view public.v_rental_unit_commission_payee_truth
with (security_invoker = true) as
select
  l.workspace_id,
  l.equipment_id,
  l.salesperson_id,
  coalesce(sum(l.rent_basis_cents) filter (
    where l.entry_kind = 'rental_commission_paid'
  ), 0)::bigint as paid_rent_basis_cents,
  coalesce(sum(l.rent_basis_cents) filter (
    where l.entry_kind = 'rent_refund_clawback'
  ), 0)::bigint as refunded_rent_basis_cents,
  coalesce(sum(l.commission_cents) filter (
    where l.entry_kind = 'rental_commission_paid'
  ), 0)::bigint as rental_commission_paid_cents,
  coalesce(sum(l.commission_cents) filter (
    where l.entry_kind = 'rent_refund_clawback'
  ), 0)::bigint as refund_clawback_cents,
  coalesce(sum(l.commission_cents), 0)::bigint as net_payee_commission_cents,
  max(l.recognized_at) as latest_commission_event_at
from public.rental_unit_commission_ledger l
group by l.workspace_id, l.equipment_id, l.salesperson_id;

comment on view public.v_rental_unit_commission_payee_truth is
  'Finance-readable per-unit, per-salesperson compensation truth. Every clawback remains tied to the original paid entry and original payee split evidence.';

revoke all on table public.v_rental_unit_commission_payee_truth from public, anon;
grant select on table public.v_rental_unit_commission_payee_truth
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Frozen rental-to-purchase conversion commission settlement
-- ---------------------------------------------------------------------------

create table if not exists public.rental_conversion_commission_settlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  qb_deal_id uuid not null references public.qb_deals(id) on delete restrict,
  qrm_deal_id uuid not null references public.qrm_deals(id) on delete restrict,
  rental_contract_id uuid not null references public.rental_contracts(id) on delete restrict,
  equipment_id uuid not null references public.qrm_equipment(id) on delete restrict,
  sale_salesperson_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  negotiated_rent_credit_cents bigint not null default 0
    check (negotiated_rent_credit_cents >= 0),
  gross_margin_cents bigint not null,
  conversion_rate_pct numeric(7, 6) not null default 0.150000
    check (conversion_rate_pct = 0.150000),
  prior_net_rental_commission_cents bigint not null default 0
    check (prior_net_rental_commission_cents >= 0),
  gross_conversion_commission_cents bigint generated always as (
    round(gross_margin_cents::numeric * conversion_rate_pct)::bigint
  ) stored,
  net_conversion_commission_cents bigint generated always as (
    round(gross_margin_cents::numeric * conversion_rate_pct)::bigint
      - prior_net_rental_commission_cents
  ) stored,
  status text not null default 'calculated'
    check (status in ('calculated', 'exception', 'posted', 'void')),
  calculated_by uuid references public.profiles(id) on delete set null,
  calculated_at timestamptz not null default now(),
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint rental_conversion_commission_status_evidence_ck check (
    (status = 'posted' and posted_by is not null and posted_at is not null)
    or (status = 'void' and voided_by is not null and voided_at is not null
        and nullif(btrim(coalesce(void_reason, '')), '') is not null)
    or status in ('calculated', 'exception')
  )
);

comment on table public.rental_conversion_commission_settlements is
  'RN9 frozen unit-level conversion settlement. Net commission is exactly round(gross margin x 15%) minus NET prior rental commission on the unit after attributable clawbacks. Posting updates qb_deals commission only; asset cost and rental/GL ledgers remain untouched.';
comment on column public.rental_conversion_commission_settlements.negotiated_rent_credit_cents is
  'Deal-specific rent credit approved for the customer. Persisted as evidence; it is not guessed from historical paid rent.';
comment on column public.rental_conversion_commission_settlements.net_conversion_commission_cents is
  'Signed exact policy result. Negative results remain exception rows and are never silently floored or posted as employee debt.';

create index if not exists idx_rental_conversion_commission_qrm_deal_fk
  on public.rental_conversion_commission_settlements (qrm_deal_id);

create index if not exists idx_rental_conversion_commission_contract_fk
  on public.rental_conversion_commission_settlements (rental_contract_id);

create index if not exists idx_rental_conversion_commission_equipment_fk
  on public.rental_conversion_commission_settlements (equipment_id);

create index if not exists idx_rental_conversion_commission_salesperson_fk
  on public.rental_conversion_commission_settlements (sale_salesperson_id);

create unique index if not exists uq_rental_conversion_commission_active_deal
  on public.rental_conversion_commission_settlements (qb_deal_id)
  where status <> 'void';

create unique index if not exists uq_rental_conversion_commission_active_unit
  on public.rental_conversion_commission_settlements (workspace_id, equipment_id)
  where status <> 'void';

create index if not exists idx_rental_conversion_commission_contract
  on public.rental_conversion_commission_settlements
    (workspace_id, rental_contract_id, calculated_at desc);

alter table public.rental_conversion_commission_settlements
  enable row level security;

create policy "rental_conversion_commission_service_all"
  on public.rental_conversion_commission_settlements for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "rental_conversion_commission_finance_select"
  on public.rental_conversion_commission_settlements for select
  using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'finance_admin', 'manager', 'owner')
  );

revoke all on table public.rental_conversion_commission_settlements
  from public, anon, authenticated, service_role;
grant select on table public.rental_conversion_commission_settlements
  to authenticated, service_role;

-- Defend frozen economics even from direct service-role inserts. The trigger
-- recomputes source margin and prior PAID unit commission from canonical rows.
create or replace function public.rental_validate_conversion_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_prior_net bigint;
begin
  select
    d.workspace_id as deal_workspace_id,
    d.crm_deal_id,
    d.gross_margin_cents,
    d.status as qb_status,
    d.commission_paid,
    d.salesman_id,
    q.workspace_id as qrm_workspace_id,
    q.rental_contract_id,
    c.workspace_id as contract_workspace_id
  into v_context
  from public.qb_deals d
  join public.qrm_deals q on q.id = d.crm_deal_id
  join public.rental_contracts c on c.id = q.rental_contract_id
  where d.id = new.qb_deal_id
    and d.deleted_at is null
    and q.id = new.qrm_deal_id
    and q.deleted_at is null
    and c.id = new.rental_contract_id
    and c.deleted_at is null;

  if not found
     or v_context.deal_workspace_id is distinct from new.workspace_id
     or v_context.qrm_workspace_id is distinct from new.workspace_id
     or v_context.contract_workspace_id is distinct from new.workspace_id then
    raise exception 'conversion deal/contract workspace provenance mismatch'
      using errcode = '23514';
  end if;

  if v_context.qb_status::text not in ('won', 'delivered') then
    raise exception 'conversion commission requires a won or delivered equipment sale'
      using errcode = '22023';
  end if;
  if v_context.commission_paid then
    raise exception 'conversion commission cannot replace an already-paid sale commission'
      using errcode = '22023';
  end if;
  if v_context.gross_margin_cents is distinct from new.gross_margin_cents then
    raise exception 'conversion gross margin must match frozen qb_deals margin'
      using errcode = '23514';
  end if;
  if v_context.salesman_id is distinct from new.sale_salesperson_id then
    raise exception 'conversion sale salesperson snapshot is stale or incorrect'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.qrm_equipment e
    where e.id = new.equipment_id
      and e.workspace_id = new.workspace_id
      and e.deleted_at is null
  ) then
    raise exception 'conversion equipment/workspace mismatch'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.rental_contracts c
    where c.id = new.rental_contract_id
      and c.workspace_id = new.workspace_id
      and c.deleted_at is null
      and (
        c.equipment_id = new.equipment_id
        or exists (
          select 1
          from public.rental_contract_lines l
          where l.rental_contract_id = c.id
            and l.workspace_id = c.workspace_id
            and l.equipment_id = new.equipment_id
            and l.deleted_at is null
        )
      )
  ) then
    raise exception 'conversion unit is not assigned to rental contract'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.qrm_deal_equipment de
    where de.deal_id = new.qrm_deal_id
      and de.workspace_id = new.workspace_id
      and de.equipment_id = new.equipment_id
      and de.role::text in ('subject', 'rental')
  ) then
    raise exception 'conversion unit is not linked to the QRM deal'
      using errcode = '23514';
  end if;

  select coalesce(sum(l.commission_cents), 0)::bigint into v_prior_net
  from public.rental_unit_commission_ledger l
  where l.workspace_id = new.workspace_id
    and l.equipment_id = new.equipment_id;

  if v_prior_net < 0 then
    raise exception 'net unit rental commission cannot be negative'
      using errcode = '23514';
  end if;
  if v_prior_net is distinct from new.prior_net_rental_commission_cents then
    raise exception 'prior net rental commission snapshot is stale or incorrect'
      using errcode = '40001';
  end if;

  if new.calculated_by is not null and not exists (
    select 1
    from public.profile_workspaces pw
    where pw.profile_id = new.calculated_by
      and pw.workspace_id = new.workspace_id
  ) then
    raise exception 'conversion calculator is not a workspace member'
      using errcode = '42501';
  end if;

  -- A negative exact result is preserved for finance review, never silently
  -- floored and never made payable by the calculation operation.
  if round(new.gross_margin_cents::numeric * new.conversion_rate_pct)::bigint
       - new.prior_net_rental_commission_cents < 0 then
    new.status := 'exception';
  else
    new.status := 'calculated';
  end if;

  return new;
end;
$$;

revoke all on function public.rental_validate_conversion_commission()
  from public, anon, authenticated, service_role;

create trigger trg_rental_validate_conversion_commission
  before insert on public.rental_conversion_commission_settlements
  for each row execute function public.rental_validate_conversion_commission();

-- Economics/provenance are immutable. Only the controlled calculated/exception
-- -> posted/void transitions may mutate a settlement.
create or replace function public.rental_guard_conversion_commission_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversion commission settlements cannot be deleted'
      using errcode = '55000';
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.qb_deal_id is distinct from old.qb_deal_id
     or new.qrm_deal_id is distinct from old.qrm_deal_id
     or new.rental_contract_id is distinct from old.rental_contract_id
     or new.equipment_id is distinct from old.equipment_id
     or new.sale_salesperson_id is distinct from old.sale_salesperson_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.negotiated_rent_credit_cents is distinct from old.negotiated_rent_credit_cents
     or new.gross_margin_cents is distinct from old.gross_margin_cents
     or new.conversion_rate_pct is distinct from old.conversion_rate_pct
     or new.prior_net_rental_commission_cents is distinct from old.prior_net_rental_commission_cents
     or new.calculated_by is distinct from old.calculated_by
     or new.calculated_at is distinct from old.calculated_at
     or new.metadata is distinct from old.metadata
     or new.created_at is distinct from old.created_at then
    raise exception 'conversion commission economics are immutable; void and recalculate'
      using errcode = '55000';
  end if;

  if old.status in ('posted', 'void') then
    raise exception 'posted or void conversion settlement is immutable'
      using errcode = '55000';
  end if;
  if new.status not in ('posted', 'void') then
    raise exception 'settlement transition must be posted or void'
      using errcode = '23514';
  end if;
  if old.status = 'exception' and new.status = 'posted' then
    raise exception 'negative conversion settlement cannot post; void and resolve'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.rental_guard_conversion_commission_mutation()
  from public, anon, authenticated, service_role;

create trigger trg_rental_guard_conversion_commission_update
  before update on public.rental_conversion_commission_settlements
  for each row execute function public.rental_guard_conversion_commission_mutation();

create trigger trg_rental_guard_conversion_commission_delete
  before delete on public.rental_conversion_commission_settlements
  for each row execute function public.rental_guard_conversion_commission_mutation();

create or replace function public.rental_calculate_conversion_commission(
  p_workspace_id text,
  p_qb_deal_id uuid,
  p_equipment_id uuid,
  p_negotiated_rent_credit_cents bigint,
  p_idempotency_key text,
  p_actor_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.rental_conversion_commission_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_prior_net bigint;
  v_net_paid_rent_basis bigint;
  v_existing public.rental_conversion_commission_settlements%rowtype;
  v_row public.rental_conversion_commission_settlements%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_calculate_conversion_commission requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_workspace_id, '')), '') is null
     or p_qb_deal_id is null
     or p_equipment_id is null
     or p_negotiated_rent_credit_cents is null
     or p_negotiated_rent_credit_cents < 0
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'workspace, deal, unit, nonnegative negotiated credit, and idempotency key are required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-unit:' || p_workspace_id || ':' || p_equipment_id::text,
      0
    )
  );

  select
    d.crm_deal_id as qrm_deal_id,
    d.gross_margin_cents,
    d.salesman_id,
    q.rental_contract_id
  into v_context
  from public.qb_deals d
  join public.qrm_deals q on q.id = d.crm_deal_id
  where d.id = p_qb_deal_id
    and d.workspace_id = p_workspace_id
    and d.deleted_at is null
    and q.workspace_id = p_workspace_id
    and q.deleted_at is null
    and q.rental_contract_id is not null
  for update of d;

  if not found then
    raise exception 'rental-conversion equipment deal not found'
      using errcode = 'P0002';
  end if;

  select
    coalesce(sum(l.commission_cents), 0)::bigint,
    coalesce(sum(
      case
        when l.entry_kind = 'rent_refund_clawback' then -l.rent_basis_cents
        else l.rent_basis_cents
      end
    ), 0)::bigint
  into v_prior_net, v_net_paid_rent_basis
  from public.rental_unit_commission_ledger l
  where l.workspace_id = p_workspace_id
    and l.equipment_id = p_equipment_id;

  if v_prior_net < 0 or v_net_paid_rent_basis < 0 then
    raise exception 'net unit rental commission or paid-rent basis cannot be negative'
      using errcode = '23514';
  end if;
  if p_negotiated_rent_credit_cents > v_net_paid_rent_basis then
    raise exception 'negotiated rent credit exceeds net attributable paid rent on the unit'
      using errcode = '23514';
  end if;

  insert into public.rental_conversion_commission_settlements (
    workspace_id, qb_deal_id, qrm_deal_id, rental_contract_id,
    equipment_id, sale_salesperson_id, idempotency_key,
    negotiated_rent_credit_cents,
    gross_margin_cents, conversion_rate_pct,
    prior_net_rental_commission_cents, calculated_by, metadata
  ) values (
    p_workspace_id, p_qb_deal_id, v_context.qrm_deal_id,
    v_context.rental_contract_id, p_equipment_id, v_context.salesman_id,
    btrim(p_idempotency_key),
    p_negotiated_rent_credit_cents, v_context.gross_margin_cents,
    0.150000, v_prior_net, p_actor_id, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_row;

  if found then
    return v_row;
  end if;

  select * into v_existing
  from public.rental_conversion_commission_settlements s
  where s.workspace_id = p_workspace_id
    and s.idempotency_key = btrim(p_idempotency_key);

  if v_existing.qb_deal_id = p_qb_deal_id
     and v_existing.equipment_id = p_equipment_id
     and v_existing.sale_salesperson_id = v_context.salesman_id
     and v_existing.negotiated_rent_credit_cents = p_negotiated_rent_credit_cents
     and v_existing.gross_margin_cents = v_context.gross_margin_cents
     and v_existing.prior_net_rental_commission_cents = v_prior_net then
    return v_existing;
  end if;

  raise exception 'idempotency key already exists with different conversion economics'
    using errcode = '23505';
end;
$$;

revoke all on function public.rental_calculate_conversion_commission(
  text, uuid, uuid, bigint, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.rental_calculate_conversion_commission(
  text, uuid, uuid, bigint, text, uuid, jsonb
) to service_role;

create or replace function public.rental_post_conversion_commission(
  p_workspace_id text,
  p_settlement_id uuid,
  p_actor_id uuid
)
returns public.rental_conversion_commission_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rental_conversion_commission_settlements%rowtype;
  v_deal public.qb_deals%rowtype;
  v_equipment_id uuid;
  v_prior_net bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_post_conversion_commission requires service_role'
      using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw on pw.profile_id = p.id
    where p.id = p_actor_id
      and p.is_active = true
      and p.role::text in ('admin', 'manager', 'owner')
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'active admin, manager, or owner approval is required'
      using errcode = '42501';
  end if;

  select s.equipment_id into v_equipment_id
  from public.rental_conversion_commission_settlements s
  where s.id = p_settlement_id
    and s.workspace_id = p_workspace_id;

  if not found then
    raise exception 'conversion commission settlement not found'
      using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rental-commission-unit:' || p_workspace_id || ':' || v_equipment_id::text,
      0
    )
  );

  select * into v_row
  from public.rental_conversion_commission_settlements s
  where s.id = p_settlement_id
    and s.workspace_id = p_workspace_id
  for update;

  if v_row.status = 'posted' then
    return v_row;
  end if;
  if v_row.status <> 'calculated' then
    raise exception 'only a nonnegative calculated settlement can post'
      using errcode = '22023';
  end if;

  select * into v_deal
  from public.qb_deals d
  where d.id = v_row.qb_deal_id
    and d.workspace_id = p_workspace_id
    and d.deleted_at is null
  for update;

  if not found or v_deal.status::text not in ('won', 'delivered') then
    raise exception 'equipment deal is no longer postable'
      using errcode = '22023';
  end if;
  if v_deal.commission_paid then
    raise exception 'equipment sale commission was already paid'
      using errcode = '22023';
  end if;
  if v_deal.gross_margin_cents is distinct from v_row.gross_margin_cents then
    raise exception 'deal margin changed; void and recalculate settlement'
      using errcode = '40001';
  end if;
  if v_deal.salesman_id is distinct from v_row.sale_salesperson_id then
    raise exception 'deal salesperson changed; void and recalculate settlement'
      using errcode = '40001';
  end if;

  select coalesce(sum(l.commission_cents), 0)::bigint into v_prior_net
  from public.rental_unit_commission_ledger l
  where l.workspace_id = p_workspace_id
    and l.equipment_id = v_row.equipment_id;

  if v_prior_net < 0
     or v_prior_net is distinct from v_row.prior_net_rental_commission_cents then
    raise exception 'unit commission changed; void and recalculate settlement'
      using errcode = '40001';
  end if;

  update public.qb_deals
  set commission_rate_pct = 0.1500,
      commission_cents = v_row.net_conversion_commission_cents,
      updated_at = now()
  where id = v_row.qb_deal_id
    and workspace_id = p_workspace_id;

  update public.rental_conversion_commission_settlements
  set status = 'posted',
      posted_by = p_actor_id,
      posted_at = now(),
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rental_post_conversion_commission(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rental_post_conversion_commission(text, uuid, uuid)
  to service_role;

create or replace function public.rental_void_conversion_commission(
  p_workspace_id text,
  p_settlement_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns public.rental_conversion_commission_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.rental_conversion_commission_settlements%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'rental_void_conversion_commission requires service_role'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'void reason is required' using errcode = '22023';
  end if;
  if p_actor_id is null or not exists (
    select 1
    from public.profiles p
    join public.profile_workspaces pw on pw.profile_id = p.id
    where p.id = p_actor_id
      and p.is_active = true
      and p.role::text in ('admin', 'manager', 'owner')
      and pw.workspace_id = p_workspace_id
  ) then
    raise exception 'active admin, manager, or owner approval is required'
      using errcode = '42501';
  end if;

  select * into v_row
  from public.rental_conversion_commission_settlements s
  where s.id = p_settlement_id
    and s.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'conversion commission settlement not found'
      using errcode = 'P0002';
  end if;
  if v_row.status = 'void' then
    return v_row;
  end if;
  if v_row.status = 'posted' then
    raise exception 'posted commission cannot be voided by this calculation workflow'
      using errcode = '22023';
  end if;

  update public.rental_conversion_commission_settlements
  set status = 'void',
      voided_by = p_actor_id,
      voided_at = now(),
      void_reason = btrim(p_reason),
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.rental_void_conversion_commission(
  text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.rental_void_conversion_commission(
  text, uuid, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Roadmap/Linear source-of-truth evidence
-- ---------------------------------------------------------------------------

update public.qep_roadmap_tasks
set ship_state = 'in_progress',
    blocking_decision = 'BLK-RENTAL-COMMISSION-SOURCE-WIRING',
    evidence_link = 'supabase/migrations/830_rental_conversion_commission_and_refund_clawback.sql',
    notes = coalesce(notes, '') ||
      E'\n[2026-07-20] RN9/RN10 backend-ready, NOT shipped: append-only per-unit/per-payee commission truth snapshots active rental contract splits; clawbacks reference original paid entries and cannot exceed attributable paid commission; conversion nets prior commission after clawbacks; unit/source locks protect retries and settlement posting. Operational release remains blocked until canonical customer-payment, rent-refund/credit, and conversion-approval producers invoke these boundaries and pass database behavior/UAT evidence. No refund source was invented. Mission alignment CONDITIONAL PASS: the backend protects employee compensation and machine-level economics, but the task stays in progress until real operational events are wired.',
    updated_at = now()
where task_id = 'L12.1';

insert into public.qep_roadmap_sync_events (
  direction, task_id, action, changed_fields, actor
) values (
  'reconcile',
  'L12.1',
  'update',
  jsonb_build_object(
    'ship_state', 'in_progress',
    'blocking_decision', 'BLK-RENTAL-COMMISSION-SOURCE-WIRING',
    'migration', '830_rental_conversion_commission_and_refund_clawback.sql',
    'owner_answers', jsonb_build_array('RN9', 'RN10'),
    'backend_state', 'backend_ready_unshipped',
    'mission_alignment', 'conditional pass: payee and unit economics are protected, but canonical payment, refund, and conversion callers plus acceptance evidence remain required'
  ),
  'codex'
);

commit;

-- Rollback / fix-forward notes:
--   This migration is an inert backend foundation until canonical payment,
--   refund, and conversion callers are wired. A rollback should first revoke
--   execute on its service-role RPCs, then retain the append-only ledgers and
--   settlements for audit. Do not drop or rewrite compensation evidence; use
--   a later correction migration and keep L12.1 in_progress.
