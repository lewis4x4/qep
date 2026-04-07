/**
 * COO lens — Slice 4.
 *
 * Today's execution board (at-risk traffic), inventory readiness rail,
 * and recovery queue for rental returns. The 8 KPI tiles ride above the
 * panels.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Truck } from "lucide-react";
import { ExecutiveKpiCard } from "../components/ExecutiveKpiCard";
import { AlertsInboxPanel } from "../components/AlertsInboxPanel";
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
        <Card className="border-orange-500/20 bg-gradient-to-r from-orange-500/5 to-transparent p-4">
          <div className="flex items-start gap-3">
            <Truck className="mt-0.5 h-4 w-4 text-orange-400" />
            <div className="flex-1">
              <p className="text-[10px] uppercase tracking-wider text-orange-400">Operations</p>
              <p className="mt-1 text-xs text-muted-foreground">
                On-time delivery, blocked moves, units not ready, intake stalled, rental returns aging,
                and the repeat-failure index. Drill any tile to see the source rows.
              </p>
            </div>
          </div>
        </Card>

        {isLoading ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">Loading COO metrics…</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
