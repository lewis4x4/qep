/**
 * Closed-Deals Audit — Slice 20h.
 *
 * Slice 20f measured *how often* the scorer is right in aggregate.
 * Slice 20g measured *which factors* earn their weight.
 * Slice 20h asks: *which specific closed deals were the scorer most
 * wrong about?* — i.e. "show me the worst misses so I can learn from
 * them deal-by-deal".
 *
 * This is the triage queue a commodity CRM scorecard never provides
 * because its predictions don't self-audit. For QEP's Move 2, it's the
 * last feedback loop: stored snapshot × realized outcome → signed
 * miss → sorted by |miss|. The manager opens the worst cases, reads
 * the stored factor list, and decides which rule to evolve.
 *
 * Pure functions — no I/O. The edge function hands over
 * `ClosedDealAuditRow[]` from the jsonb + outcomes join; this module
 * does the arithmetic.
 */

import type { CalibrationOutcome } from "./scorer-calibration";

/**
 * One closed-deal row from the edge function. `packageId` is the
 * quote_packages.id — the UI uses it for navigation and as the stable
 * display key.
 */
export interface ClosedDealAuditRow {
  packageId: string;
  /** The scorer's clamped 0..100 prediction at save time. */
  score: number;
  /** The realized outcome from qb_quote_outcomes. */
  outcome: CalibrationOutcome;
  /** The factor list captured in the snapshot. */
  factors: Array<{ label: string; weight: number }>;
  /** ISO timestamp of when the outcome was captured, for display + recency sort. */
  capturedAt: string | null;
}

/**
 * The computed audit record for one row. `delta = predicted - realized`
 * so a positive delta means "scorer was too optimistic" (bet on the
 * deal, it lost) and negative means "scorer was too pessimistic"
 * (discounted the deal, it won).
 */
export interface ClosedDealAudit {
  packageId: string;
  outcome: CalibrationOutcome;
  predicted: number; // 0..100, the stored score
  realized: number; // 0 | 50 | 100
  /** predicted - realized. Positive = over-confident, negative = under-confident. */
  delta: number;
  /** True when |delta| >= MISS_THRESHOLD. These are the rows managers should review first. */
  missed: boolean;
  /** Up to TOP_N factors ranked by absolute weight, for compact display. */
  topFactors: Array<{ label: string; weight: number }>;
  /** ISO string passed through for display. */
  capturedAt: string | null;
}

/**
 * Miss threshold: predicted probability off from realized outcome by
 * at least this many points. 30 is chosen as a "substantively wrong"
 * floor — at this scale the disagreement between prediction and
 * outcome exceeds anything plausibly explained by rounding or by
 * band-boundary fuzz, so the row is worth a human review. Callers
 * that want a tighter or looser queue can filter `audits` themselves.
 */
export const MISS_THRESHOLD = 30;
const TOP_N_FACTORS = 3;

/**
 * Outcome → realized probability. We deliberately fold `expired` into
 * the *loss* bucket (0) here — matching scorer-calibration.ts's
 * `didWin = outcome === "won"` mapping — so the two instrumentation
 * surfaces tell a consistent story. An expired quote that never
 * converted is, for the purposes of "did the scorer get it right?",
 * not a win, and we don't want to launder a misread prediction by
 * giving it coin-flip credit for a deal that simply timed out.
 */
export function realizedProbability(outcome: CalibrationOutcome): number {
  return outcome === "won" ? 100 : 0;
}

/**
 * Compute the per-row audit. Doesn't filter — callers pass valid rows.
 */
export function auditRow(row: ClosedDealAuditRow): ClosedDealAudit {
  const predicted = clamp01(row.score);
  const realized = realizedProbability(row.outcome);
  const delta = predicted - realized;
  const topFactors = [...row.factors]
    .filter((f) => typeof f.label === "string" && f.label.length > 0 && Number.isFinite(f.weight))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, TOP_N_FACTORS);
  return {
    packageId: row.packageId,
    outcome: row.outcome,
    predicted,
    realized,
    delta,
    missed: Math.abs(delta) >= MISS_THRESHOLD,
    topFactors,
    capturedAt: row.capturedAt,
  };
}

/**
 * Full pipeline: filter malformed rows, compute audits, sort by
 * |delta| descending so the worst misses surface first.
 */
export function computeClosedDealsAudit(rows: ClosedDealAuditRow[]): ClosedDealAudit[] {
  const valid = (rows ?? []).filter(
    (r) =>
      r != null &&
      typeof r.packageId === "string" &&
      r.packageId.length > 0 &&
      typeof r.score === "number" &&
      Number.isFinite(r.score) &&
      (r.outcome === "won" || r.outcome === "lost" || r.outcome === "expired") &&
      Array.isArray(r.factors),
  );
  const audits = valid.map(auditRow);
  audits.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return audits;
}

/**
 * Short human-readable label for the delta bar's accessible name.
 * "Scorer said 78%, deal lost — 78 points too optimistic" etc.
 */
export function formatAuditSummary(a: ClosedDealAudit): string {
  const outcomeWord =
    a.outcome === "won" ? "won" : a.outcome === "lost" ? "lost" : "expired";
  if (a.delta === 0) {
    return `Predicted ${a.predicted}%, deal ${outcomeWord} — scorer on target`;
  }
  const direction = a.delta > 0 ? "too optimistic" : "too pessimistic";
  return `Predicted ${a.predicted}%, deal ${outcomeWord} — ${Math.abs(a.delta)} points ${direction}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}
