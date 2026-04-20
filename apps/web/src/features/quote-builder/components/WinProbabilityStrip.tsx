/**
 * WinProbabilityStrip — Slice 20c.
 *
 * A compact, always-visible deal "barometer" that lives at the top of the
 * Customer / Equipment / Review steps. Takes a draft snapshot, asks the
 * pure-function scorer for a 0..100 score + factors, and renders:
 *
 *   • A horizontal gauge sliced into four bands (at-risk / mixed /
 *     healthy / strong) with the current score marked.
 *   • A one-sentence headline that names the biggest lift or drag so
 *     the rep has a next action, not just a number.
 *   • Up to three top factors, color-coded + hover-explained.
 *
 * This is the first visible surface of Move 2 (Counterfactual
 * Win-Probability Engine). The scorer is rule-based today — when the
 * ML/counterfactual model ships, this component doesn't change: same
 * inputs, same shape, same UI.
 *
 * Design bar: *transparent over confident*. We never show 0% or 100%,
 * we always show *why* the number moved, and we don't block the rep —
 * this is a lens, not a gate.
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Minus, Gauge, ArrowUpRight,
  CheckCircle2, AlertTriangle, History,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computeWinProbability,
  computeWinProbabilityLifts,
  type WinProbabilityContext,
  type WinProbabilityFactor,
  type WinProbabilityLift,
  type WinProbabilityResult,
} from "../lib/win-probability-scorer";
import type { FactorVerdict } from "../lib/factor-verdict";
import {
  computeShadowScore,
  describeShadowAgreement,
  type ShadowHistoricalSnapshot,
  type ShadowScoreResult,
} from "../lib/shadow-score";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface WinProbabilityStripProps {
  draft: Partial<QuoteWorkspaceDraft>;
  context: WinProbabilityContext;
  /** Optional compact mode for tight sidebars — hides the factor chips. */
  compact?: boolean;
  /**
   * Slice 20i — label → historical verdict. When present, each factor
   * chip gets a small "proven" / "suspect" badge so the rep can see
   * which parts of the score have been validated against closed deals.
   * Unknown or missing factors render without a badge — we never
   * annotate something we can't back up.
   */
  verdicts?: Map<string, FactorVerdict> | null;
  /**
   * Slice 20j — closed-deal history for the K-nearest-neighbor
   * shadow score. When non-null and non-empty, the strip renders a
   * "Shadow {N}%" chip that acts as a second witness to the rule-based
   * live score. The endpoint feeding this is manager/owner-only, so
   * reps simply won't see the chip — by design, not an error state.
   * `null` means "not loaded / not permitted", empty array means
   * "loaded but no closed deals yet"; both hide the chip cleanly.
   */
  closedHistory?: ShadowHistoricalSnapshot[] | null;
}

const BAND_STYLE: Record<
  WinProbabilityResult["band"],
  { label: string; ring: string; text: string; bar: string; bg: string }
> = {
  strong:  { label: "On pace",  ring: "ring-emerald-500/40", text: "text-emerald-400", bar: "bg-emerald-500", bg: "bg-emerald-500/5 border-emerald-500/30" },
  healthy: { label: "Healthy",  ring: "ring-sky-500/40",     text: "text-sky-400",     bar: "bg-sky-500",     bg: "bg-sky-500/5 border-sky-500/30" },
  mixed:   { label: "Mixed",    ring: "ring-amber-500/40",   text: "text-amber-400",   bar: "bg-amber-500",   bg: "bg-amber-500/5 border-amber-500/30" },
  at_risk: { label: "At risk",  ring: "ring-rose-500/40",    text: "text-rose-400",    bar: "bg-rose-500",    bg: "bg-rose-500/5 border-rose-500/30" },
};

