-- 808_l9_telematics_service_loop.sql
-- L9.4 — Telematics faults + interval crossings open service, not just
-- sales signals (RF-030: L7 intelligence dead-ended in the QRM signal
-- feed; an on-rent fault did not even flip readiness).
--
-- 1. Fault bridge: telematics-signal-ingest writes `signals` rows
--    (kind='telematics_fault') and nothing else — the flow fabric never
--    heard about them. A trigger on signals emits
--    equipment.telematics.fault enriched with the machine's ownership +
--    company (the workflow pair routes on ownership: rental_fleet →
--    open_internal_service_job → H10 readiness flip; customer-owned →
--    service intake).
-- 2. Hours emitter: equipment.hours_crossed_interval had a consumer
--    workflow since Slice 1 but no emitter. Hours writes land on
--    telematics_feeds.last_hours (telematics-ingest) and
--    qrm_equipment.engine_hours (manual/QRM edits) — both now emit when a
--    unit crosses an equipment_service_intervals.next_due_hours boundary
--    (7-day per-interval dedup probe, served by the m804
--    idx_ae_flow_dedup_probe index).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. signals → equipment.telematics.fault
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_signals_telematics_fault_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipment record;
begin
  if new.kind <> 'telematics_fault' or new.entity_type <> 'equipment' or new.entity_id is null then
    return new;
  end if;

  select e.id, e.company_id, e.ownership into v_equipment
  from public.qrm_equipment e
  where e.id = new.entity_id::uuid and e.deleted_at is null;
  if v_equipment.id is null then
    return new; -- unknown unit: the signal still lands on the feed
  end if;

  perform public.emit_event(
    'equipment.telematics.fault', 'telematics',
    'equipment', v_equipment.id::text,
    jsonb_build_object(
      'equipment_id', v_equipment.id,
      'company_id', v_equipment.company_id,
      'ownership', v_equipment.ownership,
      'severity', new.severity,
      'code', new.payload ->> 'code',
      'title', new.title,
      'signal_id', new.id
    ),
    new.workspace_id);

  return new;
end;
$$;

drop trigger if exists trg_signals_telematics_fault_emit on public.signals;
create trigger trg_signals_telematics_fault_emit
  after insert on public.signals
  for each row execute function public.trg_signals_telematics_fault_emit();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Hours-crossed-interval emitter
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.emit_hours_crossed_intervals(
  p_equipment uuid,
  p_old_hours numeric,
  p_new_hours numeric
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interval record;
  v_company uuid;
  v_workspace text;
  v_emitted integer := 0;
begin
  if p_equipment is null or p_new_hours is null then
    return 0;
  end if;

  select e.company_id, e.workspace_id into v_company, v_workspace
  from public.qrm_equipment e
  where e.id = p_equipment and e.deleted_at is null;
  if v_workspace is null then
    return 0;
  end if;

  for v_interval in
    select esi.id, esi.interval_label, esi.interval_hours, esi.next_due_hours
    from public.equipment_service_intervals esi
    where esi.equipment_id = p_equipment
      and esi.next_due_hours is not null
      and coalesce(p_old_hours, 0) < esi.next_due_hours
      and p_new_hours >= esi.next_due_hours
      -- per-interval re-emit dedup (probe shape covered by m804 index)
      and not exists (
        select 1 from public.analytics_events ae
        where ae.flow_event_type = 'equipment.hours_crossed_interval'
          and ae.entity_id = p_equipment::text
          and ae.properties ->> 'interval_label' = esi.interval_label
          and ae.occurred_at > now() - interval '7 days'
      )
  loop
    perform public.emit_event(
      'equipment.hours_crossed_interval', 'telematics',
      'equipment', p_equipment::text,
      jsonb_build_object(
        'equipment_id', p_equipment,
        'company_id', v_company,
        'current_hours', p_new_hours,
        'interval_hours', v_interval.interval_hours,
        'interval_label', v_interval.interval_label,
        'next_due_hours', v_interval.next_due_hours
      ),
      v_workspace);
    v_emitted := v_emitted + 1;
  end loop;

  return v_emitted;
end;
$$;

create or replace function public.trg_telematics_feed_hours_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.equipment_id is not null
     and new.last_hours is not null
     and new.last_hours is distinct from old.last_hours then
    perform public.emit_hours_crossed_intervals(new.equipment_id, old.last_hours, new.last_hours);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_telematics_feed_hours_emit on public.telematics_feeds;
create trigger trg_telematics_feed_hours_emit
  after update of last_hours on public.telematics_feeds
  for each row execute function public.trg_telematics_feed_hours_emit();

create or replace function public.trg_equipment_hours_emit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.engine_hours is not null
     and new.engine_hours is distinct from old.engine_hours then
    perform public.emit_hours_crossed_intervals(new.id, old.engine_hours, new.engine_hours);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_equipment_hours_emit on public.qrm_equipment;
create trigger trg_equipment_hours_emit
  after update of engine_hours on public.qrm_equipment
  for each row execute function public.trg_equipment_hours_emit();

COMMIT;
