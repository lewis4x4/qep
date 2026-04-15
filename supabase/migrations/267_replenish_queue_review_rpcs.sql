-- ============================================================================
-- Migration 267: Slice 2.7 — Replenish Queue Review surface
--
-- The parts manager's home for approving / editing / rejecting / marking
-- ordered the draft POs produced by:
--   * parts-auto-replenish cron (source_type = 'rop_triggered')
--   * predictive play Queue PO button (source_type = 'predictive_play')
--   * manual adds (source_type = 'manual_entry')
--
-- Ships:
--   v_replenish_queue_enriched — joined view w/ vendor + part + play context
--   approve_replenish_rows     — set status='approved'
--   reject_replenish_rows      — set status='rejected' (with reason)
--   mark_replenish_ordered     — set status='ordered' + po_reference
--   update_replenish_qty       — inline quantity edit
-- ============================================================================

-- Add po_reference column so we can record the actual PO number when ordering
alter table public.parts_auto_replenish_queue
  add column if not exists po_reference text,
  add column if not exists ordered_at timestamptz,
  add column if not exists ordered_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists edited_at timestamptz;

-- ── View: v_replenish_queue_enriched ────────────────────────────────────────
-- One row per queue row, joined with vendor name + part description +
-- (if play-originated) customer + machine context.

create or replace view public.v_replenish_queue_enriched as
select
  q.id,
  q.workspace_id,
  q.part_number,
  q.branch_id,
  q.qty_on_hand,
  q.reorder_point,
  q.recommended_qty,
  q.economic_order_qty,
  q.selected_vendor_id,
  q.vendor_score,
  q.vendor_selection_reason,
  q.estimated_unit_cost,
  q.estimated_total,
  q.status,
  q.scheduled_for,
  q.forecast_driven,
  q.forecast_covered_days,
  q.vendor_price_corroborated,
  q.cdk_vendor_list_price,
  q.potential_overpay_flag,
  q.source_type,
  q.originating_play_id,
  q.po_reference,
  q.approved_at,
  q.ordered_at,
  q.ordered_by,
  q.rejected_at,
  q.rejected_by,
  q.rejection_reason,
  q.edited_at,
  q.edited_by,
  q.created_at,
  q.updated_at,
  q.computation_batch_id,
  -- Enriched fields
  vp.name                                      as vendor_name,
  vp.avg_lead_time_hours                       as vendor_lead_time_hours,
  pc.description                               as part_description,
  pc.on_hand                                   as live_on_hand,
  pc.list_price                                as current_list_price,
  pc.vendor_code                               as part_vendor_code,
  -- Predictive-play origin context
  pp.part_description                          as play_part_description,
  pp.reason                                    as play_reason,
  pp.projected_due_date                        as play_projected_due,
  pp.probability                               as play_probability,
  cf.make                                      as customer_machine_make,
  cf.model                                     as customer_machine_model,
  cf.current_hours                             as customer_machine_hours,
  coalesce(cc.name,
           trim(concat(pcu.first_name, ' ', pcu.last_name)),
           'Customer')                         as customer_name
from public.parts_auto_replenish_queue q
left join public.vendor_profiles vp
  on vp.id = q.selected_vendor_id
left join public.parts_catalog pc
  on pc.workspace_id = q.workspace_id
  and pc.part_number = q.part_number
  and pc.deleted_at is null
left join public.predicted_parts_plays pp
  on pp.id = q.originating_play_id
left join public.customer_fleet cf
  on cf.id = pp.fleet_id
left join public.portal_customers pcu
  on pcu.id = pp.portal_customer_id
left join public.crm_companies cc
  on cc.id = pcu.crm_company_id;

comment on view public.v_replenish_queue_enriched is
  'Fully joined replenish queue with vendor + part + play + customer context. '
  'Powers the /parts/companion/replenish review surface.';

grant select on public.v_replenish_queue_enriched to authenticated;

-- ── RPC: replenish_queue_summary_v2 — richer than v1 (migration 261) ───────

