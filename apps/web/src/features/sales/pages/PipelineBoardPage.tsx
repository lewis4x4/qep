import { useSalesPipeline } from "../hooks/useSalesPipeline";
import { StageFilterTabs } from "../components/StageFilterTabs";
import { SalesDealCard } from "../components/SalesDealCard";
import {
  TrendingUp,
  Flame,
  Clock,
  Check,
} from "lucide-react";

/* ── Stage color palette for progress bar ───────────────── */
const STAGE_BAR_COLORS = [
  "bg-blue-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-orange-400",
  "bg-qep-orange",
  "bg-emerald-500",
];

export function PipelineBoardPage() {
  const {
    deals,
    allDeals,
    activeFilter,
    setActiveFilter,
    stageCounts,
    stages,
    isLoading,
  } = useSalesPipeline();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Compute pipeline analytics ──
  const totalValue = allDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  // Weighted value: estimate probability based on stage position
  const weightedValue = allDeals.reduce((sum, d) => {
    const maxSort = stages.length > 0 ? Math.max(...stages.map((s) => s.sort_order)) : 1;
    const pct = maxSort > 0 ? (d.stage_sort / maxSort) * 100 : 30;
    return sum + (d.amount ?? 0) * (pct / 100);
  }, 0);

  const hotCount = allDeals.filter((d) => d.heat_status === "warm").length;
  const stalledCount = allDeals.filter(
    (d) => (d.days_since_activity ?? 0) >= 10,
  ).length;
  const closingCount = allDeals.filter((d) => {
    if (!d.expected_close_on) return false;
    const days = Math.ceil(
      (new Date(d.expected_close_on).getTime() - Date.now()) / 86_400_000,
    );
    return days >= 0 && days <= 14;
  }).length;

  // Win rate (placeholder — could be computed from historical data)
  const winRate = allDeals.length > 0 ? Math.round((closingCount / allDeals.length) * 100) : 0;

  // Build filter options
  const filterOptions = [
    { key: "all", label: "All", count: stageCounts.all ?? 0 },
    ...stages.map((s) => ({
      key: s.name.toLowerCase().replace(/\s+/g, "_"),
      label: s.name,
      count: stageCounts[s.name.toLowerCase().replace(/\s+/g, "_")] ?? 0,
    })),
  ];

  // Stage distribution for progress bar
  const stageDistribution = stages.map((s, i) => {
    const key = s.name.toLowerCase().replace(/\s+/g, "_");
    const count = stageCounts[key] ?? 0;
    const pct = allDeals.length > 0 ? Math.max((count / allDeals.length) * 100, 4) : 0;
    return { pct, color: STAGE_BAR_COLORS[i % STAGE_BAR_COLORS.length], label: s.name, count };
  });

  return (
    <div className="flex flex-col pb-20 max-w-lg mx-auto">
      {/* Forecast Hero */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        {/* Title + Weighted */}
        <div className="flex items-start justify-between mb-2.5">
          <div>
            <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-0.5">
              {new Date().toLocaleDateString(undefined, { month: "long" })} Pipeline
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-[26px] font-black text-foreground tracking-[-0.02em]">
                {formatCurrency(totalValue)}
              </span>
              {allDeals.length > 0 && (
                <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {allDeals.length} deals
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em] mb-0.5">
              Weighted
            </p>
            <span className="text-lg font-extrabold text-qep-orange">
              {formatCurrency(weightedValue)}
            </span>
          </div>
        </div>

        {/* Stage progress bar */}
        {stageDistribution.length > 0 && (
          <div className="flex gap-[3px] h-1.5 rounded-[3px] overflow-hidden mb-2.5">
            {stageDistribution.map((seg, i) => (
              <div
                key={i}
                className={`${seg.color} opacity-85`}
                style={{ flex: seg.pct }}
                title={`${seg.label}: ${seg.count}`}
              />
            ))}
          </div>
        )}

        {/* Quick stats row */}
        <div className="flex gap-2">
          <QuickStat
            label="Hot"
            value={hotCount}
            icon={<Flame className="w-[13px] h-[13px]" />}
            variant="danger"
          />
          <QuickStat
            label="Stalled"
            value={stalledCount}
            icon={<Clock className="w-[13px] h-[13px]" />}
            variant="warning"
          />
          <QuickStat
            label="Closing"
            value={closingCount}
            icon={<Check className="w-[13px] h-[13px]" />}
            variant="success"
          />
          <QuickStat
            label="Win Rate"
            value={`${winRate}%`}
            variant="neutral"
          />
        </div>
      </div>

      {/* Stage filter tabs */}
      <StageFilterTabs
        options={filterOptions}
        active={activeFilter}
        onChange={setActiveFilter}
      />

      {/* Deal cards */}
      <div className="px-4 py-3.5 flex flex-col gap-2.5">
        {deals.map((deal) => (
          <SalesDealCard key={deal.deal_id} deal={deal} stages={stages} />
        ))}

        {deals.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">
              {activeFilter === "all"
                ? "No active deals in your pipeline."
                : `No deals in ${activeFilter.replace(/_/g, " ")}. Looking good — or time to prospect?`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Currency formatter ─────────────────────────────────── */
function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

/* ── Quick stat card ────────────────────────────────────── */
function QuickStat({
  label,
  value,
  icon,
  variant,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  variant: "danger" | "warning" | "success" | "neutral";
}) {
  const styles = {
    danger: {
      bg: "bg-red-500/10",
      border: "border-red-500/25",
      text: "text-red-400",
    },
    warning: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/25",
      text: "text-amber-400",
    },
    success: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/25",
      text: "text-emerald-400",
    },
    neutral: {
      bg: "bg-[hsl(var(--card))]",
      border: "border-white/[0.06]",
      text: "text-foreground",
    },
  }[variant];

  return (
    <div
      className={`flex-1 px-2.5 py-2 rounded-[10px] border ${styles.bg} ${styles.border}`}
    >
      <p className="text-[10px] text-muted-foreground/60 font-bold uppercase tracking-[0.04em] mb-0.5">
        {label}
      </p>
      <p
        className={`text-[15px] font-extrabold flex items-center gap-1 ${styles.text}`}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}
