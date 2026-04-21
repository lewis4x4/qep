/**
 * Win-Probability Scorer (Slice 20c).
 *
 * Pure, deterministic function that takes a Quote Builder draft snapshot
 * plus a small context bundle and returns a 0..100 score with an
 * attributable factor breakdown. No network calls, no DB reads — this
 * runs on every render so it must stay cheap and predictable.
 *
 * Philosophy:
 *   • Rule-based, not ML. When the counterfactual win-probability
 *     engine (Move 2) ships, this scorer becomes the rule-baseline that
 *     the ML model is evaluated against. Same inputs, same output shape
 *     — swap the implementation, keep the UI.
 *   • Transparent. Every weight has an attached reason. The UI renders
 *     the top-contributing factors so the rep can *see* why their deal
 *     looks strong or shaky, not just trust a number.
 *   • Clamped to [5, 95]. A live deal is never 0% or 100% — a rep who
 *     sees 87% will sandbag; a rep who sees 3% will give up. The clamp
 *     nudges toward productive action without false certainty.
 *
 * Feature inventory (all already on the draft after Slices 20a + 20b):
 *   • customerWarmth:         warm/cool/dormant/new
 *   • customerSignals.openDeals, pastQuoteCount, lastContactDaysAgo
 *   • tradeAllowance         (20b: commitment signal — a rep who's got
 *                             a photo-valued trade in hand has a much
 *                             more engaged customer)
 *   • equipment.length + unitPrice totals
 *   • recommendation presence (AI intake had enough signal to pick)
 *   • marginPct (supplied via context; compared to marginBaseline)
 */

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

// ── Types ────────────────────────────────────────────────────────────────

export interface WinProbabilityContext {
  /** Computed margin % for the current equipment+attachments+trade
   *  combination, or null when the rep hasn't picked equipment yet. */
  marginPct: number | null;
  /** Historical median margin % for this rep/branch, if known. The
   *  scorer compares marginPct against this baseline for the margin
   *  health factor. Null disables the factor. */
  marginBaselineMedianPct?: number | null;
}

export interface WinProbabilityFactor {
  /** Short label shown in the factors list ("Warm customer", "Trade in hand"). */
  label: string;
  /** Signed point weight applied to the score. Zero means "checked and
   *  neutral"; we still include it so the rep sees we considered it. */
  weight: number;
  /** Longer explanation shown on hover / in the expanded panel. */
  rationale: string;
  /** Category for grouping + coloring in UI. */
  kind: "relationship" | "engagement" | "commercial" | "fit";
}

export interface WinProbabilityResult {
  /** Score in [5, 95]. */
  score: number;
  /** Band for copy + color. */
  band: "strong" | "healthy" | "mixed" | "at_risk";
  /** One-sentence headline, always truthful, always actionable. */
  headline: string;
  /** All factors we considered, ordered by absolute weight descending.
   *  UI typically shows the top 3 to avoid noise. */
  factors: WinProbabilityFactor[];
  /** Raw unclamped sum, useful for debugging / attribution. */
  rawScore: number;
}

// ── Weights ──────────────────────────────────────────────────────────────

// Kept as named constants so the counterfactual engine (Move 2) can
// later import and reason about them.
export const WIN_PROB_WEIGHTS = {
  base: 40,
  warmth: {
    warm: +25,
    cool: +5,
    dormant: -10,
    new: -3,
  },
  // Past-quote relationship depth — a rep who's quoted this customer
  // many times has a tighter read on spec and budget.
  pastQuotes: {
    deep: +12,   // >= 5
    some: +5,    // 1..4
    none: -5,    // 0
  },
  // Pipeline velocity — open deals signal active buying intent.
  openDeals: {
    many: +10,   // >= 3
    some: +5,    // 1..2
    none: -5,    // 0
    // (Walk-in / no-CRM-match case keeps the `none` penalty; not
    // distinguishable from a quiet-but-real customer.)
  },
  // Recency — stale relationships close worse.
  recency: {
    hot: +12,    // <= 14 days
    warm: +5,    // 15..45
    stale: 0,    // 46..90
    cold: -8,    // > 90
  },
  // Trade commitment — 20b moonshot: if the rep has a photo-valued
  // trade in hand, the customer has materially committed. This is
  // the strongest engagement signal short of a signed quote.
  tradeCommitment: +10,
  // Equipment selected — they've narrowed to a real spec.
  equipmentSelected: +5,
  // AI recommendation present — intake had enough context to pick.
  aiRecommendation: +3,
  // Margin discipline — above-baseline margin means we're not
  // chasing the deal at the cost of P&L.
  marginAboveBaseline: +5,
  marginBelowBaseline: -8,
} as const;

// ── Main scorer ──────────────────────────────────────────────────────────

