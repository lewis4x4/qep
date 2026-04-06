import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const LOW_STOCK_THRESHOLD = 3;

export function useInventoryHealth() {
  return useQuery({
    queryKey: ["parts-inventory-health", LOW_STOCK_THRESHOLD],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("id, branch_id, part_number, qty_on_hand, bin_location")
        .is("deleted_at", null)
        .lte("qty_on_hand", LOW_STOCK_THRESHOLD)
        .order("qty_on_hand")
        .limit(50);
      if (error) throw error;
      return { rows: data ?? [], threshold: LOW_STOCK_THRESHOLD };
    },
    staleTime: 60_000,
  });
}
