import type { DealCoachContext, RuleEvaluator, RuleResult } from "./types";

/**
 * Rule: Similar-deals retrospective (Slice 17 moonshot).
 *
 * Surfaces when we have at least 3 historical quotes that match the
 * current draft on brand + price band. Leads with the two numbers reps
 * care about: win rate and average winning margin.
 *
 * Severity ladder:
 *   - critical: current margin is more than 4 pts below the avg winning
 *     margin of comparable deals → "you're way under what works"
 *   - warning:  current margin is 1–4 pts below avg winning margin
 *   - info:     within ±1 pt, OR no margin data (still show the stat
 *     because "your deals in this band win 70% of the time" is signal
 *     on its own).
 *
 * Guards — returns null when:
 *   - similarDeals is null (no equipment / no net total)
 *   - closedSampleSize < 3 (too few comps to be useful)
 *   - current draft margin is zero/non-finite (the rule can't compare)
 */

const CRITICAL_DELTA_PTS = -4;
const WARNING_DELTA_PTS  = -1;
const MIN_CLOSED_SAMPLES = 3;

export const similarDealsRule: RuleEvaluator = (ctx: DealCoachContext): RuleResult | null => {
  const sd = ctx.similarDeals;
  if (!sd) return null;
  if (sd.closedSampleSize < MIN_CLOSED_SAMPLES) return null;

  const currentPct = ctx.computed.marginPct;

  // Informational fallback when we have outcomes but no win margins yet
  if (sd.avgWinMarginPct == null) {
    if (sd.winRatePct == null) return null;
    return buildResult({
      severity: "info",
      currentPct,
      sd,
      fallbackOnly: true,
    });
  }

  if (!Number.isFinite(currentPct) || currentPct === 0) {
    // Draft not priced yet — still surface the aggregate comparison
    return buildResult({
      severity: "info",
      currentPct,
      sd,
      fallbackOnly: true,
    });
  }

  const delta = currentPct - sd.avgWinMarginPct;

  let severity: "critical" | "warning" | "info";
  if (delta <= CRITICAL_DELTA_PTS)       severity = "critical";
  else if (delta <= WARNING_DELTA_PTS)   severity = "warning";
  else                                   severity = "info";

  return buildResult({ severity, currentPct, sd, fallbackOnly: false });
};

// ── internals ─────────────────────────────────────────────────────────────

function buildResult(input: {
  severity: "critical" | "warning" | "info";
  currentPct: number;
  sd: NonNullable<DealCoachContext["similarDeals"]>;
  fallbackOnly: boolean;
}): RuleResult {
  const { sd, currentPct, severity, fallbackOnly } = input;

  const winRateText = sd.winRatePct != null
    ? `${sd.winRatePct.toFixed(0)}%`
    : "—";

  const marginText = sd.avgWinMarginPct != null
    ? `**${sd.avgWinMarginPct.toFixed(1)}%**`
    : "(no margin data)";

  const deltaText = sd.avgWinMarginPct != null && Number.isFinite(currentPct) && currentPct > 0
    ? ` You're at **${currentPct.toFixed(1)}%** — ${deltaPhrase(currentPct - sd.avgWinMarginPct)}.`
    : "";

  const priceBand = formatPriceBand(sd.priceBandLow, sd.priceBandHigh);

  return {
    ruleId:   "similar_deals",
    severity,
    title:    fallbackOnly
      ? `${sd.closedSampleSize} comparable deals in this price band`
      : buildHeadline(input),
    body:
      `${sd.closedSampleSize} similar quotes (brand match, ${priceBand}) in the last 90 days. ` +
      `Win rate **${winRateText}**. Avg winning margin ${marginText}.${deltaText}`,
    why:
      `Comparable = same primary brand + net_total within ±35% of this draft. ` +
      `Win = quote marked accepted or qb_quote_outcomes.outcome='won'. ` +
      `Margin average uses wins only so losers don't skew the target you're aiming at.`,
    metrics: {
      sample_size:          sd.sampleSize,
      closed_sample_size:   sd.closedSampleSize,
      win_rate_pct:         sd.winRatePct,
      avg_win_margin_pct:   sd.avgWinMarginPct,
      median_win_margin_pct: sd.medianWinMarginPct,
      current_margin_pct:   Number.isFinite(currentPct) ? currentPct : null,
      delta_pts:            sd.avgWinMarginPct != null && Number.isFinite(currentPct) && currentPct > 0
        ? Math.round((currentPct - sd.avgWinMarginPct) * 10) / 10
        : null,
      severity,
    },
  };
}

function buildHeadline(input: {
  severity: "critical" | "warning" | "info";
  currentPct: number;
  sd: NonNullable<DealCoachContext["similarDeals"]>;
}): string {
  const { severity, currentPct, sd } = input;
  if (sd.avgWinMarginPct == null) {
    return `Similar deals win ${sd.winRatePct?.toFixed(0) ?? "—"}%`;
  }
  const delta = currentPct - sd.avgWinMarginPct;
  const deltaFmt = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
  if (severity === "critical") return `You're ${deltaFmt} pts below what comparable winners closed at`;
  if (severity === "warning")  return `You're ${deltaFmt} pts off the typical winning margin`;
  return `Margin is tracking with similar winning deals`;
}

function deltaPhrase(delta: number): string {
  if (delta <= CRITICAL_DELTA_PTS) return `**${delta.toFixed(1)} pts** below the typical winner`;
  if (delta <= WARNING_DELTA_PTS)  return `${delta.toFixed(1)} pts below the winning average`;
  if (delta < 0)                   return `tracking slightly below (${delta.toFixed(1)} pts)`;
  if (delta === 0)                 return `right at the winning average`;
  return `**+${delta.toFixed(1)} pts** above the typical winner`;
}

function formatPriceBand(low: number, high: number): string {
  const fmt = (n: number) => n >= 1000
    ? `$${Math.round(n / 1000)}k`
    : `$${n.toLocaleString("en-US")}`;
  return `${fmt(low)}–${fmt(high)}`;
}
