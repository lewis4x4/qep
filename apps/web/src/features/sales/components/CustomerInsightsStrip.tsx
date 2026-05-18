import {
  Flame,
  Zap,
  FileText,
  Clock,
  Snowflake,
  HelpCircle,
} from "lucide-react";
import type { RepCustomer } from "../lib/types";
import {
  filterCustomersByInsight,
  type CustomerInsightKey,
} from "../lib/customer-insight-filters";

interface CustomerInsightsStripProps {
  customers: RepCustomer[];
  activeFilter: CustomerInsightKey | null;
  onFilterChange: (next: CustomerInsightKey | null) => void;
}

type Accent = "danger" | "success" | "hot" | "warning" | "cold" | "neutral";

interface Insight {
  key: CustomerInsightKey;
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  accent: Accent;
}

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
  cold: {
    bg: "bg-blue-500/[0.06]",
    border: "border-blue-500/30",
    activeBg: "bg-blue-500/15",
    activeBorder: "border-blue-500/60 ring-1 ring-blue-500/40",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    valueColor: "text-blue-300",
  },
  neutral: {
    bg: "bg-foreground/[0.04]",
    border: "border-white/[0.08]",
    activeBg: "bg-foreground/[0.08]",
    activeBorder: "border-white/30 ring-1 ring-white/20",
    iconBg: "bg-white/[0.06]",
    iconColor: "text-foreground/80",
    valueColor: "text-foreground",
  },
};

export function CustomerInsightsStrip({
  customers,
  activeFilter,
  onFilterChange,
}: CustomerInsightsStripProps) {
  const insights = buildInsights(customers);
  if (insights.length === 0) return null;

  const toggle = (key: CustomerInsightKey) =>
    onFilterChange(activeFilter === key ? null : key);

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <p
          id="customer-insights-heading"
          className="text-[10px] font-extrabold text-muted-foreground/70 uppercase tracking-[0.12em]"
        >
          AI Insights
        </p>
        <p className="text-[10px] text-muted-foreground/50 italic">
          tap to filter
        </p>
      </div>
      <div
        role="group"
        aria-labelledby="customer-insights-heading"
        className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {insights.map((insight) => (
          <InsightCard
            key={insight.key}
            insight={insight}
            isActive={activeFilter === insight.key}
            onToggle={() => toggle(insight.key)}
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
  onToggle,
}: {
  insight: Insight;
  isActive: boolean;
  onToggle: () => void;
}) {
  const styles = ACCENT_STYLES[insight.accent];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isActive}
      aria-label={`${insight.label} filter: ${insight.value}. ${insight.subtitle}`}
      className={`group snap-start shrink-0 w-[148px] min-h-[44px] text-left rounded-[14px] border px-3 py-2.5 transition-all active:scale-[0.98] cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange ${
        isActive
          ? `${styles.activeBg} ${styles.activeBorder}`
          : `${styles.bg} ${styles.border}`
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

function buildInsights(customers: RepCustomer[]): Insight[] {
  if (customers.length === 0) return [];

  const hot = filterCustomersByInsight(customers, "hot");
  const activeDeals = filterCustomersByInsight(customers, "active_deals");
  const activeQuotes = filterCustomersByInsight(customers, "active_quotes");
  const dueFollowup = filterCustomersByInsight(customers, "due_followup");
  const goneQuiet = filterCustomersByInsight(customers, "gone_quiet");
  const neverTouched = filterCustomersByInsight(customers, "never_touched");

  const insights: Insight[] = [];

  if (hot.length > 0) {
    insights.push({
      key: "hot",
      icon: <Flame className="w-3.5 h-3.5" />,
      label: "Hot",
      value: `${hot.length}`,
      subtitle: "Opportunity score 70+",
      accent: "hot",
    });
  }

  if (activeDeals.length > 0) {
    const totalDeals = activeDeals.reduce((s, c) => s + c.open_deals, 0);
    insights.push({
      key: "active_deals",
      icon: <Zap className="w-3.5 h-3.5" />,
      label: "Active Deals",
      value: `${activeDeals.length}`,
      subtitle: `${totalDeals} ${totalDeals === 1 ? "deal" : "deals"} across customers`,
      accent: "success",
    });
  }

  if (activeQuotes.length > 0) {
    const totalQuotes = activeQuotes.reduce((s, c) => s + c.active_quotes, 0);
    insights.push({
      key: "active_quotes",
      icon: <FileText className="w-3.5 h-3.5" />,
      label: "Active Quotes",
      value: `${activeQuotes.length}`,
      subtitle: `${totalQuotes} ${totalQuotes === 1 ? "quote" : "quotes"} in flight`,
      accent: "warning",
    });
  }

  if (dueFollowup.length > 0) {
    insights.push({
      key: "due_followup",
      icon: <Clock className="w-3.5 h-3.5" />,
      label: "Due Follow-up",
      value: `${dueFollowup.length}`,
      subtitle: "Last touched 7-29 days ago",
      accent: "warning",
    });
  }

  if (goneQuiet.length > 0) {
    insights.push({
      key: "gone_quiet",
      icon: <Snowflake className="w-3.5 h-3.5" />,
      label: "Gone Quiet",
      value: `${goneQuiet.length}`,
      subtitle: "30+ days without contact",
      accent: "danger",
    });
  }

  if (neverTouched.length > 0) {
    insights.push({
      key: "never_touched",
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      label: "Never Touched",
      value: `${neverTouched.length}`,
      subtitle: "Dormant accounts ready to open",
      accent: "cold",
    });
  }

  return insights;
}
