/**
 * Proposal Call Flips — Slice 20w.
 *
 * 20p's what-if preview tells the manager "applying this proposal
 * would drop Brier by 0.03 and lift hit rate 8pp on 30 deals." That's
 * the aggregate — quantitatively right, but narratively thin. A
 * manager reading it has to trust the summary; they don't see which
 * *specific* deals would have been called differently.
 *
 * This slice renders the concrete version of the same question:
 * **which closed deals would the proposal have flipped — and did the
 * flip agree with reality?** Two buckets:
 *
 *   • `corroborating` — the new call matches the actual outcome and
 *                       the old call didn't. "Deal looked like a miss
 *                       (42%), proposal calls it a win (61%), and it
 *                       won." Direct evidence the proposal is closing
 *                       the gap.
 *   • `regressing`    — the old call matched the outcome and the new
 *                       one doesn't. The proposal would make us *less*
 *                       right on this deal. Even one regressing flip
 *                       is worth showing — it's the sanity check that
 *                       stops a manager from approving a proposal that
 *                       hurts a specific book of business.
 *
 * The kind/unchanged buckets (same call in both versions) aren't shown
 * as flips but are counted so the manager sees the scale: "4 flips
 * corroborating, 1 regressing, 25 unchanged."
 *
 * Move-2 relevance: aggregate accuracy metrics let commodity CRMs
 * claim "the model improved" while hiding the specific calls that
 * got worse. QEP shows the specific calls — and if even one went the
 * wrong way, we surface it. That's the transparent-over-confident
 * stance rendered into per-deal evidence, compounding the same honesty
 * tax every upstream slice already pays.
 *
 * Pure functions — no I/O.
 */

import type { ScorerWhatIfResult, SimulatedDeal } from "./scorer-what-if";

/** Call boundary: score ≥ threshold = "called win". Matches the
 *  healthy/strong band boundary from the 20c scorer so this module
 *  agrees with `scorer-what-if`'s hit-rate math. */
export const CALL_THRESHOLD = 55;

/** Maximum flips rendered per bucket. Two or three is the usable
 *  attention budget — a list of twelve regressing flips is noise, not
 *  evidence. */
export const MAX_FLIPS_PER_BUCKET = 3;

export type DealCall = "win" | "miss";

export type CallFlipKind =
  | "corroborating"
  | "regressing"
  | "aligned_unchanged"
  | "misaligned_unchanged"
  | "expired";

export interface CallFlip {
  packageId: string;
  outcome: "won" | "lost" | "expired";
  /** Call under the stored (current) score. */
  previousCall: DealCall;
  /** Call under the proposal's simulated score. */
  proposedCall: DealCall;
  previous: number;
  proposed: number;
  /** proposed - previous. Same sign convention as `SimulatedDeal.delta`. */
  delta: number;
  kind: CallFlipKind;
}

export interface ProposalCallFlipReport {
  /** Deals where the proposal flipped the call in the right direction. */
  corroborating: CallFlip[];
  /** Deals where the proposal flipped the call the wrong way. */
  regressing: CallFlip[];
  /** Count of deals the proposal kept calling correctly. */
  alignedUnchangedCount: number;
  /** Count of deals the proposal kept calling wrong. */
  misalignedUnchangedCount: number;
  /** Count of expired deals excluded from classification. */
  expiredCount: number;
  /** Resolved deals (won + lost) that contributed to the verdict. */
  resolvedCount: number;
  /** corroborating.length - regressing.length across ALL flips
   *  (including any beyond the MAX_FLIPS_PER_BUCKET display cap). */
  netImprovement: number;
  /** Sum of both bucket sizes across ALL flips (pre-slice). */
  totalFlips: number;
  /** Propagated from `whatIf.lowConfidence`. */
  lowConfidence: boolean;
  /** True when `whatIf` had zero simulated deals — no report to show. */
  empty: boolean;
  /** True when the proposal had no actionable changes; every deal is
   *  guaranteed unchanged. UI should prefer hiding the section entirely
   *  to avoid a "0 corroborating, 0 regressing" stripe. */
  noActionableChanges: boolean;
}

/**
 * Classify one simulated deal. Pure — callable standalone in tests.
 */
export function classifyFlip(deal: SimulatedDeal): CallFlip {
  const previousCall: DealCall = deal.predicted >= CALL_THRESHOLD ? "win" : "miss";
  const proposedCall: DealCall = deal.simulated >= CALL_THRESHOLD ? "win" : "miss";

  let kind: CallFlipKind;
  if (deal.outcome === "expired") {
    // Expired deals have no ground truth; we can't call the flip
    // corroborating or regressing. They're excluded from the verdict
    // counts but still carry a delta, so the consumer can drop them.
    kind = "expired";
  } else {
    const actualCall: DealCall = deal.outcome === "won" ? "win" : "miss";
    if (previousCall === proposedCall) {
      kind =
        previousCall === actualCall
          ? "aligned_unchanged"
          : "misaligned_unchanged";
    } else {
      // Flipped. Did the flip go the right way?
      kind =
        proposedCall === actualCall
          ? "corroborating"
          : "regressing";
    }
  }

  return {
    packageId: deal.packageId,
    outcome: deal.outcome,
    previousCall,
    proposedCall,
    previous: deal.predicted,
    proposed: deal.simulated,
    delta: deal.delta,
    kind,
  };
}

