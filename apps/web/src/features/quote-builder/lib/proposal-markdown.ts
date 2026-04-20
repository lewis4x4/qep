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

export interface ProposalMarkdownContext {
  /** 20s — scorer-wide calibration trend. Null when unavailable. */
  calibrationDrift: CalibrationDriftReport | null;
  /** 20r — per-factor drift. Null or empty `drifts` when no findings. */
  factorDrift: FactorDriftReport | null;
  /** 20t — urgency + rationale. Medium/null-rationale is the silent default. */
  urgency: ProposalUrgencyResult | null;
  /** 20p — what-if Brier + hit-rate deltas. Null when no audit sample. */
  whatIf: ScorerWhatIfResult | null;
}

/**
 * Compose the context header. Returns an empty string when every
 * section is silent — the output should be copy-paste clean, not a
 * sea of "n/a" placeholders.
 */
function renderContextSection(ctx: ProposalMarkdownContext): string {
  const lines: string[] = [];

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
