-- 803_n6_equipment_lifecycle_truth.sql
-- N6.1 — Equipment lifecycle truth + inventory surfaces (backend half).
--
-- 1. Closed-won lifecycle writer: trigger on qrm_deals stamps subject units
--    sold (in_out_state/availability/delivery_date) and trade_in-role units
--    traded_date when the deal enters an is_closed_won stage. The M1.1
--    invoice path (equipment-invoice.ts) also writes sold-state, but only
--    when an accepted quote exists — this trigger closes that gap and is
--    idempotent with it (coalesce/no-op on already-sold rows).
-- 2. Trade-to-stock: accepted trades become dealer stock units instead of
--    vanishing. Fires on qb_trade_ins disposition/approval transitions;
--    flips the linked unit (ownership/availability/inventory_type/costs)
--    or creates the qrm_equipment row when crm_equipment_id is null.
--    "Accepted" = disposition in (inventory/retail/rental_fleet) OR the
--    live recon vocabulary keep_recondition + approval approved (m766/793).
-- 3. Intake sync: equipment_intake.current_stage now writes
--    qrm_equipment.intake_stage (the COO MV's intake_stalled read a
--    permanently-NULL column); stage 8 sets sale_ready_at +
--    readiness_status='ready' and seeds default PM intervals.
-- 4. equipment_service_intervals writers: intake stage-8 seeding (above) +
--    service-job completion stamps last_completed/next_due from the
--    hour meter — PM countdowns ran on an empty table since m160.
-- 5. mv_exec_inventory_readiness: merge the two readiness vocabularies.
--    The MV counted 'ready/in_prep/blocked' (never written anywhere) while
--    the L-stream rental refactors write
--    'available/in_service/on_rent/down_for_service' — ready_rate was
--    structurally 0. The MV now buckets both vocabularies.
-- 6. get_asset_360: adds the missing rental/intake/invoices/trade arms and
--    reads qrm_equipment (base table) instead of the frozen crm_equipment
--    compat view so lifecycle columns are visible.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Closed-won lifecycle writer
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_deal_close_equipment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_closed boolean;
  v_old_closed boolean;
begin
  select coalesce(s.is_closed_won, false) into v_new_closed
  from public.qrm_deal_stages s where s.id = new.stage_id;

  if not coalesce(v_new_closed, false) then
    return new;
  end if;

  select coalesce(s.is_closed_won, false) into v_old_closed
  from public.qrm_deal_stages s where s.id = old.stage_id;

  if coalesce(v_old_closed, false) then
    return new; -- already closed-won; don't re-stamp
  end if;

  -- Subject units: sold. delivery_date only if the invoice path hasn't
  -- already stamped a real one.
  update public.qrm_equipment e
  set in_out_state = 'sold',
      availability = 'sold',
      delivery_date = coalesce(e.delivery_date, current_date)
  from public.qrm_deal_equipment de
  where de.deal_id = new.id
    and de.role = 'subject'
    and de.equipment_id = e.id
    and e.deleted_at is null;

  -- Trade-in units: traded_date (previously had zero writers anywhere).
  update public.qrm_equipment e
  set traded_date = coalesce(e.traded_date, current_date)
  from public.qrm_deal_equipment de
  where de.deal_id = new.id
    and de.role = 'trade_in'
    and de.equipment_id = e.id
    and e.deleted_at is null;

  return new;
end;
$$;

drop trigger if exists trg_deal_close_equipment_lifecycle on public.qrm_deals;
create trigger trg_deal_close_equipment_lifecycle
  after update of stage_id on public.qrm_deals
  for each row execute function public.trg_deal_close_equipment_lifecycle();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Trade-to-stock conversion
-- ─────────────────────────────────────────────────────────────────────────

-- New exception source for the zero-blocking orphan path below.
alter table public.exception_queue drop constraint if exists exception_queue_source_check;
alter table public.exception_queue add constraint exception_queue_source_check
  check (source = any (array[
    'tax_failed', 'price_unmatched', 'health_refresh_failed',
    'ar_override_pending', 'stripe_mismatch', 'portal_reorder_approval',
    'sop_evidence_mismatch', 'geofence_conflict', 'stale_telematics',
    'doc_visibility', 'data_quality', 'analytics_alert',
    'workflow_dead_letter', 'messaging_failure', 'messaging_opt_out_review',
    'rental_rate_mismatch', 'rental_overdue_return', 'rental_coi_expired',
    'rental_credit_hold', 'rental_damage_dispute', 'rental_overbook_override',
    'rental_billing_failed', 'equipment_billing_failed', 'doc_center_review',
    'parts_billing_failed', 'rental_rate_floor_override',
    'trade_to_stock_unlinked'
  ]::text[]));