export function computeWinProbability(
  draft: Partial<QuoteWorkspaceDraft>,
  ctx: WinProbabilityContext,
): WinProbabilityResult {
  const factors: WinProbabilityFactor[] = [];
  let score = WIN_PROB_WEIGHTS.base;

  // ── Relationship: warmth ────────────────────────────────────────────
  const warmth = draft.customerWarmth ?? null;
  if (warmth) {
    const w = WIN_PROB_WEIGHTS.warmth[warmth as keyof typeof WIN_PROB_WEIGHTS.warmth] ?? 0;
    score += w;
    factors.push({
      label: `${cap(warmth)} customer`,
      weight: w,
      rationale: warmthRationale(warmth),
      kind: "relationship",
    });
  }

  // ── Relationship: past quote depth ─────────────────────────────────
  const pastCount = draft.customerSignals?.pastQuoteCount ?? null;
  if (pastCount != null) {
    const w = pastCount >= 5
      ? WIN_PROB_WEIGHTS.pastQuotes.deep
      : pastCount >= 1
        ? WIN_PROB_WEIGHTS.pastQuotes.some
        : WIN_PROB_WEIGHTS.pastQuotes.none;
    score += w;
    factors.push({
      label: pastCount === 0 ? "First quote" : `${pastCount} past quote${pastCount === 1 ? "" : "s"}`,
      weight: w,
      rationale: pastCount >= 5
        ? "Deep relationship — tight read on spec + budget."
        : pastCount >= 1
          ? "Existing relationship — some signal to work with."
          : "No prior quoting history — extra discovery needed.",
      kind: "relationship",
    });
  }

  // ── Engagement: open deals velocity ────────────────────────────────
  const openDeals = draft.customerSignals?.openDeals ?? null;
  if (openDeals != null) {
    const w = openDeals >= 3
      ? WIN_PROB_WEIGHTS.openDeals.many
      : openDeals >= 1
        ? WIN_PROB_WEIGHTS.openDeals.some
        : WIN_PROB_WEIGHTS.openDeals.none;
    score += w;
    factors.push({
      label: openDeals === 0 ? "No active pipeline" : `${openDeals} open deal${openDeals === 1 ? "" : "s"}`,
      weight: w,
      rationale: openDeals >= 3
        ? "High buying-intent signal across the account."
        : openDeals >= 1
          ? "Some in-flight demand."
          : "No active deals with this customer.",
      kind: "engagement",
    });
  }

  // ── Engagement: recency ────────────────────────────────────────────
  const recency = draft.customerSignals?.lastContactDaysAgo ?? null;
  if (recency != null) {
    const w = recency <= 14
      ? WIN_PROB_WEIGHTS.recency.hot
      : recency <= 45
        ? WIN_PROB_WEIGHTS.recency.warm
        : recency <= 90
          ? WIN_PROB_WEIGHTS.recency.stale
          : WIN_PROB_WEIGHTS.recency.cold;
    score += w;
    factors.push({
      label: recency === 0 ? "In touch today" : `Last touch ${recency}d ago`,
      weight: w,
      rationale: recency <= 14
        ? "Top-of-mind — momentum is on our side."
        : recency <= 45
          ? "Recent enough to follow up with warmth."
          : recency <= 90
            ? "Relationship is cooling; needs a nudge."
            : "Long silence — re-engagement effort required.",
      kind: "engagement",
    });
  }

  // ── Commercial: trade commitment (Slice 20b) ───────────────────────
  if ((draft.tradeAllowance ?? 0) > 0) {
    score += WIN_PROB_WEIGHTS.tradeCommitment;
    factors.push({
      label: "Trade in hand",
      weight: WIN_PROB_WEIGHTS.tradeCommitment,
      rationale: "Customer committed physical equipment to the deal — strongest short-of-signature engagement signal.",
      kind: "commercial",
    });
  }

  // ── Fit: equipment selected ────────────────────────────────────────
  if ((draft.equipment?.length ?? 0) > 0) {
    score += WIN_PROB_WEIGHTS.equipmentSelected;
    factors.push({
      label: "Equipment specced",
      weight: WIN_PROB_WEIGHTS.equipmentSelected,
      rationale: "Rep and customer have converged on a real machine.",
      kind: "fit",
    });
  }

  // ── Fit: AI recommendation present ─────────────────────────────────
  if (draft.recommendation) {
    score += WIN_PROB_WEIGHTS.aiRecommendation;
    factors.push({
      label: "AI-matched fit",
      weight: WIN_PROB_WEIGHTS.aiRecommendation,
      rationale: "AI intake had enough context to pick a recommended machine.",
      kind: "fit",
    });
  }

  // ── Commercial: margin discipline ──────────────────────────────────
  if (ctx.marginPct != null && ctx.marginBaselineMedianPct != null) {
    if (ctx.marginPct >= ctx.marginBaselineMedianPct) {
      score += WIN_PROB_WEIGHTS.marginAboveBaseline;
      factors.push({
        label: "Healthy margin",
        weight: WIN_PROB_WEIGHTS.marginAboveBaseline,
        rationale: `Margin ${ctx.marginPct.toFixed(1)}% is at or above your ${ctx.marginBaselineMedianPct.toFixed(1)}% baseline.`,
        kind: "commercial",
      });
    } else {
      score += WIN_PROB_WEIGHTS.marginBelowBaseline;
      factors.push({
        label: "Thin margin",
        weight: WIN_PROB_WEIGHTS.marginBelowBaseline,
        rationale: `Margin ${ctx.marginPct.toFixed(1)}% is below your ${ctx.marginBaselineMedianPct.toFixed(1)}% baseline — closing this at spec costs P&L.`,
        kind: "commercial",
      });
    }
  }

  // ── Clamp + band + headline ────────────────────────────────────────
  const rawScore = score;
  const clamped = Math.max(5, Math.min(95, Math.round(score)));
  const band: WinProbabilityResult["band"] =
    clamped >= 70 ? "strong"
    : clamped >= 55 ? "healthy"
    : clamped >= 35 ? "mixed"
    : "at_risk";

  // Sort factors by |weight| desc so the UI can render the most
  // important signals first.
  factors.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  return {
    score: clamped,
    band,
    headline: buildHeadline(clamped, band, factors),
    factors,
    rawScore,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function warmthRationale(warmth: string): string {
  switch (warmth) {
    case "warm":    return "Recent positive engagement on file.";
    case "cool":    return "Known customer; engagement has plateaued.";
    case "dormant": return "No recent activity — needs a re-warming.";
    case "new":     return "Fresh relationship — limited historical signal.";
    default:        return "";
  }
}

function buildHeadline(
  score: number,
  band: WinProbabilityResult["band"],
  factors: WinProbabilityFactor[],
): string {
  // Pick the single strongest positive and strongest negative factor
  // (if any) and stitch them into an actionable sentence.
  const strongestPos = factors.find((f) => f.weight > 0);
  const strongestNeg = factors.find((f) => f.weight < 0);

  if (band === "strong") {
    return strongestPos
      ? `On pace — ${strongestPos.label.toLowerCase()} is the biggest lift.`
      : "On pace — signals lean positive.";
  }
  if (band === "healthy") {
    if (strongestPos && strongestNeg) {
      return `Healthy — ${strongestPos.label.toLowerCase()} helps; ${strongestNeg.label.toLowerCase()} weighs.`;
    }
    return strongestPos
      ? `Healthy — ${strongestPos.label.toLowerCase()} leading.`
      : "Healthy — no strong counter-signals.";
  }
  if (band === "mixed") {
    return strongestNeg
      ? `Mixed — ${strongestNeg.label.toLowerCase()} is the biggest drag.`
      : "Mixed — signals are light either way. Add more detail to sharpen.";
  }
  return strongestNeg
    ? `At risk — ${strongestNeg.label.toLowerCase()} is dragging the deal.`
    : "At risk — not enough positive signal to carry the quote yet.";
}

// ── Counterfactual lifts (Slice 20d) ─────────────────────────────────────
//
// Given the same draft + context, simulate a handful of rep-actionable
// tweaks and return the ones that would measurably lift the score.
// This turns the strip from diagnostic ("here's your score") into
// prescriptive ("here's the single highest-impact thing to do").
//
// Philosophy:
//   • Only surface lifts the rep can actually *act on*. "Be warmer" is
//     not actionable — "capture their trade today" is.
//   • Use the same scorer for the simulation so the delta is mechanical
//     and auditable. No magic numbers here; every lift comes from
//     toggling a draft field and re-running the pure function.
//   • When the ML counterfactual engine (Move 2) ships, this function
//     doesn't need to change — we just point it at the new scorer.
//   • Skip lifts whose state already applies (don't nag the rep to
//     "capture a trade" if `tradeAllowance > 0`).

export type WinProbabilityLiftId =
  | "capture_trade"
  | "select_equipment"
  | "ai_recommendation"
  | "reconnect_customer"
  | "raise_margin";

export interface WinProbabilityLift {
  id: WinProbabilityLiftId;
  /** Imperative action verb + noun ("Capture their trade"). */
  label: string;
  /** Expected positive point lift (>0). */
  deltaPts: number;
  /** Short explanation the rep sees on hover. */
  rationale: string;
  /** One-line next action the rep can take right now. */
  actionHint: string;
}

/** Maximum lifts returned (keep UI uncluttered). */
export const MAX_LIFTS = 3;

/** Lifts below this delta are dropped as noise. */
export const MIN_LIFT_DELTA = 3;

export function computeWinProbabilityLifts(
  draft: Partial<QuoteWorkspaceDraft>,
  ctx: WinProbabilityContext,
): WinProbabilityLift[] {
  // Use `rawScore` for delta arithmetic — if we used the clamped score
  // a base already near the 95 ceiling would silently truncate big
  // real lifts (sim 105 clamped to 95 → delta 0, even though the lift
  // is genuinely +10). The rep sees the clamped number, but the
  // delta chip should show the mechanical effect of the action.
  const base = computeWinProbability(draft, ctx).rawScore;

  // Each candidate is a `(description, mutated draft|ctx)` pair. We run
  // the scorer against the mutation and keep the positive-delta ones.
  const candidates: Array<{
    id: WinProbabilityLiftId;
    label: string;
    rationale: string;
    actionHint: string;
    /** Returns true if the lift is already satisfied and should be skipped. */
    skipIf: () => boolean;
    simulate: () => { draft: Partial<QuoteWorkspaceDraft>; ctx: WinProbabilityContext };
  }> = [
    {
      id: "capture_trade",
      label: "Capture their trade",
      rationale: "Customers who commit a trade close at materially higher rates — a photo-valued trade is the strongest short-of-signature engagement signal.",
      actionHint: "Use Point, Shoot, Trade on the Customer step to capture a photo-valued trade.",
      skipIf: () => (draft.tradeAllowance ?? 0) > 0,
      simulate: () => ({ draft: { ...draft, tradeAllowance: 1 }, ctx }),
    },
    {
      id: "select_equipment",
      label: "Pick a machine",
      rationale: "Quotes with a specific spec convert better than price-anchoring conversations — the customer commits to a real configuration.",
      actionHint: "Move to the Equipment step and select the model you've been discussing.",
      skipIf: () => (draft.equipment?.length ?? 0) > 0,
      simulate: () => ({
        draft: { ...draft, equipment: [{ kind: "equipment", title: "Simulated", quantity: 1, unitPrice: 0 }] },
        ctx,
      }),
    },
    {
      id: "ai_recommendation",
      label: "Run AI Match",
      rationale: "When AI intake has enough job context to recommend a specific machine, close rates lift.",
      actionHint: "Go back to intake and describe the job; the recommender needs site + attachment notes.",
      skipIf: () => !!draft.recommendation,
      simulate: () => ({
        draft: { ...draft, recommendation: { machine: "sim", attachments: [], reasoning: "sim" } },
        ctx,
      }),
    },
    {
      id: "reconnect_customer",
      label: "Reconnect this week",
      rationale: "Stale relationships close worse. A fresh touch pulls recency back into 'warm', which lifts the score.",
      actionHint: "Call or email — even a short check-in resets the recency clock.",
      // Only relevant if we HAVE a recency signal and it's 46+ days stale.
      skipIf: () => {
        const r = draft.customerSignals?.lastContactDaysAgo;
        return r == null || r <= 45;
      },
      simulate: () => ({
        draft: {
          ...draft,
          customerSignals: draft.customerSignals
            ? { ...draft.customerSignals, lastContactDaysAgo: 7 }
            : draft.customerSignals,
        },
        ctx,
      }),
    },
    {
      id: "raise_margin",
      label: "Hold the margin line",
      rationale: "Closing at spec shouldn't cost P&L. Bringing margin back to your baseline flips this factor from drag to lift.",
      actionHint: "Trim discretionary discounts or revisit attachment mix before sending.",
      // Only relevant when we have a baseline AND current margin is below it.
      skipIf: () => {
        if (ctx.marginPct == null || ctx.marginBaselineMedianPct == null) return true;
        return ctx.marginPct >= ctx.marginBaselineMedianPct;
      },
      simulate: () => ({
        draft,
        ctx: { ...ctx, marginPct: ctx.marginBaselineMedianPct ?? ctx.marginPct },
      }),
    },
  ];

  const lifts: WinProbabilityLift[] = [];
  for (const c of candidates) {
    if (c.skipIf()) continue;
    const sim = c.simulate();
    const simRaw = computeWinProbability(sim.draft, sim.ctx).rawScore;
    const delta = Math.round(simRaw - base);
    if (delta < MIN_LIFT_DELTA) continue;
    lifts.push({
      id: c.id,
      label: c.label,
      deltaPts: delta,
      rationale: c.rationale,
      actionHint: c.actionHint,
    });
  }

  lifts.sort((a, b) => b.deltaPts - a.deltaPts);
  return lifts.slice(0, MAX_LIFTS);
}
