/**
 * Parts widgets — cross-module bridges from the parts feature into the
 * Iron dashboards. v1 ships the auto-replenish queue summary; more parts
 * widgets land in follow-up slices.
 */
import { Link } from "react-router-dom";
import { Widget } from "../Widget";
import { useReplenishQueue } from "@/features/parts/hooks/useReplenishQueue";
import { Boxes, ArrowUpRight } from "lucide-react";

export function PartsReplenishQueueWidget() {
  const { data, isLoading, isError } = useReplenishQueue();
  const pending = data?.pendingCount ?? 0;
  const autoApproved = data?.autoApprovedCount ?? 0;
  const total = data?.totalEstimated ?? 0;
  const rows = (data?.rows ?? []).slice(0, 4);

  return (
    <Widget
      title="Parts replenishment queue"
      description="Auto-suggested parts orders awaiting review."
      icon={<Boxes className="h-4 w-4" />}
      loading={isLoading}
      error={isError ? "Failed to load replenish queue." : null}
      action={
        <Link
          to="/parts"
          className="inline-flex items-center gap-1 text-xs font-medium text-qep-orange hover:underline"
        >
          Open
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      }
    >
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pending</p>
          <p className="text-lg font-bold text-amber-400">{pending}</p>
        </div>
        <div className="rounded-lg border border-border p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto-approved</p>
          <p className="text-lg font-bold text-emerald-400">{autoApproved}</p>
        </div>
        <div className="rounded-lg border border-border p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated</p>
          <p className="text-lg font-bold text-foreground">${(total / 1000).toFixed(1)}K</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Queue is clear — nothing waiting.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{r.part_number}</p>
                {r.vendor_name && (
                  <p className="text-[10px] text-muted-foreground">{r.vendor_name}</p>
                )}
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                qty {r.recommended_qty}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
