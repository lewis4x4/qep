/**
 * Proposal Rollback Plan — Slice 20ab.
 *
 * 20y gives the verdict (apply / review / hold / defer). 20z builds
 * the post-apply watchlist — the specific factors to monitor after
 * the change lands. 20aa quantifies which pieces of the proposal are
 * rock-solid vs. knife's-edge. 20ab is the last link in the chain:
 * the concrete PLAN to roll the proposal back when the watchlist
 * trips.
 *
 * A commodity CRM's lifecycle for a scorer change is "apply → done."
 * QEP's lifecycle is "apply → watch → (trip) → roll back." The watch
 * is meaningful only if the manager has a prepared rollback ready —
 * without it, a tripped watch devolves into "something went wrong,
 * now what?" and the system's learning is lost to reconstruction
 * effort. This module makes the rollback step concrete and printed
 * in the ticket alongside the apply step, so future-manager-30-days-
 * from-now has the inverse instruction right there.
 *
 * For each actionable change in the proposal, we emit a
 * `RollbackStep` with:
 *
 *   • `operation` — the concrete reversal instruction, citing the
 *                   specific number the proposal changed (so "revert
 *                   flip on `Trade in hand` — restore +8.0 weight
 *                   direction", not just "revert the flip").
 *   • `impact`    — a one-sentence statement of what behaviour
 *                   reverts when the step is executed.
 *   • `priority`  — inherited from the watchlist entry when one
 *                   exists (same factor, matching concern), else
 *                   derived from the action verb (flip is always
 *                   high priority to unwind because sign reversals
 *                   are the loudest change; drop is medium; strength
 *                   / weaken are low unless the watchlist has
 *                   escalated them).
 *   • `hasWatchTrigger` — true when a watchlist item exists for the
 *                         same factor. Signals "this rollback is an
 *                         on-call response, not a speculative plan."
 *
 * Pure function — no I/O. Deterministic for a given proposal +
 * watchlist.
 */

import type {
  ScorerAction,
  ScorerFactorChange,
  ScorerProposal,
} from "./scorer-proposal";
import type {
  ProposalWatchlist,
  WatchItem,
  WatchPriority,
} from "./proposal-watchlist";

export interface RollbackStep {
  label: string;
  /** The action the proposal originally picked. */
  action: Exclude<ScorerAction, "keep">;
  /** Concrete reversal instruction, references the specific numbers
   *  the proposal changed. */
  operation: string;
  /** One-sentence statement of what behaviour reverts when executed. */
  impact: string;
  /** Priority for unwinding. Inherits from watchlist entry when one
   *  exists, else derives from the action verb. */
  priority: WatchPriority;
  /** True when a matching watchlist item exists. The ticket can then
   *  say "this rollback is the on-call response to the watchlist item
   *  above" instead of "this rollback is a hypothetical." */
  hasWatchTrigger: boolean;
}

export interface ProposalRollbackPlan {
  steps: RollbackStep[];
  /** "3 rollback steps — 1 sign flip, 2 weight adjustments. All are
   *  cross-linked to the watchlist." */
  headline: string | null;
  empty: boolean;
}

/**
 * Build the rollback plan for a proposal.
 *
 * Returns `empty=true` when the proposal is null/empty or has no
 * actionable changes (nothing to roll back). Otherwise emits a step
 * per actionable change, sorted by priority (high → medium → low)
 * with stable secondary ordering by the proposal's original change
 * ordering so the plan reads deterministically.
 */
export function computeProposalRollback(
  proposal: ScorerProposal | null,
  watchlist: ProposalWatchlist | null,
): ProposalRollbackPlan {
  if (!proposal || proposal.changes.length === 0) {
    return { steps: [], headline: null, empty: true };
  }
  const actionable = proposal.changes.filter((c) => c.action !== "keep");
  if (actionable.length === 0) {
    return { steps: [], headline: null, empty: true };
  }

  const watchByLabel = new Map<string, WatchItem>();
  if (watchlist) {
    for (const item of watchlist.items) watchByLabel.set(item.label, item);
  }

  const steps: RollbackStep[] = [];
  for (const change of actionable) {
    const action = change.action as Exclude<ScorerAction, "keep">;
    const watchItem = watchByLabel.get(change.label) ?? null;
    const step = buildRollbackStep(change, action, watchItem);
    steps.push(step);
  }

  // Priority rank: high → medium → low. Stable secondary order by the
  // proposal's original change sequence so the plan reads predictably.
  const priorityRank: Record<WatchPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const withIdx = steps.map((s, i) => ({ s, i }));
  withIdx.sort((a, b) => {
    const pa = priorityRank[a.s.priority];
    const pb = priorityRank[b.s.priority];
    if (pa !== pb) return pa - pb;
    return a.i - b.i;
  });
  const sorted = withIdx.map((x) => x.s);

  return {
    steps: sorted,
    headline: describeHeadline(sorted),
    empty: false,
  };
}

