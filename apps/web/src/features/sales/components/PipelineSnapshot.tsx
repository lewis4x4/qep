import type { PipelineStats } from "../lib/types";

export function PipelineSnapshot({ stats }: { stats: PipelineStats }) {
  return (
    <div className="bg-[hsl(var(--card))] rounded-xl border border-white/[0.08] px-4 py-4 flex items-center justify-between">
      <Stat
        label="Deals"
        value={String(stats.deals_in_pipeline)}
      />
      <div className="w-px h-10 bg-white/[0.08]" />
      <Stat
        label="Pipeline"
        value={formatCurrency(stats.total_pipeline_value)}
        accent
      />
      <div className="w-px h-10 bg-white/[0.08]" />
      <Stat
        label="Quotes"
        value={String(stats.quotes_sent_this_week)}
        sub="this week"
      />
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="text-center px-2 flex-1">
      <p
        className={`text-[22px] font-extrabold tracking-tight ${
          accent
            ? "text-qep-orange"
            : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-0.5">
        {label}
      </p>
      {sub && (
        <p className="text-[10px] text-muted-foreground/60">{sub}</p>
      )}
    </div>
  );
}
