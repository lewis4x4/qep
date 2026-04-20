-- ============================================================================
-- Migration 308: Refresh stale Q1-2026 program seeds
--
-- Context surfaced during the Slice 18 post-merge smoke test:
-- migrations 291 + 292 seeded 15 ASV + Develon incentive programs with
-- effective_from = 2026-01-01 and effective_to = 2026-03-31. As of
-- today (2026-04-20) every one of those rows has expired, which means
-- the Deal Coach `active_programs` rule finds nothing to fire and
-- every newly-opened quote shows a silent "no active programs" state.
--
-- This is pure seed-data drift — not an authoring bug — but it leaves
-- the feature dead on arrival in every workspace until someone ships
-- real Q2+ program data.
--
-- Scope:
--   - Surgically touch ONLY the Q1-2026 seeds (effective_to exactly
--     '2026-03-31' AND effective_from exactly '2026-01-01'). The
--     compound predicate protects any real Q2 programs Angela might
--     add with their own end date.
--   - Bump effective_to forward to 2026-09-30 so the seeded programs
--     stay useful through Q3. Angela can replace or refine them at
--     any time — this is a bridge, not a commitment to the specific
--     discount values.
--   - Idempotent: re-applying the migration is a no-op when no rows
--     match the predicate.
--
-- Why 2026-09-30: covers Q2 + Q3 without extending so far into the
-- future that a stale program accidentally shapes Q4 pricing policy.
-- Short runway forces a real refresh decision before year-end.
-- ============================================================================

update public.qb_programs
   set effective_to = date '2026-09-30',
       updated_at    = now()
 where effective_from = date '2026-01-01'
   and effective_to   = date '2026-03-31';

-- Observability: log the count so operators running the migration see
-- exactly how many seed rows were refreshed.
do $$
declare
  v_extended int;
begin
  select count(*) into v_extended
  from public.qb_programs
  where effective_from = date '2026-01-01'
    and effective_to   = date '2026-09-30';
  raise notice '[308] qb_programs seed refresh: % row(s) now effective through 2026-09-30', v_extended;
end;
$$;
