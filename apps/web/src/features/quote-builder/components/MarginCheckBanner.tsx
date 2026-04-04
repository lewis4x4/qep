import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle } from "lucide-react";

interface MarginCheckBannerProps {
  marginPct: number | null;
}

export function MarginCheckBanner({ marginPct }: MarginCheckBannerProps) {
  if (marginPct === null) return null;

  const isFlagged = marginPct < 10;
  const isHealthy = marginPct >= 20;

  if (isFlagged) {
    return (
      <Card className="border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-400">
            Margin {marginPct.toFixed(1)}% — Requires Iron Manager Approval
          </p>
          <p className="mt-1 text-xs text-red-300">
            Deals under 10% margin cannot proceed without explicit manager approval per SOP.
            This quote will be flagged in the approval queue.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <CheckCircle className={`h-3.5 w-3.5 ${isHealthy ? "text-emerald-400" : "text-amber-400"}`} />
      <span className={isHealthy ? "text-emerald-400" : "text-amber-400"}>
        Margin: {marginPct.toFixed(1)}%
        {isHealthy ? " (healthy)" : marginPct >= 10 ? " (acceptable)" : ""}
      </span>
    </div>
  );
}
