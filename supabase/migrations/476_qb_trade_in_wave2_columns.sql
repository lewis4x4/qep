-- 476_qb_trade_in_wave2_columns.sql
-- Wave 2 column extensions for qb_trade_ins from Phase-2 Sales Intelligence.

alter table public.qb_trade_ins
  add column if not exists payoff_amount_cents bigint,
  add column if not exists payoff_good_through_date date,
  add column if not exists lien_holder_name text,
  add column if not exists lien_holder_address text,
  add column if not exists lien_holder_account_number text,
  add column if not exists lien_release_received_at date,
  add column if not exists title_received_at date,
  add column if not exists inspection_run_id uuid references public.inspection_runs(id) on delete set null;

comment on column public.qb_trade_ins.payoff_amount_cents is 'Trade-in payoff amount in cents; sensitive finance field.';
comment on column public.qb_trade_ins.inspection_run_id is 'Optional Wave 1 inspection run linked to trade-in appraisal/walk-around.';

create index if not exists idx_qb_trade_ins_inspection_run
  on public.qb_trade_ins (workspace_id, inspection_run_id)
  where inspection_run_id is not null;
comment on index public.idx_qb_trade_ins_inspection_run is 'Purpose: trade-in appraisal to inspection drill-through.';
