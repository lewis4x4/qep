/**
 * Scorer-Evolution Proposal — Slice 20m.
 *
 * Slices 20e → 20l built the instrumentation arc: we now know, for
 * every scorer factor, whether it earns its weight (`20g`), we know
 * the worst individual misses (`20h`), we know the shadow score's
 * aggregate track record (`20k`). What we don't yet have is a
 * *human-actionable handoff*. A manager reading the cards has to
 * translate numbers into a concrete "change rule X to weight Y"
 * recommendation themselves.
 *
 * This module does that translation. Given the attribution report
 * (20g) plus the shadow calibration summary (20k), it emits a
 * structured proposal describing, per factor:
 *
 *   • Current direction (from the scorer's avg-weight-when-present)
 *   • Measured direction (from the observed lift)
 *   • Recommended action: **strengthen / weaken / flip / drop / keep**
 *   • One-sentence rationale citing the numbers the recommendation
 *     rests on, so a reviewer can verify every call
 *
 * Plus an overall confidence note that leans on the shadow's track
 * record — when the shadow has beaten the rule scorer in their
 * historical disagreements, we say so; when it hasn't, we flag that
 * the rule-based proposal is the stronger signal on its own.
 *
 * Pure functions — no I/O. The consumer can render the structured
 * output however it wants; `renderScorerProposalMarkdown` ships a
 * safe, clipboard-ready plaintext form for immediate copy-paste
 * into a ticket.
 */

import type {
  FactorAttribution,
  FactorAttributionReport,
} from "./factor-attribution";
import { isFactorSurprising } from "./factor-attribution";
import type { ShadowAgreementSummary } from "./retrospective-shadow";

/**
 * Lift magnitude below which we treat a factor as "not pulling its
 * weight". A factor sitting at ±0.04 lift after enough observations
 * isn't meaningfully predictive — removing it simplifies the scorer
 * without hurting accuracy. Chosen at 5% (0.05) because that's the
 * smallest delta a human quickly reads as "could be noise".
 */
export const LOW_LEVERAGE_LIFT = 0.05;

/**
 * The five action verbs the proposal emits. Kept as a discriminated
 * union so consumers don't guess at string values.
 */
export type ScorerAction = "keep" | "strengthen" | "weaken" | "flip" | "drop";

export interface ScorerFactorChange {
  label: string;
  /** Scorer's avg signed weight when the factor fired. Negative = scorer penalizes. */
  currentAvgWeight: number;
  /** Measured lift (winRateWhenPresent - winRateWhenAbsent), or null. */
  lift: number | null;
  /** Observations on the "present" side — thin presence = low confidence. */
  present: number;
  /** Observations on the "absent" side. */
  absent: number;
  /** Chosen action verb. */
  action: ScorerAction;
  /** Rep-friendly one-liner explaining the recommendation. */
  rationale: string;
}

export interface ScorerProposal {
  /** Top-line headline summarizing the proposal's scope. */
  headline: string;
  /** Per-factor recommendations, sorted so "biggest change first". */
  changes: ScorerFactorChange[];
  /** Optional note from 20k's shadow calibration — leverages the
   *  shadow's track record as corroboration or caveat. Null when we
   *  don't have calibration data or it's too thin to speak to. */
  shadowCorroboration: string | null;
  /**
   * True when the underlying data is too thin to trust the proposal
   * as a whole (aggregate `FactorAttributionReport.lowConfidence`).
   */
  lowConfidence: boolean;
}

/**
 * Decide the action verb + rationale for one factor.
 *
 * Action matrix (all subject to `lowConfidence=false`):
 *   • `drop`       — has enough obs, |lift| < LOW_LEVERAGE_LIFT → noise
 *   • `flip`       — sign(weight) disagrees with sign(lift), non-trivial lift
 *   • `weaken`     — sign agrees but |weight| > 5 and |lift| < 0.1 → oversized
 *   • `strengthen` — sign agrees and |lift| > 0.25 but |weight| ≤ 3 → undersized
 *   • `keep`       — default: sign agrees at roughly the right magnitude
 *
 * Low-confidence factors always return `keep` with a "not enough
 * observations" rationale — we never recommend mutating something we
 * haven't measured.
 */
/**
 * Decide the action verb + rationale for one factor. Exported so that
 * downstream stability / sensitivity analysis (20aa) can re-evaluate
 * the same rule against perturbed factor inputs without duplicating
 * the decision matrix.
 */