create or replace function public.trg_trade_to_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now_stock boolean;
  v_was_stock boolean := false;
  v_equipment_id uuid;
  v_name text;
  v_company_id uuid;
begin
  v_now_stock :=
    new.disposition in ('inventory', 'retail', 'rental_fleet')
    or (new.disposition = 'keep_recondition'
        and new.reconditioning_approval_status = 'approved');

  if tg_op = 'UPDATE' then
    v_was_stock :=
      old.disposition in ('inventory', 'retail', 'rental_fleet')
      or (old.disposition = 'keep_recondition'
          and old.reconditioning_approval_status = 'approved');
  end if;

  if not v_now_stock or v_was_stock then
    return new;
  end if;

  -- Announce the system conversion to crm_guard_rep_equipment_financial_write
  -- (m800 latch pattern) — acquisition costs are the point of this write,
  -- and the firing session may be a rep approving a recon, not finance.
  perform set_config('qep.trade_to_stock_active', '1', true);

  if new.crm_equipment_id is not null then
    update public.qrm_equipment e
    set ownership = case
          when e.ownership = 'customer_owned' then
            (case when new.disposition = 'rental_fleet'
                  then 'rental_fleet'::public.crm_equipment_ownership
                  else 'owned'::public.crm_equipment_ownership end)
          else e.ownership end,
        availability = case
          when e.availability in ('sold', 'decommissioned') then e.availability
          else 'available'::public.crm_equipment_availability end,
        inventory_type = coalesce(e.inventory_type, 'trade_in'::public.inventory_type),
        traded_date = coalesce(e.traded_date, current_date),
        stock_number = coalesce(e.stock_number, 'T-' || left(new.id::text, 8)),
        current_cost_cents = coalesce(e.current_cost_cents, new.allowance_cents),
        net_book_value_cents = coalesce(
          e.net_book_value_cents, new.book_value_cents, new.allowance_cents)
    where e.id = new.crm_equipment_id
      and e.deleted_at is null;
  else
    -- qrm_equipment.company_id is NOT NULL — resolve provenance from the
    -- trade's deal, then quote. Zero-blocking: if no company resolves,
    -- surface an exception_queue row instead of failing the disposition
    -- write that fired this trigger.
    select d.company_id into v_company_id
    from public.qb_deals d where d.id = new.deal_id;
    if v_company_id is null then
      select q.company_id into v_company_id
      from public.qb_quotes q where q.id = new.quote_id;
    end if;

    if v_company_id is null then
      perform public.enqueue_exception(
        'trade_to_stock_unlinked',
        'Trade accepted for stock but no company resolvable',
        'warn',
        'qb_trade_ins row has no crm_equipment_id and neither deal_id nor quote_id resolves a company — stock unit not created.',
        jsonb_build_object('trade_in_id', new.id, 'disposition', new.disposition),
        'qb_trade_ins',
        new.id);
      return new;
    end if;

    v_name := nullif(trim(concat_ws(' ', new.year::text, new.make, new.model)), '');
    insert into public.qrm_equipment
      (workspace_id, company_id, name, make, model, year, serial_number,
       engine_hours, ownership, availability, inventory_type, traded_date,
       stock_number, current_cost_cents, net_book_value_cents, notes)
    values
      (coalesce(new.workspace_id, 'default'),
       v_company_id,
       coalesce(v_name, 'Trade-in unit ' || left(new.id::text, 8)),
       new.make, new.model, new.year, new.serial, new.hours,
       case when new.disposition = 'rental_fleet'
            then 'rental_fleet'::public.crm_equipment_ownership
            else 'owned'::public.crm_equipment_ownership end,
       'available', 'trade_in', current_date,
       'T-' || left(new.id::text, 8),
       new.allowance_cents,
       coalesce(new.book_value_cents, new.allowance_cents),
       'Created by trade-to-stock conversion (m803) from qb_trade_ins ' || new.id)
    returning id into v_equipment_id;

    -- Backfill the link. Only crm_equipment_id changes, which is not in
    -- this trigger's UPDATE OF column list — no re-fire.
    update public.qb_trade_ins
    set crm_equipment_id = v_equipment_id
    where id = new.id;
  end if;

  perform set_config('qep.trade_to_stock_active', '0', true);
  return new;
end;
$$;

