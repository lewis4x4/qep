import { TrendingUp, AlertTriangle, Activity, Sparkles } from "lucide-react";
import type { RepPipelineDeal } from "../lib/types";
import { filterDealsByInsight } from "../lib/insight-filters";

interface PipelinePulseProps {
  deals: RepPipelineDeal[];
}

type Tone = "positive" | "warning" | "neutral";

interface Pulse {
  tone: Tone;
  icon: React.ReactNode;
  text: string;
}

const TONE_STYLES: Record<
  Tone,
  { border: string; bg: string; iconColor: string; accent: string }
> = {
  positive: {
    border: "border-emerald-500/25",
    bg: "bg-emerald-500/[0.05]",
    iconColor: "text-emerald-400",
    accent: "text-emerald-300",
  },
  warning: {
    border: "border-amber-500/25",
    bg: "bg-amber-500/[0.05]",
    iconColor: "text-amber-400",
    accent: "text-amber-300",
  },
  neutral: {
    border: "border-qep-orange/20",
    bg: "bg-qep-orange/[0.04]",
    iconColor: "text-qep-orange",
    accent: "text-qep-orange",
  },
};

export function PipelinePulse({ deals }: PipelinePulseProps) {
  const pulse = buildPulse(deals);
  if (!pulse) return null;

  const styles = TONE_STYLES[pulse.tone];

  return (
    <div className="px-4 pt-2.5 pb-0.5">
      <div
        className={`flex items-center gap-2.5 px-3 py-2 rounded-[12px] border ${styles.border} ${styles.bg}`}
      >
        <span className={`shrink-0 ${styles.iconColor}`}>{pulse.icon}</span>
        <p className="text-[12.5px] text-foreground/90 leading-snug flex-1">
          {pulse.text}
        </p>
      </div>
    </div>
  );
}

function buildPulse(deals: RepPipelineDeal[]): Pulse | null {
  if (deals.length === 0) return null;

  const atRisk = filterDealsByInsight(deals, "at_risk").length;
  const closingSoon = filterDealsByInsight(deals, "closing_soon").length;
  const hotToPush = filterDealsByInsight(deals, "hot_to_push").length;
  const noNextStep = filterDealsByInsight(deals, "no_next_step").length;

  // Highest-signal rule wins.

  if (closingSoon >= 2 && hotToPush >= 1) {
    return {
      tone: "positive",
      icon: <Sparkles className="w-4 h-4" />,
      text: `Strong momentum — ${closingSoon} closing this week${
        hotToPush > 0 ? ` and ${hotToPush} hot to push` : ""
      }.`,
    };
  }

  if (atRisk >= 3) {
    return {
      tone: "warning",
      icon: <AlertTriangle className="w-4 h-4" />,
      text: `${atRisk} deals are cooling. Re-engage before they slip.`,
    };
  }

  if (closingSoon >= 1) {
    return {
      tone: "neutral",
      icon: <TrendingUp className="w-4 h-4" />,
      text: `${closingSoon} ${
        closingSoon === 1 ? "deal closes" : "deals close"
      } this week. Lock them down.`,
    };
  }

  if (noNextStep > deals.length / 2 && deals.length >= 3) {
    return {
      tone: "warning",
      icon: <AlertTriangle className="w-4 h-4" />,
      text: `${noNextStep} deals have no next step. Cadence is slipping.`,
    };
  }

  if (hotToPush >= 2) {
    return {
      tone: "positive",
      icon: <Sparkles className="w-4 h-4" />,
      text: `${hotToPush} hot deals in play. Push for close.`,
    };
  }

  if (deals.length >= 5 && atRisk === 0 && closingSoon === 0) {
    return {
      tone: "neutral",
      icon: <Activity className="w-4 h-4" />,
      text: "Steady pipeline. No fires, no fast closes — prospect to build momentum.",
    };
  }

  return null;
}
