/**
 * Proposal Watchlist — Slice 20z.
 *
 * Every slice from 20m through 20y has been about the DECISION: what
 * to change, how sure we are, whether to apply. 20z is about what
 * happens AFTER the decision lands.
 *
 * A manager who applies a proposal is committing to a scoring rule
 * change on a book of business. The rule change will either hold up
 * ("hit rate stays above 0.65 for the next month — nice"), erode
 * ("hit rate slips back down as the mix shifts"), or prove to have
 * been wrong ("the flip was against the mean-reversion — we're losing
 * the deals we used to win"). The only honest way to know which one
 * is to pick a small set of specific checks, set a specific trigger
 * for each, and come back.
 *
 * This module emits that watchlist. For each actionable factor in the
 * proposal, it produces:
 *
 *   • `concern`  — the specific reason this factor warrants monitoring
 *                  (sign reversal, thin sample, big drift, oversized
 *                  current weight, etc).
 *   • `trigger`  — a concrete sentence the manager can use as a mental
 *                  rule: "If hit-rate-when-present drops below 0.50
 *                  over the next 15 closed deals, revisit this flip."
 *   • `priority` — high/medium/low so the UI can rank. Sign reversals
 *                  (flip) rank highest because they're the biggest
 *                  change to the scorer's behavior; drop is medium;
 *                  strengthen/weaken are low unless the sample is
 *                  thin or the drift is large.
 *
 * We do NOT emit an entry for every factor the proposal touches — the
 * `keep` entries are explicitly not watched (they're the baseline),
 * and low-priority `strengthen`/`weaken` with healthy samples and
 * stable drift also drop out. A watchlist of 12 factors is noise; a
 * watchlist of 2-4 specific factors is evidence.
 *
 * Move-2 relevance: commodity CRMs either fire-and-forget a rule
 * change ("model retrained — done") or bury the monitoring in a
 * dashboard nobody checks. QEP turns the monitoring into specific
 * per-factor triggers, so the manager can come back in 30 days and
 * check exactly the things they said they'd check, not reconstruct
 * the concern from scratch. The watchlist is the memory layer for
 * the counterfactual loop.
 *
 * Pure function — no I/O.
 */

import type {
  ScorerAction,
  ScorerFactorChange,
  ScorerProposal,
} from "./scorer-proposal";
import type { FactorDriftReport } from "./factor-drift";

/**
 * Minimum observations-when-present before we trust a factor as
 * having a "substantial" sample. Below this, any action on the factor
 * is flagged as "thin — watch closely."
 */
export const SUBSTANTIAL_PRESENCE = 15;

/**
 * Lift magnitude above which we consider a factor's measured effect
 * "large" — worth flagging as such in the concern copy.
 */
export const LARGE_LIFT = 0.25;

/**
 * Drift magnitude (absolute) above which we flag the factor as
 * "volatile" in its drift history, which matters most for `flip`
 * actions because a volatile factor is one we might have to flip
 * back a quarter from now.
 */
export const VOLATILE_DRIFT = 0.2;

export type WatchPriority = "high" | "medium" | "low";

export interface WatchItem {
  label: string;
  action: Exclude<ScorerAction, "keep">;
  /** Why this factor needs monitoring. One sentence. */
  concern: string;
  /** What would make us reconsider. Concrete and testable. */
  trigger: string;
  priority: WatchPriority;
}

export interface ProposalWatchlist {
  items: WatchItem[];
  /** One-sentence summary ("3 factors to monitor closely after
   *  applying") or null when watchlist is empty. */
  headline: string | null;
  /** True when the proposal itself is empty or all-keep. Distinct
   *  from "no items to watch" (e.g. proposal has 5 changes but all
   *  are stable, healthy samples). */
  empty: boolean;
}

/**
 * Build the per-factor watchlist.
 *
 * Returns `empty=true` when there's no proposal or no actionable
 * changes to monitor. Otherwise, items are ordered by priority
 * (high → medium → low) with a stable secondary ordering by the
 * proposal's original change ordering so the watchlist reads
 * deterministically.
 */
export function computeProposalWatchlist(
  proposal: ScorerProposal | null,
  factorDrift: FactorDriftReport | null,
): ProposalWatchlist {
  if (!proposal || proposal.changes.length === 0) {
    return { items: [], headline: null, empty: true };
  }

  const actionable = proposal.changes.filter((c) => c.action !== "keep");
  if (actionable.length === 0) {
    return { items: [], headline: null, empty: true };
  }

  const driftByLabel = new Map<string, number>();
  if (factorDrift) {
    for (const d of factorDrift.drifts) {
      if (d.drift !== null) driftByLabel.set(d.label, d.drift);
    }
  }

  const items: WatchItem[] = [];

  for (const change of actionable) {
    // Narrow: we already filtered out `keep`.
    const action = change.action as Exclude<ScorerAction, "keep">;
    const drift = driftByLabel.get(change.label) ?? null;
    const thinPresence = change.present < SUBSTANTIAL_PRESENCE;
    const volatileDrift = drift !== null && Math.abs(drift) >= VOLATILE_DRIFT;

    const item = watchItemForChange(change, action, {
      drift,
      thinPresence,
      volatileDrift,
    });
    if (item) items.push(item);
  }

  // Rank: high first, then medium, then low. Stable insertion order
  // within each band.
  const priorityRank: Record<WatchPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const withIdx = items.map((it, i) => ({ it, i }));
  withIdx.sort((a, b) => {
    const pa = priorityRank[a.it.priority];
    const pb = priorityRank[b.it.priority];
    if (pa !== pb) return pa - pb;
    return a.i - b.i;
  });
  const ranked = withIdx.map((x) => x.it);

  if (ranked.length === 0) {
    return { items: [], headline: null, empty: false };
  }

  return {
    items: ranked,
    headline: describeHeadline(ranked),
    empty: false,
  };
}

