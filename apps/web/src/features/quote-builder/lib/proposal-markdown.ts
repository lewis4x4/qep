/**
 * Proposal Markdown with Context — Slice 20u.
 *
 * 20m's `renderScorerProposalMarkdown` emits a clean, structured ticket
 * from the proposal alone. 20r/20s/20t added the calibration-drift,
 * factor-drift, and urgency context that drives when the manager
 * should actually care. This slice closes the loop: when the manager
 * hits "Copy as Markdown", the pasted ticket now carries every receipt
 * that justified the recommendation, not just the proposal body.
 *
 * A reviewer reading the ticket should be able to answer:
 *   • Why now? (urgency rationale from 20t)
 *   • What moved? (calibration + factor drift from 20s / 20r)
 *   • What to change? (proposal body from 20m)
 *   • Would it help? (what-if preview, slotted when available)
 *
 * All without opening QEP. That's the Move-2 bar for the markdown:
 * self-contained evidence chain.
 *
 * Pure functions — the UI's clipboard handler calls this with whatever
 * context it has in hand, and unavailable slices fall out cleanly.
 */

import {
  renderScorerProposalMarkdown,
  type ScorerProposal,
} from "./scorer-proposal";
import type { CalibrationDriftReport } from "./calibration-drift";
import type { FactorDriftReport } from "./factor-drift";
import type { ProposalUrgencyResult } from "./proposal-urgency";
import type { ScorerWhatIfResult } from "./scorer-what-if";
import type { ProposalConfidenceResult } from "./proposal-confidence";
import { describeProposalConfidencePill } from "./proposal-confidence";
import type { ProposalCallFlipReport } from "./proposal-call-flips";
import {
  describeCallFlipsHeadline,
  formatFlipRow,
} from "./proposal-call-flips";
import type { ProposalApplyVerdict } from "./proposal-apply-verdict";
import { describeProposalVerdictPill } from "./proposal-apply-verdict";
import type { ProposalWatchlist } from "./proposal-watchlist";
import type { ProposalStabilityReport } from "./proposal-stability";
import { describeStabilityPill } from "./proposal-stability";
import type { ProposalRollbackPlan } from "./proposal-rollback";

export interface ProposalMarkdownContext {
  /** 20s — scorer-wide calibration trend. Null when unavailable. */
  calibrationDrift: CalibrationDriftReport | null;
  /** 20r — per-factor drift. Null or empty `drifts` when no findings. */
  factorDrift: FactorDriftReport | null;
  /** 20t — urgency + rationale. Medium/null-rationale is the silent default. */
  urgency: ProposalUrgencyResult | null;
  /** 20p — what-if Brier + hit-rate deltas. Null when no audit sample. */
  whatIf: ScorerWhatIfResult | null;
  /** 20v — meta-confidence score + per-driver rationale. Null when we
   *  can't compose signals yet (no proposal, no audits). */
  confidence: ProposalConfidenceResult | null;
  /** 20w — per-deal call-flip evidence. Null when no what-if to derive
   *  flips from, or when the proposal is all-keep. */
  callFlips: ProposalCallFlipReport | null;
  /** 20y — composed apply/review/hold/defer recommendation + ranked
   *  reasons. Null when the caller didn't compute one (UI that wants
   *  the receipts without the verdict). */
  verdict: ProposalApplyVerdict | null;
  /** 20z — per-factor watchlist for post-apply monitoring. Null when
   *  the caller didn't compute one; empty (`items: []`) is also
   *  handled — section is omitted cleanly when no factors warrant
   *  monitoring (e.g. an all-healthy strengthen proposal). */
  watchlist: ProposalWatchlist | null;
  /** 20aa — per-change sensitivity report: which actionable changes
   *  hold up under small perturbations of the measured lift and sample
   *  size, and which are knife's-edge calls. Null when caller doesn't
   *  compute; `empty=true` report is handled — section is omitted
   *  cleanly when the proposal has no actionable changes. */
  stability: ProposalStabilityReport | null;
  /** 20ab — the concrete rollback plan. Per-actionable-change reversal
   *  operation with priority inherited from the watchlist when
   *  cross-linked. Rendered after the watchlist so the reader sees
   *  "what to watch" followed by "how to unwind when a watch trips."
   *  Null when caller didn't compute; empty-plan is handled. */
  rollback: ProposalRollbackPlan | null;
}