export function pickAction(f: FactorAttribution): {
  action: ScorerAction;
  rationale: string;
} {
  if (f.lowConfidence || f.lift === null) {
    return {
      action: "keep",
      rationale: `Insufficient observations (present=${f.present}, absent=${f.absent}) — hold until we have more data.`,
    };
  }

  const lift = f.lift;
  const absLift = Math.abs(lift);
  const weight = f.avgWeightWhenPresent;
  const absWeight = Math.abs(weight);

  // Surprising: sign(weight) disagrees with sign(lift) AND weight is
  // non-trivial (scorer is actually betting on this, not just noting it).
  if (isFactorSurprising(f)) {
    const liftPct = Math.round(lift * 100);
    return {
      action: "flip",
      rationale: `Scorer applies ${weight > 0 ? "+" : ""}${weight.toFixed(1)} but measured lift is ${liftPct > 0 ? "+" : ""}${liftPct}%. Current sign is actively anti-predictive.`,
    };
  }

  // Low leverage: sign maybe agrees, but the factor just isn't moving
  // the needle. Drop it.
  if (absLift < LOW_LEVERAGE_LIFT) {
    return {
      action: "drop",
      rationale: `Measured lift ${Math.round(lift * 100)}% across ${f.present + f.absent} deals — within noise floor, factor isn't earning its weight.`,
    };
  }

  // Oversized: scorer's weight is a lot larger than the effect size.
  // A +15 weight for a factor that only delivers +7% lift is overkill.
  if (absWeight > 5 && absLift < 0.1) {
    return {
      action: "weaken",
      rationale: `Weight ${weight > 0 ? "+" : ""}${weight.toFixed(1)} is large but measured lift is only ${Math.round(lift * 100)}% — trim the weight to match the evidence.`,
    };
  }

  // Undersized: measured lift is big but scorer barely rewards it.
  if (absWeight <= 3 && absLift > 0.25) {
    return {
      action: "strengthen",
      rationale: `Measured lift ${Math.round(lift * 100)}% but scorer only applies weight ${weight > 0 ? "+" : ""}${weight.toFixed(1)} — raise the weight to credit the signal properly.`,
    };
  }

  // Default: the scorer is roughly right. Note the evidence anyway.
  return {
    action: "keep",
    rationale: `Weight ${weight > 0 ? "+" : ""}${weight.toFixed(1)} matches measured lift ${Math.round(lift * 100)}% directionally — no change needed.`,
  };
}

/**
 * Build the corroboration sentence from the shadow calibration. Null
 * when we don't have enough shadow data to speak to.
 */
function describeShadowCorroboration(
  calibration: ShadowAgreementSummary | null,
): string | null {
  if (!calibration || calibration.lowConfidence) return null;
  const rate = calibration.shadowDisagreementWinRate;
  if (rate === null) return null; // no disagreements logged

  const pct = Math.round(rate * 100);
  if (rate >= 0.6) {
    return `Corroborated by shadow K-NN: the shadow has won ${calibration.shadowWonDisagreementCount}/${calibration.disagreementCount} historical disagreements (${pct}%), adding independent support for scorer evolution.`;
  }
  if (rate <= 0.4) {
    return `Caveat: shadow K-NN has won only ${calibration.shadowWonDisagreementCount}/${calibration.disagreementCount} historical disagreements (${pct}%) — lean on the rule-based lift numbers, the shadow hasn't yet earned corroboration weight.`;
  }
  return `Shadow K-NN is a coin-flip against the rule scorer historically (${pct}%) — neither corroborates nor undercuts this proposal.`;
}

/**
 * Sort changes so the most actionable show first: flip > strengthen >
 * weaken > drop > keep. Within a group, descending by |lift| to
 * surface the biggest effect sizes.
 */
const ACTION_SORT_ORDER: Record<ScorerAction, number> = {
  flip: 0,
  strengthen: 1,
  weaken: 2,
  drop: 3,
  keep: 4,
};

export function computeScorerProposal(
  report: FactorAttributionReport | null,
  calibration: ShadowAgreementSummary | null,
): ScorerProposal {
  if (!report || report.factors.length === 0) {
    return {
      headline: "Not enough factor-attribution data to propose scorer changes yet.",
      changes: [],
      shadowCorroboration: null,
      lowConfidence: true,
    };
  }

  const changes: ScorerFactorChange[] = report.factors.map((f) => {
    const { action, rationale } = pickAction(f);
    return {
      label: f.label,
      currentAvgWeight: f.avgWeightWhenPresent,
      lift: f.lift,
      present: f.present,
      absent: f.absent,
      action,
      rationale,
    };
  });

  changes.sort((a, b) => {
    const orderDiff = ACTION_SORT_ORDER[a.action] - ACTION_SORT_ORDER[b.action];
    if (orderDiff !== 0) return orderDiff;
    const aLift = a.lift === null ? 0 : Math.abs(a.lift);
    const bLift = b.lift === null ? 0 : Math.abs(b.lift);
    return bLift - aLift;
  });

  const actionable = changes.filter((c) => c.action !== "keep").length;
  const headline =
    actionable === 0
      ? `All ${changes.length} factors land within tolerance of measured lift — no changes recommended.`
      : `${actionable} of ${changes.length} factors has a recommended change (${report.dealsAnalyzed} deals analyzed).`;

  return {
    headline,
    changes,
    shadowCorroboration: describeShadowCorroboration(calibration),
    lowConfidence: report.lowConfidence,
  };
}

/**
 * Render the proposal as a ticket-ready markdown block. Safe for
 * copy-paste into GitHub/Linear/Jira without extra formatting.
 */
export function renderScorerProposalMarkdown(proposal: ScorerProposal): string {
  const lines: string[] = [];
  lines.push("## Scorer Evolution Proposal");
  lines.push("");
  lines.push(proposal.headline);
  if (proposal.lowConfidence) {
    lines.push("");
    lines.push("> ⚠ Based on a small closed-deal sample — re-run once more deals accumulate.");
  }
  lines.push("");

  const actionable = proposal.changes.filter((c) => c.action !== "keep");
  if (actionable.length > 0) {
    lines.push("### Recommended changes");
    for (const c of actionable) {
      lines.push(`- **${c.action.toUpperCase()}** · \`${c.label}\` — ${c.rationale}`);
    }
    lines.push("");
  }

  const keeps = proposal.changes.filter((c) => c.action === "keep");
  if (keeps.length > 0) {
    lines.push("### Keep as-is");
    for (const c of keeps) {
      lines.push(`- \`${c.label}\` — ${c.rationale}`);
    }
    lines.push("");
  }

  if (proposal.shadowCorroboration) {
    lines.push("### Shadow K-NN corroboration");
    lines.push(proposal.shadowCorroboration);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
