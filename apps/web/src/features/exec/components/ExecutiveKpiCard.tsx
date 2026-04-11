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
import { ArrowRight, Activity, Target, TrendingDown, TrendingUp, Waves } from "lucide-react";
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

  const category = (definition.display_category || "Executive").replace(/_/g, " ");
  const refreshLabel = snapshot ? relativeRefresh(snapshot.calculated_at) : (fallbackSource ?? "No live data");
  const deltaTone =
    deltaPct == null ? "text-muted-foreground" : deltaPct >= 0 ? "text-emerald-300" : "text-rose-300";
  const DeltaIcon = deltaPct == null ? Waves : deltaPct >= 0 ? TrendingUp : TrendingDown;
  const stateBadge = noSnapshot ? "Live" : isStale ? "Stale" : "Live";
  const metricEvidence = [
    `Metric: ${definition.label}`,
    definition.description ? `Description: ${definition.description}` : null,
    `Current value: ${formatted}`,
    target != null ? `Target: ${formatKpiValue(target, format)}` : null,
    comparison != null ? `Prior value: ${formatKpiValue(comparison, format)}` : null,
    `Refresh: ${refreshLabel}`,
    definition.formula_text ? `Formula: ${definition.formula_text}` : null,
  ].filter(Boolean).join("\n");

  return (
    <Card className="group relative flex min-h-[220px] flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-5 shadow-[0_20px_40px_rgba(2,6,23,0.18)] transition duration-200 hover:border-qep-orange/35 hover:shadow-[0_24px_60px_rgba(2,6,23,0.28)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
              {category}
            </span>
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">
              {stateBadge}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2">
            <h3 className="text-base font-semibold leading-tight text-white sm:text-lg">
              {definition.label}
            </h3>
            <MetricDefinitionPopover definition={definition} snapshot={snapshot} />
          </div>
          {definition.description && (
            <p className="mt-2 text-sm leading-5 text-slate-400">
              {definition.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-end gap-3">
        <span className="text-4xl font-semibold tracking-tight text-white sm:text-[2.6rem]">
          {formatted}
        </span>
        {target != null && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300">
            <Target className="h-3 w-3" />
            Target {formatKpiValue(target, format)}
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Refresh
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
            <Activity className="h-3.5 w-3.5 text-qep-orange" />
            <span>{refreshLabel}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Performance
          </p>
          <div className={`mt-2 flex items-center gap-2 text-sm ${deltaTone}`}>
            <DeltaIcon className="h-3.5 w-3.5" />
            {deltaPct != null ? (
              <span>{deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}% vs target</span>
            ) : comparison != null ? (
              <span>Prior {formatKpiValue(comparison, format)}</span>
            ) : (
              <span>No comparison baseline yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        <button
          type="button"
          onClick={() => onDrill?.(definition.metric_key)}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-qep-orange/25 bg-qep-orange/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-qep-orange transition hover:border-qep-orange/40 hover:bg-qep-orange/15"
        >
          Drill down <ArrowRight className="h-3 w-3" />
        </button>
        <AskIronAdvisorButton
          contextType="metric"
          contextId={definition.metric_key}
          contextTitle={definition.label}
          draftPrompt={`Explain ${definition.label} for me right now. What is driving it, what changed, and what should I do next?`}
          evidence={metricEvidence}
          preferredSurface="metric_drawer"
          onBeforeOpen={() => onDrill?.(definition.metric_key)}
          variant="inline"
          label="Ask Iron"
          className="min-h-[40px] rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
        />
      </div>
    </Card>
  );
}
