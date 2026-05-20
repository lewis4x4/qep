-- ============================================================================
-- Migration 598: AUTO-lane silent ratification
-- Q6, Q9, Q16 are AUTO-lane decisions whose recommendation IS the current live
-- behavior. They get auto-answered immediately on seed (silence threshold = 1d,
-- and the V2 spec says AUTO-lane decisions ratify on creation if no human acts).
-- The trigger from migration 595 will auto-promote A4.1, A4.7, A4.8, A3.9, B1.1
-- from pending_decision to not_started in the same transaction.
-- ============================================================================

BEGIN;

UPDATE public.qep_decisions
SET status              = 'answered'::public.qep_decision_status,
    answered_by         = 'auto-lane-ratification',
    answered_at         = NOW(),
    answered_option     = recommended_option,
    answered_rationale  = format(
      'AUTO-lane ratification — recommendation is current live behavior. Owner (%s) can revert at any time via npm run task <id> -- --unblock and updating the qep_decisions row. Reversal cost: %s.',
      owner_role,
      COALESCE(reversal_cost, 'low')
    )
WHERE code IN ('Q6','Q9','Q16')
  AND status = 'open';

COMMIT;
