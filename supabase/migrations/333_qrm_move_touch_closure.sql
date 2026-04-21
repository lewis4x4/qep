-- Slice 5 — close the signal → move → touch loop.
--
-- When a rep completes a move from TodaySurface, we auto-log a touch so the
-- rep's actual work is visible to the graph (deal health scoring reads from
-- touches, not moves). We also suppress the signals that triggered the move
-- so they don't re-surface on Pulse after the rep has already acted.
--
-- Two schema changes on existing Slice-1 tables:
--
--   1. touches.from_move_id — nullable back-reference to the move that
--      spawned this touch. Null for organic touches (email sync, voice note,
--      manual log); non-null for touches created by a move completion. Lets
--      us render "logged from move" on the touch detail and measure how
--      often a move actually leads to logged work.
--
--   2. signals.suppressed_until already exists (migration 310), but we had
--      no safe index for "find open signals for this entity" when doing
--      bulk suppression. Add a partial index on (entity_type, entity_id)
--      where suppressed_until is null so the WHERE-IN bulk update the edge
--      function does stays on an index scan even as the signals table grows.

-- ---------------------------------------------------------------------------
-- touches.from_move_id
-- ---------------------------------------------------------------------------

alter table public.touches
  add column if not exists from_move_id uuid
    references public.moves(id) on delete set null;

comment on column public.touches.from_move_id is
  'Back-reference to the move that spawned this touch, when the touch was '
  'logged as part of a move-complete flow (Slice 5). Null for organic '
  'touches coming from email sync, voice notes, or manual logging.';

create index if not exists idx_touches_from_move
  on public.touches (from_move_id)
  where from_move_id is not null;

-- ---------------------------------------------------------------------------
-- signals lookup for bulk suppression
-- ---------------------------------------------------------------------------

-- When a move completes we issue:
--
--   update signals set suppressed_until = now() + '7 days'::interval
--    where id = any(move.signal_ids) and workspace_id = :ws;
--
-- That's an index scan on `id` primary key, already fast. But the recommender
-- also needs to answer "is there an open signal for this entity still?" when
-- deciding whether to re-propose a move post-suppression. The existing
-- partial index idx_signals_rep_open is on (assigned_rep_id, occurred_at);
-- add a complementary one keyed on entity so rep-independent rules
-- (workspace_sla, e.g.) stay cheap.

create index if not exists idx_signals_entity_open
  on public.signals (entity_type, entity_id, occurred_at desc)
  where suppressed_until is null;
