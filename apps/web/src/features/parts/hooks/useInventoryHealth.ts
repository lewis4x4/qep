import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const FALLBACK_LOW_STOCK_THRESHOLD = 3;

export type StockStatus = "stockout" | "critical" | "reorder" | "healthy" | "no_profile";

export interface InventoryHealthRow {
  inventory_id: string;
  workspace_id: string;
  branch_id: string;
  part_number: string;
  qty_on_hand: number;
  bin_location: string | null;
  catalog_id: string | null;
  reorder_point: number | null;
  safety_stock: number | null;
  economic_order_qty: number | null;
  consumption_velocity: number | null;
  avg_lead_time_days: number | null;
  reorder_computed_at: string | null;
  stock_status: StockStatus;
  days_until_stockout: number | null;
}

export function useInventoryHealth() {
  return useQuery({
    queryKey: ["parts-inventory-health-intelligent"],
    queryFn: async () => {
      // Try the intelligent view first (requires migration 136)
      const { data: viewData, error: viewError } = await supabase
        .from("parts_inventory_reorder_status")
        .select("*")
        .in("stock_status", ["stockout", "critical", "reorder", "no_profile"])
        .order("stock_status")
        .limit(50);

      if (!viewError && viewData && viewData.length > 0) {
        const rows = (viewData as InventoryHealthRow[]).map((r) => {
          if (r.stock_status === "no_profile" && r.qty_on_hand > FALLBACK_LOW_STOCK_THRESHOLD) {
            return null;
          }
          return r;
        }).filter((r): r is InventoryHealthRow => r !== null);

        return {
          rows,
          mode: "intelligent" as const,
          threshold: null,
        };
      }

      // Fallback: static threshold (pre-migration-136)
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("id, branch_id, part_number, qty_on_hand, bin_location")
        .is("deleted_at", null)
        .lte("qty_on_hand", FALLBACK_LOW_STOCK_THRESHOLD)
        .order("qty_on_hand")
        .limit(50);
      if (error) throw error;

      const legacyRows: InventoryHealthRow[] = (data ?? []).map((r) => ({
        inventory_id: r.id,
        workspace_id: "",
        branch_id: r.branch_id,
        part_number: r.part_number,
        qty_on_hand: r.qty_on_hand,
        bin_location: r.bin_location,
        catalog_id: null,
        reorder_point: FALLBACK_LOW_STOCK_THRESHOLD,
        safety_stock: null,
        economic_order_qty: null,
        consumption_velocity: null,
        avg_lead_time_days: null,
        reorder_computed_at: null,
        stock_status: r.qty_on_hand <= 0 ? "stockout" : "critical",
        days_until_stockout: null,
      }));

      return {
        rows: legacyRows,
        mode: "static" as const,
        threshold: FALLBACK_LOW_STOCK_THRESHOLD,
      };
    },
    staleTime: 60_000,
  });
}
