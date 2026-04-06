import type { QrmWeightedDeal } from "../lib/types";
import { getDealSignalState } from "../lib/deal-signals";

interface QrmPipelineManagerMetricsProps {
  deals: QrmWeightedDeal[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function QrmPipelineManagerMetrics({ deals }: QrmPipelineManagerMetricsProps) {
  const summary = deals.reduce(
    (acc, deal) => {
      const { isOverdueFollowUp, isStalled } = getDealSignalState(deal);
      acc.totalDeals += 1;
      acc.totalAmount += deal.amount ?? 0;
      acc.weightedAmount += deal.weightedAmount ?? 0;
      if (isOverdueFollowUp) {
        acc.overdueCount += 1;
      }
      if (isStalled) {
        acc.stalledCount += 1;
      }
      return acc;
    },
    {
      totalDeals: 0,
      totalAmount: 0,
      weightedAmount: 0,
      overdueCount: 0,
      stalledCount: 0,
    }
  );

  return (
    <section
      className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-5"
      aria-label="Manager pipeline metrics"
    >
      <Metric label="Open Deals" value={String(summary.totalDeals)} />
      <Metric label="Pipeline Amount" value={formatCurrency(summary.totalAmount)} />
      <Metric label="Weighted Pipeline" value={formatCurrency(summary.weightedAmount)} />
      <Metric label="Overdue Follow-Up" value={String(summary.overdueCount)} />
      <Metric label="Stalled Deals" value={String(summary.stalledCount)} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
