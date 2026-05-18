import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Target,
  Flame,
  HelpCircle,
  Crown,
} from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";
import {
  filterDealsByInsight,
  type InsightFilterKey,
} from "../lib/insight-filters";

interface PipelineInsightsStripProps {
  deals: RepPipelineDeal[];
  activeFilter: InsightFilterKey | null;
  onFilterChange: (next: InsightFilterKey | null) => void;
}

type Accent = "danger" | "success" | "hot" | "warning" | "gold";

type Insight = {
  key: string;
  filterKey: InsightFilterKey | null;
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  accent: Accent;
  onTap?: () => void;
};

const ACCENT_STYLES: Record<
  Accent,
  {
    bg: string;
    border: string;
    activeBg: string;
    activeBorder: string;
    iconBg: string;
    iconColor: string;
    valueColor: string;
  }
> = {
  danger: {
    bg: "bg-red-500/[0.06]",
    border: "border-red-500/30",
    activeBg: "bg-red-500/15",
    activeBorder: "border-red-500/60 ring-1 ring-red-500/40",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-400",
    valueColor: "text-red-300",
  },
  success: {
    bg: "bg-emerald-500/[0.06]",
    border: "border-emerald-500/30",
    activeBg: "bg-emerald-500/15",
    activeBorder: "border-emerald-500/60 ring-1 ring-emerald-500/40",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    valueColor: "text-emerald-300",
  },
  hot: {
    bg: "bg-qep-orange/[0.08]",
    border: "border-qep-orange/35",
    activeBg: "bg-qep-orange/20",
    activeBorder: "border-qep-orange ring-1 ring-qep-orange/50",
    iconBg: "bg-qep-orange/20",
    iconColor: "text-qep-orange",
    valueColor: "text-qep-orange",
  },
  warning: {
    bg: "bg-amber-500/[0.06]",
    border: "border-amber-500/30",
    activeBg: "bg-amber-500/15",
    activeBorder: "border-amber-500/60 ring-1 ring-amber-500/40",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    valueColor: "text-amber-300",
  },
  gold: {
    bg: "bg-yellow-500/[0.06]",
    border: "border-yellow-500/30",
    activeBg: "bg-yellow-500/15",
    activeBorder: "border-yellow-500/60 ring-1 ring-yellow-500/40",
    iconBg: "bg-yellow-500/15",
    iconColor: "text-yellow-400",
    valueColor: "text-yellow-300",
  },
};

export function PipelineInsightsStrip({
  deals,
  activeFilter,
  onFilterChange,
}: PipelineInsightsStripProps) {
  const navigate = useNavigate();
  const insights = buildInsights(deals, navigate, activeFilter, onFilterChange);
  if (insights.length === 0) return null;

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-extrabold text-muted-foreground/70 uppercase tracking-[0.12em]">
          AI Insights
        </p>
        <p className="text-[10px] text-muted-foreground/50 italic">
          tap to filter
        </p>
      </div>
      <div
        className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {insights.map((insight) => (
          <InsightCard
            key={insight.key}
            insight={insight}
            isActive={
              insight.filterKey !== null && insight.filterKey === activeFilter
            }
          />
        ))}
        <div className="shrink-0 w-1" aria-hidden />
      </div>
    </div>
  );
}

function InsightCard({
  insight,
  isActive,
}: {
  insight: Insight;
  isActive: boolean;
}) {
  const styles = ACCENT_STYLES[insight.accent];
  return (
    <button
      type="button"
      onClick={insight.onTap}
      disabled={!insight.onTap}
      className={`group snap-start shrink-0 w-[148px] text-left rounded-[14px] border px-3 py-2.5 transition-all active:scale-[0.98] ${
        isActive
          ? `${styles.activeBg} ${styles.activeBorder}`
          : `${styles.bg} ${styles.border}`
      } ${insight.onTap ? "cursor-pointer hover:brightness-110" : "cursor-default"}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <div
          className={`w-6 h-6 rounded-[7px] flex items-center justify-center ${styles.iconBg}`}
        >
          <span className={styles.iconColor}>{insight.icon}</span>
        </div>
        <p className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-[0.06em] truncate">
          {insight.label}
        </p>
      </div>
      <p className={`text-[18px] font-black leading-none mb-1 ${styles.valueColor}`}>
        {insight.value}
      </p>
      <p className="text-[10.5px] text-muted-foreground/85 leading-snug line-clamp-2">
        {insight.subtitle}
      </p>
    </button>
  );
}

function buildInsights(
  deals: RepPipelineDeal[],
  navigate: (path: string) => void,
  activeFilter: InsightFilterKey | null,
  onFilterChange: (next: InsightFilterKey | null) => void,
): Insight[] {
  if (deals.length === 0) return [];

  const toggleFilter = (key: InsightFilterKey) => {
    onFilterChange(activeFilter === key ? null : key);
  };

  const atRisk = filterDealsByInsight(deals, "at_risk");
  const closingSoon = filterDealsByInsight(deals, "closing_soon");
  const hotToPush = filterDealsByInsight(deals, "hot_to_push");
  const noNextStep = filterDealsByInsight(deals, "no_next_step");

  const topDeal = [...deals]
    .filter((d) => (d.amount ?? 0) > 0)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];

  const insights: Insight[] = [];

  if (atRisk.length > 0) {
    const totalAtRisk = atRisk.reduce((s, d) => s + (d.amount ?? 0), 0);
    insights.push({
      key: "at-risk",
      filterKey: "at_risk",
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      label: "At Risk",
      value: `${atRisk.length}`,
      subtitle: `${formatCurrency(totalAtRisk)} cooling — needs attention`,
      accent: "danger",
      onTap: () => toggleFilter("at_risk"),
    });
  }

  if (closingSoon.length > 0) {
    const totalClosing = closingSoon.reduce((s, d) => s + (d.amount ?? 0), 0);
    insights.push({
      key: "closing-soon",
      filterKey: "closing_soon",
      icon: <Target className="w-3.5 h-3.5" />,
      label: "Closing 7d",
      value: `${closingSoon.length}`,
      subtitle: `${formatCurrency(totalClosing)} expected this week`,
      accent: "success",
      onTap: () => toggleFilter("closing_soon"),
    });
  }

  if (hotToPush.length > 0) {
    insights.push({
      key: "hot-to-push",
      filterKey: "hot_to_push",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "Hot to Push",
      value: `${hotToPush.length}`,
      subtitle: "Warm + active — close while it's hot",
      accent: "hot",
      onTap: () => toggleFilter("hot_to_push"),
    });
  }

  if (noNextStep.length > 0) {
    insights.push({
      key: "no-next-step",
      filterKey: "no_next_step",
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      label: "No Next Step",
      value: `${noNextStep.length}`,
      subtitle: "Schedule a follow-up to keep momentum",
      accent: "warning",
      onTap: () => toggleFilter("no_next_step"),
    });
  }

  if (topDeal) {
    insights.push({
      key: "top-deal",
      filterKey: null,
      icon: <Crown className="w-3.5 h-3.5" />,
      label: "Top Deal",
      value: formatCurrency(topDeal.amount ?? 0),
      subtitle: topDeal.customer_name || topDeal.deal_name,
      accent: "gold",
      onTap: () => navigate(`/sales/deals/${topDeal.deal_id}`),
    });
  }

  return insights;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}
