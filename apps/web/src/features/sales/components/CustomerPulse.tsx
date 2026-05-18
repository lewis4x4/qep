import {
  TrendingUp,
  AlertTriangle,
  Activity,
  Sparkles,
} from "lucide-react";
import type { RepCustomer } from "../lib/types";
import { filterCustomersByInsight } from "../lib/customer-insight-filters";

interface CustomerPulseProps {
  customers: RepCustomer[];
}

type Tone = "positive" | "warning" | "neutral";

interface Pulse {
  tone: Tone;
  icon: React.ReactNode;
  text: string;
}

const TONE_STYLES: Record<
  Tone,
  { border: string; bg: string; iconColor: string }
> = {
  positive: {
    border: "border-emerald-500/25",
    bg: "bg-emerald-500/[0.05]",
    iconColor: "text-emerald-400",
  },
  warning: {
    border: "border-amber-500/25",
    bg: "bg-amber-500/[0.05]",
    iconColor: "text-amber-400",
  },
  neutral: {
    border: "border-qep-orange/20",
    bg: "bg-qep-orange/[0.04]",
    iconColor: "text-qep-orange",
  },
};

export function CustomerPulse({ customers }: CustomerPulseProps) {
  const pulse = buildPulse(customers);
  if (!pulse) return null;

  const styles = TONE_STYLES[pulse.tone];

  return (
    <div className="px-4 pt-2.5 pb-0.5">
      <div
        role="status"
        aria-label={`Book pulse: ${pulse.text}`}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-[12px] border ${styles.border} ${styles.bg}`}
      >
        <span aria-hidden className={`shrink-0 ${styles.iconColor}`}>
          {pulse.icon}
        </span>
        <p className="text-[12.5px] text-foreground/90 leading-snug flex-1">
          {pulse.text}
        </p>
      </div>
    </div>
  );
}

function buildPulse(customers: RepCustomer[]): Pulse | null {
  if (customers.length === 0) return null;

  const hot = filterCustomersByInsight(customers, "hot").length;
  const activeDeals = filterCustomersByInsight(customers, "active_deals").length;
  const activeQuotes = filterCustomersByInsight(customers, "active_quotes").length;
  const goneQuiet = filterCustomersByInsight(customers, "gone_quiet").length;
  const neverTouched = filterCustomersByInsight(customers, "never_touched").length;
  const dueFollowup = filterCustomersByInsight(customers, "due_followup").length;

  // Highest-signal rule wins.

  if (goneQuiet >= 5 && activeQuotes >= 1) {
    return {
      tone: "warning",
      icon: <AlertTriangle className="w-4 h-4" />,
      text: `Mixed signal — ${goneQuiet} accounts going quiet, ${activeQuotes} quotes in flight. Push the quotes.`,
    };
  }

  if (goneQuiet >= 5) {
    return {
      tone: "warning",
      icon: <AlertTriangle className="w-4 h-4" />,
      text: `${goneQuiet} accounts haven't been contacted in 30+ days. Re-engage before they churn.`,
    };
  }

  if (hot >= 5 && activeDeals >= 3) {
    return {
      tone: "positive",
      icon: <Sparkles className="w-4 h-4" />,
      text: `Strong book — ${hot} hot customers and ${activeDeals} with active deals.`,
    };
  }

  if (activeQuotes >= 3) {
    return {
      tone: "positive",
      icon: <Sparkles className="w-4 h-4" />,
      text: `${activeQuotes} quotes in flight. Follow up to convert them.`,
    };
  }

  if (neverTouched >= 3 && customers.length >= 10) {
    return {
      tone: "neutral",
      icon: <TrendingUp className="w-4 h-4" />,
      text: `${neverTouched} customers have never been contacted. Easy wins.`,
    };
  }

  if (dueFollowup >= 3) {
    return {
      tone: "warning",
      icon: <AlertTriangle className="w-4 h-4" />,
      text: `${dueFollowup} accounts are overdue for follow-up. Keep cadence tight.`,
    };
  }

  if (customers.length >= 10 && goneQuiet === 0 && dueFollowup === 0) {
    return {
      tone: "positive",
      icon: <Activity className="w-4 h-4" />,
      text: "Healthy coverage — every account has a recent touch.",
    };
  }

  return null;
}
