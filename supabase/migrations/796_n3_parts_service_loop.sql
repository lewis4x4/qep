-- ============================================================================
-- Migration 796: N3.1 — Parts↔Service loop (one stock truth, reservations,
--                vendor POs, backorder events)
--
--   Stream N seam completion (RF-002, RF-020..023). Five dead seams:
--
--   1. ONE LEDGER. Three quantity surfaces diverged by design: parts_catalog
--      (DMS import, prices only), parts_inventory (m108 MVP the pick RPCs
--      mutate), parts_stock (m671 canonical with reservations/locations that
--      only the m673 lookup reads). Both quantity ledgers are EMPTY in prod
--      (verified 2026-07-08), so the unification is riskless:
--      adjust_parts_inventory_delta_strict now operates on parts_stock —
--      every existing caller (counter pick, service fulfillment, intake,
--      billing) lands on the canonical ledger from the first stocked unit.
--      parts_inventory is retired from the hot path (kept for history);
--      parts_catalog stays the import/pricing surface it always was.
--
--   2. RESERVATIONS. parts_stock.qty_reserved had zero writers. New
--      reserve/release/consume functions hold planned service picks; the
--      strict RPC's negative path honors available = on_hand − reserved, so
--      the counter can no longer sell the unit a service job reserved.
--      Service picks draw through their own hold (consume_reserved_part).
--
--   3. VENDOR POs. (Edge-side: service-parts-planner groups order actions
--      by vendor into purchase_orders + purchase_order_lines and writes the
--      po_number back to service_parts_actions.po_reference — which is what
--      the vendor escalator chases.) Schema here: the requirement link on
--      PO lines.
--
--   4. BACKORDER EVENTS. parts.item.received had a flagship consumer
--      workflow (parts-received-for-open-job) and zero producers. Two
--      producers now: the fulfillment RPC's receive path, and delivered
--      counter/portal orders linked to a service job via the new
--      parts_orders.service_job_id.
--
--   5. (Edge-side: service-quote-engine prices parts from parts_catalog
--      retail instead of unit_cost ?? 0.)
-- ============================================================================

BEGIN;

-- ── Schema additions ─────────────────────────────────────────────────────────
ALTER TABLE public.parts_orders
  ADD COLUMN IF NOT EXISTS service_job_id uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_parts_orders_service_job
  ON public.parts_orders (service_job_id) WHERE service_job_id IS NOT NULL;
COMMENT ON COLUMN public.parts_orders.service_job_id is
  'N3.1: counter/portal order sourced for a service job — its delivery emits parts.item.received so the waiting job advances.';

ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS service_parts_requirement_id uuid REFERENCES public.service_parts_requirements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_po_lines_service_requirement
  ON public.purchase_order_lines (service_parts_requirement_id) WHERE service_parts_requirement_id IS NOT NULL;

ALTER TABLE public.service_jobs
  ADD COLUMN IF NOT EXISTS parts_delay_expected_at timestamptz;
COMMENT ON COLUMN public.service_jobs.parts_delay_expected_at is
  'N3.1: latest planned part arrival when it exceeds scheduled_start_at — flags the job for reschedule. Cleared when parts arrive in time.';

