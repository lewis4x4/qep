-- 802_n5_event_fabric_scheduled_autonomy.sql
-- N5.1 — Event fabric completion + scheduled autonomy + cron fleet health.
--
-- 1. service.* lifecycle producers: row trigger on service_jobs emits
--    service.job.created / stage_changed / assigned / completed via
--    emit_event(); an hourly scanner emits service.job.delayed — the
--    flagship service-delay-strategic-account workflow finally has a
--    producer (it subscribed to an event nothing emitted since m19x).
-- 2. flow_resolve_context customer_tier fix: crm_companies.tags never
--    existed (42703 defect class — to_jsonb() silently omitted it, so
--    customer_tier was NULL forever and tier-gated workflows could never
--    pass conditions). Tier now derives from metadata->'tags' then
--    classification.
-- 3. Atomic claim for service-customer-notify-dispatch (FOR UPDATE SKIP
--    LOCKED lease, claim_dge_refresh_job pattern) — the claim-less loop
--    double-sends customer SMS/email under any concurrent invocation, and
--    the GHA service-cron already fires it every 5 minutes.
-- 4. Scheduled autonomy: vault-http crons for the 7 deployed-but-dormant
--    parts engines, plain-SQL crons for AR dunning (via a null-role-safe
--    wrapper), the service delay scanner, and analytics_events retention.
-- 5. Cron fleet health: repoint qb-rebate-deadline-check at the deployed
--    qb-rebate-deadlines-cron function (command was url := NULL since m293
--    — 7/7 failures for its whole life); defensively unschedule the
--    never-registered legacy service *-periodic pg_cron jobs (m097/105/107
--    path, gated on app.settings GUCs that never existed in prod).
-- 6. flow_events (m209 "Bus B") marked deprecated — the shared
--    publishFlowEvent helper is repointed to emit_event()/analytics_events
--    in this same slice (edge code). Rows are kept as history.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. service.* lifecycle producers (trigger on service_jobs)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_service_jobs_flow_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  -- company_id key name matters: flow_resolve_context hydrates context
  -- from payload->>'company_id' / payload->>'deal_id'.
  v_payload := jsonb_build_object(
    'service_job_id', new.id,
    'wo_number', new.wo_number,
    'company_id', new.customer_id,
    'machine_id', new.machine_id,
    'stage', new.current_stage,
    'priority', new.priority,
    'machine_down', new.machine_down,
    'technician_id', new.technician_id
  );

  if tg_op = 'INSERT' then
    perform public.emit_event(
      'service.job.created', 'service-lifecycle',
      'service_job', new.id::text, v_payload, new.workspace_id);
    return new;
  end if;

  -- Soft-delete is not a lifecycle signal.
  if new.deleted_at is not null then
    return new;
  end if;

  if new.current_stage is distinct from old.current_stage then
    perform public.emit_event(
      'service.job.stage_changed', 'service-lifecycle',
      'service_job', new.id::text,
      v_payload || jsonb_build_object('previous_stage', old.current_stage),
      new.workspace_id);
  end if;

  if new.technician_id is distinct from old.technician_id
     and new.technician_id is not null then
    perform public.emit_event(
      'service.job.assigned', 'service-lifecycle',
      'service_job', new.id::text, v_payload, new.workspace_id);
  end if;

  if new.closed_at is not null and old.closed_at is null then
    perform public.emit_event(
      'service.job.completed', 'service-lifecycle',
      'service_job', new.id::text,
      v_payload || jsonb_build_object('closed_at', new.closed_at),
      new.workspace_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_service_jobs_flow_events on public.service_jobs;
create trigger trg_service_jobs_flow_events
  after insert or update of current_stage, technician_id, closed_at
  on public.service_jobs
  for each row execute function public.trg_service_jobs_flow_events();

-- Hourly delay scanner → service.job.delayed. Time-based delay cannot be
-- a row trigger; this is the same scanner+dedup-probe shape as the m775
-- rental scanners. Enriches with the newest open deal for the company so
-- the strategic-account workflow's `context.deal exists` condition can pass.
create or replace function public.scan_service_job_delays(
  p_stale_hours integer default 48,
  p_redetect_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_deal_id uuid;
  v_emitted integer := 0;
begin
  -- pg_cron connections carry no JWT (auth.role() is null); service_role
  -- may also call. Everything else is rejected. (m792 gate pattern.)
  if (select auth.role()) is not null
     and (select auth.role()) <> 'service_role' then
    raise exception 'scan_service_job_delays: service caller required';
  end if;

  for v_job in
    select sj.id, sj.workspace_id, sj.customer_id, sj.wo_number,
           sj.current_stage, sj.current_stage_entered_at, sj.promised_at,
           sj.machine_down
    from public.service_jobs sj
    where sj.deleted_at is null
      and sj.closed_at is null
      and (
        coalesce(sj.current_stage_entered_at, sj.updated_at)
          < now() - make_interval(hours => p_stale_hours)
        or (sj.promised_at is not null and sj.promised_at < now())
      )
      -- Re-detect probe: one service.job.delayed per job per window.
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'service.job.delayed'
          and ae.entity_type = 'service_job'
          and ae.entity_id = sj.id::text
          and ae.occurred_at > now() - make_interval(hours => p_redetect_hours)
      )
    limit 200
  loop
    select d.id into v_deal_id
    from public.qrm_deals d
    where d.company_id = v_job.customer_id
      and d.deleted_at is null
      and d.closed_at is null
    order by d.created_at desc
    limit 1;

    perform public.emit_event(
      'service.job.delayed', 'service-delay-scan',
      'service_job', v_job.id::text,
      jsonb_build_object(
        'service_job_id', v_job.id,
        'wo_number', v_job.wo_number,
        'company_id', v_job.customer_id,
        'deal_id', v_deal_id,
        'stage', v_job.current_stage,
        'stage_entered_at', v_job.current_stage_entered_at,
        'promised_at', v_job.promised_at,
        'machine_down', v_job.machine_down,
        'stale_hours_threshold', p_stale_hours
      ),
      v_job.workspace_id);
    v_emitted := v_emitted + 1;
  end loop;

  return v_emitted;
end;
$$;

revoke all on function public.scan_service_job_delays(integer, integer) from public;
grant execute on function public.scan_service_job_delays(integer, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. flow_resolve_context: real customer_tier derivation
--    (full recreate; only the customer-tier block changed — the original
--    read v_company->'tags', a column crm_companies never had)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.flow_resolve_context(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_event public.analytics_events;
  v_payload jsonb;
  v_company_id uuid;
  v_deal_id uuid;
  v_contact_id uuid;
  v_equipment_id uuid;
  v_company jsonb;
  v_deal jsonb;
  v_health_score numeric;
  v_ar_block text;
  v_recent_runs jsonb;
  v_open_quote_total numeric;
  v_customer_tier text;
begin
  select * into v_event from public.analytics_events where event_id = p_event_id;
  if v_event.event_id is null then
    return jsonb_build_object('error', 'event_not_found');
  end if;

  v_payload := coalesce(v_event.properties, '{}'::jsonb);

  -- Pull common foreign keys from the payload (defensive cast)
  begin v_company_id := nullif(v_payload ->> 'company_id', '')::uuid; exception when others then v_company_id := null; end;
  begin v_deal_id := nullif(v_payload ->> 'deal_id', '')::uuid; exception when others then v_deal_id := null; end;
  begin v_contact_id := nullif(v_payload ->> 'contact_id', '')::uuid; exception when others then v_contact_id := null; end;
  begin v_equipment_id := nullif(v_payload ->> 'equipment_id', '')::uuid; exception when others then v_equipment_id := null; end;

  if v_company_id is not null then
    select to_jsonb(c.*) - 'created_at' - 'updated_at' into v_company
    from public.crm_companies c where c.id = v_company_id;
  end if;

  if v_deal_id is not null then
    select to_jsonb(d.*) - 'created_at' - 'updated_at' into v_deal
    from public.crm_deals d where d.id = v_deal_id;
    -- Backfill company_id from deal if payload didn't carry it
    if v_company_id is null and v_deal is not null then
      v_company_id := nullif(v_deal ->> 'company_id', '')::uuid;
      if v_company_id is not null then
        select to_jsonb(c.*) - 'created_at' - 'updated_at' into v_company
        from public.crm_companies c where c.id = v_company_id;
      end if;
    end if;
  end if;

  -- Health score (best-effort)
  begin
    select cpe.health_score into v_health_score
    from public.customer_profiles_extended cpe
    where cpe.id = v_company_id
    limit 1;
  exception when undefined_table then v_health_score := null;
  end;

  -- AR block status
  begin
    select case when count(*) > 0 then 'blocked' else 'clear' end into v_ar_block
    from public.exception_queue
    where source = 'ar_override_pending'
      and status = 'open'
      and (payload ->> 'company_id')::text = v_company_id::text;
  exception when others then v_ar_block := null;
  end;

  -- Customer tier — N5.1/m802 fix. The original read v_company->'tags',
  -- but crm_companies has no tags column (to_jsonb omitted the key and
  -- tier stayed NULL forever). Real sources, in precedence order:
  --   1. metadata->'tags' jsonb array containing 'strategic'/'enterprise'
  --   2. classification column valued 'strategic'/'enterprise'
  --   3. 'standard' for any other resolved company
  if v_company is not null then
    if coalesce(v_company -> 'metadata' -> 'tags' ? 'strategic', false) then
      v_customer_tier := 'strategic';
    elsif coalesce(v_company -> 'metadata' -> 'tags' ? 'enterprise', false) then
      v_customer_tier := 'enterprise';
    elsif lower(coalesce(v_company ->> 'classification', '')) in ('strategic', 'enterprise') then
      v_customer_tier := lower(v_company ->> 'classification');
    else
      v_customer_tier := 'standard';
    end if;
  end if;

  -- Open quote total — join through crm_deals
  if v_company_id is not null then
    begin
      select coalesce(sum(qp.net_total), 0) into v_open_quote_total
      from public.quote_packages qp
      join public.crm_deals d on d.id = qp.deal_id
      where d.company_id = v_company_id
        and qp.status in ('draft', 'sent', 'negotiating');
    exception when others then v_open_quote_total := null;
    end;
  end if;

  -- Recent runs for the same entity (last 30 days)
  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', r.id,
    'workflow_slug', r.workflow_slug,
    'status', r.status,
    'finished_at', r.finished_at
  ) order by r.started_at desc) filter (where r.id is not null), '[]'::jsonb)
  into v_recent_runs
  from public.flow_workflow_runs r
  where r.workspace_id = v_event.workspace_id
    and r.event_id is not null
    and r.started_at > now() - interval '30 days'
    and r.event_id in (
      select event_id from public.analytics_events
      where entity_type = v_event.entity_type and entity_id = v_event.entity_id
    );

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'company', v_company,
    'deal', v_deal,
    'health_score', v_health_score,
    'ar_block_status', v_ar_block,
    'customer_tier', v_customer_tier,
    'open_quote_total', v_open_quote_total,
    'recent_runs', v_recent_runs
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Atomic claim for service-customer-notify-dispatch
-- ─────────────────────────────────────────────────────────────────────────

