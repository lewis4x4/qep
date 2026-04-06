import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useReplenishQueue,
  useApproveReplenish,
  type ReplenishSummary,
} from "../hooks/useReplenishQueue";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "pending"
      ? "bg-amber-500"
      : status === "auto_approved"
        ? "bg-emerald-500"
        : "bg-muted-foreground";
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function dollars(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  data?: ReplenishSummary;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

export function ReplenishmentApprovalCard({ data, isLoading, isError, errorMessage }: Props) {
  const [expanded, setExpanded] = useState(false);
  const approve = useApproveReplenish();

  if (isLoading) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground animate-pulse">Loading replenishment queue…</p>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className="p-4 text-sm text-destructive border-destructive/40" role="alert">
        {errorMessage ?? "Failed to load replenishment queue."}
      </Card>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <Card className="p-4 space-y-1">
        <h2 className="text-sm font-medium">Auto-replenishment</h2>
        <p className="text-xs text-muted-foreground">No pending replenishment requests.</p>
      </Card>
    );
  }

  const { rows, pendingCount, autoApprovedCount, totalEstimated } = data;
  const shown = expanded ? rows : rows.slice(0, 5);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Auto-replenishment</h2>
        <div className="flex items-center gap-2 text-xs">
          {pendingCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
              {pendingCount} pending
            </Badge>
          )}
          {autoApprovedCount > 0 && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              {autoApprovedCount} auto-approved
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Queue items</p>
          <p className="font-semibold tabular-nums">{rows.length}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground uppercase">Est. total</p>
          <p className="font-semibold tabular-nums">{dollars(totalEstimated)}</p>
        </div>
      </div>

      <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
        {shown.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-2 rounded border border-border/50 p-2 text-xs"
          >
            <StatusDot status={r.status} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-medium truncate">{r.part_number}</span>
                <span className="text-muted-foreground">×{r.recommended_qty}</span>
                <span className="text-muted-foreground ml-auto tabular-nums">
                  {dollars(r.estimated_total)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>{r.branch_id}</span>
                {r.vendor_name && (
                  <>
                    <span>·</span>
                    <span className="truncate">{r.vendor_name}</span>
                  </>
                )}
                {r.vendor_score != null && (
                  <>
                    <span>·</span>
                    <span className="tabular-nums">{(r.vendor_score * 100).toFixed(0)}%</span>
                  </>
                )}
              </div>
              {r.vendor_selection_reason && (
                <p className="text-[10px] text-muted-foreground/70 truncate">
                  {r.vendor_selection_reason}
                </p>
              )}
            </div>
            {r.status === "pending" && (
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate({ id: r.id, action: "approve" })}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2 text-destructive"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate({ id: r.id, action: "reject" })}
                >
                  Reject
                </Button>
              </div>
            )}
            {r.status === "auto_approved" && (
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shrink-0"
              >
                Auto
              </Badge>
            )}
          </div>
        ))}
      </div>

      {rows.length > 5 && (
        <button
          type="button"
          className="text-xs text-primary hover:underline underline-offset-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show all ${rows.length} items`}
        </button>
      )}

      {approve.isError && (
        <p className="text-xs text-destructive">
          {(approve.error as Error)?.message ?? "Action failed."}
        </p>
      )}
    </Card>
  );
}