/**
 * Compose the context header. Returns an empty string when every
 * section is silent — the output should be copy-paste clean, not a
 * sea of "n/a" placeholders.
 */
function renderContextSection(ctx: ProposalMarkdownContext): string {
  const lines: string[] = [];

  // Verdict (20y) — pinned above everything else so a skimmer reads
  // the recommendation FIRST and the receipts below it. The verdict
  // line is "✓ APPLY — confidence 82/100, 3 corroborating flips…"
  // plus a bulleted reasons list with polarity icons so a reviewer
  // can sanity-check the verdict against the evidence in one glance.
  // `defer` with no reasons is elided — there's nothing to say beyond
  // the headline and the proposal body speaks for itself.
  if (ctx.verdict) {
    const pill = describeProposalVerdictPill(ctx.verdict.verdict);
    lines.push(`**Verdict**: ${pill} — ${ctx.verdict.headline}`);
    if (ctx.verdict.reasons.length > 0) {
      for (const r of ctx.verdict.reasons) {
        const icon =
          r.polarity === "positive" ? "✓" : r.polarity === "negative" ? "⚠" : "·";
        lines.push(`  - ${icon} ${r.rationale}`);
      }
    }
  }

  // Urgency headline — one line only. We intentionally pin it above
  // the drift numbers so a skimmer reads "why" before "what".
  if (ctx.urgency) {
    const pill =
      ctx.urgency.urgency === "high"
        ? "🔴 HIGH PRIORITY"
        : ctx.urgency.urgency === "low"
          ? "🟢 LOW URGENCY"
          : "🟡 STANDARD";
    if (ctx.urgency.rationale) {
      lines.push(`**Urgency**: ${pill} — ${ctx.urgency.rationale}`);
    } else if (ctx.urgency.urgency !== "medium") {
      // Non-medium urgency without a rationale is an edge case; still
      // surface the pill so the reviewer isn't blindsided.
      lines.push(`**Urgency**: ${pill}`);
    }
    // medium + null rationale → silent, the default.
  }

  // Calibration drift — scorer-wide trend.
  if (ctx.calibrationDrift) {
    const d = ctx.calibrationDrift;
    if (d.recentN > 0 || d.priorN > 0) {
      const accDelta = formatPp(d.accuracyDelta);
      const brierDelta = formatBrierDelta(d.brierDelta);
      const trust = d.lowConfidence ? " _(directional only — thin sample)_" : "";
      lines.push(
        `**Calibration drift** (${d.windowDays}d): ${d.direction} · hit rate ${accDelta}, Brier ${brierDelta} · ${d.recentN} recent vs ${d.priorN} prior deals${trust}`,
      );
    }
  }

  // Factor drift — list the top drifting factors so the reviewer has
  // the specific rules that moved, not just the aggregate.
  if (ctx.factorDrift && ctx.factorDrift.drifts.length > 0) {
    const top = ctx.factorDrift.drifts.slice(0, 3);
    const bullets = top.map((f) => {
      const delta = f.drift === null ? "—" : `${f.drift > 0 ? "+" : ""}${Math.round(f.drift * 100)}pp`;
      const thin = f.lowConfidence ? " _(thin sample)_" : "";
      return `  - \`${f.label}\` · ${f.direction} · ${delta}${thin}`;
    });
    lines.push(`**Factor drift** (top ${top.length}):`);
    lines.push(...bullets);
    if (ctx.factorDrift.drifts.length > top.length) {
      lines.push(
        `  - _+${ctx.factorDrift.drifts.length - top.length} more drifting factor${ctx.factorDrift.drifts.length - top.length === 1 ? "" : "s"} not shown_`,
      );
    }
  }

  // What-if preview — whether applying the proposal would help.
  if (ctx.whatIf && !ctx.whatIf.noActionableChanges && ctx.whatIf.currentBrier !== null && ctx.whatIf.simulatedBrier !== null) {
    const brierCur = ctx.whatIf.currentBrier.toFixed(3);
    const brierSim = ctx.whatIf.simulatedBrier.toFixed(3);
    const hitCur =
      ctx.whatIf.currentHitRate === null ? "—" : `${Math.round(ctx.whatIf.currentHitRate * 100)}%`;
    const hitSim =
      ctx.whatIf.simulatedHitRate === null ? "—" : `${Math.round(ctx.whatIf.simulatedHitRate * 100)}%`;
    const thin = ctx.whatIf.lowConfidence ? " _(thin sample)_" : "";
    lines.push(
      `**What-if preview** (${ctx.whatIf.dealsSimulated} deals): Brier ${brierCur} → ${brierSim}, hit rate ${hitCur} → ${hitSim}${thin}`,
    );
  }

  // Call flips (20w) — the concrete per-deal evidence. Sits below the
  // what-if aggregate because that's the reading order: "here's the
  // average, and here are the specific deals." The headline speaks for
  // itself; we add the ranked buckets below only when they're non-empty.
  if (ctx.callFlips && !ctx.callFlips.empty && !ctx.callFlips.noActionableChanges) {
    const flipHeadline = describeCallFlipsHeadline(ctx.callFlips);
    if (flipHeadline) {
      lines.push(`**Call flips**: ${flipHeadline}`);
      if (ctx.callFlips.corroborating.length > 0) {
        lines.push(`  - ✅ Corroborating (proposal calls outcome right):`);
        for (const flip of ctx.callFlips.corroborating) {
          lines.push(`    - \`${flip.packageId}\` · ${formatFlipRow(flip)}`);
        }
      }
      if (ctx.callFlips.regressing.length > 0) {
        lines.push(`  - ⚠️ Regressing (proposal would call outcome wrong):`);
        for (const flip of ctx.callFlips.regressing) {
          lines.push(`    - \`${flip.packageId}\` · ${formatFlipRow(flip)}`);
        }
      }
    }
  }

  // Confidence (20v) — surfaces last so the reader has already seen the
  // raw signals (drift, what-if, flips) and the confidence block reads
  // as the meta-verdict rather than an unexplained assertion. Drivers
  // come inline as a bulleted list; bails out if no drivers present
  // (e.g. base-50 no-signal prior with "Neutral prior" rationale).
  if (ctx.confidence) {
    const pill = describeProposalConfidencePill(ctx.confidence.band);
    const damp = ctx.confidence.dampenedByThinSample
      ? " _(dampened — thin attribution sample)_"
      : "";
    lines.push(
      `**Confidence**: ${ctx.confidence.confidence}/100 · ${pill}${damp}`,
    );
    lines.push(`  - _${ctx.confidence.rationale}_`);
    if (ctx.confidence.drivers.length > 0) {
      for (const d of ctx.confidence.drivers) {
        const sign = d.contribution > 0 ? "+" : "";
        lines.push(`  - \`${sign}${d.contribution}\` — ${d.rationale}`);
      }
    }
  }

  // Stability (20aa) — per-change sensitivity analysis sits just above
  // the watchlist because "is this call solid?" logically precedes
  // "what do I watch after applying it?". Omitted when the proposal
  // has no actionable changes, or when the stability report is empty
  // for any other reason — the header is only useful alongside the
  // per-row detail that pinpoints which changes are knife's-edge.
  if (ctx.stability && !ctx.stability.empty && ctx.stability.changes.length > 0) {
    const pill = describeStabilityPill(ctx.stability);
    const headline = ctx.stability.headline ?? "";
    lines.push(`**Stability**: ${pill.label} — ${headline}`);
    for (const row of ctx.stability.changes) {
      const ratingTag =
        row.rating === "stable"
          ? "🟢 stable"
          : row.rating === "mixed"
            ? "🟡 mixed"
            : "🔴 fragile";
      const pct = Math.round(row.stability * 100);
      const alt =
        row.altAction && row.altAction !== row.action
          ? ` · would drift to \`${row.altAction}\``
          : "";
      lines.push(
        `  - \`${row.label}\` · ${row.action} · ${ratingTag} (${pct}% stable)${alt}`,
      );
    }
  }

  // Watchlist (20z) — post-apply monitoring plan, surfaces last in
  // the context block because it's relevant only AFTER the decision
  // above has been made. A ticket reader skimming for "what do we
  // watch?" finds it at the bottom of the context, just above the
  // proposal body that it pertains to. Omitted cleanly when empty
  // (no factors warrant monitoring) — the markdown doesn't emit a
  // "Watchlist: none" line to avoid stub-placeholder noise.
  if (ctx.watchlist && ctx.watchlist.items.length > 0) {
    const headline = ctx.watchlist.headline ?? `${ctx.watchlist.items.length} factors to monitor after applying.`;
    lines.push(`**Watchlist**: ${headline}`);
    for (const item of ctx.watchlist.items) {
      const priorityTag =
        item.priority === "high"
          ? "🔴 high"
          : item.priority === "medium"
            ? "🟡 medium"
            : "⚪ low";
      lines.push(`  - \`${item.label}\` · ${item.action} · ${priorityTag}`);
      lines.push(`    - _Concern_: ${item.concern}`);
      lines.push(`    - _Trigger_: ${item.trigger}`);
    }
  }

  // Rollback plan (20ab) — the very last section in the context block,
  // because it's the step you take AFTER the watchlist trips. Reading
  // order: verdict (decide) → signals (why) → stability (robustness)
  // → watchlist (what to watch) → rollback (how to unwind). When the
  // plan is empty (no actionable changes) we omit it cleanly so the
  // all-keep case doesn't render an "0 rollback steps" stub.
  if (ctx.rollback && !ctx.rollback.empty && ctx.rollback.steps.length > 0) {
    const headline =
      ctx.rollback.headline ??
      `${ctx.rollback.steps.length} rollback step${ctx.rollback.steps.length === 1 ? "" : "s"}.`;
    lines.push(`**Rollback plan**: ${headline}`);
    for (const step of ctx.rollback.steps) {
      const priorityTag =
        step.priority === "high"
          ? "🔴 high"
          : step.priority === "medium"
            ? "🟡 medium"
            : "⚪ low";
      const watchTag = step.hasWatchTrigger ? " · 👁 watched" : "";
      lines.push(
        `  - \`${step.label}\` · ${step.action} · ${priorityTag}${watchTag}`,
      );
      lines.push(`    - _Operation_: ${step.operation}`);
      lines.push(`    - _Impact_: ${step.impact}`);
    }
  }

  if (lines.length === 0) return "";
  const out: string[] = [];
  out.push("## Context");
  out.push("");
  out.push(...lines);
  out.push("");
  return out.join("\n");
}

/**
 * Full "receipts included" markdown renderer. The Context block
 * prepends the existing proposal markdown so a skimmer reads urgency
 * → drift → proposal → corroboration in that order. When every
 * context slice is silent, this falls through to exactly the 20m
 * output — no empty headers, no stubbed placeholders.
 */
export function renderProposalMarkdownWithContext(
  proposal: ScorerProposal,
  ctx: ProposalMarkdownContext,
): string {
  const header = renderContextSection(ctx);
  const body = renderScorerProposalMarkdown(proposal);
  if (header.length === 0) return body;
  return `${header}\n${body}`;
}

/** Format a fractional delta as `+Npp` / `-Npp` / `—`. */
function formatPp(delta: number | null): string {
  if (delta === null) return "—";
  const pp = Math.round(delta * 100);
  return `${pp > 0 ? "+" : ""}${pp}pp`;
}

/** Format a Brier delta at three decimals with sign. */
function formatBrierDelta(delta: number | null): string {
  if (delta === null) return "—";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}
