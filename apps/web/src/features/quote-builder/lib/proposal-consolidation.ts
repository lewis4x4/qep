/**
 * Proposal Consolidation / Lindy Streak — Slice 20ae.
 *
 * 20ad answered the pairwise time-series question: "is the proposal
 * the same as last session, or did it drift?" The natural follow-up
 * is the N-session version of the same question: "when this call
 * shows up, has it been consistent across many sessions, or is it
 * brand new?" A call that's been `flip Trade in hand` for 4 of the
 * last 4 sessions is a consolidated finding — an Lindy call, in the
 * Taleb sense: the longer it's been consistent, the more trust it
 * has earned. A call that appeared for the first time this session
 * is fresh evidence, worth looking at but not yet tempered by time.
 *
 * This module takes a rolling history of previous proposals (most
 * recent first) plus the current proposal and, for every actionable
 * change in the current proposal, computes:
 *
 *   • `streak`   — the number of consecutive sessions (ending with
 *                  the current one) where this (label, action) pair
 *                  appeared. Always ≥ 1 when the call exists in the
 *                  current proposal.
 *   • `windowSize` — how many prior sessions we had visibility into.
 *                    The streak ceiling is `windowSize + 1`.
 *   • `band`     — one of "new" (streak=1), "consistent" (2–3),
 *                  "consolidated" (≥4). Absolute cut-offs rather than
 *                  ratios because "4 consistent sessions" has the
 *                  same meaning whether the window is 5 or 10.
 *
 * Aggregated across the whole proposal:
 *
 *   • `consolidatedCount`   — number of changes at or above the
 *                             "consolidated" threshold.
 *   • `newCount`            — number of brand-new calls.
 *   • `averageStreak`       — the mean streak length across all
 *                             actionable changes. Null when the
 *                             proposal has no actionable calls.
 *   • `headline`            — one-sentence summary for the UI and
 *                             the markdown handoff.
 *
 * A companion `describeConsolidationPill` maps the aggregate to a
 * stable pill band — emerald when most calls are consolidated,
 * amber when the proposal is mostly fresh, muted when we have no
 * history yet.
 *
 * Move-2: every upstream slice tells you something about the CURRENT
 * proposal. 20ad adds a pairwise time signal. This slice adds the
 * N-session consolidation signal, so a proposal reader can answer
 * "is THIS specific call one I've seen before, and for how long?"
 * not just "did the full proposal shift since last week?". The
 * commodity CRM's "here's your fresh recommendation every day" model
 * has no concept of a call earning Lindy — QEP treats consistent
 * calls as strictly more trustworthy than transient ones, and shows
 * the streak explicitly so the manager doesn't have to remember.
 *
 * Pure function — no I/O. A caller (e.g. QuoteListPage) owns the
 * localStorage rolling buffer and passes the history in.
 */

import type { ScorerAction, ScorerProposal } from "./scorer-proposal";

/** Streak length at which a call is "consolidated" — time-tested. */
export const CONSOLIDATED_STREAK = 4;
/** Minimum streak length to be called "consistent" (2 or 3). */
export const CONSISTENT_STREAK = 2;

export type ConsolidationBand = "new" | "consistent" | "consolidated";

export interface ProposalConsolidationEntry {
  label: string;
  action: Exclude<ScorerAction, "keep">;
  /** Consecutive sessions ending at the current one where
   *  (label, action) matched. Always ≥ 1. */
  streak: number;
  /** Derived band from the streak length. */
  band: ConsolidationBand;
}

export interface ProposalConsolidationReport {
  /** Per-actionable-change streak entries, sorted consolidated →
   *  consistent → new and alphabetically within each band for
   *  deterministic output. */
  entries: ProposalConsolidationEntry[];
  /** Number of entries whose band is "consolidated". */
  consolidatedCount: number;
  /** Number of entries whose band is "new" (streak = 1). */
  newCount: number;
  /** Arithmetic mean of streak lengths, or null when no actionable
   *  changes. */
  averageStreak: number | null;
  /** How many prior proposals we had visibility into. 0 when the
   *  caller hasn't wired history yet. */
  windowSize: number;
  /** One-sentence summary for the UI / markdown handoff. Null when
   *  the proposal has no actionable changes to consolidate (all-keep
   *  or no proposal). */
  headline: string | null;
  /** True when we have no history at all OR no actionable changes.
   *  UI can use this to hide the row cleanly. */
  empty: boolean;
}

/**
 * Compute consolidation streaks for the current proposal given a
 * rolling history of previous proposals (most recent first).
 *
 * `history` should NOT include the current proposal. A history of
 * `[]` means "no prior knowledge" — every current actionable change
 * will report `streak=1` (band="new") and the report will be marked
 * `empty=true` so the UI can hide cleanly.
 */