interface WatchContext {
  drift: number | null;
  thinPresence: boolean;
  volatileDrift: boolean;
}

function watchItemForChange(
  change: ScorerFactorChange,
  action: Exclude<ScorerAction, "keep">,
  ctx: WatchContext,
): WatchItem | null {
  if (action === "flip") {
    // Flips always watch — sign reversal is the biggest behavior
    // change possible.
    const priority: WatchPriority = "high";
    const concernParts: string[] = [
      "Proposal flipped the sign of this factor — a sign reversal is the largest behavior change the scorer can make.",
    ];
    if (ctx.volatileDrift) {
      concernParts.push(
        `Drift is volatile (${formatPp(ctx.drift)}) — a factor that swings this much could swing back.`,
      );
    }
    if (ctx.thinPresence) {
      concernParts.push(
        `Presence sample is thin (${change.present} observations) — the flip decision rests on limited evidence.`,
      );
    }
    return {
      label: change.label,
      action,
      concern: concernParts.join(" "),
      trigger: `If hit-rate-when-present drifts back within ±5pp of hit-rate-when-absent over the next ${change.present >= 20 ? 20 : 15} closed deals, reconsider — the flip may be chasing noise.`,
      priority,
    };
  }

  if (action === "drop") {
    // Dropping a factor means the scorer loses a signal. If the lift
    // is near zero (noise removal) we watch medium; if the lift is
    // moderate-negative (actively anti-predictive) we still watch
    // medium because there's a theory that we should recover rather
    // than drop.
    const priority: WatchPriority = "medium";
    const concernParts: string[] = [
      "Proposal drops this factor from the scorer — after applying, the scorer will no longer consider it at all.",
    ];
    if (ctx.thinPresence) {
      concernParts.push(
        `Sample is thin (${change.present} observations) — the "noise" verdict may not hold once more deals accumulate.`,
      );
    }
    if (ctx.drift !== null && Math.abs(ctx.drift) >= LARGE_LIFT) {
      concernParts.push(
        `Drift is large (${formatPp(ctx.drift)}) — a dropped factor that's still moving could re-emerge as meaningful.`,
      );
    }
    return {
      label: change.label,
      action,
      concern: concernParts.join(" "),
      trigger: `If |lift| rises above ±10pp over the next 20 closed deals, reconsider — the signal may have come back.`,
      priority,
    };
  }

  if (action === "strengthen" || action === "weaken") {
    // Only watch if there's a reason: thin sample, volatile drift, or
    // large lift (strengthen-specific). Otherwise drop out of the
    // watchlist — these are routine tuning calls.
    if (!ctx.thinPresence && !ctx.volatileDrift) {
      // Stable, substantial — no reason to add the noise of a watch.
      return null;
    }
    const priority: WatchPriority = ctx.thinPresence ? "medium" : "low";
    const concernParts: string[] = [];
    if (action === "strengthen") {
      concernParts.push(
        "Proposal strengthens this factor — weight multiplier goes up, so any measurement error amplifies with it.",
      );
    } else {
      concernParts.push(
        "Proposal weakens this factor — the signal survives but at reduced magnitude, so its contribution is smaller than before.",
      );
    }
    if (ctx.thinPresence) {
      concernParts.push(
        `Presence sample is thin (${change.present} observations) — the magnitude tuning rests on a limited base.`,
      );
    }
    if (ctx.volatileDrift) {
      concernParts.push(
        `Drift is volatile (${formatPp(ctx.drift)}) — the factor's behavior is still moving.`,
      );
    }
    return {
      label: change.label,
      action,
      concern: concernParts.join(" "),
      trigger:
        action === "strengthen"
          ? `If hit-rate-when-present slips by more than 5pp over the next 20 closed deals, back off the strengthening — the amplified weight is over-claiming.`
          : `If hit-rate-when-present recovers above its pre-weakening baseline over the next 20 closed deals, revisit — the weakening may be over-corrected.`,
      priority,
    };
  }

  // `keep` was filtered upstream. Safety net.
  return null;
}

function describeHeadline(items: WatchItem[]): string {
  const n = items.length;
  const high = items.filter((it) => it.priority === "high").length;
  if (n === 1) return `1 factor to monitor closely after applying.`;
  if (high > 0) {
    return `${n} factors to monitor after applying — ${high} high-priority (sign reversals).`;
  }
  return `${n} factors to monitor after applying.`;
}

/** Format a fractional drift delta as `+Npp` / `-Npp`. Null → `—`. */
function formatPp(delta: number | null): string {
  if (delta === null) return "—";
  const pp = Math.round(delta * 100);
  return `${pp > 0 ? "+" : ""}${pp}pp`;
}
