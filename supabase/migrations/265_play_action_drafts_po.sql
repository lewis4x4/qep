-- ============================================================================
-- Migration 265: Level 2 — "Action" on a predictive play drafts a PO
--
-- Before: clicking Action on /parts/companion/predictive-plays just marked
--         the play status = 'actioned'. No downstream effect.
--
-- After:  clicking Action
--   1. Marks the play actioned (unchanged)
--   2. Inserts a row into parts_auto_replenish_queue with:
--        source_type = 'predictive_play'
--        originating_play_id = <play.id>
--        vendor, part, qty, scheduled_for all copied from the play
--   3. Queue row lands at status 'scheduled' (honors vendor ordering day)
--        OR 'pending' if no vendor schedule configured
--   4. Parts manager sees the new draft on the replenish review dashboard
--      (whenever that UI ships)
--
-- Idempotent: clicking Action twice on the same play does NOT create duplicate
-- queue rows. The originating_play_id FK acts as the dedup key.
-- ============================================================================

-- ── Extend parts_auto_replenish_queue to track play origin ─────────────────

alter table public.parts_auto_replenish_queue
  add column if not exists source_type text
    check (source_type in ('rop_triggered', 'predictive_play', 'manual_entry', 'api_import')),
  add column if not exists originating_play_id uuid
    references public.predicted_parts_plays(id) on delete set null;

comment on column public.parts_auto_replenish_queue.source_type is
  'How this queue row was created — rop_triggered=auto-replenish cron, '
  'predictive_play=rep actioned a play, manual_entry=parts mgr added, '
  'api_import=bulk load';

comment on column public.parts_auto_replenish_queue.originating_play_id is
  'Back-reference to predicted_parts_plays.id when source_type=predictive_play. '
  'Enables idempotent re-action and "show me the play behind this PO".';

-- Backfill existing rows as rop_triggered (they were all created by the cron)
update public.parts_auto_replenish_queue
set source_type = 'rop_triggered'
where source_type is null;

create unique index if not exists uq_auto_replenish_queue_play_origin
  on public.parts_auto_replenish_queue (originating_play_id)
  where originating_play_id is not null
    and status not in ('rejected', 'expired');

-- ── Upgrade action_predictive_play RPC ─────────────────────────────────────

create or replace function public.action_predictive_play(
  p_play_id uuid,
  p_action  text,     -- 'actioned' | 'dismissed' | 'fulfilled' | 'open'
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  v_play record;
  v_queue_row_id uuid;
  v_queue_action text := 'none';
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;
  if p_action not in ('actioned', 'dismissed', 'fulfilled', 'open') then
    raise exception 'invalid action';
  end if;

  -- Load the play
  select * into v_play
  from public.predicted_parts_plays
  where id = p_play_id and workspace_id = ws
  for update;

  if v_play is null then
    raise exception 'play not found in workspace';
  end if;

  -- If acting on a play, draft / reuse a PO in the replenish queue
  if p_action = 'actioned' and v_play.recommended_order_qty > 0 then
    -- Idempotency: check if a live queue row already exists for this play
    select id into v_queue_row_id
    from public.parts_auto_replenish_queue
    where originating_play_id = v_play.id
      and status not in ('rejected', 'expired')
    limit 1;

    if v_queue_row_id is null then
      -- Create new draft PO
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
      )
      select
        v_play.workspace_id,
        v_play.part_number,
        coalesce(cf.make, ''),  -- branch placeholder — the play is customer-scoped,
                                -- not branch-scoped; parts mgr picks branch at approval
        coalesce(v_play.current_on_hand, 0)::int,
        0,                       -- no ROP trigger; play-originated
        v_play.recommended_order_qty::int,
        null,
        v_play.suggested_vendor_id,
        null,
        format('Predictive play for %s %s at %s hrs',
               coalesce(cf.make, '?'), coalesce(cf.model, '?'),
               coalesce(cf.current_hours::text, 'unknown')),
        pc.list_price,
        pc.list_price * v_play.recommended_order_qty,
        case
          when v_play.suggested_order_by is not null
            and v_play.suggested_order_by > current_date
          then 'scheduled'
          else 'pending'
        end,
        'play-action-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
        v_play.suggested_order_by,
        true,                    -- forecast_driven by definition
        v_play.projected_due_date - current_date,
        'predictive_play',
        v_play.id
      from public.parts_catalog pc
      left join public.customer_fleet cf on cf.id = v_play.fleet_id
      where pc.id = v_play.part_id
      returning id into v_queue_row_id;

      v_queue_action := 'created';
    else
      v_queue_action := 'reused_existing';
    end if;
  end if;

  -- Update the play status (always)
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
-- Migration 265 complete.
-- ============================================================================