export function computeProposalConsolidation(
  history: readonly ScorerProposal[],
  current: ScorerProposal | null,
): ProposalConsolidationReport {
  if (!current) return emptyReport(history.length);
  const actionable = current.changes.filter((c) => c.action !== "keep");
  if (actionable.length === 0) return emptyReport(history.length);

  const entries: ProposalConsolidationEntry[] = actionable.map((c) => {
    // Walk back through history, most recent first. Stop at the
    // first proposal that doesn't carry the same (label, action)
    // — that's the session before the current streak started.
    let streak = 1; // current proposal itself counts
    for (const prev of history) {
      const match = prev.changes.find(
        (p) => p.label === c.label && p.action === c.action,
      );
      if (!match) break;
      streak += 1;
    }
    return {
      label: c.label,
      action: c.action as Exclude<ScorerAction, "keep">,
      streak,
      band: bandForStreak(streak),
    };
  });

  // Deterministic sort: consolidated first (longest streak wins),
  // then consistent (longest streak wins), then new (alphabetical).
  // Ties within a band fall back to label alphabetical.
  entries.sort((a, b) => {
    const bandRank = bandSortRank(a.band) - bandSortRank(b.band);
    if (bandRank !== 0) return bandRank;
    if (a.streak !== b.streak) return b.streak - a.streak;
    return a.label.localeCompare(b.label);
  });

  const consolidatedCount = entries.filter(
    (e) => e.band === "consolidated",
  ).length;
  const newCount = entries.filter((e) => e.band === "new").length;
  const averageStreak =
    entries.length === 0
      ? null
      : entries.reduce((sum, e) => sum + e.streak, 0) / entries.length;

  const headline = describeHeadline(
    entries,
    consolidatedCount,
    newCount,
    history.length,
  );

  return {
    entries,
    consolidatedCount,
    newCount,
    averageStreak,
    windowSize: history.length,
    headline,
    empty: false,
  };
}

function emptyReport(windowSize: number): ProposalConsolidationReport {
  return {
    entries: [],
    consolidatedCount: 0,
    newCount: 0,
    averageStreak: null,
    windowSize,
    headline: null,
    empty: true,
  };
}

function bandForStreak(streak: number): ConsolidationBand {
  if (streak >= CONSOLIDATED_STREAK) return "consolidated";
  if (streak >= CONSISTENT_STREAK) return "consistent";
  return "new";
}

function bandSortRank(band: ConsolidationBand): number {
  switch (band) {
    case "consolidated":
      return 0;
    case "consistent":
      return 1;
    case "new":
      return 2;
  }
}

function describeHeadline(
  entries: ProposalConsolidationEntry[],
  consolidated: number,
  neu: number,
  windowSize: number,
): string {
  const total = entries.length;
  if (windowSize === 0) {
    // First-ever mount. Every call is technically "new" but that
    // doesn't mean it's unstable — we just don't know yet.
    return `No prior sessions to consolidate against — ${total} call${total === 1 ? "" : "s"} logged for future comparison.`;
  }
  const parts: string[] = [];
  if (consolidated > 0) {
    parts.push(
      `${consolidated} consolidated call${consolidated === 1 ? "" : "s"}`,
    );
  }
  const consistent = total - consolidated - neu;
  if (consistent > 0) {
    parts.push(`${consistent} consistent`);
  }
  if (neu > 0) {
    parts.push(`${neu} new`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : `${total} call${total === 1 ? "" : "s"}`;
  return `Across the last ${windowSize} session${windowSize === 1 ? "" : "s"}: ${summary}.`;
}

/**
 * Stable pill descriptor for the UI.
 *
 *   • emerald "CONSOLIDATED" — majority of calls are consolidated
 *     (streak ≥ 4). The proposal is a time-tested, Lindy-weighted
 *     recommendation.
 *   • sky "CONSISTENT"      — no consolidated calls yet but most
 *     are consistent (streak ≥ 2). The scorer is finding its feet.
 *   • amber "FRESH"         — majority are brand-new. Worth
 *     watching but not tempered by time yet.
 *   • muted "— no history"  — windowSize=0. No prior sessions to
 *     speak of; the pill explicitly shows absence-of-data.
 *
 * "Majority" here is strict > 50% to keep the pill unambiguous on
 * small proposals. Empty reports → muted.
 */
export function describeConsolidationPill(
  report: ProposalConsolidationReport,
): { label: string; tone: "emerald" | "sky" | "amber" | "muted" } {
  if (report.empty || report.windowSize === 0) {
    return { label: "— no history", tone: "muted" };
  }
  const total = report.entries.length;
  if (total === 0) {
    return { label: "— no history", tone: "muted" };
  }
  const consistentOrBetter = total - report.newCount;
  if (report.consolidatedCount * 2 > total) {
    return { label: "◆ CONSOLIDATED", tone: "emerald" };
  }
  if (consistentOrBetter * 2 > total) {
    return { label: "≡ CONSISTENT", tone: "sky" };
  }
  return { label: "✦ FRESH", tone: "amber" };
}
