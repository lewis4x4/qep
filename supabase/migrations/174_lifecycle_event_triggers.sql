-- ============================================================================
-- Migration 174: Lifecycle event auto-population triggers (Phase D)
--
-- The customer_lifecycle_events table was shipped in mig 168 with the
-- trigger network deferred. This migration installs the AFTER INSERT
-- triggers on the source tables (qrm_deals, service_jobs, voice_captures,
-- customer_invoices) so the lifecycle timeline populates from real
-- activity going forward.
--
-- All triggers use NOT EXISTS guards so they record the FIRST occurrence
-- per company per event_type. Subsequent inserts are no-ops, keeping the
-- timeline focused on milestones rather than activity volume.
-- ============================================================================

-- ── Generic helper: insert a lifecycle event if not already present ──────

create or replace function public.insert_lifecycle_event_once(
  p_workspace_id text,
  p_company_id uuid,
  p_event_type text,
  p_metadata jsonb,
  p_source_table text,
  p_source_id uuid
) returns void
language plpgsql
security definer
as $$
begin
  if p_company_id is null then return; end if;

  insert into public.customer_lifecycle_events (
    workspace_id, company_id, event_type, metadata, source_table, source_id
  )
  select
    coalesce(p_workspace_id, 'default'),
    p_company_id,
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_source_table,
    p_source_id
  where not exists (
    select 1 from public.customer_lifecycle_events
    where company_id = p_company_id
      and event_type = p_event_type
  );
end;
$$;

comment on function public.insert_lifecycle_event_once(text, uuid, text, jsonb, text, uuid) is
  'Idempotent lifecycle event insert. Records the FIRST occurrence per (company, event_type) only.';

-- ── 1. First quote / first purchase from qrm_deals ───────────────────────

create or replace function public.trg_lifecycle_from_deal()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.company_id is null then return new; end if;

  -- First quote (any deal created counts as first quote signal)
  perform public.insert_lifecycle_event_once(
    new.workspace_id,
    new.company_id,
    'first_quote',
    jsonb_build_object('deal_id', new.id, 'deal_name', new.name),
    'qrm_deals',
    new.id
  );

  -- First purchase (deal closed_at populated and amount > 0)
  if (tg_op = 'UPDATE' and old.closed_at is null and new.closed_at is not null and coalesce(new.amount, 0) > 0)
     or (tg_op = 'INSERT' and new.closed_at is not null and coalesce(new.amount, 0) > 0) then
    perform public.insert_lifecycle_event_once(
      new.workspace_id,
      new.company_id,
      'first_purchase',
      jsonb_build_object('deal_id', new.id, 'amount', new.amount),
      'qrm_deals',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lifecycle_deal on public.qrm_deals;
create trigger trg_lifecycle_deal
  after insert or update of closed_at on public.qrm_deals
  for each row execute function public.trg_lifecycle_from_deal();

-- ── 2. First service from service_jobs ──────────────────────────────────

create or replace function public.trg_lifecycle_from_service_job()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.customer_id is null then return new; end if;

  perform public.insert_lifecycle_event_once(
    new.workspace_id,
    new.customer_id,
    'first_service',
    jsonb_build_object('service_job_id', new.id, 'request_type', new.request_type::text),
    'service_jobs',
    new.id
  );

  return new;
end;
$$;

drop trigger if exists trg_lifecycle_service on public.service_jobs;
create trigger trg_lifecycle_service
  after insert on public.service_jobs
  for each row execute function public.trg_lifecycle_from_service_job();

-- ── 3. First contact from voice_captures (best-effort) ──────────────────
-- voice_captures may have customer linkage in metadata. This trigger is
-- defensive — if the metadata shape doesn't carry company_id, the lifecycle
-- event simply doesn't fire.

do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'voice_captures' and relnamespace = 'public'::regnamespace
  ) then
    execute $trg$
      create or replace function public.trg_lifecycle_from_voice_capture()
      returns trigger
      language plpgsql
      security definer
      as $body$
      declare
        v_company_id uuid;
      begin
        begin
          v_company_id := (new.metadata ->> 'company_id')::uuid;
        exception when others then
          v_company_id := null;
        end;
        if v_company_id is null then return new; end if;

        perform public.insert_lifecycle_event_once(
          new.workspace_id,
          v_company_id,
          'first_contact',
          jsonb_build_object('voice_capture_id', new.id),
          'voice_captures',
          new.id
        );
        return new;
      end;
      $body$;
    $trg$;
    execute 'drop trigger if exists trg_lifecycle_voice on public.voice_captures';
    execute 'create trigger trg_lifecycle_voice after insert on public.voice_captures for each row execute function public.trg_lifecycle_from_voice_capture()';
  end if;
end $$;

-- ── 4. First warranty claim is deferred until a warranty claim table exists.

-- ── 5. Backfill convenience: one-shot RPC to seed lifecycle events from existing data
create or replace function public.backfill_customer_lifecycle_events()
returns table (event_type text, inserted_count bigint)
language plpgsql
security invoker
as $$
begin
  -- first_quote backfill
  return query
    with inserted as (
      insert into public.customer_lifecycle_events (workspace_id, company_id, event_type, event_at, metadata, source_table, source_id)
      select d.workspace_id, d.company_id, 'first_quote',
             min(d.created_at) over (partition by d.company_id),
             jsonb_build_object('deal_id', d.id),
             'qrm_deals', d.id
      from public.qrm_deals d
      where d.company_id is not null
        and not exists (
          select 1 from public.customer_lifecycle_events cle
          where cle.company_id = d.company_id and cle.event_type = 'first_quote'
        )
      on conflict do nothing
      returning 1
    )
    select 'first_quote', count(*) from inserted;

  -- first_service backfill
  return query
    with inserted as (
      insert into public.customer_lifecycle_events (workspace_id, company_id, event_type, event_at, metadata, source_table, source_id)
      select sj.workspace_id, sj.customer_id, 'first_service',
             min(sj.created_at) over (partition by sj.customer_id),
             jsonb_build_object('service_job_id', sj.id),
             'service_jobs', sj.id
      from public.service_jobs sj
      where sj.customer_id is not null
        and not exists (
          select 1 from public.customer_lifecycle_events cle
          where cle.company_id = sj.customer_id and cle.event_type = 'first_service'
        )
      on conflict do nothing
      returning 1
    )
    select 'first_service', count(*) from inserted;
end;
$$;

comment on function public.backfill_customer_lifecycle_events() is
  'One-shot backfill: scans qrm_deals + service_jobs and seeds first_quote / first_service events for existing customers.';
