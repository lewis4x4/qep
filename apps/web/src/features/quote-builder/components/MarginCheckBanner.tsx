import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle } from "lucide-react";

interface MarginCheckBannerProps {
  marginPct: number | null;
  /** Pass waterfall data to show the margin cascade visualization. */
  waterfall?: {
    equipmentTotal: number;
    dealerCost: number;
    tradeAllowance: number;
    netTotal: number;
    marginAmount: number;
  } | null;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function WaterfallBar({ label, value, maxValue, isPositive }: { label: string; value: number; maxValue: number; isPositive: boolean }) {
  const pct = maxValue > 0 ? Math.min(100, Math.abs(value) / maxValue * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 text-right text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden relative">
        <div
          className={cn("h-full rounded transition-all", isPositive ? "bg-emerald-500/60" : "bg-rose-500/60")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("w-20 text-right tabular-nums font-medium shrink-0", isPositive ? "text-emerald-400" : "text-rose-400")}>
        {isPositive ? "" : "−"}{fmt(Math.abs(value))}
      </span>
    </div>
  );
}

export function MarginCheckBanner({ marginPct, waterfall }: MarginCheckBannerProps) {
  if (marginPct === null) return null;

  const isFlagged = marginPct < 10;
  const isHealthy = marginPct >= 20;

  return (
    <div className="space-y-3">
      {/* Status banner */}
      {isFlagged ? (
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
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle className={cn("h-3.5 w-3.5", isHealthy ? "text-emerald-400" : "text-amber-400")} />
          <span className={isHealthy ? "text-emerald-400" : "text-amber-400"}>
            Margin: {marginPct.toFixed(1)}%
            {isHealthy ? " (healthy)" : marginPct >= 10 ? " (acceptable)" : ""}
          </span>
        </div>
      )}

      {/* Waterfall visualization */}
      {waterfall && waterfall.equipmentTotal > 0 && (
        <Card className="border-border/60 bg-card/60 p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-2">Margin Waterfall</p>
          <WaterfallBar label="Equipment" value={waterfall.equipmentTotal} maxValue={waterfall.equipmentTotal} isPositive={true} />
          <WaterfallBar label="Dealer Cost" value={waterfall.dealerCost} maxValue={waterfall.equipmentTotal} isPositive={false} />
          {waterfall.tradeAllowance > 0 && (
            <WaterfallBar label="Trade-In" value={waterfall.tradeAllowance} maxValue={waterfall.equipmentTotal} isPositive={false} />
          )}
          <div className="border-t border-border/60 pt-2 mt-1">
            <WaterfallBar
              label="Net Margin"
              value={waterfall.marginAmount}
              maxValue={waterfall.equipmentTotal}
              isPositive={waterfall.marginAmount >= 0}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
