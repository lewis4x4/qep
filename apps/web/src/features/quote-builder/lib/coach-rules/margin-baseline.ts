import type { DealCoachContext, RuleEvaluator, RuleResult } from "./types";

/**
 * Rule: Margin vs personal (or team) baseline.
 *
 * Surfaces when the current draft's margin_pct is materially below
 * the rep's 90-day won-deal median — the signal that the rep is about
 * to leave money on the table.
 *
 * Thresholds (tunable; trained in Slice 18 eventually):
 *   delta ≤ -4 pts → critical
 *   delta ≤ -2 pts → warning
 *   delta ≤ -0.5 pts → info
 *   else           → no suggestion
 *
 * Never fires when:
 *   - baseline sample size < 3 (too noisy to trust)
 *   - current draft margin is null or zero
 */

const THRESHOLDS = {
  critical: -4,
  warning:  -2,
  info:     -0.5,
} as const;

export const marginBaselineRule: RuleEvaluator = (ctx: DealCoachContext): RuleResult | null => {
  const { medianPct, sampleSize, usingTeamFallback } = ctx.marginBaseline;
  const currentPct = ctx.computed.marginPct;

  // Guards
  if (medianPct == null || sampleSize < 3) return null;
  if (!Number.isFinite(currentPct) || currentPct === 0) return null;

  const delta = currentPct - medianPct;

  let severity: "critical" | "warning" | "info" | null = null;
  if (delta <= THRESHOLDS.critical) severity = "critical";
  else if (delta <= THRESHOLDS.warning) severity = "warning";
  else if (delta <= THRESHOLDS.info) severity = "info";

  if (!severity) return null;

  const deltaFormatted = delta.toFixed(1);
  const whoseMedian = usingTeamFallback ? "team's" : "your";

  return {
    ruleId: "margin_baseline",
    severity,
    title: `Margin is ${deltaFormatted} pts below ${whoseMedian} baseline`,
    body:
      `This quote is at **${currentPct.toFixed(1)}%** margin. ${whoseMedian[0].toUpperCase() + whoseMedian.slice(1)} ` +
      `90-day won-deal median is **${medianPct.toFixed(1)}%** (n=${sampleSize}). ` +
      `Consider raising the asking price or revisiting dealer discount.`,
    why:
      `Computed from ${sampleSize} won ${usingTeamFallback ? "team" : "personal"} ` +
      `quotes in the last 90 days. Median is used (not mean) to be robust to a few very-high-margin outliers.`,
    action: {
      label: "Review pricing",
      actionId: "focus_margin_input",
    },
    metrics: {
      current_margin_pct: currentPct,
      baseline_median_pct: medianPct,
      delta_pts: delta,
      baseline_sample_size: sampleSize,
      using_team_fallback: usingTeamFallback ? "true" : "false",
    },
  };
};
