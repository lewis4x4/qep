import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2 } from "lucide-react";
import type { TransferSummary } from "../hooks/useTransferRecommendations";
import { useApproveTransfer } from "../hooks/useTransferRecommendations";

function priorityBadge(priority: string) {
  const cls: Record<string, string> = {
    critical: "border-red-500/30 text-red-600 dark:text-red-400",
    high: "border-amber-500/30 text-amber-600 dark:text-amber-400",
    normal: "border-border text-muted-foreground",
    low: "border-border text-muted-foreground/60",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${cls[priority] ?? cls.normal}`}>
      {priority}
    </Badge>
  );
}

function dollars(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

interface Props {
  data?: TransferSummary;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

export function TransferRecommendationsCard({ data, isLoading, isError, errorMessage }: Props) {
  const approveMut = useApproveTransfer();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground animate-pulse">Loading transfer recommendations…</p>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
        {errorMessage ?? "Failed to load transfer recommendations."}
      </Card>
    );
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium">Branch transfers</h2>
        <p className="text-xs text-muted-foreground">
          No pending transfer recommendations. Branch inventory is balanced.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-sm font-medium">Branch transfers</h2>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Pending</p>
          <p className="font-semibold tabular-nums">{data.pendingCount}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Net savings</p>
          <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {dollars(data.totalSavings)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Critical</p>
          <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">
            {data.criticalCount}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
        {data.rows.slice(0, 8).map((r) => (
          <div key={r.id} className="rounded border border-border/50 p-2 text-xs space-y-1">
            <div className="flex items-center gap-1.5 justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono font-medium">{r.part_number}</span>
                {priorityBadge(r.priority)}
              </div>
              <span className="text-emerald-600 dark:text-emerald-400 shrink-0 font-medium tabular-nums">
                +{dollars(r.net_savings)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>{r.from_branch_id}</span>
              <ArrowRight className="h-3 w-3" />
              <span>{r.to_branch_id}</span>
              <span className="ml-1">×{r.recommended_qty}</span>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                disabled={approveMut.isPending && pendingId === r.id}
                onClick={() => {
                  setPendingId(r.id);
                  approveMut.mutate({ id: r.id, action: "approved" }, { onSettled: () => setPendingId(null) });
                }}
              >
                {approveMut.isPending && pendingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2 text-muted-foreground"
                disabled={approveMut.isPending && pendingId === r.id}
                onClick={() => {
                  setPendingId(r.id);
                  approveMut.mutate({ id: r.id, action: "rejected" }, { onSettled: () => setPendingId(null) });
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
