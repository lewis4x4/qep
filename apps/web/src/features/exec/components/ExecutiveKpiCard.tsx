/**
 * Premium KPI tile for the QEP Moonshot Command Center.
 *
 * Renders the live value, refresh state, formula popover, and a drill button.
 * Pulls value from the live snapshot first, falls back to a Slice 1 live query
 * if the snapshot runner hasn't populated this metric yet.
 *
 * Spec §16: every card must expose formula, last refresh, and a drill action.
 */
import { Card } from "@/components/ui/card";
import { ArrowRight, Activity } from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";
import { MetricDefinitionPopover } from "./MetricDefinitionPopover";
import { formatKpiValue, formatForMetric, relativeRefresh } from "../lib/formatters";
import type { MetricDefinition, KpiSnapshot } from "../lib/types";

interface Props {
  definition: MetricDefinition;
  snapshot: KpiSnapshot | null;
  fallbackValue: number | null;
  fallbackSource: string | null;
  onDrill?: (metricKey: string) => void;
}

export function ExecutiveKpiCard({ definition, snapshot, fallbackValue, fallbackSource, onDrill }: Props) {
  const value = snapshot?.metric_value ?? fallbackValue;
  const format = formatForMetric(definition.metric_key);
  const formatted = formatKpiValue(value, format);
  const target = snapshot?.target_value ?? null;
  const comparison = snapshot?.comparison_value ?? null;
  const isStale = snapshot?.refresh_state === "stale" || snapshot?.refresh_state === "partial";
  const noSnapshot = !snapshot;

  // Compare delta vs target if both present
  let deltaPct: number | null = null;
  if (value != null && target != null && target !== 0) {
    deltaPct = ((value - target) / target) * 100;
  }

  return (
    <Card className="group relative flex flex-col gap-2 p-4 transition hover:border-qep-orange/50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
              {definition.label}
            </p>
            <MetricDefinitionPopover definition={definition} snapshot={snapshot} />
          </div>
        </div>
        {(noSnapshot || isStale) && (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-400" title={noSnapshot ? "Live fallback (no snapshot yet)" : "Snapshot stale"}>
            {noSnapshot ? "live" : "stale"}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">{formatted}</span>
        {target != null && (
          <span className="text-[10px] text-muted-foreground">/ {formatKpiValue(target, format)}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Activity className="h-2.5 w-2.5" />
          {snapshot ? relativeRefresh(snapshot.calculated_at) : (fallbackSource ?? "no data")}
        </span>
        {deltaPct != null && (
          <span className={deltaPct >= 0 ? "text-emerald-400" : "text-red-400"}>
            {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}% vs target
          </span>
        )}
        {comparison != null && deltaPct == null && (
          <span className="text-muted-foreground">prior: {formatKpiValue(comparison, format)}</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => onDrill?.(definition.metric_key)}
          className="inline-flex items-center gap-1 text-[10px] text-qep-orange hover:underline"
        >
          Drill <ArrowRight className="h-2.5 w-2.5" />
        </button>
        <AskIronAdvisorButton
          contextType="metric"
          contextId={definition.metric_key}
          variant="inline"
        />
      </div>
    </Card>
  );
}
