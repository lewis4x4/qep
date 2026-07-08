-- ============================================================================
-- Migration 794: fix trade_valuation_auto_calc missing FROM alias
--
--   m766:718 wrote `from public.qep_find_trade_brand(...)` with no alias,
--   then selected `fb.represented_for_retail_trade` — 42P01 "missing
--   FROM-clause entry for table fb" on EVERY trade_valuations INSERT/UPDATE
--   since m766 shipped (the sibling call sites at m766:207 and :883 have the
--   alias). Found during N1.1: the H10 recon-actuals writeback updates
--   trade_valuations and hit the broken trigger. One-word fix; body is
--   otherwise verbatim m766.
-- ============================================================================

BEGIN;

create or replace function public.trade_valuation_auto_calc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discount_band jsonb;
  v_brand_represented boolean := false;
  v_min_discount numeric;
  v_default_discount numeric;
  v_cost_basis numeric;
  v_expected_sale_price numeric;
begin
  select fb.represented_for_retail_trade
    into v_brand_represented
  from public.qep_find_trade_brand(coalesce(NEW.workspace_id, public.get_my_workspace()), NEW.make) fb;

  if NEW.auction_value is not null then
    v_discount_band := coalesce(
      public.qep_finance_config_value(
        'trade_nonrepresented_discount_band',
        coalesce(NEW.workspace_id, public.get_my_workspace())
      ),
      '{"min_discount_pct": 8, "max_discount_pct": 10, "default_discount_pct": 8}'::jsonb
    );
    v_min_discount := coalesce((v_discount_band->>'min_discount_pct')::numeric, 8);
    v_default_discount := coalesce((v_discount_band->>'default_discount_pct')::numeric, v_min_discount);

    if coalesce(v_brand_represented, false) = false
       and (NEW.discount_percentage is null or NEW.discount_percentage < v_min_discount) then
      NEW.discount_percentage := v_default_discount;
    end if;

    NEW.discounted_value := NEW.auction_value * (1 - coalesce(NEW.discount_percentage, 8) / 100);
    NEW.preliminary_value := NEW.discounted_value - coalesce(NEW.reconditioning_estimate, 0);
    NEW.suggested_resale_price := NEW.preliminary_value / (1 - 0.225); -- midpoint of 20-25%

    v_cost_basis := coalesce(NEW.final_value, NEW.discounted_value, NEW.auction_value);
    v_expected_sale_price := coalesce(NEW.suggested_resale_price, NEW.auction_value);
    NEW.expected_gross_margin_pct := public.qep_trade_expected_margin_pct(
      v_cost_basis,
      NEW.reconditioning_estimate,
      v_expected_sale_price
    );

    if NEW.final_value is not null and NEW.preliminary_value > 0 then
      NEW.over_allowance := (NEW.final_value > NEW.preliminary_value * 1.10);
      if NEW.over_allowance and NEW.status = 'preliminary' then
        NEW.status := 'manager_review';
      end if;
    end if;
  else
    NEW.expected_gross_margin_pct := public.qep_trade_expected_margin_pct(
      coalesce(NEW.final_value, NEW.discounted_value, NEW.auction_value),
      NEW.reconditioning_estimate,
      coalesce(NEW.suggested_resale_price, NEW.auction_value)
    );
  end if;

  return NEW;
end;
$$;

COMMIT;
