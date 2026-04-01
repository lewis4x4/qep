-- Add a predictive deal score (0-100) to each deal.
-- Scored periodically by the anomaly-scan function based on:
--   activity frequency, stage velocity, deal size vs average,
--   competitor mentions, sentiment patterns, and follow-up adherence.

alter table public.crm_deals
  add column if not exists deal_score smallint,
  add column if not exists deal_score_factors jsonb,
  add column if not exists deal_score_updated_at timestamptz;

comment on column public.crm_deals.deal_score is 'Predicted win probability 0-100 based on historical patterns.';
comment on column public.crm_deals.deal_score_factors is 'JSON breakdown of scoring factors and their individual contributions.';

create index if not exists idx_deals_score
  on public.crm_deals (deal_score desc)
  where deleted_at is null;
