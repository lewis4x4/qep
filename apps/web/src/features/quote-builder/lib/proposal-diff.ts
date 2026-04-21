/**
 * Proposal Diff — Slice 20ad.
 *
 * 20m–20ac built the decision-support layer: what to change, how sure
 * we are, whether to apply, what to monitor, how to unwind. Every one
 * of those is a CROSS-SECTIONAL view — "here's the current proposal
 * and the evidence behind it, right now."
 *
 * What a sceptical manager still can't answer is the TIME-SERIES
 * question: "Is the scorer settling down, or is it thrashing?" A
 * proposal that says "flip `Trade in hand`" two weeks in a row is a
 * stable finding earning trust; one that oscillates
 * flip → strengthen → flip is a noisy signal the manager should not
 * act on with the same confidence.
 *
 * This module diffs the current proposal against the previous one and
 * emits:
 *
 *   • `addedFactors`    — labels in the current proposal that were not
 *                         actionable in the previous one. "New call."
 *   • `removedFactors`  — labels that were actionable last time but
 *                         fell off this time. "Scorer no longer cares."
 *   • `changedActions`  — labels present in both, where the action verb
 *                         moved (e.g. flip → strengthen, drop → keep).
 *                         The `from → to` arrow tells the manager which
 *                         way the scorer's opinion is drifting.
 *   • `unchangedCount`  — labels that kept the same action. The size of
 *                         this number relative to the rest tells the
 *                         stability story.
 *
 * A compact `headline` composes these into a human sentence:
 *
 *   "Proposal stable since last session — 3 unchanged calls."
 *   "Since last session: 1 new call (`Trade in hand`), 2 actions moved
 *    (`Edge`: flip → strengthen; `Age` drop → keep)."
 *
 * Move-2: commodity CRMs give the manager a fresh proposal every day
 * with no memory of what they said yesterday. QEP treats the proposal
 * as a time series — every invocation is compared to the last one so
 * the manager can separate "consistent finding" from "knee-jerk
 * reaction to one outlier week." The honesty tax that every upstream
 * slice pays in the cross-section now pays again in the time series.
 *
 * Pure function — no I/O. A future companion slice can wire the
 * previous-proposal source (localStorage, server-side history,
 * whatever), but this file knows nothing about persistence.
 */

import type {
  ScorerAction,
  ScorerFactorChange,
  ScorerProposal,
} from "./scorer-proposal";

/**
 * A single action-change entry. `previousAction` and `currentAction`
 * are both non-null and both non-keep (we don't emit diff rows for
 * factors that stayed as keep — the UI cares about actionable drift,
 * not the invisible majority).
 */
export interface ProposalActionChange {
  label: string;
  previousAction: Exclude<ScorerAction, "keep">;
  currentAction: Exclude<ScorerAction, "keep">;
}

export interface ProposalDiff {
  /** Labels actionable now but weren't in the previous proposal. */
  addedFactors: string[];
  /** Labels actionable in the previous proposal but dropped from this one. */
  removedFactors: string[];
  /** Labels actionable in both but with a different verb. */
  changedActions: ProposalActionChange[];
  /** Labels actionable in both with the same verb. "Stable calls." */
  unchangedCount: number;
  /** One-sentence summary for the UI + markdown. Null on empty. */
  headline: string | null;
  /** True when there's no previous proposal OR the proposals are
   *  content-identical (every actionable row is unchanged AND neither
   *  side has a factor the other is missing). */
  empty: boolean;
}

/**
 * Compute the diff between the previous proposal and the current one.
 *
 * Returns `empty=true` when the previous proposal is null (first-time
 * invocation — nothing to compare against), or when the two proposals
 * are content-equivalent on the actionable axis (no added, no removed,
 * no changed).
 */
