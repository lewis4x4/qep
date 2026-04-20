/**
 * Shadow Score — Slice 20j. The first counterfactual model.
 *
 * Every prior slice in the 20-arc (e → i) measured, attributed, triaged,
 * or annotated the *rule-based* scorer. Slice 20j is the first slice
 * that produces a second, independent score from a different mechanism:
 * a K-nearest-neighbor average of the *closest historical deals*.
 *
 * The live rule-based score answers "based on the rules we encoded,
 * where does this deal sit?". The shadow score answers "among the K
 * closed deals whose factor profile looks most like this one, what
 * fraction won?". When the two agree, a manager gains confidence; when
 * they disagree, the rep knows this is a deal that doesn't fit the
 * rule-based mental model and deserves a human read.
 *
 * Move-2 framing: the shadow score is explicitly called a *shadow* and
 * never replaces the live score. It's a second witness, not a verdict.
 * When the full ML counterfactual model ships, it slots in behind the
 * same interface (`computeShadowScore(live, history) → ShadowScoreResult`)
 * with no change to the UI.
 *
 * Pure functions — no I/O. Callers pass in the live factor list plus a
 * list of historical snapshots from `quote_packages.win_probability_snapshot`
 * joined with `qb_quote_outcomes`. The edge function already loads this
 * shape for the 20h audit card; Slice 20j re-uses that same payload on
 * manager accounts where the data is available.
 *
 * Design choices worth justifying:
 *   • **Symmetric-difference + L1-on-shared** distance. Simple, robust,
 *     no scaling needed beyond what the scorer already produces. A
 *     historical snapshot that has factors the live draft doesn't
 *     (or vice versa) is "further away" by one point per orphan label,
 *     plus |Δweight| for every shared label. This is the rank-1 metric
 *     a K-NN would use if we had a feature vector; keeping it rank-1
 *     keeps the math defensible.
 *   • **K = 10.** Small enough that a 30-deal history still yields a
 *     useful signal; large enough that single-deal noise doesn't
 *     dominate. When there's a tie at the K-boundary we include all
 *     tied rows rather than picking arbitrarily.
 *   • **Two low-confidence paths:** sparse sample (kUsed < K) and
 *     distant neighbors (mean distance above threshold). Either one
 *     flips `lowConfidence = true`; UI should de-emphasize the chip.
 *   • **`realizedProbability` mirrors closed-deals-audit.ts exactly.**
 *     Expired folds into loss (0), not coin-flip. We want the shadow
 *     score to tell a consistent story with the other calibration
 *     surfaces; disagreeing about what "expired" means would corrupt
 *     cross-surface comparisons.
 */

import type { CalibrationOutcome } from "./scorer-calibration";

/**
 * One historical closed-deal snapshot. Matches the row shape the edge
 * function already emits for Slice 20h's closed-deals-audit endpoint,
 * minus the fields this calculator doesn't need (score, capturedAt).
 */
export interface ShadowHistoricalSnapshot {
  /** Stable id (quote_packages.id). Used as the snapshot key in tests
   *  and for surfacing "which neighbor contributed" if we later expand
   *  the tooltip — not currently rendered but useful for debug. */
  packageId: string;
  /** The full factor list captured at the time the deal closed. */
  factors: Array<{ label: string; weight: number }>;
  /** The realized outcome from qb_quote_outcomes. */
  outcome: CalibrationOutcome;
}

export interface ShadowScoreResult {
  /**
   * Shadow score in 0..100 — fraction of the K-nearest historical
   * neighbors that ended in a win, expressed as a percentage. We
   * deliberately DON'T clamp to [5, 95] like the live scorer: the
   * shadow *is* an empirical observation, and if all neighbors won the
   * honest answer is 100, not 95.
   */
  shadowScore: number;
  /** Actual neighbor count used (can exceed K when the boundary ties). */
  kUsed: number;
  /** Mean distance across the neighbors used. Lower = tighter match. */
  meanDistance: number;
  /** UI uses this to de-emphasize / add a "thin data" badge. */
  lowConfidence: boolean;
  /** Why lowConfidence fired (or "ok" when confident). */
  reason: ShadowReason;
}

export type ShadowReason =
  | "ok"
  | "empty-history"
  | "sparse-sample"
  | "distant-neighbors";

/**
 * Default K. Tuned to balance signal-from-one-deal noise (K too small)
 * with "now you're just averaging the whole book" washout (K too large).
 */
export const SHADOW_K_DEFAULT = 10;
/**
 * Mean-distance above which we call the top-K "not actually similar".
 * Empirical floor — callers can override via `opts.distantThreshold`.
 *
 * Scale: symmetric-difference adds 1 per orphan label; L1 on shared
 * labels can contribute 2–10 per factor (weights range ~-25..+25, but
 * most fire within ±5 of the partner). A mean distance of ~20 typically
 * means half the factors mismatch outright; ~10 means the profile is
 * a close cousin. 15 is the midpoint — tight enough to matter, loose
 * enough that early datasets still surface something.
 */
export const SHADOW_DISTANT_THRESHOLD = 15;

export interface ShadowScoreOptions {
  k?: number;
  distantThreshold?: number;
}

/**
 * Factor-profile distance. Symmetric-difference count on labels plus
 * L1 on shared-label weights. Pure, commutative, zero when both
 * profiles are identical (same labels + same weights).
 *
 * Worth noting: we treat "label present at weight 0" and "label
 * absent" as *different* states. That's deliberate — the live scorer
 * emits weight-0 factors when it checked but found no signal, and
 * that carries information (the rep *was* evaluated on that axis).
 * Collapsing them would throw away the scorer's own accounting.
 */
