/**
 * Proposal Pre-Apply Checklist — Slice 20ac.
 *
 * 20y produces the verdict pill — one word + one sentence + ranked
 * reasons. That answers "what does the system recommend?". But the
 * manager's actual question at the moment of action is the inverse:
 * "did we check everything?" The verdict is the output; the checklist
 * is the audit trail that produced it, made visible.
 *
 * A pilot runs a pre-flight checklist before every takeoff — not
 * because they don't trust themselves, but because THE WHOLE POINT is
 * to make the check mandatory and visible. The same logic applies to
 * shipping a scorer change: every gate that gave a thumbs-up, and
 * every gate that gave a thumbs-down, should be inspectable as a row,
 * not buried inside a composite verdict.
 *
 * This module emits that row-by-row audit. For each of the pre-flight
 * gates, it emits a `CheckItem` with:
 *
 *   • `status`   — pass / warn / fail / skipped. "skipped" when the
 *                  input signal isn't available (e.g. no what-if
 *                  because no closed-deal audit sample yet).
 *   • `label`    — the gate name ("Sample adequate", "Confidence",
 *                  "Verdict", etc).
 *   • `evidence` — the specific number or state that gave the check
 *                  its status ("72/100", "apply", "−0.034 Brier").
 *
 * The overall `readiness` mirrors 20y's verdict band but is derived
 * structurally from the check rows (any fail → hold, >half warn →
 * review, else ready) so the two can diverge when one signal has
 * information the verdict's priority tree ignores. When they agree —
 * which is most of the time — the checklist serves as corroborating
 * receipts; when they disagree, the manager is prompted to look at
 * the row that broke the tie.
 *
 * Move-2: commodity CRMs either hand the manager a single verdict
 * ("apply!") or leave them to triangulate across five dashboards. QEP
 * gives them the verdict AND the explicit row-by-row checklist that
 * produced it, so shipping a change is a deliberate act with visible
 * evidence, not a button press with invisible trust.
 *
 * Pure function — no I/O. Deterministic for a given input bundle.
 */

import type { ScorerProposal } from "./scorer-proposal";
import type { ProposalConfidenceResult } from "./proposal-confidence";
import type { ProposalApplyVerdict } from "./proposal-apply-verdict";
import type { ProposalStabilityReport } from "./proposal-stability";
import type { ScorerWhatIfResult } from "./scorer-what-if";
import type { ProposalCallFlipReport } from "./proposal-call-flips";
import type { CalibrationDriftReport } from "./calibration-drift";

/**
 * Confidence thresholds aligned with 20v's band definitions so the
 * checklist doesn't disagree with the confidence pill on what counts
 * as passing.
 */
export const CONFIDENCE_PASS_THRESHOLD = 60;
export const CONFIDENCE_WARN_THRESHOLD = 45;

/**
 * Minimum deals a factor-attribution report should have analyzed
 * before we treat the proposal's measurements as trustworthy. Matches
 * the calibration library's LOW_CONFIDENCE_THRESHOLD.
 */
export const SAMPLE_PASS_THRESHOLD = 10;

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

/**
 * Stable identifier for every check the checklist can emit. The UI
 * uses these as React keys and tests pin them verbatim so renaming a
 * check is a one-place change.
 */
export type CheckId =
  | "sample"
  | "confidence"
  | "verdict"
  | "stability"
  | "what_if"
  | "call_flips"
  | "calibration_trend";

export interface CheckItem {
  id: CheckId;
  /** One-line gate name — "Sample adequate", "Confidence", etc. */
  label: string;
  status: CheckStatus;
  /** The specific number or state that gave the check its status. */
  evidence: string;
}

export type Readiness = "ready" | "review" | "hold";

export interface PreflightChecklist {
  items: CheckItem[];
  passCount: number;
  warnCount: number;
  failCount: number;
  skippedCount: number;
  readiness: Readiness;
  /** "Ready to apply — all 5 gates passed." / "Review recommended — 2 warnings." / "Not ready — 1 gate failed." */
  headline: string | null;
  /** True when there's no proposal to check at all. Not the same as
   *  "all skipped" — a proposal with zero signals yields skipped rows,
   *  not empty. */
  empty: boolean;
}

export interface PreflightInput {
  proposal: ScorerProposal | null;
  confidence: ProposalConfidenceResult | null;
  verdict: ProposalApplyVerdict | null;
  stability: ProposalStabilityReport | null;
  whatIf: ScorerWhatIfResult | null;
  callFlips: ProposalCallFlipReport | null;
  calibrationDrift: CalibrationDriftReport | null;
  /** Deals analyzed in the factor-attribution pipeline. Needed for the
   *  sample-adequacy check — distinct from the what-if's
   *  dealsSimulated (which is the audit sample, a subset). */
  dealsAnalyzed: number | null;
}

/**
 * Build the pre-flight checklist.
 *
 * Returns `empty=true` when there's no proposal to check. Otherwise
 * emits a row for every gate, with `skipped` rows for unavailable
 * inputs so the manager can see at a glance "we don't have data on
 * this gate yet" rather than having the gate silently omitted.
 */
