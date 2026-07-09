-- 806_l9_damage_charge_persistence.sql
-- L9.2 — Damage/return charge persistence: bill what was assessed (RF-005).
--
-- The L5 billing runner reads rental_returns.{fuel,cleaning,damage}_charge_
-- cents + environmental_fee_cents (rental-billing-runner:111-125) — columns
-- nothing wrote. The ops wizard writes legacy charge_amount DOLLARS, and the
-- runner's assembler treats raw values as cents, so even a naive hand-off
-- would bill $4.50 for a $450 assessment. Edge half of this slice
-- (rental-ops dispose_damage) now persists true cents; this migration adds:
--
-- 1. service_jobs.rental_return_id — the renter-fault H10 work order backlink
--    so a closing job can advance its return precisely.
-- 2. rental_h10_down_for_service (m774, recreated verbatim + extension):
--    when the LAST open rental_fleet_maintenance job for a machine closes,
--    the machine's work_order_open returns with a resolved disposition
--    auto-advance to completed (decision_at stamped). Manual finalize on
--    /ops/returns stays as the escape hatch; the m805 finalize guard still
--    blocks undisposed damage.
-- 3. Backfill: legacy charge_amount dollars → damage_charge_cents (no rows
--    carry charge_amount in prod today; kept for other environments).
--
-- Single billing path decision (spec fix 5): return damage bills on the
-- FINAL RENTAL INVOICE only. generateInvoiceForServiceJob now refuses
-- rental_fleet_maintenance jobs (edge half) — otherwise wiring customer_id
-- onto the renter-fault job would have double-billed the same damage
-- through the service-invoice path.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Work-order → return backlink
-- ─────────────────────────────────────────────────────────────────────────

alter table public.service_jobs
  add column if not exists rental_return_id uuid references public.rental_returns(id) on delete set null;

create index if not exists idx_service_jobs_rental_return
  on public.service_jobs (rental_return_id)
  where rental_return_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. H10: closing the last rental-fleet job advances the return
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.rental_h10_down_for_service()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_machine uuid;
  v_open integer;
  v_relevant boolean;
begin
  if tg_op = 'INSERT' then
    v_machine := new.machine_id;
    v_relevant := new.service_internal_work_class = 'rental_fleet_maintenance';
  else
    v_machine := coalesce(new.machine_id, old.machine_id);
    v_relevant := coalesce(new.service_internal_work_class, '') = 'rental_fleet_maintenance'
               or coalesce(old.service_internal_work_class, '') = 'rental_fleet_maintenance';
  end if;
  if v_machine is null or not coalesce(v_relevant, false) then
    return null;
  end if;

  select count(*) into v_open
  from public.service_jobs j
  where j.machine_id = v_machine
    and j.service_internal_work_class = 'rental_fleet_maintenance'
    and j.closed_at is null;

  if v_open > 0 then
    update public.qrm_equipment
    set readiness_status = 'in_service'
    where id = v_machine and ownership = 'rental_fleet';
  else
    update public.qrm_equipment
    set readiness_status = 'available'
    where id = v_machine and ownership = 'rental_fleet' and readiness_status = 'in_service';
    perform public.rental_recompute_equipment_fleet_state(v_machine);

    -- L9.2: the repair loop is done — advance this machine's disposed
    -- returns out of work_order_open. Fires the m805 returns trigger
    -- (fleet-state release) and passes the m805 finalize guard because
    -- the disposition is resolved. Manual finalize stays available for
    -- returns that never opened a work order.
    update public.rental_returns r
    set status = 'completed',
        decision_at = coalesce(r.decision_at, now())
    where r.equipment_id = v_machine
      and r.status = 'work_order_open'
      and coalesce(r.damage_disposition, 'pending') <> 'pending';
  end if;

  return null;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Backfill legacy dollar assessments into the billed column
-- ─────────────────────────────────────────────────────────────────────────

update public.rental_returns
set damage_charge_cents = round(charge_amount * 100)::bigint
where charge_amount is not null
  and charge_amount > 0
  and damage_charge_cents is null;

COMMIT;