function buildRollbackStep(
  change: ScorerFactorChange,
  action: Exclude<ScorerAction, "keep">,
  watchItem: WatchItem | null,
): RollbackStep {
  const priority = watchItem ? watchItem.priority : defaultPriority(action);
  const hasWatchTrigger = watchItem !== null;
  const weight = change.currentAvgWeight;
  const weightStr = formatWeight(weight);

  if (action === "flip") {
    const opposite = weight >= 0 ? "negative" : "positive";
    const current = weight >= 0 ? "positive" : "negative";
    return {
      label: change.label,
      action,
      operation: `Revert sign flip — restore the ${current} weight direction at ${weightStr}, undoing the proposal's switch to ${opposite}.`,
      impact: `Deals that re-scored under the flipped sign return to their pre-proposal ranking on this factor.`,
      priority,
      hasWatchTrigger,
    };
  }
  if (action === "drop") {
    return {
      label: change.label,
      action,
      operation: `Re-add the factor to the scorer at its pre-drop weight of ${weightStr}.`,
      impact: `The scorer resumes considering this factor; deals with it present regain the pre-drop contribution.`,
      priority,
      hasWatchTrigger,
    };
  }
  if (action === "strengthen") {
    return {
      label: change.label,
      action,
      operation: `Reduce the weight multiplier back to the pre-strengthen baseline (from the proposal's amplified value toward ${weightStr}).`,
      impact: `The factor's contribution shrinks back to the original magnitude; deals where it fires no longer get the extra push.`,
      priority,
      hasWatchTrigger,
    };
  }
  // weaken
  return {
    label: change.label,
    action,
    operation: `Restore the weight multiplier back to the pre-weaken baseline (from the proposal's damped value toward ${weightStr}).`,
    impact: `The factor's contribution returns to full magnitude; deals where it fires regain the pre-weaken weight.`,
    priority,
    hasWatchTrigger,
  };
}

/**
 * Default priority when no watchlist entry is available. Mirrors the
 * watchlist's own default rank so the two modules agree on "this
 * matters" without requiring both to be present.
 */
function defaultPriority(
  action: Exclude<ScorerAction, "keep">,
): WatchPriority {
  if (action === "flip") return "high";
  if (action === "drop") return "medium";
  return "low";
}

function describeHeadline(steps: RollbackStep[]): string {
  const n = steps.length;
  const flips = steps.filter((s) => s.action === "flip").length;
  const drops = steps.filter((s) => s.action === "drop").length;
  const weightAdj = steps.filter(
    (s) => s.action === "strengthen" || s.action === "weaken",
  ).length;
  const linked = steps.filter((s) => s.hasWatchTrigger).length;

  const parts: string[] = [];
  if (flips > 0) parts.push(`${flips} sign flip${flips === 1 ? "" : "s"}`);
  if (drops > 0) parts.push(`${drops} re-add${drops === 1 ? "" : "s"}`);
  if (weightAdj > 0) {
    parts.push(`${weightAdj} weight adjustment${weightAdj === 1 ? "" : "s"}`);
  }

  const breakdown = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
  const plural = n === 1 ? "step" : "steps";
  const linkNote =
    linked === n && n > 0
      ? ". All cross-linked to the watchlist."
      : linked > 0
        ? `. ${linked} of ${n} cross-linked to the watchlist.`
        : ".";
  return `${n} rollback ${plural}${breakdown}${linkNote}`;
}

function formatWeight(w: number): string {
  const sign = w > 0 ? "+" : "";
  return `${sign}${w.toFixed(1)}`;
}
