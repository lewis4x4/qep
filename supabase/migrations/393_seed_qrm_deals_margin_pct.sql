-- 393_seed_qrm_deals_margin_pct.sql
--
-- The Owner "Deals > $250K" table renders a GM% column per deal. margin_pct
-- is nullable on qrm_deals and the existing seeded large deals all have
-- NULL values, so the table shows "—" for every row.
--
-- Seeds realistic GM% values on the 8 deals ≥ $250K so the column and the
-- RISK-derivation (which keys off margin_pct) render meaningfully.
--
-- Values are spread across the realistic equipment-dealer range (11–19%)
-- to exercise the risk buckets:
--   < 10%  → HIGH  risk (we deliberately avoid — these are real open deals)
--   10-15% → MEDIUM risk
--   >=15%  → LOW risk
--
-- Deterministic assignment by id-ordinal so re-running the migration is
-- a no-op (same ids → same update values).

with targets as (
  select
    d.id,
    row_number() over (order by d.amount desc) as n
  from public.qrm_deals d
  where d.deleted_at is null
    and d.amount >= 250000
)
update public.qrm_deals d
set margin_pct = case t.n % 6
    when 0 then 17.4
    when 1 then 15.6
    when 2 then 16.2
    when 3 then 13.8
    when 4 then 18.4
    else        14.9
  end
from targets t
where d.id = t.id
  and d.margin_pct is null;
