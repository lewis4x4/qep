-- ============================================================================
-- Migration 254: Pipeline sort_position + reorder RPC (QRM Track 2 Slice 2.4)
--
-- Adds intra-column ordering to the QRM pipeline board:
--   * `crm_deals.sort_position` — nullable integer, ordered within (workspace, stage)
--   * Backfill assigns a deterministic initial order per (workspace_id, stage_id)
--   * `crm_reorder_pipeline_deals` RPC commits a new order atomically with
--     RLS-equivalent access checks; rep cannot reorder deals they cannot see
--   * `crm_deals_rep_safe` view extended to surface `sort_position` + `margin_pct`
--     so the board has what it needs for analytics + ordering without elevating
--
-- Roadmap slice: Track 2 Slice 2.4 — Pipeline Board Polish
-- ============================================================================

-- 1. Column + index ─────────────────────────────────────────────────────────

alter table public.crm_deals
  add column if not exists sort_position integer;

comment on column public.crm_deals.sort_position is
  'Intra-column order on the pipeline board. Lower values render first. NULL sorts last.';

-- Partial index: skip NULLs (they fall to end, ordered by created_at in the app)
create index if not exists idx_crm_deals_stage_sort_position
  on public.crm_deals (stage_id, sort_position)
  where sort_position is not null and deleted_at is null;

-- 2. Backfill ───────────────────────────────────────────────────────────────
--
-- Assign sort_position in 100-unit steps per (workspace_id, stage_id) bucket,
-- ordered by created_at ascending. Gaps let us insert between cards without a
-- rewrite when a future drag lands between two rows.

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, stage_id
      order by created_at asc, id asc
    ) as rn
  from public.crm_deals
  where deleted_at is null
    and sort_position is null
)
update public.crm_deals d
   set sort_position = r.rn * 100
  from ranked r
 where d.id = r.id;

-- 3. Reorder RPC ────────────────────────────────────────────────────────────
--
-- Accepts (stage_id, ordered_deal_ids[]) and writes sort_position in 100-unit
-- steps. Enforces:
--   * Caller can see every deal (elevated viewer OR crm_rep_can_access_deal)
--   * Every deal belongs to the caller's workspace
--   * Every deal is currently in p_stage_id (or about to land in it — caller
--     sets stageId first via patchCrmDeal, then calls this to place it)
--
-- Runs as SECURITY DEFINER so the function body can see the rows, but does an
-- explicit access check before mutating anything. Same pattern as the other
-- rep-scoped RPCs in this repo.

create or replace function public.crm_reorder_pipeline_deals(
  p_stage_id uuid,
  p_ordered_deal_ids uuid[]
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role text;
  v_workspace text;
  v_deal_id uuid;
  v_idx integer := 0;
begin
  v_role := public.get_my_role();
  v_workspace := public.get_my_workspace();

  if v_role is null or v_workspace is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_ordered_deal_ids is null or array_length(p_ordered_deal_ids, 1) is null then
    return;
  end if;

  -- Validate: every deal belongs to caller's workspace, is in target stage,
  -- and caller can see it.
  foreach v_deal_id in array p_ordered_deal_ids loop
    if not exists (
      select 1
        from public.crm_deals d
       where d.id = v_deal_id
         and d.workspace_id = v_workspace
         and d.stage_id = p_stage_id
         and d.deleted_at is null
    ) then
      raise exception 'deal % not in stage % for workspace', v_deal_id, p_stage_id
        using errcode = '42501';
    end if;

    if v_role = 'rep' and not public.crm_rep_can_access_deal(v_deal_id) then
      raise exception 'not authorized for deal %', v_deal_id using errcode = '42501';
    end if;
  end loop;

  -- Commit the new order.
  foreach v_deal_id in array p_ordered_deal_ids loop
    v_idx := v_idx + 1;
    update public.crm_deals
       set sort_position = v_idx * 100,
           updated_at = now()
     where id = v_deal_id
       and workspace_id = v_workspace;
  end loop;
end;
$$;

comment on function public.crm_reorder_pipeline_deals(uuid, uuid[]) is
  'Atomically reorder deals within a pipeline stage. Rep callers can only reorder deals they can access.';

revoke execute on function public.crm_reorder_pipeline_deals(uuid, uuid[]) from public;
grant execute on function public.crm_reorder_pipeline_deals(uuid, uuid[]) to authenticated;

-- 4. Surface sort_position + margin_pct on the rep-safe view ────────────────
--
-- Rebuild the view so the board query can sort + run gate evaluation without
-- pulling crm_deals_elevated_full. margin_pct is a soft-gate input (roadmap:
-- "Requires Iron Manager Approval" state when margin <10%) and is already
-- visible to reps through the existing card surfaces, so exposing it here is
-- not a new information leak.

drop view if exists public.crm_deals_rep_safe;

create view public.crm_deals_rep_safe with (security_barrier = true) as
select
  d.id,
  d.workspace_id,
  d.name,
  d.stage_id,
  d.primary_contact_id,
  d.company_id,
  d.assigned_rep_id,
  d.amount,
  d.expected_close_on,
  d.hubspot_deal_id,
  d.next_follow_up_at,
  d.last_activity_at,
  d.closed_at,
  d.created_at,
  d.updated_at,
  d.deleted_at,
  d.sort_position,
  d.margin_pct,
  d.deposit_status,
  d.deposit_amount,
  d.sla_deadline_at
from public.crm_deals d
where d.deleted_at is null
  and (
    public.get_my_role() in ('admin', 'manager', 'owner')
    or (public.get_my_role() = 'rep' and public.crm_rep_can_access_deal(d.id))
  );

comment on view public.crm_deals_rep_safe is
  'Rep-safe projection of crm_deals. Includes sort_position + margin_pct + deposit_status + sla_deadline_at for the pipeline board.';

-- Rollback (manual):
--   drop function if exists public.crm_reorder_pipeline_deals(uuid, uuid[]);
--   drop index if exists public.idx_crm_deals_stage_sort_position;
--   alter table public.crm_deals drop column if exists sort_position;
--   (restore crm_deals_rep_safe from migration 025 if needed)
