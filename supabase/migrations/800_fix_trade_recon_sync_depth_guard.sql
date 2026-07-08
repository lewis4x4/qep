-- 800: Trade recon valuation sync — depth guard killed the H10 actuals chain.
--
-- m766's trg_trade_recondition_sync_from_valuation wrapper used
-- pg_trigger_depth() > 1 as its re-entrancy guard. That correctly breaks the
-- loop (sync updates qb_trade_ins → cascading triggers touch the valuation →
-- sync again), but it also skips every legitimate trigger-initiated valuation
-- change: the m793 H10 actuals writeback updates
-- trade_valuations.reconditioning_estimate from inside the
-- service_internal_cost_postings trigger, so the sync wrapper fired at depth 2
-- and silently returned — recon cost overruns past the 10%/$2,500 threshold
-- never flipped reconditioning_approval_status to 'stale' (diagnosed
-- 2026-07-08 on the m799 verification loop; a manual
-- qep_trade_sync_recondition_state call flipped it, the trigger chain did not).
--
-- Fix: guard on the transaction-local latch qep_trade_sync_recondition_state
-- already sets ('qep.trade_recondition_sync_active') before its qb_trade_ins
-- write — the precise re-entrancy signal — and release it after syncing so
-- later valuation changes in the same transaction still sync.

create or replace function public.qep_trade_recondition_sync_from_valuation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trade_in_id uuid;
begin
  if coalesce(current_setting('qep.trade_recondition_sync_active', true), 'off') = 'on' then
    return null;
  end if;

  for v_trade_in_id in
    select t.id
    from public.qb_trade_ins t
    where t.trade_valuation_id = NEW.id
  loop
    perform public.qep_trade_sync_recondition_state(v_trade_in_id);
  end loop;

  -- The sync leaves the latch on (transaction-local); release it so later
  -- valuation changes in the same transaction are not silently skipped.
  perform set_config('qep.trade_recondition_sync_active', 'off', true);

  return null;
end;
$$;
