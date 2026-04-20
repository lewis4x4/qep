import type { DealCoachContext, RuleEvaluator, RuleResult } from "./types";
import type { ReasonBucket } from "../deal-intelligence-api";

/**
 * Rule: Reason-intelligence retrospective (Slice 17).
 *
 * Fires when the draft's current margin is under the applicable baseline
 * (meaning the rep is about to trip the margin floor and will have to
 * submit a reason on save). Surfaces historical win rates for each
 * reason bucket so the rep can see which justifications correlate with
 * actual closes.
 *
 *   "Margin exceptions by reason (last 180 days):
 *    • Customer relationship: 8 wins / 3 losses (72%)
 *    • Volume commitment:     5 wins / 4 losses (55%)
 *    • Competitive response:  4 wins / 7 losses (36%)"
 *
 * Severity is always 'info' — this is an advisory surface, not a
 * gate or alarm. The margin_baseline + similar_deals rules carry the
 * urgency; this one supplies the "if you're going to ask for an
 * exception, here's what historically works."
 *
 * Guards — returns null when:
 *   - reasonIntelligence.stats is empty (no margin_exceptions yet, or
 *     every bucket is under MIN_BUCKET_SAMPLES)
 *   - current draft margin is at or above the margin baseline (no
 *     exception looming; the rule would be noise)
 *   - draft isn't priced yet (marginPct == 0 or non-finite)
 */

const MIN_STATS_TO_SHOW = 2;

// Display labels for the canonical buckets — kept here rather than in
// types.ts so copy changes land in one place next to the rule that uses
// them.
const BUCKET_LABELS: Record<ReasonBucket, string> = {
  competitive_response:     "Competitive response",
  customer_relationship:    "Customer relationship",
  strategic_loss_leader:    "Strategic / loss leader",
  volume_commitment:        "Volume commitment",
  service_trade_in_offset:  "Service / trade-in offset",
  other:                    "Other",
};

export const reasonIntelligenceRule: RuleEvaluator = (
  ctx: DealCoachContext,
): RuleResult | null => {
  const { stats } = ctx.reasonIntelligence;
  if (stats.length < MIN_STATS_TO_SHOW) return null;

  // Only fire when the rep is under the baseline (an exception is likely).
  const baseline = ctx.marginBaseline.medianPct;
  const current = ctx.computed.marginPct;
  if (!Number.isFinite(current) || current === 0) return null;
  if (baseline == null || current >= baseline) return null;

  const topThree = stats.slice(0, 3);
  const bodyLines = topThree.map((s) => {
    const closed = s.wins + s.losses;
    const winRate = s.winRatePct != null ? `${s.winRatePct.toFixed(0)}%` : "—";
    const label = BUCKET_LABELS[s.bucket] ?? (s.bucket as string);
    return `• **${label}**: ${s.wins} won / ${s.losses} lost of ${closed} closed (${winRate})`;
  });

  const top = topThree[0];
  const topLabel = BUCKET_LABELS[top.bucket] ?? (top.bucket as string);
  const title = top.winRatePct != null
    ? `${topLabel} reasons win ${top.winRatePct.toFixed(0)}% — pick carefully`
    : `Historical exception reasons available`;

  return {
    ruleId: "reason_intelligence",
    severity: "info",
    title,
    body:
      `You're below baseline — a margin exception is likely on save. ` +
      `Historical outcomes by reason bucket (last 180 days):\n\n` +
      bodyLines.join("\n") +
      `\n\nMake sure your reason actually matches the category that wins.`,
    why:
      `Pulled from qb_margin_exceptions joined to qb_quote_outcomes. ` +
      `Buckets are assigned by regex match on the rep's reason text. ` +
      `Rates are wins/(wins+losses); in-flight and expired deals are excluded. ` +
      `Buckets with fewer than 3 samples are hidden to avoid noise.`,
    metrics: {
      total_samples:           ctx.reasonIntelligence.totalSamples,
      top_bucket:              top.bucket as string,
      top_bucket_win_rate_pct: top.winRatePct,
      buckets_shown:           topThree.length,
    },
  };
};

// Re-export for completeness — callers may want the label table to
// render the same copy elsewhere (e.g. inside the margin-exception
// reason modal when Slice 18 surfaces suggested wording).
export { BUCKET_LABELS };
