/**
 * COO lens — Slice 4.
 *
 * Today's execution board (at-risk traffic), inventory readiness rail,
 * and recovery queue for rental returns. The 8 KPI tiles ride above the
 * panels.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ExecutiveKpiCard } from "../components/ExecutiveKpiCard";
import { AlertsInboxPanel } from "../components/AlertsInboxPanel";
import { AiExecutiveSummaryStrip } from "../components/AiExecutiveSummaryStrip";
import {
  TodaysExecutionBoard,
  InventoryReadinessRail,
  RecoveryQueuePanel,
} from "../components/coo/TodaysExecutionBoard";
import { useMetricDefinitions, useLatestSnapshots } from "../lib/useExecData";

interface Props {
  onDrill?: (metricKey: string) => void;
}

export function CooCommandCenterView({ onDrill }: Props) {
  const { data: definitions = [], isLoading } = useMetricDefinitions("coo");
  const metricKeys = useMemo(() => definitions.map((d) => d.metric_key), [definitions]);
  const { data: snapshots = [] } = useLatestSnapshots(metricKeys);

  const snapshotByKey = useMemo(() => {
    const m = new Map<string, (typeof snapshots)[number]>();
    for (const s of snapshots) m.set(s.metric_key, s);
    return m;
  }, [snapshots]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <AiExecutiveSummaryStrip role="coo" />

        {isLoading ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">Loading COO metrics…</Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {definitions.map((def) => (
              <ExecutiveKpiCard
                key={def.metric_key}
                definition={def}
                snapshot={snapshotByKey.get(def.metric_key) ?? null}
                fallbackValue={null}
                fallbackSource="snapshot pipeline"
                onDrill={onDrill}
              />
            ))}
          </div>
        )}

        <TodaysExecutionBoard />
        <InventoryReadinessRail />
        <RecoveryQueuePanel />
      </div>

      <div>
        <AlertsInboxPanel role="coo" />
      </div>
    </div>
  );
}
