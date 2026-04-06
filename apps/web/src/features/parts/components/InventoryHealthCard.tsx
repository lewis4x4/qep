import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { PartCrossRefPanel } from "./PartCrossRefPanel";
import type { InventoryHealthRow, StockStatus } from "../hooks/useInventoryHealth";

const STATUS_CONFIG: Record<StockStatus, { label: string; color: string; dotColor: string }> = {
  stockout: { label: "Stockout", color: "text-red-700 dark:text-red-400", dotColor: "bg-red-500" },
  critical: { label: "Critical", color: "text-amber-700 dark:text-amber-400", dotColor: "bg-amber-500" },
  reorder: { label: "Reorder", color: "text-yellow-700 dark:text-yellow-400", dotColor: "bg-yellow-500" },
  no_profile: { label: "Low", color: "text-muted-foreground", dotColor: "bg-muted-foreground" },
  healthy: { label: "OK", color: "text-green-700 dark:text-green-400", dotColor: "bg-green-500" },
};

function StockStatusBadge({ status }: { status: StockStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase ${cfg.color}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
      {cfg.label}
    </span>
  );
}

export function InventoryHealthCard({
  rows,
  mode,
  threshold,
  isLoading,
  isError = false,
  errorMessage,
}: {
  rows: InventoryHealthRow[];
  mode: "intelligent" | "static";
  threshold: number | null;
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
}) {
  const stockoutCount = rows.filter((r) => r.stock_status === "stockout").length;
  const criticalCount = rows.filter((r) => r.stock_status === "critical").length;
  const reorderCount = rows.filter((r) => r.stock_status === "reorder").length;

  const headlineLabel = mode === "intelligent"
    ? "Inventory intelligence"
    : `Low stock (\u2264 ${threshold ?? 3})`;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-medium">{headlineLabel}</h2>
        <Link to="/parts/inventory" className="text-xs text-primary underline-offset-2 hover:underline">
          Inventory
        </Link>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage ?? "Inventory health failed to load."}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">All inventory levels healthy.</p>
      ) : (
        <>
          {mode === "intelligent" && (
            <div className="flex gap-4 mb-3 text-xs">
              {stockoutCount > 0 && (
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                  <span className="font-semibold tabular-nums">{stockoutCount}</span>
                  <span className="text-muted-foreground">stockout</span>
                </div>
              )}
              {criticalCount > 0 && (
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                  <span className="font-semibold tabular-nums">{criticalCount}</span>
                  <span className="text-muted-foreground">critical</span>
                </div>
              )}
              {reorderCount > 0 && (
                <div className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="font-semibold tabular-nums">{reorderCount}</span>
                  <span className="text-muted-foreground">reorder</span>
                </div>
              )}
            </div>
          )}

          <ul className="space-y-1.5 text-xs max-h-52 overflow-y-auto">
            {rows.map((r) => (
              <li
                key={r.inventory_id}
                className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b border-border/40 pb-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StockStatusBadge status={r.stock_status} />
                  <span className="font-mono truncate">{r.part_number}</span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                  <span>{r.branch_id}</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {r.qty_on_hand} ea
                  </span>
                  {r.reorder_point != null && (
                    <span className="text-[10px]">
                      ROP {r.reorder_point}
                    </span>
                  )}
                  {r.days_until_stockout != null && (
                    <span className={`text-[10px] font-medium tabular-nums ${
                      r.days_until_stockout <= 3
                        ? "text-red-600 dark:text-red-400"
                        : r.days_until_stockout <= 7
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }`}>
                      ~{r.days_until_stockout}d
                    </span>
                  )}
                </div>

                {mode === "intelligent" && r.consumption_velocity != null && r.consumption_velocity > 0 && (
                  <div className="w-full text-[10px] text-muted-foreground pl-5">
                    {r.consumption_velocity.toFixed(2)}/day
                    {r.avg_lead_time_days != null && ` · ${r.avg_lead_time_days.toFixed(0)}d lead`}
                    {r.economic_order_qty != null && r.economic_order_qty > 1 && ` · EOQ ${r.economic_order_qty}`}
                  </div>
                )}
                {(r.stock_status === "stockout" || r.stock_status === "critical") && (
                  <div className="w-full pl-5 mt-0.5">
                    <PartCrossRefPanel partNumber={r.part_number} branchId={r.branch_id} compact />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
