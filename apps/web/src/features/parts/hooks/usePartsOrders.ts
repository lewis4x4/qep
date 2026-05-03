import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { normalizePartsOrderListRows, type PartsOrderListRow } from "../lib/parts-row-normalizers";

export type { PartsOrderListRow } from "../lib/parts-row-normalizers";

export function usePartsOrders() {
  return useQuery<PartsOrderListRow[]>({
    queryKey: ["parts-orders-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_orders")
        .select(
          `
          id,
          status,
          order_source,
          fulfillment_run_id,
          line_items,
          created_at,
          portal_customer_id,
          crm_company_id,
          portal_customers!parts_orders_portal_customer_id_fkey ( first_name, last_name, email ),
          crm_companies!parts_orders_crm_company_id_fkey ( id, name )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return normalizePartsOrderListRows(data);
    },
    staleTime: 15_000,
  });
}