export function computeSnapshotDistance(
  liveFactors: Array<{ label: string; weight: number }>,
  historicalFactors: Array<{ label: string; weight: number }>,
): number {
  const liveMap = new Map<string, number>();
  for (const f of liveFactors) {
    if (typeof f.label === "string" && f.label.length > 0 && Number.isFinite(f.weight)) {
      liveMap.set(f.label, f.weight);
    }
  }
  const histMap = new Map<string, number>();
  for (const f of historicalFactors) {
    if (typeof f.label === "string" && f.label.length > 0 && Number.isFinite(f.weight)) {
      histMap.set(f.label, f.weight);
    }
  }

  let dist = 0;
  // Shared labels: add |Δweight|. Orphan on live side: +1. Orphan on
  // historical side: +1. Net result is commutative by construction.
  for (const [label, liveW] of liveMap) {
    const histW = histMap.get(label);
    if (histW === undefined) {
      dist += 1;
    } else {
      dist += Math.abs(liveW - histW);
    }
  }
  for (const label of histMap.keys()) {
    if (!liveMap.has(label)) {
      dist += 1;
    }
  }
  return dist;
}

/**
 * Outcome → {0, 1}. Identical semantics to closed-deals-audit.ts's
 * `realizedProbability / 100`: expired folds into loss.
 */
function outcomeWinFlag(outcome: CalibrationOutcome): 0 | 1 {
  return outcome === "won" ? 1 : 0;
}

/**
 * Compute the shadow score. Returns a result with lowConfidence=true
 * when history is too sparse or neighbors too far. Empty history is
 * NOT an error — we return `{shadowScore: 50, reason: "empty-history",
 * lowConfidence: true}` so callers can always render something. The
 * UI is expected to hide/grey the chip when lowConfidence is set.
 */
export function computeShadowScore(
  liveFactors: Array<{ label: string; weight: number }>,
  history: ShadowHistoricalSnapshot[],
  opts: ShadowScoreOptions = {},
): ShadowScoreResult {
  const k = Math.max(1, Math.floor(opts.k ?? SHADOW_K_DEFAULT));
  const distantThreshold = opts.distantThreshold ?? SHADOW_DISTANT_THRESHOLD;

  const valid = (history ?? []).filter(
    (h) =>
      h != null &&
      typeof h.packageId === "string" &&
      h.packageId.length > 0 &&
      Array.isArray(h.factors) &&
      (h.outcome === "won" || h.outcome === "lost" || h.outcome === "expired"),
  );

  if (valid.length === 0) {
    return {
      shadowScore: 50,
      kUsed: 0,
      meanDistance: 0,
      lowConfidence: true,
      reason: "empty-history",
    };
  }

  // Score every historical snapshot by distance.
  const ranked = valid
    .map((h) => ({
      snapshot: h,
      distance: computeSnapshotDistance(liveFactors, h.factors),
    }))
    .sort((a, b) => a.distance - b.distance);

  // Tie-inclusive top K: take everything with distance ≤ Kth-from-top.
  // When history.length < K the boundary is simply the farthest row,
  // and `used` becomes the full sample.
  const boundaryIndex = Math.min(k, ranked.length) - 1;
  const boundaryDistance = ranked[boundaryIndex].distance;
  const used = ranked.filter((r) => r.distance <= boundaryDistance);

  const winCount = used.reduce(
    (n, r) => n + outcomeWinFlag(r.snapshot.outcome),
    0,
  );
  const shadowScore = Math.round((winCount / used.length) * 100);
  const meanDistance =
    used.reduce((n, r) => n + r.distance, 0) / used.length;

  // Low-confidence paths. Sparse sample wins over distant-neighbors
  // when both fire, because it's the more fundamental data problem
  // (we just don't have enough deals yet) and callers benefit from
  // the more actionable `reason`.
  let reason: ShadowReason = "ok";
  let lowConfidence = false;
  if (valid.length < k) {
    lowConfidence = true;
    reason = "sparse-sample";
  } else if (meanDistance > distantThreshold) {
    lowConfidence = true;
    reason = "distant-neighbors";
  }

  return {
    shadowScore,
    kUsed: used.length,
    meanDistance,
    lowConfidence,
    reason,
  };
}

/**
 * Short, rep-facing sentence summarizing how the shadow reads against
 * the live score. Kept here (not in the component) so tests can pin
 * the copy and the edge-side consumer — if we ever build one — can
 * reuse the phrasing verbatim.
 */
export function describeShadowAgreement(
  liveScore: number,
  shadow: ShadowScoreResult,
): string {
  if (shadow.reason === "empty-history") {
    return "Not enough closed deals yet to form a historical read.";
  }
  if (shadow.reason === "sparse-sample") {
    return `Only ${shadow.kUsed} close match${shadow.kUsed === 1 ? "" : "es"} so far — shadow is directional, not decisive.`;
  }
  const delta = Math.round(shadow.shadowScore - liveScore);
  const absDelta = Math.abs(delta);
  if (absDelta <= 10) {
    return `Shadow ${shadow.shadowScore}% agrees with the live score — confidence is high.`;
  }
  if (delta > 0) {
    return `Shadow ${shadow.shadowScore}% — similar closed deals won more often than the rules suggest. Worth a second look.`;
  }
  return `Shadow ${shadow.shadowScore}% — similar closed deals won less often than the rules suggest. Worth a second look.`;
}
