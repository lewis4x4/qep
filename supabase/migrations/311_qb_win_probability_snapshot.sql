-- Migration 311: Win-probability snapshot on quote_packages (Slice 20e)
--
-- Every time a rep saves a Quote Builder quote, the client has already
-- computed a win-probability score + factor breakdown for the deal (via
-- the rule-based scorer in win-probability-scorer.ts). This migration
-- persists that snapshot alongside the quote so we can:
--
--   1. Show the score on QuoteListPage rows for pipeline triage.
--   2. Surface the factor breakdown on QuoteDetail / post-mortem views.
--   3. Build the ML training loop (Move 2 Phase 3): later slices can
--      pair the snapshot with the eventual qb_quote_outcomes row to
--      produce labeled observations — (features at save-time) →
--      (win/loss). The rule scorer becomes the baseline the ML model is
--      evaluated against.
--
-- Two columns — one rich and one denormalized:
--   * `win_probability_snapshot` (jsonb) — full result:
--       { score, band, rawScore, factors: [...], marginBaselineMedianPct,
--         weightsVersion, savedAt }
--   * `win_probability_score` (smallint) — the integer score, denormalized
--     so QuoteListPage can sort/filter without pulling the jsonb blob.
--     Kept in sync with snapshot.score via the application layer; the
--     partial index below accelerates "hot deals" queries.
--
-- Both columns are nullable — existing quotes pre-Slice 20e stay null
-- and the UI renders "—" for them. A later backfill job could compute
-- historical scores, but we don't block the slice on that.

alter table public.quote_packages
  add column if not exists win_probability_snapshot jsonb,
  add column if not exists win_probability_score smallint check (
    win_probability_score is null or (win_probability_score between 0 and 100)
  );

comment on column public.quote_packages.win_probability_snapshot is
  'Full win-probability result captured at save time: {score, band, rawScore, factors, marginBaselineMedianPct, weightsVersion, savedAt}. Powers Move 2 (counterfactual engine) learning loop.';
comment on column public.quote_packages.win_probability_score is
  'Denormalized integer score 0..100 copied from win_probability_snapshot.score for fast list sort/filter. Null for quotes saved before Slice 20e.';

-- Partial index only covers quotes that actually have a score, so the
-- index stays compact. Used by QuoteListPage "sort by probability" and
-- future "at-risk quotes" dashboards.
create index if not exists idx_quote_packages_win_probability_score
  on public.quote_packages (win_probability_score desc)
  where win_probability_score is not null;