export function WinProbabilityStrip({
  draft,
  context,
  compact = false,
  verdicts = null,
  closedHistory = null,
}: WinProbabilityStripProps) {
  const result = useMemo(
    () => computeWinProbability(draft, context),
    [draft, context],
  );
  // Slice 20d: counterfactual lifts — only surfaced when the deal has
  // real room to move. We deliberately hide lifts on already-strong
  // deals (>=70) so the rep isn't nagged on a win-likely quote.
  const lifts = useMemo(
    () => (result.score < 70 ? computeWinProbabilityLifts(draft, context) : []),
    [draft, context, result.score],
  );
  // Slice 20j: K-NN shadow score. Computed only when we have history
  // available (manager role, endpoint responded with data). The
  // `result.factors` list is the authoritative live factor profile —
  // using it (not `topFactors`) keeps the distance metric honest.
  const shadow = useMemo(() => {
    if (!closedHistory || closedHistory.length === 0) return null;
    return computeShadowScore(result.factors, closedHistory);
  }, [result.factors, closedHistory]);
  const style = BAND_STYLE[result.band];
  // Top 3 factors by absolute weight; scorer already sorted them.
  const topFactors = result.factors.slice(0, 3);

  return (
    <TooltipProvider delayDuration={150}>
      <Card className={cn("p-3 border", style.bg)}>
        <div className="flex items-center gap-3">
          {/* Score pill */}
          <div className={cn(
            "shrink-0 w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center ring-4",
            style.ring,
            style.bg,
          )}>
            <Gauge className={cn("h-3 w-3 -mb-1", style.text)} aria-hidden />
            <span className={cn("text-lg font-bold tabular-nums", style.text)}>
              {result.score}
            </span>
          </div>

          {/* Headline + gauge */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className={cn("text-xs font-semibold uppercase tracking-wide", style.text)}>
                {style.label}
              </div>
              <div className="flex items-center gap-2">
                {shadow && !shadow.lowConfidence && (
                  <ShadowChip liveScore={result.score} shadow={shadow} />
                )}
                <div className="text-[10px] text-muted-foreground">Win probability</div>
              </div>
            </div>
            <p className="mt-0.5 text-sm text-foreground truncate" title={result.headline}>
              {result.headline}
            </p>
            <GaugeBar score={result.score} barColor={style.bar} />
          </div>
        </div>

        {/* Factor chips */}
        {!compact && topFactors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topFactors.map((f, i) => (
              <FactorChip
                key={`${f.label}-${i}`}
                factor={f}
                verdict={verdicts?.get(f.label) ?? null}
              />
            ))}
            {result.factors.length > topFactors.length && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center rounded-full border border-border/50 bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground cursor-help">
                    +{result.factors.length - topFactors.length} more
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <ul className="space-y-1">
                    {result.factors.slice(topFactors.length).map((f, i) => (
                      <li key={i} className="text-xs">
                        <span className={factorDirClass(f.weight)}>
                          {f.weight > 0 ? "+" : ""}{f.weight}
                        </span>{" "}
                        {f.label}
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* Slice 20d: counterfactual biggest lifts. Only rendered when
            the score has real room to move AND the scorer found at least
            one actionable lift; strong deals stay quiet. */}
        {!compact && lifts.length > 0 && (
          <div className="mt-3 border-t border-border/40 pt-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ArrowUpRight className="h-3 w-3 text-emerald-400" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                Biggest lifts
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lifts.map((l) => (
                <LiftChip key={l.id} lift={l} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </TooltipProvider>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function GaugeBar({ score, barColor }: { score: number; barColor: string }) {
  // Four equal-width bands so the rep has fixed mental landmarks.
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="mt-1.5 relative">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
        {/* band dividers at 35 / 55 / 70 */}
        <div className="flex-[35] border-r border-background/30" />
        <div className="flex-[20] border-r border-background/30" />
        <div className="flex-[15] border-r border-background/30" />
        <div className="flex-[30]" />
      </div>
      {/* score marker */}
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded-full ring-2 ring-background",
          barColor,
        )}
        style={{ left: `calc(${pct}% - 2px)` }}
        aria-label={`Score ${score}`}
      />
    </div>
  );
}

function FactorChip({
  factor,
  verdict,
}: {
  factor: WinProbabilityFactor;
  verdict: FactorVerdict | null;
}) {
  const Icon = factor.weight > 0 ? TrendingUp : factor.weight < 0 ? TrendingDown : Minus;
  // Only render a badge for proven/suspect. `unknown` + `null` both
  // mean "no historical claim to make" — the chip stays clean.
  const showBadge = verdict === "proven" || verdict === "suspect";
  // Rep-facing copy: avoid analyst jargon and never point reps at a
  // manager-only surface. "Proven" means the factor has backed up its
  // scorer weight in closed deals; "suspect" means it hasn't — don't
  // lean on this one signal alone, use it alongside your judgment.
  const verdictTooltip =
    verdict === "proven"
      ? "Historically confirmed — past closed deals backed this signal up."
      : verdict === "suspect"
        ? "Historically mixed — this signal didn't consistently hold in past closed deals. Use judgment, don't lean on it alone."
        : null;
  // Compose the accessible label so it includes the verdict when
  // present — otherwise screen readers would miss the badge semantics.
  const ariaLabel =
    verdictTooltip !== null
      ? `${factor.label}: ${factor.rationale}. ${verdictTooltip}`
      : `${factor.label}: ${factor.rationale}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-help focus:outline-none focus:ring-2 focus:ring-ring",
            factor.weight > 0
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : factor.weight < 0
                ? "border-rose-500/30 bg-rose-500/5 text-rose-300"
                : "border-border/60 bg-background/40 text-muted-foreground",
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span className="tabular-nums font-medium">
            {factor.weight > 0 ? "+" : ""}{factor.weight}
          </span>
          <span>{factor.label}</span>
          {showBadge && verdict === "proven" && (
            <CheckCircle2
              className="h-3 w-3 text-emerald-400 -mr-0.5"
              aria-hidden
            />
          )}
          {showBadge && verdict === "suspect" && (
            <AlertTriangle
              className="h-3 w-3 text-amber-400 -mr-0.5"
              aria-hidden
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <p>{factor.rationale}</p>
        {verdictTooltip !== null && (
          <p className="mt-1 border-t border-border/40 pt-1 text-[11px] text-muted-foreground">
            {verdictTooltip}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function factorDirClass(weight: number): string {
  return weight > 0 ? "text-emerald-400" : weight < 0 ? "text-rose-400" : "text-muted-foreground";
}

/**
 * Slice 20j — Shadow chip. Renders a compact "Shadow {N}%" pill next
 * to the "Win probability" label so managers can see both numbers at
 * a glance. We intentionally keep this small — the live score is the
 * hero; the shadow is corroboration.
 *
 * Agreement coloring (live vs. shadow within ±10):
 *   • Agreement → neutral border (no alarm, just confirmation).
 *   • Disagreement ≥11 in either direction → amber border, "worth a
 *     second look" copy. We don't color it red: a disagreement isn't
 *     bad news, it's a signal that the deal doesn't fit the mental
 *     model the scorer encodes. That's a prompt to think, not to panic.
 */
function ShadowChip({
  liveScore,
  shadow,
}: {
  liveScore: number;
  shadow: ShadowScoreResult;
}) {
  const delta = Math.round(shadow.shadowScore - liveScore);
  const disagrees = Math.abs(delta) > 10;
  const tooltip = describeShadowAgreement(liveScore, shadow);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={`Shadow score ${shadow.shadowScore} percent, based on ${shadow.kUsed} similar closed deals. ${tooltip}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-help focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
            disagrees
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="h-3 w-3" aria-hidden />
          <span className="tabular-nums">Shadow {shadow.shadowScore}%</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <p>{tooltip}</p>
        <p className="mt-1 border-t border-border/40 pt-1 text-[11px] text-muted-foreground">
          Based on the {shadow.kUsed} closed deal{shadow.kUsed === 1 ? "" : "s"} whose factor profile looks most like this one.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function LiftChip({ lift }: { lift: WinProbabilityLift }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={`${lift.label}: +${lift.deltaPts} points. ${lift.actionHint}`}
          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200 cursor-help hover:bg-emerald-500/15 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <ArrowUpRight className="h-3 w-3" aria-hidden />
          <span className="tabular-nums font-semibold">+{lift.deltaPts}</span>
          <span>{lift.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs">{lift.rationale}</p>
        <p className="mt-1 text-[11px] text-muted-foreground italic">
          {lift.actionHint}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