-- ── Stock-row resolver (part_number + branch → parts_stock row) ─────────────
create or replace function public.qep_resolve_parts_stock_row(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_create boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pn text := trim(both from coalesce(p_part_number, ''));
  v_part_id uuid;
  v_location_id uuid;
  v_branch_slug text;
  v_stock_id uuid;
begin
  if length(v_pn) = 0 then
    raise exception 'missing_branch_or_part' using errcode = 'P0001';
  end if;

  select id into v_part_id
  from public.parts
  where workspace_id = p_workspace_id and part_number = v_pn and deleted_at is null
  limit 1;

  if v_part_id is null and p_create then
    insert into public.parts (workspace_id, part_number, parts_catalog_id, description)
    select p_workspace_id, v_pn, pc.id, pc.description
    from (select 1) one
    left join lateral (
      select id, description from public.parts_catalog
      where workspace_id = p_workspace_id and part_number = v_pn
      limit 1
    ) pc on true
    returning id into v_part_id;
  end if;
  if v_part_id is null then
    return null;
  end if;

  select id, branch_slug into v_location_id, v_branch_slug
  from public.parts_locations
  where workspace_id = p_workspace_id
    and deleted_at is null
    and is_active
    and (id::text = p_branch_id or branch_id::text = p_branch_id or branch_slug = p_branch_id)
  order by created_at asc
  limit 1;

  if v_location_id is null then
    select id, branch_slug into v_location_id, v_branch_slug
    from public.parts_locations
    where workspace_id = p_workspace_id and deleted_at is null and is_active
    order by created_at asc
    limit 1;
  end if;
  if v_location_id is null then
    return null;
  end if;

  select id into v_stock_id
  from public.parts_stock
  where workspace_id = p_workspace_id
    and part_id = v_part_id
    and location_id = v_location_id
    and deleted_at is null
  limit 1;

  if v_stock_id is null and p_create then
    insert into public.parts_stock (workspace_id, part_id, location_id, branch_slug, qty_on_hand, qty_reserved)
    values (p_workspace_id, v_part_id, v_location_id, v_branch_slug, 0, 0)
    returning id into v_stock_id;
  end if;

  return v_stock_id;
end;
$$;

grant execute on function public.qep_resolve_parts_stock_row(text, text, text, boolean) to authenticated;
grant execute on function public.qep_resolve_parts_stock_row(text, text, text, boolean) to service_role;

-- ── ONE LEDGER: strict delta now writes parts_stock (reservation-aware) ─────
create or replace function public.adjust_parts_inventory_delta_strict(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
begin
  if not (
    auth.role() = 'service_role'
    or public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  ) then
    raise exception 'INSUFFICIENT_PRIVILEGES' using errcode = '42501';
  end if;

  if p_branch_id is null or length(trim(both from coalesce(p_part_number, ''))) = 0 then
    raise exception 'missing_branch_or_part' using errcode = 'P0001';
  end if;
  if p_delta = 0 then
    return;
  end if;

  v_stock_id := public.qep_resolve_parts_stock_row(p_workspace_id, p_branch_id, p_part_number, p_delta > 0);
  if v_stock_id is null then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  select qty_on_hand, qty_reserved into v_on_hand, v_reserved
  from public.parts_stock where id = v_stock_id for update;

  if p_delta < 0 and (v_on_hand - v_reserved + p_delta) < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update public.parts_stock
  set qty_on_hand = v_on_hand + p_delta, updated_at = now()
  where id = v_stock_id;
end;
$$;

comment on function public.adjust_parts_inventory_delta_strict(text, text, text, integer) is
  'N3.1: strict stock change on the canonical parts_stock ledger. Negative deltas honor reservations (available = on_hand − reserved) so counter sales cannot take stock a service job holds.';

-- ── RESERVATIONS ─────────────────────────────────────────────────────────────
create or replace function public.reserve_service_part(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
begin
  if not (
    auth.role() = 'service_role'
    or public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  ) then
    raise exception 'INSUFFICIENT_PRIVILEGES' using errcode = '42501';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    return false;
  end if;

  v_stock_id := public.qep_resolve_parts_stock_row(p_workspace_id, p_branch_id, p_part_number, false);
  if v_stock_id is null then
    return false;
  end if;

  select qty_on_hand, qty_reserved into v_on_hand, v_reserved
  from public.parts_stock where id = v_stock_id for update;

  if (v_on_hand - v_reserved) < p_qty then
    return false;
  end if;

  update public.parts_stock
  set qty_reserved = v_reserved + p_qty, updated_at = now()
  where id = v_stock_id;
  return true;
end;
$$;

create or replace function public.release_service_part_reservation(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_id uuid;
begin
  if coalesce(p_qty, 0) <= 0 then return; end if;
  v_stock_id := public.qep_resolve_parts_stock_row(p_workspace_id, p_branch_id, p_part_number, false);
  if v_stock_id is null then return; end if;
  update public.parts_stock
  set qty_reserved = greatest(0, qty_reserved - p_qty), updated_at = now()
  where id = v_stock_id;
end;
$$;

-- Service picks draw through their own hold: release up to qty, then take.
create or replace function public.consume_reserved_part(
  p_workspace_id text,
  p_branch_id text,
  p_part_number text,
  p_qty integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_id uuid;
  v_on_hand numeric;
  v_reserved numeric;
begin
  if coalesce(p_qty, 0) <= 0 then return; end if;
  v_stock_id := public.qep_resolve_parts_stock_row(p_workspace_id, p_branch_id, p_part_number, false);
  if v_stock_id is null then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  select qty_on_hand, qty_reserved into v_on_hand, v_reserved
  from public.parts_stock where id = v_stock_id for update;

  if v_on_hand < p_qty then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update public.parts_stock
  set qty_on_hand = v_on_hand - p_qty,
      qty_reserved = greatest(0, v_reserved - p_qty),
      updated_at = now()
  where id = v_stock_id;
end;
$$;

grant execute on function public.reserve_service_part(text, text, text, integer) to authenticated;
grant execute on function public.reserve_service_part(text, text, text, integer) to service_role;
grant execute on function public.release_service_part_reservation(text, text, text, integer) to authenticated;
grant execute on function public.release_service_part_reservation(text, text, text, integer) to service_role;
grant execute on function public.consume_reserved_part(text, text, text, integer) to authenticated;
grant execute on function public.consume_reserved_part(text, text, text, integer) to service_role;

-- ── Fulfillment RPC: pick consumes the hold; receive emits the event ────────
create or replace function public.service_parts_apply_fulfillment_action(
  p_requirement_id uuid,
  p_action text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.service_parts_requirements%rowtype;
  v_job record;
  v_next text;
  v_action public.service_parts_action_type;
  v_qty int;
  v_pn text;
  v_norm text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_norm := lower(trim(both from coalesce(p_action, '')));

  select * into strict v_req
  from public.service_parts_requirements
  where id = p_requirement_id
  for update;

  if v_req.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, branch_id, workspace_id into strict v_job
  from public.service_jobs
  where id = v_req.job_id
  for update;

  case v_norm
    when 'pick' then
      v_next := 'picking';
      v_action := 'pick';
    when 'receive' then
      v_next := 'received';
      v_action := 'receive';
    when 'consume' then
      v_next := 'consumed';
      v_action := 'consume';
    when 'return' then
      v_next := 'returned';
      v_action := 'return';
    else
      raise exception 'invalid_action' using errcode = 'P0001';
  end case;

  if v_norm = 'pick' and v_req.status = 'pending' then
    raise exception 'INVALID_TRANSITION: pick requires a plan — run parts planner first' using errcode = 'P0001';
  end if;

  if v_norm = 'receive' and not (v_req.status in ('ordering', 'transferring', 'received')) then
    raise exception 'INVALID_TRANSITION: receive requires ordering or transferring (planned order in flight)' using errcode = 'P0001';
  end if;

  if v_norm in ('consume', 'return') and not (v_req.status in ('staged', 'received', 'consumed', 'returned')) then
    raise exception 'INVALID_TRANSITION: line must be staged or received before consume/return' using errcode = 'P0001';
  end if;

  v_qty := greatest(1, coalesce(v_req.quantity, 1));
  v_pn := trim(both from v_req.part_number);

  if v_norm = 'pick' then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for pick' using errcode = 'P0001';
    end if;
    -- N3.1: picks draw through the reservation the planner placed.
    perform public.consume_reserved_part(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      v_qty
    );
  elsif v_norm in ('receive', 'return') then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for inventory movement' using errcode = 'P0001';
    end if;
    perform (select public.adjust_parts_inventory_delta_strict(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      v_qty
    ));
  end if;

  update public.service_parts_actions
  set completed_at = now()
  where requirement_id = p_requirement_id
    and job_id = v_req.job_id
    and completed_at is null
    and superseded_at is null;

  insert into public.service_parts_actions (
    workspace_id,
    requirement_id,
    job_id,
    action_type,
    actor_id,
    completed_at,
    metadata
  ) values (
    v_req.workspace_id,
    p_requirement_id,
    v_req.job_id,
    v_action,
    p_actor_id,
    now(),
    jsonb_build_object('via', 'service_parts_apply_fulfillment_action')
  );

  update public.service_parts_requirements
  set
    status = v_next,
    updated_at = now()
  where id = p_requirement_id
  returning * into v_req;

  -- N3.1: first-ever producer of parts.item.received — the flagship
  -- parts-received-for-open-job workflow (m209-era consumer) now fires.
  if v_norm = 'receive' then
    perform public.emit_event(
      'parts.item.received',
      'parts',
      'service_parts_requirement',
      p_requirement_id::text,
      jsonb_build_object(
        'linked_service_job_id', v_req.job_id,
        'requirement_id', p_requirement_id,
        'part_number', v_pn,
        'quantity', v_qty
      ),
      v_req.workspace_id
    );
    -- Arrival in hand: clear the reschedule flag if this was the blocker.
    update public.service_jobs
    set parts_delay_expected_at = null
    where id = v_req.job_id
      and parts_delay_expected_at is not null
      and not exists (
        select 1 from public.service_parts_requirements r
        where r.job_id = v_req.job_id
          and r.id <> p_requirement_id
          and r.status in ('ordering', 'transferring')
      );
  end if;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    v_req.workspace_id,
    v_req.job_id,
    'parts_action',
    p_actor_id,
    jsonb_build_object(
      'action', v_norm,
      'requirement_id', p_requirement_id,
      'new_status', v_next,
      'via', 'service_parts_apply_fulfillment_action'
    )
  );

  return jsonb_build_object(
    'requirement', to_jsonb(v_req)
  );
end;
$$;

comment on function public.service_parts_apply_fulfillment_action(uuid, text, uuid) is
  'Transactional fulfillment on the canonical parts_stock ledger: pick consumes the planner''s reservation; receive restocks and emits parts.item.received (N3.1).';

-- ── Delivered counter orders linked to a job also announce arrival ──────────
create or replace function public.fn_parts_order_delivered_emit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'delivered'
     and (old.status is distinct from 'delivered')
     and new.service_job_id is not null then
    perform public.emit_event(
      'parts.item.received',
      'parts',
      'parts_order',
      new.id::text,
      jsonb_build_object(
        'linked_service_job_id', new.service_job_id,
        'parts_order_id', new.id
      ),
      new.workspace_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parts_order_delivered_emit on public.parts_orders;
create trigger trg_parts_order_delivered_emit
  after update of status on public.parts_orders
  for each row execute function public.fn_parts_order_delivered_emit();

COMMIT;
