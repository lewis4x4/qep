/**
 * HealthScorePill — Inline health score indicator for cards, rows, and lists.
 *
 * Shows the numeric score in a color-coded pill with an optional delta arrow.
 * Clicking opens the HealthScoreDrawer for the full explainer.
 *
 * Used on: company cards, deal rows, contact lists, command center tiles.
 */
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface HealthScorePillProps {
  score: number | null;
  delta7d?: number | null;
  size?: "sm" | "md";
  onClick?: () => void;
  className?: string;
}

function scoreTier(score: number): { text: string; border: string; bg: string; label: string } {
  if (score >= 80) return { text: "text-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/10", label: "Excellent" };
  if (score >= 60) return { text: "text-blue-400", border: "border-blue-500/40", bg: "bg-blue-500/10", label: "Good" };
  if (score >= 40) return { text: "text-amber-400", border: "border-amber-500/40", bg: "bg-amber-500/10", label: "Fair" };
  return { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10", label: "At risk" };
}

export function HealthScorePill({ score, delta7d, size = "sm", onClick, className = "" }: HealthScorePillProps) {
  if (score == null) return null;

  const tier = scoreTier(score);
  const rounded = Math.round(score);
  const isSm = size === "sm";

  const deltaIcon = delta7d == null || delta7d === 0
    ? <Minus className="h-2.5 w-2.5 opacity-40" />
    : delta7d > 0
      ? <TrendingUp className="h-2.5 w-2.5 text-emerald-400" />
      : <TrendingDown className="h-2.5 w-2.5 text-red-400" />;

  const deltaLabel = delta7d != null && delta7d !== 0
    ? (delta7d > 0 ? `+${delta7d.toFixed(1)}` : delta7d.toFixed(1))
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Health score: ${rounded}/100 — ${tier.label}${deltaLabel ? ` (${deltaLabel} vs last 7d)` : ""}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 ${isSm ? "py-0.5 text-[10px]" : "py-1 text-[11px]"} font-semibold ${tier.border} ${tier.text} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : "cursor-default"} ${className}`}
    >
      <span className="tabular-nums">{rounded}</span>
      {delta7d != null && (
        <>
          {deltaIcon}
          {deltaLabel && <span className="tabular-nums opacity-70">{deltaLabel}</span>}
        </>
      )}
    </button>
  );
}
