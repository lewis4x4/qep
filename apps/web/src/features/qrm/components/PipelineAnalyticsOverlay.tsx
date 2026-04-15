/**
 * Pipeline Analytics Overlay — Track 2 Slice 2.4.
 *
 * A compact, toggle-able strip that sits above the swim lanes when "Stage
 * Stats" is on. It consumes a `PipelineAnalyticsSnapshot` and surfaces the
 * four roadmap metrics: avg time per stage (delegated to the per-column
 * header), conversion rates, bottleneck, and velocity trend.
 *
 * This overlay is purely presentational — all math happens in
 * `pipeline-analytics.ts` so it can be unit-tested without rendering React.
 */

import { AlertTriangle, ArrowRight, Gauge, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PipelineAnalyticsSnapshot } from "../lib/pipeline-analytics";

interface PipelineAnalyticsOverlayProps {
  snapshot: PipelineAnalyticsSnapshot;
}

function toneForConversion(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 60) return "text-emerald-500";
  if (pct >= 30) return "text-amber-500";
  return "text-rose-500";
}

export function PipelineAnalyticsOverlay({ snapshot }: PipelineAnalyticsOverlayProps) {
  const stagesWithConversion = snapshot.stages.filter((s) => s.conversionToNextPct !== null);
  const medianConversion = stagesWithConversion.length > 0
    ? Math.round(
      stagesWithConversion.reduce((sum, s) => sum + (s.conversionToNextPct ?? 0), 0)
      / stagesWithConversion.length,
    )
    : null;

  return (
    <Card className="border-border/60 bg-card/70 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Open deals</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{snapshot.totalOpenDeals}</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Velocity (7d)</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {snapshot.velocityDealsPerWeek}
              <span className="ml-1 text-xs font-normal text-muted-foreground">deals moved</span>
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Median conversion</p>
            <p className={cn("mt-1 text-lg font-semibold tabular-nums", toneForConversion(medianConversion))}>
              {medianConversion === null ? "—" : `${medianConversion}%`}
            </p>
          </div>
        </div>

        <div className={cn(
          "flex items-start gap-3 rounded-lg border p-3",
          snapshot.bottleneckStageId
            ? "border-rose-500/40 bg-rose-500/5"
            : "border-border/50 bg-background/50",
        )}>
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              snapshot.bottleneckStageId ? "text-rose-500" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              snapshot.bottleneckStageId ? "text-rose-500" : "text-muted-foreground",
            )}>
              Bottleneck
            </p>
            <p className={cn(
              "mt-1 truncate text-sm font-semibold",
              snapshot.bottleneckStageId ? "text-rose-500" : "text-muted-foreground",
            )}>
              {snapshot.bottleneckStageName ?? "None detected"}
            </p>
          </div>
        </div>
      </div>

      {stagesWithConversion.length > 0 && (
        <div
          className="mt-3 flex items-stretch gap-1 overflow-x-auto"
          role="list"
          aria-label="Stage conversion chips"
        >
          {snapshot.stages.map((s) => (
            <div
              key={s.stageId}
              role="listitem"
              className="min-w-[110px] shrink-0 rounded-lg border border-border/50 bg-background/40 px-2 py-1.5"
            >
              <p className="truncate text-[10px] font-medium text-muted-foreground" title={s.stageName}>
                {s.stageName}
              </p>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {s.dealCount}
                </span>
                {s.conversionToNextPct !== null && (
                  <span className={cn("text-[10px] tabular-nums", toneForConversion(s.conversionToNextPct))}>
                    → {s.conversionToNextPct}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
