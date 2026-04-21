/**
 * Proposal Streak Breaks — Slice 20af.
 *
 * 20ad emits the pairwise diff: "1 action moved, 1 new call." 20ae
 * emits the N-session consolidation: "`flip Trade in hand` — 4
 * sessions consistent." Each signal is useful in isolation, but
 * neither answers the sceptical-manager question that sits between
 * them: "of the things that moved THIS session, were any of them
 * previously consolidated calls?"
 *
 * A consolidated call breaking is a louder signal than a fresh call
 * moving. `flip Trade in hand` drifting to `strengthen` after 4
 * consistent sessions is the scorer legitimately re-thinking a
 * time-tested call — the reviewer owes it a closer look than the
 * generic "action moved" line in the pairwise diff. A consolidated
 * call vanishing entirely is the consolidated consensus itself
 * breaking.
 *
 * This module cross-references the current proposal's changes
 * (added / removed / changed — from 20ad semantics) against the
 * rolling history (20ae semantics) to surface:
 *
 *   • changed-action breaks — label was consistent in history with
 *     `previousAction`, now emits `currentAction`. `priorStreak` is
 *     the number of consecutive sessions the old (label, action)
 *     pair held, ending at the previous proposal.
 *   • removed-factor breaks — label was consistent in history with
 *     `previousAction`, now absent or keep. `currentAction` is null.
 *
 * Only entries with `priorStreak ≥ 2` are surfaced — a brand-new
 * call moving isn't a "broken streak", it's just noise. The
 * threshold mirrors 20ae's "consistent" floor so a manager reading
 * both rows sees the same "consistent or better" bar in both
 * places.
 *
 * Priority bands inherit from streak length:
 *   priorStreak ≥ 4 → "consolidated-break"  (was Lindy, now moved)
 *   priorStreak  2–3 → "consistent-break"   (was consistent, now moved)
 *
 * Aggregate counts + a headline for the UI + markdown handoff. A
 * companion `describeStreakBreaksPill` maps the aggregate to a
 * pill:
 *   ≥1 consolidated-break → rose BROKEN
 *   ≥1 consistent-break only → amber EVOLVING
 *   empty → muted (nothing to alert)
 *
 * Move-2: most CRMs don't know what the scorer said last week, let
 * alone last month. By persisting the rolling history (20ae) and
 * cross-referencing it with the pairwise diff (20ad), QEP can
 * raise a distinct tier-1 alert when a time-tested call breaks —
 * the exact event the commodity CRM silently absorbs into its daily
 * fresh recommendation. The manager sees the broken Lindy
 * explicitly so the magnitude of the re-think isn't lost.
 *
 * Pure function — no I/O. The caller owns the history source.
 */

import type { ScorerAction, ScorerProposal } from "./scorer-proposal";

/** Streak length at which a break is "consolidated" (was Lindy). */
export const CONSOLIDATED_BREAK = 4;
/** Streak length at which a break registers at all. Below this we
 *  treat the move as routine drift and leave it to the 20ad diff. */
export const BREAK_FLOOR = 2;

export type StreakBreakKind = "consolidated-break" | "consistent-break";

export interface StreakBreakEntry {
  label: string;
  /** Consecutive sessions (ending at the PREVIOUS proposal) where
   *  (label, previousAction) appeared. Always ≥ `BREAK_FLOOR`. */
  priorStreak: number;
  /** The action the label had in the historical consistent run. */
  previousAction: Exclude<ScorerAction, "keep">;
  /** The action the label has in the CURRENT proposal, or null when
   *  the factor is absent / keep (i.e. the consolidated call
   *  disappeared entirely). */
  currentAction: Exclude<ScorerAction, "keep"> | null;
  kind: StreakBreakKind;
}

export interface ProposalStreakBreakReport {
  /** Sorted priorStreak desc, then label alpha. Longest-standing
   *  breaks surface first. */
  entries: StreakBreakEntry[];
  consolidatedBreakCount: number;
  consistentBreakCount: number;
  /** One-sentence summary for the UI / markdown. Null when empty. */
  headline: string | null;
  /** True when no entries surfaced — UI hides cleanly. */
  empty: boolean;
}

