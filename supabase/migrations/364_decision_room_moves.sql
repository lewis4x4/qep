-- ============================================================================
-- Migration 364: Decision Room move persistence
--
-- Moves tried in the Decision Room Simulator's Try-a-move surface survive
-- page refresh via localStorage today, but that state dies with the device.
-- Reps share accounts across desktop + mobile + tablet; managers want to
-- see what their reps simulated against a deal. This table persists every
-- simulated move (with its per-seat reactions + aggregate) under the same
-- workspace/RLS discipline as crm_deals.
--
-- Each row is one (rep, deal, move) simulation run. Recent rows are read
-- on page mount; new rows are inserted whenever try-a-move returns.
-- ============================================================================

create table if not exists public.decision_room_moves (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  deal_id uuid not null references public.qrm_deals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  move_text text not null,
  reactions jsonb not null default '[]'::jsonb,
  aggregate jsonb not null default '{}'::jsonb,
  velocity_delta integer,
  mood text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint decision_room_moves_mood_check
    check (mood is null or mood in ('positive', 'negative', 'mixed'))
);

comment on table public.decision_room_moves is
  'Decision Room Simulator — persisted Try-a-move runs. One row per simulated move.';

create index if not exists idx_decision_room_moves_deal
  on public.decision_room_moves (deal_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_decision_room_moves_user
  on public.decision_room_moves (user_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_decision_room_moves_workspace
  on public.decision_room_moves (workspace_id, created_at desc)
  where deleted_at is null;

-- ── Touch-on-update trigger ─────────────────────────────────────────────
create or replace function public.decision_room_moves_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_decision_room_moves_touch on public.decision_room_moves;
create trigger trg_decision_room_moves_touch
  before update on public.decision_room_moves
  for each row execute function public.decision_room_moves_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.decision_room_moves enable row level security;

drop policy if exists "decision_room_moves_workspace_select" on public.decision_room_moves;
create policy "decision_room_moves_workspace_select"
  on public.decision_room_moves
  for select
  to authenticated
  using (
    deleted_at is null
    and workspace_id = public.get_my_workspace()
  );

drop policy if exists "decision_room_moves_rep_insert" on public.decision_room_moves;
create policy "decision_room_moves_rep_insert"
  on public.decision_room_moves
  for insert
  to authenticated
  with check (
    workspace_id = public.get_my_workspace()
    and user_id = auth.uid()
  );

drop policy if exists "decision_room_moves_owner_update" on public.decision_room_moves;
create policy "decision_room_moves_owner_update"
  on public.decision_room_moves
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and workspace_id = public.get_my_workspace()
  )
  with check (
    user_id = auth.uid()
    and workspace_id = public.get_my_workspace()
  );

-- Service role bypasses RLS; no additional grant needed.
grant select, insert, update on public.decision_room_moves to authenticated;
