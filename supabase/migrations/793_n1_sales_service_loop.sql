-- ============================================================================
-- Migration 793: N1.1 — Sales↔Service loop (seam completion, Stream N)
--
--   Four verified dead seams from the 2026-07-08 review, one slice:
--
--   1. MAKE-READY. deal.stage.changed (m194 trg_flow_emit_deal) never carried
--      equipment_id or a stage name, so no workflow could react to a deal
--      reaching a named stage with the machine in hand. The emitter now joins
--      the subject unit (qrm_deal_equipment role='subject') and the stage
--      names in. The deal-deposit-make-ready flow workflow (flow-runner) uses
--      them to open a pdi_new_prep service job — the work_class m691 defined
--      but nothing ever wrote. A badge trigger stamps
--      qrm_deals.make_ready_check_status when a deal reaches "Equipment
--      Ready" (sort 17+): 'flagged' while the PDI job is open, 'passed'
--      otherwise. Badge, not block — a hard gate would strand every in-flight
--      deal that predates the workflow (m070's margin badge precedent).
--
--   2. TRADE RECON. keep_recondition approval (m766) now auto-opens a
--      reconditioning WO on the traded unit, and H10 cost postings roll
--      actual recon costs back into trade_valuations.reconditioning_estimate
--      — which makes the m766 10%/$2,500 material-change re-approval able to
--      fire from reality instead of never (the estimate was written once at
--      valuation and never touched again).
--
--   3. (Edge/UI, not in this migration: upsell-scanner + completion-feedback
--      persist recommendations through ingestSignal; ServiceToSalesPage gains
--      Create Opportunity.)
--
--   4. FLEET INTELLIGENCE. fleet_intelligence (m013) had readers on five
--      surfaces and zero writers, ever. compute_fleet_intelligence() derives
--      replacement predictions from service frequency/spend, engine hours,
--      and telematics for customer-owned units, upserted on equipment serial;
--      pg_cron every 6 hours (plain SQL, no secrets).
-- ============================================================================

BEGIN;

-- ── 1a. Enrich the deal event payload ───────────────────────────────────────
create or replace function public.flow_emit_from_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_equipment_id uuid;
  v_stage_name text;
  v_old_stage_name text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'deal.created';
  elsif new.stage_id is distinct from old.stage_id then
    v_event_type := 'deal.stage.changed';
  else
    return new;
  end if;

  select de.equipment_id into v_equipment_id
  from public.qrm_deal_equipment de
  where de.deal_id = new.id and de.role = 'subject'
  order by de.created_at asc
  limit 1;

  select s.name into v_stage_name from public.crm_deal_stages s where s.id = new.stage_id;
  if tg_op = 'UPDATE' then
    select s.name into v_old_stage_name from public.crm_deal_stages s where s.id = old.stage_id;
  end if;

  perform public.emit_event(
    v_event_type,
    'qrm',
    'crm_deal',
    new.id::text,
    jsonb_build_object(
      'deal_id', new.id,
      'workspace_id', new.workspace_id,
      'amount', new.amount,
      'stage_id', new.stage_id,
      'stage_name', v_stage_name,
      'expected_close_on', new.expected_close_on,
      'company_id', new.company_id,
      'assigned_rep_id', new.assigned_rep_id,
      'closed_at', new.closed_at,
      'equipment_id', v_equipment_id,
      'old_stage_id', case when tg_op = 'UPDATE' then old.stage_id else null end,
      'old_stage_name', v_old_stage_name
    ),
    new.workspace_id
  );
  return new;
end;
$$;

-- ── 1b. Make-ready badge at "Equipment Ready" (sort_order >= 17) ───────────
alter table public.qrm_deals
  add column if not exists make_ready_check_status text
  check (make_ready_check_status is null or make_ready_check_status in ('passed', 'flagged'));

comment on column public.qrm_deals.make_ready_check_status is
  'N1.1 badge: flagged when the deal reached Equipment Ready with its subject unit''s pdi_new_prep make-ready job still open; passed otherwise. Null = stage 17 never reached since N1.1.';

create or replace function public.enforce_make_ready_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sort integer;
  v_open_pdi boolean;
begin
  if new.stage_id is distinct from old.stage_id then
    select s.sort_order into v_sort from public.crm_deal_stages s where s.id = new.stage_id;
    if coalesce(v_sort, 0) >= 17 then
      select exists (
        select 1
        from public.qrm_deal_equipment de
        join public.service_jobs sj on sj.machine_id = de.equipment_id
        where de.deal_id = new.id
          and de.role = 'subject'
          and sj.service_internal_work_class = 'pdi_new_prep'
          and sj.closed_at is null
      ) into v_open_pdi;
      new.make_ready_check_status := case when v_open_pdi then 'flagged' else 'passed' end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_make_ready_badge on public.qrm_deals;
create trigger trg_enforce_make_ready_badge
  before update of stage_id on public.qrm_deals
  for each row execute function public.enforce_make_ready_badge();

-- ── 2a. keep_recondition approval auto-opens a reconditioning WO ────────────
create or replace function public.fn_trade_recon_open_wo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reconditioning_approval_status = 'approved'
     and (old.reconditioning_approval_status is distinct from 'approved')
     and new.disposition = 'keep_recondition'
     and new.crm_equipment_id is not null
     and not exists (
       select 1 from public.service_jobs sj
       where sj.machine_id = new.crm_equipment_id
         and sj.service_internal_work_class = 'reconditioning'
         and sj.closed_at is null
     ) then
    insert into public.service_jobs
      (workspace_id, machine_id, request_type, customer_problem_summary,
       service_internal_work_class, internal_cost_posting_status)
    values
      (new.workspace_id, new.crm_equipment_id, 'internal',
       'Trade-in reconditioning (auto-opened on keep_recondition approval, trade ' || new.id || ')',
       'reconditioning', 'pending');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trade_recon_open_wo on public.qb_trade_ins;
create trigger trg_trade_recon_open_wo
  after update of reconditioning_approval_status on public.qb_trade_ins
  for each row execute function public.fn_trade_recon_open_wo();

-- ── 2b. H10 actuals write back into the valuation estimate ─────────────────
-- Rolls ALL reconditioning postings for the traded unit into
-- trade_valuations.reconditioning_estimate. The m766 sync trigger
-- (trg_trade_recondition_sync_from_valuation) then re-evaluates the
-- 10%/$2,500 material-change gate against the last approved figure.
create or replace function public.fn_trade_recon_actuals_writeback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade record;
  v_actual_total numeric(14, 2);
begin
  if new.work_class is distinct from 'reconditioning' or new.machine_id is null then
    return new;
  end if;

  select t.id, t.trade_valuation_id into v_trade
  from public.qb_trade_ins t
  where t.crm_equipment_id = new.machine_id
    and t.disposition = 'keep_recondition'
    and t.trade_valuation_id is not null
  order by t.created_at desc
  limit 1;

  if v_trade.trade_valuation_id is null then
    return new;
  end if;

  select coalesce(sum(p.total_cost_cents), 0) / 100.0 into v_actual_total
  from public.service_internal_cost_postings p
  where p.machine_id = new.machine_id
    and p.work_class = 'reconditioning';

  update public.trade_valuations
     set reconditioning_estimate = v_actual_total
   where id = v_trade.trade_valuation_id
     and reconditioning_estimate is distinct from v_actual_total;

  return new;
end;
$$;

drop trigger if exists trg_trade_recon_actuals_writeback on public.service_internal_cost_postings;
create trigger trg_trade_recon_actuals_writeback
  after insert or update on public.service_internal_cost_postings
  for each row execute function public.fn_trade_recon_actuals_writeback();

-- ── 4a. fleet_intelligence writer ───────────────────────────────────────────
create unique index if not exists uq_fleet_intelligence_serial
  on public.fleet_intelligence (equipment_serial)
  where equipment_serial is not null;

create or replace function public.compute_fleet_intelligence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  with candidates as (
    select
      e.id as equipment_id,
      coalesce(c.name, 'Unknown customer') as customer_name,
      coalesce(e.serial_number, e.vin_pin, e.stock_number, e.id::text) as equipment_serial,
      coalesce(e.make, 'Unknown') as make,
      coalesce(e.model, 'Unknown') as model,
      e.year,
      greatest(coalesce(e.engine_hours, 0), coalesce(tf.last_hours, 0)) as current_hours,
      tf.provider as telematics_source,
      sj.last_service_date,
      sj.jobs_12m,
      sj.spend_12m,
      coalesce(nullif(e.current_market_value, 0), nullif(e.purchase_price, 0), 50000) as value_proxy
    from public.qrm_equipment e
    join public.qrm_companies c on c.id = e.company_id
    left join lateral (
      select max(t.last_hours) as last_hours, max(t.provider) as provider
      from public.telematics_feeds t
      where t.equipment_id = e.id
    ) tf on true
    join lateral (
      select
        max(j.closed_at)::date as last_service_date,
        count(*) filter (where j.closed_at > now() - interval '12 months') as jobs_12m,
        coalesce(sum(j.invoice_total) filter (where j.closed_at > now() - interval '12 months'), 0) as spend_12m
      from public.service_jobs j
      where j.machine_id = e.id
    ) sj on sj.last_service_date is not null
    where e.deleted_at is null
      and e.ownership = 'customer_owned'
  ), scored as (
    select *,
      -- Repair burden: 12-month service spend as a share of unit value,
      -- nudged by service frequency. >= 0.35 reads as replace-soon.
      least(1.0, (spend_12m / value_proxy) + (jobs_12m * 0.03)) as risk
    from candidates
  ), upserted as (
    insert into public.fleet_intelligence
      (customer_name, equipment_serial, make, model, year, current_hours,
       last_service_date, last_service_hours, utilization_trend,
       predicted_replacement_date, replacement_confidence,
       replacement_model_version, telematics_source, metadata)
    select
      s.customer_name, s.equipment_serial, s.make, s.model, s.year, s.current_hours,
      s.last_service_date, s.current_hours,
      case when s.jobs_12m >= 4 then 'heavy' when s.jobs_12m >= 2 then 'steady' else 'light' end,
      (now() + make_interval(months => greatest(2, round(20 - (s.risk * 18))::int)))::date,
      round(least(0.90, 0.30 + s.risk * 0.60)::numeric, 2),
      'n1-repair-burden-v1',
      s.telematics_source,
      jsonb_build_object(
        'source', 'compute_fleet_intelligence',
        'jobs_12m', s.jobs_12m,
        'spend_12m', s.spend_12m,
        'value_proxy', s.value_proxy,
        'risk', round(s.risk::numeric, 3),
        'equipment_id', s.equipment_id,
        'computed_at', now()
      )
    from scored s
    on conflict (equipment_serial) where equipment_serial is not null
    do update set
      customer_name = excluded.customer_name,
      current_hours = excluded.current_hours,
      last_service_date = excluded.last_service_date,
      last_service_hours = excluded.last_service_hours,
      utilization_trend = excluded.utilization_trend,
      predicted_replacement_date = excluded.predicted_replacement_date,
      replacement_confidence = excluded.replacement_confidence,
      replacement_model_version = excluded.replacement_model_version,
      telematics_source = excluded.telematics_source,
      metadata = excluded.metadata,
      updated_at = now()
    returning id
  )
  select count(*) into v_rows from upserted;

  return v_rows;
end;
$$;

comment on function public.compute_fleet_intelligence() is
  'N1.1: derives replacement predictions (repair-burden heuristic v1: 12-month service spend / unit value + frequency) for customer-owned units with service history and upserts fleet_intelligence — the m013 table every replacement surface reads and nothing ever wrote. Runs every 6h on pg_cron; outreach_status is never clobbered.';

revoke execute on function public.compute_fleet_intelligence() from public;
revoke execute on function public.compute_fleet_intelligence() from anon;
grant execute on function public.compute_fleet_intelligence() to authenticated;
grant execute on function public.compute_fleet_intelligence() to service_role;

-- ── 4b. Cron (plain SQL, m787 shape) ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'Skipping fleet-intelligence cron: pg_cron not available.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-intelligence-scan') THEN
    PERFORM cron.unschedule('fleet-intelligence-scan');
  END IF;

  PERFORM cron.schedule(
    'fleet-intelligence-scan',
    '35 */6 * * *',
    $job$select public.compute_fleet_intelligence();$job$
  );
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping fleet-intelligence cron: %', SQLERRM;
END $$;

COMMIT;
