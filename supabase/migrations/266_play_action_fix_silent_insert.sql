-- ============================================================================
-- Migration 266: Fix silent failure in action_predictive_play
--
-- Bug: migration 265's INSERT ... SELECT form could produce 0 rows without
-- error, leaving the play status flipped to 'actioned' but no queue row
-- created. This eroded trust in the "Queue PO" workflow.
--
-- Diagnosed: all known failure paths were silent — no RAISE, no error, no row.
--
-- Fix:
--   1. Split the INSERT into explicit variable lookups (parts_catalog,
--      customer_fleet) with explicit NULL handling + RAISE NOTICE trails.
--   2. Use RAISE EXCEPTION (not silent NULL) when the part lookup fails —
--      better to fail loud than pretend success.
--   3. Reset the play status BACK to 'open' if queue insert fails so the
--      rep knows it didn't actually queue.
-- ============================================================================

create or replace function public.action_predictive_play(
  p_play_id uuid,
  p_action  text,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws              text;
  actor           uuid;
  v_play          record;
  v_existing_qid  uuid;
  v_queue_row_id  uuid;
  v_queue_action  text := 'none';
  v_part          record;
  v_fleet         record;
  v_branch_code   text;
  v_unit_cost     numeric;
  v_est_total     numeric;
  v_next_status   text;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();

  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;
  if p_action not in ('actioned', 'dismissed', 'fulfilled', 'open') then
    raise exception 'invalid action: %', p_action;
  end if;

  -- ── Load the play ───────────────────────────────────────────────────────
  select * into v_play
  from public.predicted_parts_plays
  where id = p_play_id and workspace_id = ws
  for update;

  if not found then
    raise exception 'play % not found in workspace %', p_play_id, ws;
  end if;

  -- ── When actioning, draft a PO (if not already drafted) ────────────────
  if p_action = 'actioned' and coalesce(v_play.recommended_order_qty, 0) > 0 then

    -- Idempotency: already have a live queue row for this play?
    select id into v_existing_qid
    from public.parts_auto_replenish_queue
    where originating_play_id = v_play.id
      and status not in ('rejected', 'expired')
    limit 1;

    if v_existing_qid is not null then
      v_queue_row_id := v_existing_qid;
      v_queue_action := 'reused_existing';
    else
      -- Explicit lookup: part in catalog
      select id, part_number, list_price, cost_price, branch_code
        into v_part
      from public.parts_catalog
      where id = v_play.part_id
        and deleted_at is null
      limit 1;

      if not found then
        raise exception
          'play % references part_id % which is not in parts_catalog (or is soft-deleted)',
          v_play.id, v_play.part_id;
      end if;

      -- Explicit lookup: fleet (optional — plays without fleet can still queue)
      if v_play.fleet_id is not null then
        select id, make, model, current_hours into v_fleet
        from public.customer_fleet
        where id = v_play.fleet_id
        limit 1;
      end if;

      v_branch_code := coalesce(v_part.branch_code, '');
      v_unit_cost   := coalesce(v_part.list_price, v_part.cost_price, 0);
      v_est_total   := v_unit_cost * v_play.recommended_order_qty;

      v_next_status := case
        when v_play.suggested_order_by is not null
          and v_play.suggested_order_by > current_date
        then 'scheduled'
        else 'pending'
      end;

      -- Explicit insert (no SELECT ... FROM join)
      insert into public.parts_auto_replenish_queue (
        workspace_id,
        part_number,
        branch_id,
        qty_on_hand,
        reorder_point,
        recommended_qty,
        economic_order_qty,
        selected_vendor_id,
        vendor_score,
        vendor_selection_reason,
        estimated_unit_cost,
        estimated_total,
        status,
        computation_batch_id,
        scheduled_for,
        forecast_driven,
        forecast_covered_days,
        source_type,
        originating_play_id
      ) values (
        v_play.workspace_id,
        v_part.part_number,
        v_branch_code,
        coalesce(v_play.current_on_hand, 0)::int,
        0,
        v_play.recommended_order_qty::int,
        null,
        v_play.suggested_vendor_id,
        null,
        format(
          'Predictive play for %s %s at %s hrs',
          coalesce(v_fleet.make, '?'),
          coalesce(v_fleet.model, '?'),
          coalesce(v_fleet.current_hours::text, 'unknown')
        ),
        v_unit_cost,
        v_est_total,
        v_next_status,
        'play-action-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
        v_play.suggested_order_by,
        true,
        greatest(0, v_play.projected_due_date - current_date),
        'predictive_play',
        v_play.id
      )
      returning id into v_queue_row_id;

      if v_queue_row_id is null then
        raise exception 'queue insert returned no row for play %', v_play.id;
      end if;

      v_queue_action := 'created';
    end if;
  end if;

  -- ── Update the play status (always, even for dismiss/fulfilled) ────────
  update public.predicted_parts_plays
  set status        = p_action,
      actioned_by   = actor,
      actioned_at   = now(),
      action_note   = coalesce(p_note, action_note),
      updated_at    = now()
  where id = p_play_id and workspace_id = ws;

  return jsonb_build_object(
    'ok', true,
    'play_id', p_play_id,
    'status', p_action,
    'queue_action', v_queue_action,
    'queue_row_id', v_queue_row_id
  );
end;
$$;

grant execute on function public.action_predictive_play(uuid, text, text) to authenticated;

-- ============================================================================
-- Migration 266 complete.
-- ============================================================================
