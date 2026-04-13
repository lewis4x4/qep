import type { PipelineStats } from "../lib/types";

export function PipelineSnapshot({ stats }: { stats: PipelineStats }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between">
      <Stat label="Deals" value={String(stats.deals_in_pipeline)} />
      <div className="w-px h-8 bg-slate-200" />
      <Stat
        label="Pipeline"
        value={`$${stats.total_pipeline_value >= 1000 ? `${(stats.total_pipeline_value / 1000).toFixed(0)}K` : stats.total_pipeline_value.toLocaleString()}`}
      />
      <div className="w-px h-8 bg-slate-200" />
      <Stat label="Quotes" value={String(stats.quotes_sent_this_week)} sub="this week" />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="text-center px-2">
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">
        {label}
      </p>
      {sub && (
        <p className="text-[10px] text-slate-400">{sub}</p>
      )}
    </div>
  );
}