export function computeProposalPreflightChecklist(
  input: PreflightInput,
): PreflightChecklist {
  if (!input.proposal || input.proposal.changes.length === 0) {
    return emptyChecklist();
  }
  const actionable = input.proposal.changes.filter((c) => c.action !== "keep");
  if (actionable.length === 0) {
    // Proposal is all-keep — no need to pre-flight anything.
    return emptyChecklist();
  }

  const items: CheckItem[] = [
    checkSample(input),
    checkConfidence(input),
    checkVerdict(input),
    checkStability(input),
    checkWhatIf(input),
    checkCallFlips(input),
    checkCalibrationTrend(input),
  ];

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  for (const item of items) {
    if (item.status === "pass") passCount += 1;
    else if (item.status === "warn") warnCount += 1;
    else if (item.status === "fail") failCount += 1;
    else skippedCount += 1;
  }

  const readiness = deriveReadiness(failCount, warnCount, passCount);
  const headline = describeHeadline(
    readiness,
    passCount,
    warnCount,
    failCount,
    skippedCount,
  );

  return {
    items,
    passCount,
    warnCount,
    failCount,
    skippedCount,
    readiness,
    headline,
    empty: false,
  };
}

function emptyChecklist(): PreflightChecklist {
  return {
    items: [],
    passCount: 0,
    warnCount: 0,
    failCount: 0,
    skippedCount: 0,
    readiness: "hold",
    headline: null,
    empty: true,
  };
}

function checkSample(input: PreflightInput): CheckItem {
  const n = input.dealsAnalyzed;
  if (n === null) {
    return {
      id: "sample",
      label: "Sample adequate",
      status: "skipped",
      evidence: "no factor-attribution report yet",
    };
  }
  if (n >= SAMPLE_PASS_THRESHOLD) {
    return {
      id: "sample",
      label: "Sample adequate",
      status: "pass",
      evidence: `${n} deals analyzed (≥ ${SAMPLE_PASS_THRESHOLD})`,
    };
  }
  return {
    id: "sample",
    label: "Sample adequate",
    status: "fail",
    evidence: `${n} deals analyzed (< ${SAMPLE_PASS_THRESHOLD})`,
  };
}

function checkConfidence(input: PreflightInput): CheckItem {
  const c = input.confidence;
  if (!c) {
    return {
      id: "confidence",
      label: "Confidence",
      status: "skipped",
      evidence: "no confidence score",
    };
  }
  if (c.confidence >= CONFIDENCE_PASS_THRESHOLD) {
    return {
      id: "confidence",
      label: "Confidence",
      status: "pass",
      evidence: `${c.confidence}/100 (${c.band})`,
    };
  }
  if (c.confidence >= CONFIDENCE_WARN_THRESHOLD) {
    return {
      id: "confidence",
      label: "Confidence",
      status: "warn",
      evidence: `${c.confidence}/100 (${c.band}) — below ${CONFIDENCE_PASS_THRESHOLD} pass threshold`,
    };
  }
  return {
    id: "confidence",
    label: "Confidence",
    status: "fail",
    evidence: `${c.confidence}/100 (${c.band}) — below ${CONFIDENCE_WARN_THRESHOLD} fail threshold`,
  };
}

function checkVerdict(input: PreflightInput): CheckItem {
  const v = input.verdict;
  if (!v) {
    return {
      id: "verdict",
      label: "Verdict",
      status: "skipped",
      evidence: "no verdict computed",
    };
  }
  if (v.verdict === "apply") {
    return {
      id: "verdict",
      label: "Verdict",
      status: "pass",
      evidence: "apply",
    };
  }
  if (v.verdict === "review") {
    return {
      id: "verdict",
      label: "Verdict",
      status: "warn",
      evidence: "review",
    };
  }
  // hold / defer both fail the check — "not ready to apply"
  return {
    id: "verdict",
    label: "Verdict",
    status: "fail",
    evidence: v.verdict,
  };
}

function checkStability(input: PreflightInput): CheckItem {
  const s = input.stability;
  if (!s || s.empty || s.rating === null || s.meanStability === null) {
    return {
      id: "stability",
      label: "Stability",
      status: "skipped",
      evidence: "no stability report",
    };
  }
  const pct = Math.round(s.meanStability * 100);
  if (s.rating === "stable") {
    return {
      id: "stability",
      label: "Stability",
      status: "pass",
      evidence: `${pct}% stable across ${s.changes.length} change${s.changes.length === 1 ? "" : "s"}`,
    };
  }
  if (s.rating === "mixed") {
    return {
      id: "stability",
      label: "Stability",
      status: "warn",
      evidence: `${pct}% mean (mixed — at least one row is on a knife's edge)`,
    };
  }
  return {
    id: "stability",
    label: "Stability",
    status: "fail",
    evidence: `${pct}% mean (fragile — most changes would flip under small perturbations)`,
  };
}

