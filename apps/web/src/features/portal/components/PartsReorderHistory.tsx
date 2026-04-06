import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { History, RotateCcw, Package } from "lucide-react";

interface RecentLineItem {
  part_number?: string;
  quantity?: number;
  description?: string;
  unit_price?: number;
}

interface MachineHistoryRow {
  fleet_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  last_ordered_at: string | null;
  total_orders: number;
  recent_line_items:
    | Array<{ li: RecentLineItem[] | RecentLineItem; created_at: string }>
    | null;
}

interface PartsReorderHistoryProps {
  /** Optional: if set, show only history for this fleet id. */
  fleetFilterId?: string;
  /** Called when the user clicks "Reorder" on a past line item. */
  onReorder: (lineItems: Array<{ part_number: string; quantity: number; description?: string }>) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Safely coerce the recent_line_items shape from the RPC. */
function extractLineItems(row: MachineHistoryRow): RecentLineItem[] {
  if (!row.recent_line_items || !Array.isArray(row.recent_line_items)) return [];
  const flat: RecentLineItem[] = [];
  for (const orderEntry of row.recent_line_items) {
    const li = orderEntry?.li;
    if (Array.isArray(li)) {
      flat.push(...(li as RecentLineItem[]));
    } else if (li && typeof li === "object") {
      flat.push(li as RecentLineItem);
    }
  }
  return flat;
}

export function PartsReorderHistory({ fleetFilterId, onReorder }: PartsReorderHistoryProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "parts-history"],
    queryFn: portalApi.getPartsHistory,
    staleTime: 60_000,
  });

  const allRows = (data?.history ?? []) as unknown as MachineHistoryRow[];
  const rows = fleetFilterId ? allRows.filter((r) => r.fleet_id === fleetFilterId) : allRows;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-qep-orange" aria-hidden />
        <h3 className="text-sm font-bold text-foreground">
          {fleetFilterId ? "Reorder History for This Machine" : "Reorder History by Machine"}
        </h3>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-20 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-xs text-red-400">Failed to load parts history.</p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No previous parts orders for {fleetFilterId ? "this machine" : "any of your equipment"} yet. Your order history will appear here for quick reorder.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const lineItems = extractLineItems(row);
          const hasLineItems = lineItems.length > 0;
          return (
            <div key={row.fleet_id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {row.make} {row.model}{row.year ? ` (${row.year})` : ""}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {row.serial_number && <span>S/N: {row.serial_number}</span>}
                    <span>{row.total_orders} order{row.total_orders === 1 ? "" : "s"}</span>
                    <span>Last: {formatDate(row.last_ordered_at)}</span>
                  </div>
                </div>
                {hasLineItems && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] shrink-0"
                    onClick={() => {
                      const normalized = lineItems
                        .filter((li) => li.part_number)
                        .map((li) => ({
                          part_number: String(li.part_number ?? ""),
                          quantity: Math.max(1, Number(li.quantity ?? 1)),
                          description: li.description,
                        }));
                      if (normalized.length > 0) onReorder(normalized);
                    }}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" aria-hidden />
                    Reorder recent
                  </Button>
                )}
              </div>

              {/* Recent line items preview */}
              {hasLineItems && (
                <div className="mt-2 rounded border border-border/40 bg-muted/20 p-2">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    Most recent items
                  </p>
                  <ul className="space-y-0.5">
                    {lineItems.slice(0, 4).map((li, i) => (
                      <li key={i} className="flex items-center justify-between text-[10px]">
                        <span className="flex items-center gap-1 text-foreground truncate">
                          <Package className="h-2.5 w-2.5 text-muted-foreground shrink-0" aria-hidden />
                          <span className="truncate">
                            {li.part_number ?? "—"}
                            {li.description ? ` · ${li.description}` : ""}
                          </span>
                        </span>
                        <span className="text-muted-foreground ml-2">
                          ×{li.quantity ?? 1}
                        </span>
                      </li>
                    ))}
                    {lineItems.length > 4 && (
                      <li className="text-[10px] italic text-muted-foreground">
                        +{lineItems.length - 4} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
