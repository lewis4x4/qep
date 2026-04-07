/**
 * CFO lens — Slice 3.
 *
 * Cash, A/R, deposits, payment exceptions, refund exposure, receipt
 * compliance, hauling recovery, and loaded margin %. Composes the same
 * KPI tile + alerts inbox primitives as the CEO view, plus three
 * domain panels: PolicyEnforcementWall, MarginWaterfallExplorer,
 * CashPressureView.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { ExecutiveKpiCard } from "../components/ExecutiveKpiCard";
import { AlertsInboxPanel } from "../components/AlertsInboxPanel";
import { AiExecutiveSummaryStrip } from "../components/AiExecutiveSummaryStrip";
import { PolicyEnforcementWall } from "../components/cfo/PolicyEnforcementWall";
import { MarginWaterfallExplorer } from "../components/cfo/MarginWaterfallExplorer";
import { useMetricDefinitions, useLatestSnapshots } from "../lib/useExecData";

interface Props {
  onDrill?: (metricKey: string) => void;
}

export function CfoCommandCenterView({ onDrill }: Props) {
  const { data: definitions = [], isLoading } = useMetricDefinitions("cfo");
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
        <AiExecutiveSummaryStrip role="cfo" />

        {isLoading ? (
          <Card className="p-6 text-center text-xs text-muted-foreground">Loading CFO metrics…</Card>
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

        <PolicyEnforcementWall />
        <MarginWaterfallExplorer />
      </div>

      <div className="space-y-4">
        <AlertsInboxPanel role="cfo" />
        {/* Receipt compliance quick-glance */}
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Receipt className="h-3 w-3 text-blue-400" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receipt compliance</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Surfaced via the <code>receipt_compliance_rate</code> KPI tile.
            Drill there for the daily trend and exception list.
          </p>
        </Card>
      </div>
    </div>
  );
}