create or replace function public.replenish_queue_summary_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := public.get_my_workspace();

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'pending',          (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and status = 'pending'),
      'scheduled',        (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and status = 'scheduled'),
      'auto_approved',    (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and status = 'auto_approved'),
      'approved',         (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and status = 'approved'),
      'ordered',          (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and status = 'ordered'),
      'overpay_flags',    (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and potential_overpay_flag = true
                               and status in ('pending','scheduled','auto_approved','approved')),
      'from_predictive',  (select count(*)::int from public.parts_auto_replenish_queue
                             where workspace_id = ws and source_type = 'predictive_play'
                               and status in ('pending','scheduled','auto_approved','approved')),
      'total_draft_value', (
        select coalesce(sum(estimated_total), 0)::numeric(14,2)
        from public.parts_auto_replenish_queue
        where workspace_id = ws
          and status in ('pending', 'scheduled', 'auto_approved', 'approved')
      )
    ),
    'by_vendor', (
      select coalesce(jsonb_agg(row_to_json(v) order by v.total_usd desc nulls last), '[]'::jsonb)
      from (
        select
          coalesce(vp.name, 'No vendor selected') as vendor_name,
          q.selected_vendor_id,
          count(*)::int                          as item_count,
          sum(q.estimated_total)::numeric(14,2)  as total_usd,
          min(q.scheduled_for)                   as next_order_date,
          count(*) filter (where q.potential_overpay_flag)::int as overpay_items,
          count(*) filter (where q.source_type = 'predictive_play')::int as play_items,
          count(*) filter (where q.status = 'pending')::int as pending_items,
          count(*) filter (where q.status = 'scheduled')::int as scheduled_items,
          count(*) filter (where q.status = 'auto_approved')::int as auto_approved_items
        from public.parts_auto_replenish_queue q
        left join public.vendor_profiles vp on vp.id = q.selected_vendor_id
        where q.workspace_id = ws
          and q.status in ('pending','scheduled','auto_approved','approved')
        group by vp.name, q.selected_vendor_id
      ) v
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.replenish_queue_summary_v2() to authenticated;

-- ── Mutation RPCs ──────────────────────────────────────────────────────────

create or replace function public.approve_replenish_rows(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  cnt int;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role for replenish approval';
  end if;

  update public.parts_auto_replenish_queue
  set status = 'approved',
      approved_at = now(),
      updated_at = now()
  where id = any(p_ids)
    and workspace_id = ws
    and status in ('pending', 'scheduled', 'auto_approved');

  get diagnostics cnt = row_count;
  return jsonb_build_object('ok', true, 'approved_count', cnt);
end;
$$;

grant execute on function public.approve_replenish_rows(uuid[]) to authenticated;

create or replace function public.reject_replenish_rows(p_ids uuid[], p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  cnt int;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  update public.parts_auto_replenish_queue
  set status = 'rejected',
      rejected_at = now(),
      rejected_by = actor,
      rejection_reason = p_reason,
      updated_at = now()
  where id = any(p_ids)
    and workspace_id = ws
    and status in ('pending', 'scheduled', 'auto_approved', 'approved');

  get diagnostics cnt = row_count;
  return jsonb_build_object('ok', true, 'rejected_count', cnt);
end;
$$;

grant execute on function public.reject_replenish_rows(uuid[], text) to authenticated;

create or replace function public.mark_replenish_ordered(
  p_ids uuid[],
  p_po_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  cnt int;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  update public.parts_auto_replenish_queue
  set status = 'ordered',
      ordered_at = now(),
      ordered_by = actor,
      po_reference = coalesce(p_po_reference, po_reference),
      updated_at = now()
  where id = any(p_ids)
    and workspace_id = ws
    and status in ('approved', 'auto_approved');

  get diagnostics cnt = row_count;

  -- Also flip originating predictive plays to 'fulfilled'
  update public.predicted_parts_plays
  set status = 'fulfilled',
      updated_at = now()
  where id in (
    select originating_play_id
    from public.parts_auto_replenish_queue
    where id = any(p_ids) and originating_play_id is not null
  );

  return jsonb_build_object('ok', true, 'ordered_count', cnt);
end;
$$;

grant execute on function public.mark_replenish_ordered(uuid[], text) to authenticated;

create or replace function public.update_replenish_qty(
  p_id uuid,
  p_new_qty numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  v_row record;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;
  if p_new_qty <= 0 then
    raise exception 'quantity must be positive';
  end if;

  update public.parts_auto_replenish_queue
  set recommended_qty = p_new_qty::int,
      estimated_total = estimated_unit_cost * p_new_qty,
      edited_at = now(),
      edited_by = actor,
      updated_at = now()
  where id = p_id
    and workspace_id = ws
    and status in ('pending', 'scheduled', 'auto_approved')
  returning id, recommended_qty, estimated_total into v_row;

  if not found then
    raise exception 'queue row not found or not editable (must be pending/scheduled/auto_approved)';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'new_qty', v_row.recommended_qty,
    'new_total', v_row.estimated_total
  );
end;
$$;

grant execute on function public.update_replenish_qty(uuid, numeric) to authenticated;

-- ============================================================================
-- Migration 267 complete.
-- ============================================================================
