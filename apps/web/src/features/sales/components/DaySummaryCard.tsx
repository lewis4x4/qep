import type { RepPipelineDeal } from "../lib/types";

export function DaySummaryCard({
  pipeline,
}: {
  pipeline: RepPipelineDeal[];
}) {
  const warmDeals = pipeline.filter((d) => d.heat_status === "warm").length;
  const totalValue = pipeline.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  return (
    <div className="bg-[hsl(var(--card))] border border-white/[0.08] rounded-xl px-4 py-4">
      <p className="text-sm font-semibold text-foreground mb-2">
        Today's Summary
      </p>
      <div className="space-y-1.5 text-sm text-muted-foreground">
        <p>
          {pipeline.length} active {pipeline.length === 1 ? "deal" : "deals"} in
          pipeline
        </p>
        <p>{warmDeals} deals with recent activity</p>
        <p>Total pipeline value: ${totalValue.toLocaleString()}</p>
      </div>
      <p className="text-xs text-muted-foreground/50 mt-3">
        Tomorrow's briefing will be ready at 5am.
      </p>
    </div>
  );
}
