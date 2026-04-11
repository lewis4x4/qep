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
          <Card className="p-6 text-center text-xs text-muted-foreground">Loading leadership metrics…</Card>
        ) : definitions.length === 0 ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">
            Metric registry is not available yet.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
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
