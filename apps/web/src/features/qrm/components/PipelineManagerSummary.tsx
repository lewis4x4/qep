import { Card } from "@/components/ui/card";
import { formatMoney } from "../lib/pipeline-utils";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export interface StageSummaryRow {
  stageId: string;
  stageName: string;
  count: number;
  amount: number;
}

interface PipelineManagerSummaryProps {
  showWeightedMetrics: boolean;
  showStageDistribution: boolean;
  weightedTotals: {
    openDeals: number;
    pipelineAmount: number;
    weightedPipeline: number;
  };
  stageSummary: StageSummaryRow[];
}

export function PipelineManagerSummary({
  showWeightedMetrics,
  showStageDistribution,
  weightedTotals,
  stageSummary,
}: PipelineManagerSummaryProps) {
  return (
    <>
      {showWeightedMetrics && (
        <section
          className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-card p-4"
          aria-label="Manager deal summary"
        >
          <Metric label="Open deals" value={String(weightedTotals.openDeals)} />
          <Metric label="Pipeline amount" value={formatMoney(weightedTotals.pipelineAmount)} />
          <Metric label="Weighted" value={formatMoney(weightedTotals.weightedPipeline)} />
        </section>
      )}

      {showStageDistribution && stageSummary.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Stage distribution</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Stage</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {stageSummary.map((item) => (
                  <tr key={item.stageId} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">{item.stageName}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatMoney(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