alter table public.service_customer_notifications
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz;

comment on column public.service_customer_notifications.lease_expires_at is
  'Dispatch lease (m802). A row is claimable when undelivered AND lease is null/expired. Prevents concurrent dispatchers double-sending.';

-- claim_dge_refresh_job pattern (m240): FOR UPDATE SKIP LOCKED + lease.
-- Returns full rows so the dispatcher keeps its existing field access.
create or replace function public.claim_service_customer_notifications(
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns setof public.service_customer_notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'claim_service_customer_notifications: service_role required';
  end if;

  return query
  with candidate as (
    select n.id
    from public.service_customer_notifications n
    where n.channel in ('sms', 'email')
      and n.recipient is not null
      and (n.metadata ->> 'delivered') is null
      and (n.lease_expires_at is null or n.lease_expires_at <= now())
    order by n.created_at asc
    limit greatest(coalesce(p_limit, 25), 1)
    for update skip locked
  ),
  claimed as (
    update public.service_customer_notifications n
    set claimed_at = now(),
        lease_expires_at = now()
          + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 15))
    from candidate c
    where n.id = c.id
    returning n.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_service_customer_notifications(integer, integer) from public;
grant execute on function public.claim_service_customer_notifications(integer, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. AR dunning cron wrapper (null-role-safe)
-- ─────────────────────────────────────────────────────────────────────────

-- run_ar_dunning_cycle (m664) gates on auth.role() = 'service_role' OR
-- qep_finance_can_mutate(); a pg_cron connection carries neither. This
-- wrapper is itself gated to cron/service callers, then shims the
-- service_role claim for this transaction only before iterating
-- workspaces. Zero-blocking: a workspace failure is captured, not raised.
create or replace function public.run_ar_dunning_cycle_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws record;
  v_one jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if (select auth.role()) is not null
     and (select auth.role()) <> 'service_role' then
    raise exception 'run_ar_dunning_cycle_all: service caller required';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);

  for v_ws in
    select ws.workspace_id from public.workspace_settings ws
    union
    select 'default'
  loop
    begin
      v_one := public.run_ar_dunning_cycle(v_ws.workspace_id, current_date);
      v_results := v_results
        || jsonb_build_array(jsonb_build_object(
             'workspace_id', v_ws.workspace_id, 'result', v_one));
    exception when others then
      v_results := v_results
        || jsonb_build_array(jsonb_build_object(
             'workspace_id', v_ws.workspace_id, 'error', sqlerrm));
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.run_ar_dunning_cycle_all() from public;
grant execute on function public.run_ar_dunning_cycle_all() to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Cron fleet: legacy decommission, rebate repoint, new schedules
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_job record;
  v_fn text;
  v_schedule text;
  v_jobname text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'Skipping N5.1 cron registration: pg_cron not available.';
    return;
  end if;

  -- 5a. Decommission the never-registered legacy service pg_cron path
  -- (m097/105/107 *-periodic jobs, gated on app.settings GUCs that never
  -- existed in prod). No-op there; defensive for other environments.
  for v_job in
    select jobname from cron.job where jobname like 'service-%-periodic'
  loop
    perform cron.unschedule(v_job.jobname);
    raise notice 'Unscheduled legacy service pg_cron job: %', v_job.jobname;
  end loop;

  -- 5b. Plain-SQL crons (no vault dependency).

  -- Hourly service delay scanner → service.job.delayed producer.
  if exists (select 1 from cron.job where jobname = 'service-job-delay-scan') then
    perform cron.unschedule('service-job-delay-scan');
  end if;
  perform cron.schedule(
    'service-job-delay-scan',
    '15 * * * *',
    $job$select public.scan_service_job_delays()$job$);

  -- Daily AR dunning cycle (roadmap: manual-button-only until now).
  if exists (select 1 from cron.job where jobname = 'run-ar-dunning-cycle') then
    perform cron.unschedule('run-ar-dunning-cycle');
  end if;
  perform cron.schedule(
    'run-ar-dunning-cycle',
    '30 10 * * *',
    $job$select public.run_ar_dunning_cycle_all()$job$);

  -- Weekly analytics_events retention. Safe by construction: the
  -- flow_pending_events view only scans unconsumed flow events from the
  -- last 7 days; a 180-day age cutoff can never intersect that window.
  if exists (select 1 from cron.job where jobname = 'analytics-events-retention') then
    perform cron.unschedule('analytics-events-retention');
  end if;
  perform cron.schedule(
    'analytics-events-retention',
    '30 3 * * 0',
    $job$delete from public.analytics_events where occurred_at < now() - interval '180 days'$job$);

  -- 5c. Vault-http crons (m787/m788 fleet pattern).
  if not exists (select 1 from vault.decrypted_secrets where name = 'INTERNAL_SERVICE_SECRET') then
    raise notice 'Skipping N5.1 vault-http crons: INTERNAL_SERVICE_SECRET not in vault.';
    return;
  end if;

  -- qb-rebate-deadline-check: registered with url := NULL since m293 —
  -- 7/7 failures, never worked. Repoint at the deployed
  -- qb-rebate-deadlines-cron function (job name kept for continuity with
  -- the roadmap; note the fn slug is plural).
  -- The 7 parts engines: deployed since Stream J but never scheduled.
  -- Proposal/compute engines only (no real POs); predictive-ai is
  -- LLM-billed and self-caps at 10 machines/run. Staggered early-AM ET.
  for v_fn, v_schedule in
    select * from (values
      ('qb-rebate-deadlines-cron',  '0 11 * * *'),
      ('parts-demand-forecast',     '10 6 * * *'),
      ('parts-reorder-compute',     '40 6 * * *'),
      ('parts-auto-replenish',      '10 7 * * *'),
      ('parts-network-optimizer',   '40 7 * * *'),
      ('parts-predictive-failure',  '10 8 * * *'),
      ('parts-predictive-kitter',   '40 8 * * *'),
      ('parts-predictive-ai',       '10 9 * * *')
    ) as t(fn, sched)
  loop
    v_jobname := case when v_fn = 'qb-rebate-deadlines-cron'
                      then 'qb-rebate-deadline-check' else v_fn end;
    if exists (select 1 from cron.job where jobname = v_jobname) then
      perform cron.unschedule(v_jobname);
    end if;
    perform cron.schedule(
      v_jobname,
      v_schedule,
      format(
        $job$select net.http_post(
    url := 'https://iciddijgonywtxoelous.supabase.co/functions/v1/%s',
    headers := jsonb_build_object('x-internal-service-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'INTERNAL_SERVICE_SECRET')),
    body := '{}'::jsonb
  )$job$, v_fn));
  end loop;
exception
  when others then
    raise notice 'N5.1 cron registration failed: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Bus B deprecation + dedupe-probe index for the repointed helper
-- ─────────────────────────────────────────────────────────────────────────

comment on table public.flow_events is
  'DEPRECATED (N5.1 / m802): legacy write-only m209 bus. All writers repointed to emit_event()/analytics_events; flow-runner consumes flow_pending_events. Rows kept as history — do not add readers or writers.';

-- publishFlowEvent (repointed) probes for an existing event by
-- (workspace, flow_event_type, properties->>'idempotency_key') before
-- emitting. Expression index keeps the probe off a seq scan as the spine
-- grows.
create index if not exists idx_ae_flow_idempotency_key
  on public.analytics_events ((properties ->> 'idempotency_key'))
  where flow_event_type is not null;

COMMIT;