/**
 * Build the full call-flip report from a what-if result.
 *
 * Returns `empty=true` when the what-if has no simulated deals, and
 * `noActionableChanges=true` when the proposal is all-keep (brier
 * deltas are zero, every call is unchanged, nothing to classify).
 */
export function computeProposalCallFlips(
  whatIf: ScorerWhatIfResult,
): ProposalCallFlipReport {
  const empty = whatIf.dealsSimulated === 0;
  const noActionableChanges = whatIf.noActionableChanges;

  if (empty || noActionableChanges) {
    return {
      corroborating: [],
      regressing: [],
      alignedUnchangedCount: 0,
      misalignedUnchangedCount: 0,
      expiredCount: 0,
      resolvedCount: 0,
      netImprovement: 0,
      totalFlips: 0,
      lowConfidence: whatIf.lowConfidence,
      empty,
      noActionableChanges,
    };
  }

  const allCorroborating: CallFlip[] = [];
  const allRegressing: CallFlip[] = [];
  let alignedUnchangedCount = 0;
  let misalignedUnchangedCount = 0;
  let expiredCount = 0;

  for (const deal of whatIf.perDeal) {
    const flip = classifyFlip(deal);
    switch (flip.kind) {
      case "corroborating":
        allCorroborating.push(flip);
        break;
      case "regressing":
        allRegressing.push(flip);
        break;
      case "aligned_unchanged":
        alignedUnchangedCount++;
        break;
      case "misaligned_unchanged":
        misalignedUnchangedCount++;
        break;
      case "expired":
        expiredCount++;
        break;
    }
  }

  // Rank each bucket by the magnitude of score change — the biggest
  // flips are the ones the manager most needs to eyeball.
  allCorroborating.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  allRegressing.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const resolvedCount =
    allCorroborating.length +
    allRegressing.length +
    alignedUnchangedCount +
    misalignedUnchangedCount;

  return {
    corroborating: allCorroborating.slice(0, MAX_FLIPS_PER_BUCKET),
    regressing: allRegressing.slice(0, MAX_FLIPS_PER_BUCKET),
    alignedUnchangedCount,
    misalignedUnchangedCount,
    expiredCount,
    resolvedCount,
    netImprovement: allCorroborating.length - allRegressing.length,
    totalFlips: allCorroborating.length + allRegressing.length,
    lowConfidence: whatIf.lowConfidence,
    empty: false,
    noActionableChanges: false,
  };
}

/**
 * One-sentence headline for the call-flips section. Pinned copy so
 * it's testable and the UI stays dumb. Returns null when the section
 * shouldn't render at all (empty or no actionable changes).
 */
export function describeCallFlipsHeadline(
  report: ProposalCallFlipReport,
): string | null {
  if (report.empty || report.noActionableChanges) return null;
  if (report.totalFlips === 0) {
    return `No call flips on ${report.resolvedCount} resolved deal${report.resolvedCount === 1 ? "" : "s"} — the proposal refines scores without changing any verdicts.`;
  }
  const thin = report.lowConfidence
    ? " (directional only — thin sample)"
    : "";
  if (report.regressing.length === 0) {
    return `${report.corroborating.length} call${report.corroborating.length === 1 ? "" : "s"} would flip in the right direction, none in the wrong direction${thin}.`;
  }
  if (report.corroborating.length === 0) {
    return `⚠ ${report.regressing.length} call${report.regressing.length === 1 ? "" : "s"} would regress, none would corroborate${thin} — review carefully before applying.`;
  }
  const net = report.netImprovement;
  const netCopy =
    net > 0
      ? `net +${net} toward correctness`
      : net < 0
        ? `net ${net} against correctness`
        : "net zero";
  return `${report.corroborating.length} corroborating, ${report.regressing.length} regressing (${netCopy})${thin}.`;
}

/** Format a stored → simulated score pair with the call verdicts for
 *  rendering in a compact row. Kept here so tests can pin the copy. */
export function formatFlipRow(flip: CallFlip): string {
  const outcomeLabel =
    flip.outcome === "won" ? "won" : flip.outcome === "lost" ? "lost" : "expired";
  return `${flip.previous}% (${flip.previousCall}) → ${flip.proposed}% (${flip.proposedCall}) · ${outcomeLabel}`;
}
