/**
 * Time Primitive — Phase 0 P0.7 pure functions.
 *
 * Provides the `timeBalance` pure function that Phase 3's Time Bank will
 * build on. No IO, no DB access — just arithmetic.
 *
 * Companion to `qrm_stage_age()` SQL function (migration 215) and
 * `qrm_stage_transitions` table. The SQL side tracks *when* a deal entered
 * its current stage; this module interprets that duration against a budget.
 */

export interface TimeBalanceInput {
  days_in_stage: number;
}

export interface TimeBudget {
  max_days: number;
}

export interface TimeBalanceResult {
  remaining: number;
  pct_used: number;
  is_over: boolean;
}

/**
 * Compute time balance: how much of a budget is consumed vs remaining.
 *
 * @param subject  - The entity's current days in stage
 * @param budget   - The maximum allowed days
 * @returns Balance with remaining (clamped to 0), pct_used (0-1+), and is_over flag
 */
export function timeBalance(
  subject: TimeBalanceInput,
  budget: TimeBudget,
): TimeBalanceResult {
  const pct_used = budget.max_days > 0
    ? subject.days_in_stage / budget.max_days
    : 1.0;
  return {
    remaining: Math.max(0, budget.max_days - subject.days_in_stage),
    pct_used: Math.round(pct_used * 100) / 100,
    is_over: subject.days_in_stage > budget.max_days,
  };
}
