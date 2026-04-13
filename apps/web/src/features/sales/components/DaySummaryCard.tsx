import type { RepPipelineDeal } from "../lib/types";

export function DaySummaryCard({
  pipeline,
}: {
  pipeline: RepPipelineDeal[];
}) {
  const warmDeals = pipeline.filter((d) => d.heat_status === "warm").length;
  const totalValue = pipeline.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-4">
      <p className="text-sm font-semibold text-slate-700 mb-2">
        Today's Summary
      </p>
      <div className="space-y-1.5 text-sm text-slate-600">
        <p>
          {pipeline.length} active {pipeline.length === 1 ? "deal" : "deals"} in
          pipeline
        </p>
        <p>{warmDeals} deals with recent activity</p>
        <p>Total pipeline value: ${totalValue.toLocaleString()}</p>
      </div>
      <p className="text-xs text-slate-400 mt-3">
        Tomorrow's briefing will be ready at 5am.
      </p>
    </div>
  );
}
