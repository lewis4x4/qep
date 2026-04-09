-- ============================================================================
-- Migration 215: Time Primitive (Phase 0 P0.7 / Day 11)
--
-- Creates the time substrate that Phase 3's Time Bank will build on.
-- Ships the stage-transition tracking table, a cold-start backfill for
-- existing open deals, a trigger for go-forward transitions, and two
-- utility functions: qrm_stage_age() and qrm_time_balance().
--
-- Key design decisions:
--   - AFTER UPDATE trigger avoids ordering conflicts with the 3 existing
--     BEFORE UPDATE triggers on crm_deals.stage_id (migrations 066/070).
--   - Cold-start backfill is honest about limitations: historical transitions
--     before this migration are not recoverable (crm_activities has no
--     stage-change enum values). Each open deal gets one row with
--     from_stage_id = NULL and at = crm_deals.updated_at.
--   - Append-only table (no updated_at column, no updates).
--
-- Dependencies: crm_deals (021), crm_deal_stages (021)
-- ============================================================================

-- ── Table: qrm_stage_transitions ──────────────────────────────────────────────

create table public.qrm_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  from_stage_id uuid,  -- NULL for cold-start backfill rows (no "from" stage)
  to_stage_id uuid not null references public.crm_deal_stages(id),
  at timestamptz not null default now(),
  source text not null default 'trigger'
    check (source in ('trigger', 'cold_start_backfill_2026_04_09', 'manual')),
  created_at timestamptz not null default now()
);

comment on table public.qrm_stage_transitions is
  'Phase 0 P0.7: append-only stage transition log. Cold-start backfill on 2026-04-09 provides one row per open deal; the AFTER UPDATE trigger captures go-forward transitions. Historical transitions before the migration date are not recoverable.';

comment on column public.qrm_stage_transitions.source is
  'How the row was created: ''trigger'' = automatic on stage_id change, ''cold_start_backfill_2026_04_09'' = one-time backfill, ''manual'' = admin override.';

alter table public.qrm_stage_transitions enable row level security;

-- Authenticated users can read transitions (managers review stage history).
create policy "qrm_stage_transitions_select_authenticated"
  on public.qrm_stage_transitions for select
  using (auth.role() = 'authenticated' or auth.role() = 'service_role');

-- Only service role can insert/update/delete (trigger uses security definer).
create policy "qrm_stage_transitions_service_all"
  on public.qrm_stage_transitions for all
  using (auth.role() = 'service_role');

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index idx_qrm_stage_transitions_deal_at
  on public.qrm_stage_transitions(deal_id, at desc);

create index idx_qrm_stage_transitions_workspace_at
  on public.qrm_stage_transitions(workspace_id, at desc);

-- ── Trigger function: log stage transitions ──────────────────────────────────
--
-- AFTER UPDATE (not BEFORE) to avoid ordering conflicts with the 3 existing
-- BEFORE UPDATE triggers on crm_deals.stage_id:
--   1. crm_deal_sla_stage_change  (migration 066)
--   2. enforce_deposit_gate_on_stage  (migration 070)
--   3. enforce_margin_check_on_stage  (migration 070)
--
-- The WHEN clause ensures we only log actual changes, not no-op updates.
-- Security definer is needed so the trigger can insert regardless of the
-- calling user's role (matches the existing BEFORE triggers' pattern).

create or replace function public.crm_deals_log_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.qrm_stage_transitions (workspace_id, deal_id, from_stage_id, to_stage_id, at, source)
  values (NEW.workspace_id, NEW.id, OLD.stage_id, NEW.stage_id, now(), 'trigger');
  return NEW;
end;
$$;

create trigger crm_deals_log_stage_transition
  after update of stage_id on public.crm_deals
  for each row
  when (OLD.stage_id is distinct from NEW.stage_id)
  execute function public.crm_deals_log_stage_transition();

-- ── Function: qrm_stage_age(deal_id) → integer ───────────────────────────────
--
-- Returns days in current stage. Handles cold-start: if no transition row
-- exists for the deal at all, falls back to now() - crm_deals.updated_at.

create or replace function public.qrm_stage_age(p_deal_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  -- Fast path: most recent transition row
  select at into v_at
  from public.qrm_stage_transitions
  where deal_id = p_deal_id
  order by at desc
  limit 1;

  if v_at is not null then
    return floor(extract(epoch from (now() - v_at)) / 86400)::integer;
  end if;

  -- Fallback: no transition row (deal created before migration)
  select updated_at into v_at
  from public.crm_deals
  where id = p_deal_id;

  if v_at is not null then
    return floor(extract(epoch from (now() - v_at)) / 86400)::integer;
  end if;

  return 0;
end;
$$;

comment on function public.qrm_stage_age is
  'Phase 0 P0.7: returns integer days a deal has been in its current stage. Uses qrm_stage_transitions if available, falls back to crm_deals.updated_at for deals predating the migration.';

-- ── Function: qrm_time_balance(workspace_id) → TABLE ─────────────────────────
--
-- Returns stage-age info for every open deal in a workspace.
-- The dual naming (days_in_stage + stage_age_days) anticipates a future
-- max_days budget column on crm_deal_stages (not in Phase 0 scope).

create or replace function public.qrm_time_balance(p_workspace_id text)
returns table(
  deal_id uuid,
  stage_name text,
  days_in_stage integer,
  stage_age_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    d.id as deal_id,
    s.name as stage_name,
    public.qrm_stage_age(d.id) as days_in_stage,
    public.qrm_stage_age(d.id) as stage_age_days
  from public.crm_deals d
  join public.crm_deal_stages s on s.id = d.stage_id
  where d.workspace_id = p_workspace_id
    and d.deleted_at is null
    and d.closed_at is null;
end;
$$;

comment on function public.qrm_time_balance is
  'Phase 0 P0.7: returns stage-age info for every open deal in a workspace. Foundation for Phase 3 Time Bank.';

-- ── Cold-start backfill ───────────────────────────────────────────────────────
--
-- One row per open deal. "Open" means deleted_at IS NULL AND closed_at IS NULL
-- (matches the qrm-command-center edge function's definition).
--
-- Uses crm_deals.updated_at as the best available proxy for when the deal
-- entered its current stage. This is imperfect (updated_at fires on any column
-- change) but is the honest cold-start — historical transitions are not
-- recoverable from crm_activities (no stage-change enum values exist).

insert into public.qrm_stage_transitions (workspace_id, deal_id, from_stage_id, to_stage_id, at, source)
select
  d.workspace_id,
  d.id,
  NULL,
  d.stage_id,
  d.updated_at,
  'cold_start_backfill_2026_04_09'
from public.crm_deals d
where d.deleted_at is null
  and d.closed_at is null;