-- Recreate the rep financial-write guard with the trade-to-stock latch
-- honored at the top (everything below is verbatim from the prior def).
create or replace function public.crm_guard_rep_equipment_financial_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- m803: trade-to-stock system conversion announces itself via a
  -- transaction-local latch (same shape as qep.trade_recondition_sync_active
  -- from m800). Only trg_trade_to_stock sets it, and it clears it after.
  if coalesce(current_setting('qep.trade_to_stock_active', true), '') = '1' then
    return new;
  end if;

  if public.qrm_can_access_customer_financial() then
    return new;
  end if;

  if tg_op = 'INSERT' and (
    new.purchase_price is not null
    or new.current_market_value is not null
    or new.replacement_cost is not null
    or new.daily_rental_rate is not null
    or new.weekly_rental_rate is not null
    or new.monthly_rental_rate is not null
    or new.current_cost_cents is not null
    or new.net_book_value_cents is not null
    or new.supplier_invoice_number is not null
    or new.supplier_invoice_date is not null
    or new.supplier_invoice_amount_cents is not null
    or new.reference_amount_cents is not null
    or new.note_amount_cents is not null
    or new.note_code is not null
    or new.note_due_date is not null
    or new.finance_amount_cents is not null
    or new.finance_due_date is not null
    or new.settlement_number is not null
    or new.settlement_date is not null
    or new.maintenance_expense_cents is not null
    or new.rental_cost_pct is not null
    or new.rental_insurable_amount_cents is not null
    or new.rental_amount_cents is not null
    or new.sale_gl_account is not null
    or new.inventory_gl_account is not null
  ) then
    raise exception 'FORBIDDEN_EQUIPMENT_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.purchase_price is distinct from old.purchase_price
    or new.current_market_value is distinct from old.current_market_value
    or new.replacement_cost is distinct from old.replacement_cost
    or new.daily_rental_rate is distinct from old.daily_rental_rate
    or new.weekly_rental_rate is distinct from old.weekly_rental_rate
    or new.monthly_rental_rate is distinct from old.monthly_rental_rate
    or new.current_cost_cents is distinct from old.current_cost_cents
    or new.net_book_value_cents is distinct from old.net_book_value_cents
    or new.supplier_invoice_number is distinct from old.supplier_invoice_number
    or new.supplier_invoice_date is distinct from old.supplier_invoice_date
    or new.supplier_invoice_amount_cents is distinct from old.supplier_invoice_amount_cents
    or new.reference_amount_cents is distinct from old.reference_amount_cents
    or new.note_amount_cents is distinct from old.note_amount_cents
    or new.note_code is distinct from old.note_code
    or new.note_due_date is distinct from old.note_due_date
    or new.finance_amount_cents is distinct from old.finance_amount_cents
    or new.finance_due_date is distinct from old.finance_due_date
    or new.settlement_number is distinct from old.settlement_number
    or new.settlement_date is distinct from old.settlement_date
    or new.maintenance_expense_cents is distinct from old.maintenance_expense_cents
    or new.rental_cost_pct is distinct from old.rental_cost_pct
    or new.rental_insurable_amount_cents is distinct from old.rental_insurable_amount_cents
    or new.rental_amount_cents is distinct from old.rental_amount_cents
    or new.sale_gl_account is distinct from old.sale_gl_account
    or new.inventory_gl_account is distinct from old.inventory_gl_account
  ) then
    raise exception 'FORBIDDEN_EQUIPMENT_FINANCIAL_WRITE'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_trade_to_stock on public.qb_trade_ins;
