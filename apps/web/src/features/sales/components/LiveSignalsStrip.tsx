import { useNavigate } from "react-router-dom";
import { Snowflake, Flame, Clock, FileWarning } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";

export interface LiveSignalsStripProps {
  pipeline: RepPipelineDeal[];
  expiringQuoteCount?: number;
}

interface Signal {
  key: string;
  icon: LucideIcon;
  iconClass: string;
  label: string;
  count: number;
  to: string;
}

export function LiveSignalsStrip({
  pipeline,
  expiringQuoteCount = 0,
}: LiveSignalsStripProps) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;

  const coolingCount = pipeline.filter(
    (d) => d.heat_status === "cooling" || d.heat_status === "cold",
  ).length;
  const closingSoonCount = pipeline.filter(
    (d) =>
      d.expected_close_on &&
      new Date(d.expected_close_on).getTime() - now < week,
  ).length;
  const quietCount = pipeline.filter(
    (d) => (d.days_since_activity ?? 0) >= 14,
  ).length;

  const signals: Signal[] = [
    {
      key: "closing",
      icon: Flame,
      iconClass: "text-qep-orange",
      label: "Closing this week",
      count: closingSoonCount,
      to: "/sales/pipeline?filter=closing_this_week",
    },
    {
      key: "cooling",
      icon: Snowflake,
      iconClass: "text-sky-400",
      label: "Cooling deals",
      count: coolingCount,
      to: "/sales/pipeline?filter=cooling",
    },
    {
      key: "quiet",
      icon: Clock,
      iconClass: "text-amber-400",
      label: "Quiet 14d+",
      count: quietCount,
      to: "/sales/pipeline?filter=quiet",
    },
    {
      key: "quotes",
      icon: FileWarning,
      iconClass: "text-purple-400",
      label: "Quotes expiring",
      count: expiringQuoteCount,
      to: "/sales/quotes?filter=expiring",
    },
  ];

  const visible = signals.filter((s) => s.count > 0);
  if (visible.length === 0) return null;

  return (
    <div
      data-testid="live-signals-strip"
      className="-mx-4 px-4 overflow-x-auto scrollbar-hide"
    >
      <div className="flex gap-2 pb-1 min-w-min">
        {visible.map((signal) => (
          <SignalChip key={signal.key} signal={signal} />
        ))}
      </div>
    </div>
  );
}

function SignalChip({ signal }: { signal: Signal }) {
  const navigate = useNavigate();
  const Icon = signal.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(signal.to)}
      className="flex items-center gap-2 px-3 py-2 rounded-full bg-[hsl(var(--card))] border border-white/[0.08] hover:border-white/[0.18] active:scale-95 transition-all whitespace-nowrap"
    >
      <Icon className={`w-3.5 h-3.5 ${signal.iconClass}`} aria-hidden="true" />
      <span className="text-xs font-semibold text-foreground">
        {signal.count}
      </span>
      <span className="text-xs text-muted-foreground">{signal.label}</span>
    </button>
  );
}
