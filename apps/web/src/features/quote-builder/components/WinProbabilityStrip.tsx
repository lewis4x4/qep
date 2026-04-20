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
import { TrendingUp, TrendingDown, Minus, Gauge } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computeWinProbability,
  type WinProbabilityContext,
  type WinProbabilityFactor,
  type WinProbabilityResult,
} from "../lib/win-probability-scorer";
import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";

export interface WinProbabilityStripProps {
  draft: Partial<QuoteWorkspaceDraft>;
  context: WinProbabilityContext;
  /** Optional compact mode for tight sidebars — hides the factor chips. */
  compact?: boolean;
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

export function WinProbabilityStrip({ draft, context, compact = false }: WinProbabilityStripProps) {
  const result = useMemo(
    () => computeWinProbability(draft, context),
    [draft, context],
  );
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
              <div className="text-[10px] text-muted-foreground">Win probability</div>
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
              <FactorChip key={`${f.label}-${i}`} factor={f} />
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

function FactorChip({ factor }: { factor: WinProbabilityFactor }) {
  const Icon = factor.weight > 0 ? TrendingUp : factor.weight < 0 ? TrendingDown : Minus;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-help",
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
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {factor.rationale}
      </TooltipContent>
    </Tooltip>
  );
}

function factorDirClass(weight: number): string {
  return weight > 0 ? "text-emerald-400" : weight < 0 ? "text-rose-400" : "text-muted-foreground";
}