export function computeProposalDiff(
  previous: ScorerProposal | null,
  current: ScorerProposal | null,
): ProposalDiff {
  if (!current) return emptyDiff();
  if (!previous) return emptyDiff();

  // Build action maps — only factors with a non-keep action matter for
  // the diff. A factor flipping from non-actionable to actionable (keep
  // → something) counts as ADDED; an actionable factor dropping to keep
  // (or being omitted entirely) counts as REMOVED.
  const prev = actionableMap(previous.changes);
  const curr = actionableMap(current.changes);

  const addedFactors: string[] = [];
  const removedFactors: string[] = [];
  const changedActions: ProposalActionChange[] = [];
  let unchangedCount = 0;

  for (const [label, currentAction] of curr.entries()) {
    const previousAction = prev.get(label);
    if (previousAction === undefined) {
      addedFactors.push(label);
    } else if (previousAction !== currentAction) {
      changedActions.push({ label, previousAction, currentAction });
    } else {
      unchangedCount += 1;
    }
  }
  for (const [label] of prev.entries()) {
    if (!curr.has(label)) {
      removedFactors.push(label);
    }
  }

  // Sort everything for a deterministic UI / markdown output.
  addedFactors.sort();
  removedFactors.sort();
  changedActions.sort((a, b) => a.label.localeCompare(b.label));

  const empty =
    addedFactors.length === 0 &&
    removedFactors.length === 0 &&
    changedActions.length === 0;

  if (empty) {
    // Content-identical. The caller can still choose to render a
    // "Proposal stable — N unchanged calls" surface by checking
    // unchangedCount, but the diff itself is empty.
    return {
      addedFactors: [],
      removedFactors: [],
      changedActions: [],
      unchangedCount,
      headline:
        unchangedCount > 0
          ? `Proposal stable since last session — ${unchangedCount} unchanged call${unchangedCount === 1 ? "" : "s"}.`
          : null,
      empty: true,
    };
  }

  const headline = describeHeadline(
    addedFactors,
    removedFactors,
    changedActions,
    unchangedCount,
  );

  return {
    addedFactors,
    removedFactors,
    changedActions,
    unchangedCount,
    headline,
    empty: false,
  };
}

function emptyDiff(): ProposalDiff {
  return {
    addedFactors: [],
    removedFactors: [],
    changedActions: [],
    unchangedCount: 0,
    headline: null,
    empty: true,
  };
}

/**
 * Turn a ScorerFactorChange list into a label → action map, skipping
 * keep rows. We want the diff to reflect actionable drift only.
 */
function actionableMap(
  changes: ScorerFactorChange[],
): Map<string, Exclude<ScorerAction, "keep">> {
  const out = new Map<string, Exclude<ScorerAction, "keep">>();
  for (const c of changes) {
    if (c.action !== "keep") {
      out.set(c.label, c.action);
    }
  }
  return out;
}

function describeHeadline(
  added: string[],
  removed: string[],
  changed: ProposalActionChange[],
  unchanged: number,
): string {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(
      `${added.length} new call${added.length === 1 ? "" : "s"}`,
    );
  }
  if (removed.length > 0) {
    parts.push(
      `${removed.length} dropped`,
    );
  }
  if (changed.length > 0) {
    parts.push(
      `${changed.length} action${changed.length === 1 ? "" : "s"} moved`,
    );
  }
  const stabilityNote =
    unchanged > 0
      ? ` · ${unchanged} unchanged call${unchanged === 1 ? "" : "s"}`
      : "";
  return `Since last session: ${parts.join(", ")}${stabilityNote}.`;
}

/**
 * Stable pill descriptor for the UI. Tone reflects the "is the scorer
 * thrashing?" question: zero drift → emerald (stable), small drift →
 * amber (evolving), large drift → rose (thrashing).
 *
 * The band is derived from (added + removed + changed) relative to
 * total actionable calls. We intentionally use absolute cut-offs
 * rather than a ratio because "2 changes" is noisy whether the total
 * is 3 or 8 — any re-think of two or more actionable calls is worth
 * the reviewer's attention.
 */
export function describeProposalDiffPill(
  diff: ProposalDiff,
): { label: string; tone: "emerald" | "amber" | "rose" | "muted" } {
  if (diff.empty) {
    if (diff.unchangedCount > 0) {
      return { label: "◆ STABLE", tone: "emerald" };
    }
    return { label: "— no prior", tone: "muted" };
  }
  const drift =
    diff.addedFactors.length +
    diff.removedFactors.length +
    diff.changedActions.length;
  if (drift >= 3) return { label: "↯ THRASHING", tone: "rose" };
  if (drift >= 1) return { label: "↻ EVOLVING", tone: "amber" };
  return { label: "◆ STABLE", tone: "emerald" };
}