/**
 * Compute streak breaks by cross-referencing the current proposal
 * against the rolling history.
 *
 * `history` is most-recent-first, NOT including the current
 * proposal. `current` is the proposal under review. A `null` current
 * or empty history yields an empty report.
 *
 * Algorithm:
 *   1. Build the current actionable map (label → action, keep rows
 *      skipped — same rule as 20ad / 20ae).
 *   2. For each label that appeared in the MOST RECENT previous
 *      proposal with a non-keep action, walk back through history
 *      counting consecutive sessions where (label, sameAction) held.
 *      Stop at the first session that breaks the streak.
 *   3. If that prior streak ≥ BREAK_FLOOR AND the current proposal
 *      no longer carries the same (label, action) pair, emit an
 *      entry — either with `currentAction` populated (action changed)
 *      or null (factor removed / demoted to keep).
 *   4. Sort, aggregate, return.
 *
 * Note on "removed that went to keep vs removed entirely": both
 * count as `currentAction=null`. The 20ad diff already distinguishes
 * those two inside the `removedFactors` list — this slice is purely
 * about "consolidated consensus broke", not about where it went.
 */
export function computeProposalStreakBreaks(
  history: readonly ScorerProposal[],
  current: ScorerProposal | null,
): ProposalStreakBreakReport {
  if (!current) return emptyReport();
  if (history.length === 0) return emptyReport();

  const prevProposal = history[0];
  if (!prevProposal) return emptyReport();

  const currActionable = actionableMap(current.changes);
  const prevActionable = actionableMap(prevProposal.changes);

  const entries: StreakBreakEntry[] = [];

  // Walk every actionable label in the PREVIOUS proposal. A break
  // is always anchored to "the thing that was consistent last time."
  // A brand-new label showing up in current has no history to break;
  // that's 20ad added-factor territory, not here.
  for (const [label, previousAction] of prevActionable.entries()) {
    // Count how far back (including the previous proposal itself)
    // the (label, previousAction) streak ran.
    let priorStreak = 1; // previous proposal counts
    for (let i = 1; i < history.length; i++) {
      const session = history[i];
      const match = session.changes.find(
        (c) => c.label === label && c.action === previousAction,
      );
      if (!match) break;
      priorStreak += 1;
    }

    if (priorStreak < BREAK_FLOOR) continue;

    // Did the call break? Either the label is missing/keep in
    // current, or its action is different from previousAction.
    const currentAction = currActionable.get(label);
    if (currentAction === previousAction) continue; // streak continues
    const kind: StreakBreakKind =
      priorStreak >= CONSOLIDATED_BREAK
        ? "consolidated-break"
        : "consistent-break";
    entries.push({
      label,
      priorStreak,
      previousAction,
      currentAction: currentAction ?? null,
      kind,
    });
  }

  // Sort: longest streak first, label alpha tie-break. Manager's eye
  // goes to the biggest broken Lindy calls first.
  entries.sort((a, b) => {
    if (a.priorStreak !== b.priorStreak) return b.priorStreak - a.priorStreak;
    return a.label.localeCompare(b.label);
  });

  const consolidatedBreakCount = entries.filter(
    (e) => e.kind === "consolidated-break",
  ).length;
  const consistentBreakCount = entries.filter(
    (e) => e.kind === "consistent-break",
  ).length;

  const headline = describeHeadline(
    consolidatedBreakCount,
    consistentBreakCount,
  );

  return {
    entries,
    consolidatedBreakCount,
    consistentBreakCount,
    headline,
    empty: entries.length === 0,
  };
}

function emptyReport(): ProposalStreakBreakReport {
  return {
    entries: [],
    consolidatedBreakCount: 0,
    consistentBreakCount: 0,
    headline: null,
    empty: true,
  };
}

function actionableMap(
  changes: ScorerProposal["changes"],
): Map<string, Exclude<ScorerAction, "keep">> {
  const out = new Map<string, Exclude<ScorerAction, "keep">>();
  for (const c of changes) {
    if (c.action !== "keep") out.set(c.label, c.action);
  }
  return out;
}

function describeHeadline(consolidated: number, consistent: number): string | null {
  if (consolidated === 0 && consistent === 0) return null;
  const parts: string[] = [];
  if (consolidated > 0) {
    parts.push(
      `${consolidated} consolidated call${consolidated === 1 ? "" : "s"} broken`,
    );
  }
  if (consistent > 0) {
    parts.push(
      `${consistent} consistent call${consistent === 1 ? "" : "s"} moved`,
    );
  }
  return `Streak breaks since last session: ${parts.join(", ")}.`;
}

/**
 * Stable pill descriptor for the UI.
 *   rose BROKEN   — ≥1 consolidated break (Lindy weight just shifted)
 *   amber EVOLVING — only consistent breaks, no consolidated ones
 *   muted "—"     — empty report
 */
export function describeStreakBreaksPill(
  report: ProposalStreakBreakReport,
): { label: string; tone: "rose" | "amber" | "muted" } {
  if (report.empty) return { label: "— no breaks", tone: "muted" };
  if (report.consolidatedBreakCount > 0) {
    return { label: "⚡ BROKEN", tone: "rose" };
  }
  return { label: "↯ EVOLVING", tone: "amber" };
}