function checkWhatIf(input: PreflightInput): CheckItem {
  const w = input.whatIf;
  if (
    !w ||
    w.noActionableChanges ||
    w.currentBrier === null ||
    w.simulatedBrier === null ||
    w.brierDelta === null
  ) {
    return {
      id: "what_if",
      label: "What-if Brier",
      status: "skipped",
      evidence: "no historical audit sample",
    };
  }
  const fmt = formatBrierDelta(w.brierDelta);
  if (w.brierDelta < -0.005) {
    return {
      id: "what_if",
      label: "What-if Brier",
      status: "pass",
      evidence: `${fmt} on ${w.dealsSimulated} deals (improves accuracy)`,
    };
  }
  if (w.brierDelta <= 0.005) {
    return {
      id: "what_if",
      label: "What-if Brier",
      status: "warn",
      evidence: `${fmt} on ${w.dealsSimulated} deals (roughly neutral)`,
    };
  }
  return {
    id: "what_if",
    label: "What-if Brier",
    status: "fail",
    evidence: `${fmt} on ${w.dealsSimulated} deals (regresses accuracy)`,
  };
}

function checkCallFlips(input: PreflightInput): CheckItem {
  const cf = input.callFlips;
  if (!cf || cf.empty || cf.noActionableChanges) {
    return {
      id: "call_flips",
      label: "Call flips balance",
      status: "skipped",
      evidence: "no per-deal flip data",
    };
  }
  const corr = cf.corroborating.length;
  const reg = cf.regressing.length;
  if (corr === 0 && reg === 0) {
    return {
      id: "call_flips",
      label: "Call flips balance",
      status: "warn",
      evidence: "0 corroborating, 0 regressing (proposal refines without flipping)",
    };
  }
  if (corr > reg) {
    return {
      id: "call_flips",
      label: "Call flips balance",
      status: "pass",
      evidence: `${corr} corroborating vs ${reg} regressing`,
    };
  }
  if (corr === reg) {
    return {
      id: "call_flips",
      label: "Call flips balance",
      status: "warn",
      evidence: `${corr} corroborating vs ${reg} regressing (tied)`,
    };
  }
  return {
    id: "call_flips",
    label: "Call flips balance",
    status: "fail",
    evidence: `${corr} corroborating vs ${reg} regressing (net negative)`,
  };
}

function checkCalibrationTrend(input: PreflightInput): CheckItem {
  const d = input.calibrationDrift;
  if (!d || (d.recentN === 0 && d.priorN === 0)) {
    return {
      id: "calibration_trend",
      label: "Calibration trend",
      status: "skipped",
      evidence: "no calibration window",
    };
  }
  // Directions: "improving" (rate ↑ is good), "degrading" (rate ↓ is
  // bad), "stable" (no meaningful delta). Warn on degrading — the
  // proposal is responding to it, so it's not a blocker, but the
  // reviewer should see that the scorer is currently losing ground.
  if (d.direction === "improving") {
    return {
      id: "calibration_trend",
      label: "Calibration trend",
      status: "pass",
      evidence: `improving (${d.recentN} recent vs ${d.priorN} prior deals)`,
    };
  }
  if (d.direction === "degrading") {
    return {
      id: "calibration_trend",
      label: "Calibration trend",
      status: "warn",
      evidence: `degrading (${d.recentN} recent vs ${d.priorN} prior deals) — proposal responds to this`,
    };
  }
  // stable
  return {
    id: "calibration_trend",
    label: "Calibration trend",
    status: "pass",
    evidence: `stable (${d.recentN} recent vs ${d.priorN} prior deals)`,
  };
}

/**
 * Derive overall readiness from the counts.
 *
 *   • Any fail            → hold    (at least one gate says no)
 *   • ≥2 warns, no fail   → review  (enough concerns to pause)
 *   • 1 warn, no fail     → ready   (single warning isn't a blocker)
 *   • 0 warn / 0 fail     → ready   (happy path)
 *
 * Skipped rows don't count against readiness — they're "no data,"
 * not "failing."
 */
function deriveReadiness(
  failCount: number,
  warnCount: number,
  _passCount: number,
): Readiness {
  if (failCount > 0) return "hold";
  if (warnCount >= 2) return "review";
  return "ready";
}

function describeHeadline(
  readiness: Readiness,
  passCount: number,
  warnCount: number,
  failCount: number,
  skippedCount: number,
): string {
  const parts: string[] = [];
  if (passCount > 0) parts.push(`${passCount} passed`);
  if (warnCount > 0) parts.push(`${warnCount} warn`);
  if (failCount > 0) parts.push(`${failCount} failed`);
  if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
  const counts = parts.join(", ");

  if (readiness === "ready") {
    return `Ready to apply — ${counts}.`;
  }
  if (readiness === "review") {
    return `Review recommended — ${counts}.`;
  }
  return `Not ready — ${counts}.`;
}

export function describeReadinessPill(
  readiness: Readiness,
): { label: string; tone: "emerald" | "amber" | "rose" } {
  if (readiness === "ready") {
    return { label: "✓ READY", tone: "emerald" };
  }
  if (readiness === "review") {
    return { label: "⚠ REVIEW", tone: "amber" };
  }
  return { label: "✗ HOLD", tone: "rose" };
}

/** Format a Brier delta at three decimals with sign. */
function formatBrierDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}