create trigger trg_trade_to_stock
  after insert or update of disposition, reconditioning_approval_status
  on public.qb_trade_ins
  for each row execute function public.trg_trade_to_stock();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Intake → qrm_equipment sync (+ stage-8 PM interval seeding)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_intake_sync_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qrm_equipment e
  set intake_stage = new.current_stage,
      sale_ready_at = case
        when new.current_stage >= 8 then coalesce(e.sale_ready_at, now())
        else e.sale_ready_at end,
      readiness_status = case
        -- rental fleet-state machine (m769/m774) owns this column for
        -- rental units; sold units keep their state
        when e.ownership = 'rental_fleet' then e.readiness_status
        when e.availability = 'sold' or e.in_out_state = 'sold' then e.readiness_status
        when new.current_stage >= 8 then 'ready'
        else 'in_prep' end,
      readiness_blocker_reason = case
        when new.current_stage >= 8
             and e.ownership <> 'rental_fleet'
             and coalesce(e.availability::text, '') <> 'sold'
        then null
        else e.readiness_blocker_reason end
  where e.id = new.equipment_id
    and e.deleted_at is null;

  -- Sale-ready: seed default PM intervals once (countdowns were empty).
  if new.current_stage >= 8 then
    insert into public.equipment_service_intervals
      (workspace_id, equipment_id, interval_label, interval_hours, notes)
    select e.workspace_id, e.id, v.label, v.hours,
           'Seeded at intake sale-ready (m803)'
    from public.qrm_equipment e,
         (values ('250-hour service', 250),
                 ('500-hour service', 500),
                 ('1000-hour service', 1000)) as v(label, hours)
    where e.id = new.equipment_id
      and e.deleted_at is null
      and not exists (
        select 1 from public.equipment_service_intervals esi
        where esi.equipment_id = e.id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_intake_sync_equipment on public.equipment_intake;
create trigger trg_intake_sync_equipment
  after insert or update of current_stage on public.equipment_intake
  for each row execute function public.trg_intake_sync_equipment();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Service-completion writer for PM intervals
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_service_completion_intervals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.closed_at is null or old.closed_at is not null then
    return new;
  end if;
  if new.machine_id is null or new.hour_meter_reading is null then
    return new;
  end if;

  -- Stamp intervals this service plausibly covered: due (or nearly due —
  -- within 10% of the interval) at the recorded hour meter. Rolls
  -- next_due_hours forward so the Asset 360 countdown moves.
  update public.equipment_service_intervals esi
  set last_completed_hours = new.hour_meter_reading,
      last_completed_at = new.closed_at,
      next_due_hours = new.hour_meter_reading + esi.interval_hours
  where esi.equipment_id = new.machine_id
    and (
      esi.next_due_hours is null
      or new.hour_meter_reading >= esi.next_due_hours - (esi.interval_hours * 0.1)
    );

  return new;
end;
$$;

drop trigger if exists trg_service_completion_intervals on public.service_jobs;
create trigger trg_service_completion_intervals
  after update of closed_at on public.service_jobs
  for each row execute function public.trg_service_completion_intervals();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. mv_exec_inventory_readiness — merge the readiness vocabularies
-- ─────────────────────────────────────────────────────────────────────────

-- CASCADE drops the dependent exec_inventory_readiness_v (recreated below,
-- same definition as prod: owner-only security_invoker wrapper).
drop materialized view if exists public.mv_exec_inventory_readiness cascade;

create materialized view public.mv_exec_inventory_readiness as
select
  workspace_id,
  count(*)::integer as total_units,
  count(*) filter (
    where readiness_status in ('ready', 'available')
  )::integer as ready_units,
  count(*) filter (
    where readiness_status in ('in_prep', 'in_service')
  )::integer as in_prep_units,
  count(*) filter (
    where readiness_status in ('blocked', 'down_for_service')
  )::integer as blocked_units,
  count(*) filter (
    where intake_stage is not null and intake_stage < 5
  )::integer as intake_stalled,
  case
    when count(*) > 0 then
      (count(*) filter (where readiness_status in ('ready', 'available'))::numeric
        / count(*)::numeric * 100::numeric)::numeric(6, 2)
    else 0::numeric
  end as ready_rate_pct
from public.qrm_equipment e
where deleted_at is null
group by workspace_id;

create unique index uq_mv_exec_inventory_readiness
  on public.mv_exec_inventory_readiness (workspace_id);

comment on materialized view public.mv_exec_inventory_readiness is
  'COO inventory readiness (m191, vocab merged m803). ready = ready|available; in_prep = in_prep|in_service; blocked = blocked|down_for_service — the m191 buckets were never written while the L-stream rental writers used the second vocabulary. intake_stage is written by trg_intake_sync_equipment since m803.';

-- Recreate the dependent wrapper dropped by the CASCADE (verbatim from prod).
create view public.exec_inventory_readiness_v
with (security_invoker = true) as
select total_units,
       ready_units,
       in_prep_units,
       blocked_units,
       intake_stalled,
       ready_rate_pct
from public.mv_exec_inventory_readiness
where workspace_id = public.get_my_workspace()
  and public.get_my_role() = 'owner'::public.user_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. get_asset_360 — rental / intake / invoices / trade arms
-- ─────────────────────────────────────────────────────────────────────────

-- NOTE: deliberately NOT security definer — the original (m160/m384) runs
-- as invoker so workspace RLS on qrm_equipment/crm_companies/rental_* keeps
-- gating what the caller can see. Do not flip this to definer.
create or replace function public.get_asset_360(p_equipment_id uuid)
returns json
language plpgsql
stable
as $$
declare
  v_equipment json;
  v_company json;
  v_badges json;
  v_recent_service json;
  v_open_deal json;
  v_rental json;
  v_intake json;
  v_invoices json;
  v_trades json;
begin
  -- Base table, not the frozen crm_equipment compat view — lifecycle
  -- columns (intake_stage, sale_ready_at, traded_date, in_out_state …)
  -- must be visible to the page.
  select to_json(e.*) into v_equipment
  from public.qrm_equipment e
  where e.id = p_equipment_id;

  if v_equipment is null then
    return null;
  end if;

  select to_json(c.*) into v_company
  from public.crm_companies c
  where c.id = (v_equipment ->> 'company_id')::uuid;

  v_badges := public.get_asset_badges(p_equipment_id);

  select json_agg(row_to_json(sj)) into v_recent_service
  from (
    select id, customer_problem_summary, current_stage::text as current_stage,
           scheduled_start_at, scheduled_end_at, closed_at
    from public.service_jobs
    where machine_id = p_equipment_id
      and deleted_at is null
    order by created_at desc
    limit 5
  ) sj;

  select to_json(d) into v_open_deal
  from (
    select d.id, d.name, d.amount, d.stage_id, d.next_follow_up_at
    from public.qrm_deal_equipment de
    join public.crm_deals d on d.id = de.deal_id
    where de.equipment_id = p_equipment_id
      and d.closed_at is null
      and d.deleted_at is null
    order by d.updated_at desc
    limit 1
  ) d;

  -- Rental arm: recent contracts + open one + recent rental invoices.
  select json_build_object(
    'contracts', coalesce((
      select json_agg(row_to_json(rc)) from (
        select id, contract_number, status, lifecycle_state,
               approved_start_date, approved_end_date,
               on_rent_at, off_rent_at, returned_at, closed_at,
               agreed_daily_rate, agreed_weekly_rate, agreed_monthly_rate
        from public.rental_contracts
        where equipment_id = p_equipment_id
          and deleted_at is null
        order by created_at desc
        limit 5
      ) rc), '[]'::json),
    'open_contract', (
      select to_json(oc) from (
        select id, contract_number, status, lifecycle_state,
               on_rent_at, approved_start_date, approved_end_date
        from public.rental_contracts
        where equipment_id = p_equipment_id
          and deleted_at is null
          and closed_at is null
          and returned_at is null
        order by created_at desc
        limit 1
      ) oc),
    'recent_invoices', coalesce((
      select json_agg(row_to_json(ri)) from (
        select ri.id, ri.invoice_number, ri.period_start, ri.period_end,
               ri.total_cents, ri.balance_cents, ri.status, ri.due_date
        from public.rental_invoices ri
        join public.rental_contracts rc on rc.id = ri.rental_contract_id
        where rc.equipment_id = p_equipment_id
          and ri.deleted_at is null
        order by ri.period_start desc
        limit 5
      ) ri), '[]'::json)
  ) into v_rental;

  -- Intake arm: the unit's intake pipeline row (stage + checklist flags).
  select to_json(i) into v_intake
  from (
    select id, current_stage, stock_number, po_number, arrival_date,
           pdi_completed, photo_ready, pricing_verified, team_notified,
           high_demand_flagged, stage_history, updated_at
    from public.equipment_intake
    where equipment_id = p_equipment_id
    order by created_at desc
    limit 1
  ) i;

  -- Invoice arm: equipment sale invoices for this unit (m788 spine).
  select json_agg(row_to_json(ci)) into v_invoices
  from (
    select id, invoice_number, invoice_type, status, total, amount_paid,
           created_at, reversal_of_invoice_id
    from public.customer_invoices
    where qrm_equipment_id = p_equipment_id
    order by created_at desc
    limit 5
  ) ci;

  -- Trade arm: trade-in records referencing this unit.
  select json_agg(row_to_json(t)) into v_trades
  from (
    select id, deal_id, quote_id, allowance_cents, book_value_cents,
           disposition, reconditioning_approval_status, approved_at, created_at
    from public.qb_trade_ins
    where crm_equipment_id = p_equipment_id
    order by created_at desc
    limit 5
  ) t;

  return json_build_object(
    'equipment', v_equipment,
    'company', v_company,
    'badges', v_badges,
    'recent_service', coalesce(v_recent_service, '[]'::json),
    'open_deal', v_open_deal,
    'rental', v_rental,
    'intake', v_intake,
    'invoices', coalesce(v_invoices, '[]'::json),
    'trades', coalesce(v_trades, '[]'::json)
  );
end;
$$;

COMMIT;
