/**
 * CEO lens — top 8 KPIs + AI summary placeholder + alerts.
 *
 * Slice 1: Renders the 8 metric definitions seeded in migration 187.
 * Snapshots may not exist yet; the KPI tiles fall back to live source-view
 * queries via `useFallbackKpis`. AI summary strip is a placeholder for
 * Slice 5.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ExecutiveKpiCard } from "../components/ExecutiveKpiCard";
import { AlertsInboxPanel } from "../components/AlertsInboxPanel";
import { AiExecutiveSummaryStrip } from "../components/AiExecutiveSummaryStrip";
import { CeoGrowthExplorer } from "../components/ceo/CeoGrowthExplorer";
import { useMetricDefinitions, useLatestSnapshots, useFallbackKpis } from "../lib/useExecData";

interface Props {
  onDrill?: (metricKey: string) => void;
}

export function CeoCommandCenterView({ onDrill }: Props) {
  const { data: definitions = [], isLoading: defsLoading } = useMetricDefinitions("ceo");
  const metricKeys = useMemo(() => definitions.map((d) => d.metric_key), [definitions]);
  const { data: snapshots = [] } = useLatestSnapshots(metricKeys);
  const { data: fallbacks = {} } = useFallbackKpis("ceo");

  const snapshotByKey = useMemo(() => {
    const m = new Map<string, (typeof snapshots)[number]>();
    for (const s of snapshots) m.set(s.metric_key, s);
    return m;
  }, [snapshots]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <AiExecutiveSummaryStrip role="ceo" />

        {/* KPI grid */}
        {defsLoading ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">Loading metric registry…</Card>
        ) : definitions.length === 0 ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">
            No metric definitions found. Run migration 187.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {definitions.map((def) => {
              const snapshot = snapshotByKey.get(def.metric_key) ?? null;
              const fallback = fallbacks[def.metric_key] ?? null;
              return (
                <ExecutiveKpiCard
                  key={def.metric_key}
                  definition={def}
                  snapshot={snapshot}
                  fallbackValue={fallback?.value ?? null}
                  fallbackSource={fallback?.source ?? null}
                  onDrill={onDrill}
                />
              );
            })}
          </div>
        )}

        <CeoGrowthExplorer />
      </div>

      {/* Right rail: alerts inbox */}
      <div>
        <AlertsInboxPanel role="ceo" />
      </div>
    </div>
  );
}
