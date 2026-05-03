import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  normalizeInventoryHealthRows,
  type InventoryHealthRow,
} from "../lib/parts-row-normalizers";

const FALLBACK_LOW_STOCK_THRESHOLD = 3;

export type { InventoryHealthRow, StockStatus } from "../lib/parts-row-normalizers";

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
        const rows = normalizeInventoryHealthRows(viewData).map((r) => {
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

      const legacyRows = normalizeInventoryHealthRows(data).map((r): InventoryHealthRow => ({
        ...r,
        reorder_point: FALLBACK_LOW_STOCK_THRESHOLD,
        stock_status: r.qty_on_hand <= 0 ? "stockout" : "critical",
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
