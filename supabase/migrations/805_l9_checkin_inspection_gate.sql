-- 805_l9_checkin_inspection_gate.sql
-- L9.1 — Check-in inspection gate + turnaround loop (RF-004).
--
-- The m774 fleet-state recompute flipped availability rented→available the
-- instant a line was coded returned — damaged or un-inspected iron was
-- instantly re-rentable, and rental_check_availability/the calendar only
-- block on readiness_status (which nothing set until a disposition opened
-- an H10 work order). Three changes:
--
-- 1. rental_recompute_equipment_fleet_state becomes return-aware: an open
--    uncleared rental_returns row (inspection_pending / decision_pending /
--    damage_assessment) parks the unit at availability='in_service' AND
--    readiness_status='in_service' — the existing hard-conflict channel
--    that rental_check_availability (m774:221) and the calendar already
--    honor. Clearing (clean_return / work_order_open / completed) releases
--    availability; readiness stays 'in_service' while an open
--    rental_fleet_maintenance job exists (H10 hand-off unchanged).
-- 2. rental_returns re-runs the recompute on insert/status change so the
--    gate engages when rental-ops creates the return and releases when the
--    inspection/disposition clears it (ordering fix: the line-status
--    trigger fires before the return row exists, so the return row itself
--    must re-trigger).
-- 3. Finalize gate: /ops/returns completes returns via a DIRECT client
--    UPDATE (RentalReturnsPage), bypassing rental-ops — so the "damaged
--    returns must be disposed before completion" rule lives in a BEFORE
--    trigger, not the edge function.
--
-- The check-in inspection itself (rental_checkin template + run creation
-- on code_line_return, complete_checkin_inspection action) ships in the
-- rental-ops edge function in this same slice.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Return-aware fleet-state recompute (m774 base, verbatim + gate)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.rental_recompute_equipment_fleet_state(p_equipment uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_next_available timestamptz;
  v_on_rent boolean;
  v_open_return boolean;
  v_open_maint boolean;
begin
  if p_equipment is null then
    return;
  end if;

  select
    bool_or(src.on_rent),
    max(src.until)
  into v_on_rent, v_next_available
  from (
    select l.status in ('active', 'off_rent', 'held') as on_rent, l.rental_end_at as until
    from public.rental_contract_lines l
    where l.equipment_id = p_equipment
      and l.deleted_at is null
      and l.status in ('reserved', 'active', 'off_rent', 'held')
    union all
    select false, (h.hold_end + 1)::timestamptz
    from public.rental_reservation_holds h
    where h.equipment_id = p_equipment and h.status = 'active' and h.deleted_at is null
  ) src;

  -- L9.1: an un-inspected or un-disposed return keeps the unit out of the
  -- rentable pool. Cleared = clean_return / work_order_open (H10 takes
  -- over) / refund_processing / completed.
  select exists (
    select 1 from public.rental_returns r
    where r.equipment_id = p_equipment
      and r.status in ('inspection_pending', 'decision_pending', 'damage_assessment')
  ) into v_open_return;

  select exists (
    select 1 from public.service_jobs sj
    where sj.machine_id = p_equipment
      and sj.service_internal_work_class = 'rental_fleet_maintenance'
      and sj.closed_at is null
      and sj.deleted_at is null
  ) into v_open_maint;

  update public.qrm_equipment e
  set
    availability = case
      when coalesce(v_on_rent, false) then 'rented'
      when v_open_return then 'in_service'
      when e.availability = 'rented' then 'available'
      -- release the return-gate parking only once neither an uncleared
      -- return nor an open H10 job remains
      when e.availability = 'in_service' and not v_open_maint then 'available'
      else e.availability
    end,
    readiness_status = case
      -- return gate rides the same hard-conflict channel H10 uses
      when v_open_return then 'in_service'
      when e.readiness_status = 'in_service' then
        case
          when v_open_maint then e.readiness_status  -- H10 owns while jobs open
          when coalesce(v_on_rent, false) then 'on_rent'
          else 'available'
        end
      when coalesce(v_on_rent, false) then 'on_rent'
      when e.readiness_status = 'on_rent' then 'available'
      else e.readiness_status
    end,
    next_available_at = v_next_available
  where e.id = p_equipment;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. rental_returns drives the recompute
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.trg_rental_returns_fleet_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.equipment_id is not null then
    perform public.rental_recompute_equipment_fleet_state(new.equipment_id);
  end if;
  if tg_op = 'UPDATE'
     and old.equipment_id is not null
     and old.equipment_id is distinct from new.equipment_id then
    perform public.rental_recompute_equipment_fleet_state(old.equipment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rental_returns_fleet_state on public.rental_returns;
create trigger trg_rental_returns_fleet_state
  after insert or update of status, equipment_id on public.rental_returns
  for each row execute function public.trg_rental_returns_fleet_state();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Finalize gate — damaged returns must be disposed before completion
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.rental_returns_guard_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from new.status
     and new.has_charges is true
     and coalesce(new.damage_disposition, 'pending') = 'pending' then
    raise exception
      'rental return % has undisposed damage — choose customer_billable/warranty/internal_wear (or resolve the dispute) before completing',
      old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rental_returns_guard_finalize on public.rental_returns;
create trigger trg_rental_returns_guard_finalize
  before update of status on public.rental_returns
  for each row execute function public.rental_returns_guard_finalize();

COMMIT;
