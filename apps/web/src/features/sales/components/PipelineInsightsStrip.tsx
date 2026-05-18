import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Target,
  Flame,
  HelpCircle,
  Crown,
} from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";

interface PipelineInsightsStripProps {
  deals: RepPipelineDeal[];
}

type Insight = {
  key: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  accent: "danger" | "success" | "hot" | "warning" | "gold";
  onTap?: () => void;
};

const ACCENT_STYLES: Record<
  Insight["accent"],
  { bg: string; border: string; iconBg: string; iconColor: string; valueColor: string }
> = {
  danger: {
    bg: "bg-red-500/[0.06]",
    border: "border-red-500/30",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-400",
    valueColor: "text-red-300",
  },
  success: {
    bg: "bg-emerald-500/[0.06]",
    border: "border-emerald-500/30",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    valueColor: "text-emerald-300",
  },
  hot: {
    bg: "bg-qep-orange/[0.08]",
    border: "border-qep-orange/35",
    iconBg: "bg-qep-orange/20",
    iconColor: "text-qep-orange",
    valueColor: "text-qep-orange",
  },
  warning: {
    bg: "bg-amber-500/[0.06]",
    border: "border-amber-500/30",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    valueColor: "text-amber-300",
  },
  gold: {
    bg: "bg-yellow-500/[0.06]",
    border: "border-yellow-500/30",
    iconBg: "bg-yellow-500/15",
    iconColor: "text-yellow-400",
    valueColor: "text-yellow-300",
  },
};

export function PipelineInsightsStrip({ deals }: PipelineInsightsStripProps) {
  const navigate = useNavigate();
  const insights = buildInsights(deals, navigate);
  if (insights.length === 0) return null;

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-extrabold text-muted-foreground/70 uppercase tracking-[0.12em]">
          AI Insights
        </p>
        <p className="text-[10px] text-muted-foreground/50 italic">
          tap to focus
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
          <InsightCard key={insight.key} insight={insight} />
        ))}
        <div className="shrink-0 w-1" aria-hidden />
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const styles = ACCENT_STYLES[insight.accent];
  return (
    <button
      type="button"
      onClick={insight.onTap}
      disabled={!insight.onTap}
      className={`group snap-start shrink-0 w-[148px] text-left rounded-[14px] border px-3 py-2.5 transition-all active:scale-[0.98] ${styles.bg} ${styles.border} ${
        insight.onTap ? "cursor-pointer hover:brightness-110" : "cursor-default"
      }`}
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
): Insight[] {
  if (deals.length === 0) return [];

  const now = Date.now();
  const DAY = 86_400_000;

  // ── 1. At risk: cold OR stalled 14d+ ──
  const atRisk = deals.filter(
    (d) =>
      d.heat_status === "cold" || (d.days_since_activity ?? 0) >= 14,
  );

  // ── 2. Closing this week (7d) ──
  const closingSoon = deals.filter((d) => {
    if (!d.expected_close_on) return false;
    const days = Math.ceil(
      (new Date(d.expected_close_on).getTime() - now) / DAY,
    );
    return days >= 0 && days <= 7;
  });

  // ── 3. Hot to push (warm + active in last 5d) ──
  const hotToPush = deals.filter(
    (d) =>
      d.heat_status === "warm" && (d.days_since_activity ?? 99) < 5,
  );

  // ── 4. No next step set ──
  const noNextStep = deals.filter(
    (d) =>
      !d.next_follow_up_at &&
      !["won", "lost", "closed_won", "closed_lost"].includes(
        d.stage.toLowerCase().replace(/\s+/g, "_"),
      ),
  );

  // ── 5. Top deal (highest amount) ──
  const topDeal = [...deals]
    .filter((d) => (d.amount ?? 0) > 0)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];

  const insights: Insight[] = [];

  if (atRisk.length > 0) {
    const totalAtRisk = atRisk.reduce((s, d) => s + (d.amount ?? 0), 0);
    insights.push({
      key: "at-risk",
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      label: "At Risk",
      value: `${atRisk.length}`,
      subtitle: `${formatCurrency(totalAtRisk)} cooling — needs attention`,
      accent: "danger",
      onTap: () => navigate(`/sales/deals/${atRisk[0].deal_id}`),
    });
  }

  if (closingSoon.length > 0) {
    const totalClosing = closingSoon.reduce((s, d) => s + (d.amount ?? 0), 0);
    insights.push({
      key: "closing-soon",
      icon: <Target className="w-3.5 h-3.5" />,
      label: "Closing 7d",
      value: `${closingSoon.length}`,
      subtitle: `${formatCurrency(totalClosing)} expected this week`,
      accent: "success",
      onTap: () => navigate(`/sales/deals/${closingSoon[0].deal_id}`),
    });
  }

  if (hotToPush.length > 0) {
    insights.push({
      key: "hot-to-push",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "Hot to Push",
      value: `${hotToPush.length}`,
      subtitle: "Warm + active — close while it's hot",
      accent: "hot",
      onTap: () => navigate(`/sales/deals/${hotToPush[0].deal_id}`),
    });
  }

  if (noNextStep.length > 0) {
    insights.push({
      key: "no-next-step",
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      label: "No Next Step",
      value: `${noNextStep.length}`,
      subtitle: "Schedule a follow-up to keep momentum",
      accent: "warning",
      onTap: () => navigate(`/sales/deals/${noNextStep[0].deal_id}`),
    });
  }

  if (topDeal) {
    insights.push({
      key: "top-deal",
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
