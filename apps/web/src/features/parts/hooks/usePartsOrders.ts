import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PartsOrderListRow = {
  id: string;
  status: string;
  order_source: string;
  fulfillment_run_id: string | null;
  line_items: unknown;
  created_at: string;
  portal_customer_id: string | null;
  crm_company_id: string | null;
  portal_customers: { first_name: string; last_name: string; email: string } | null;
  crm_companies: { id: string; name: string } | null;
};

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

export function usePartsOrders() {
  return useQuery({
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
      const raw = (data ?? []) as Record<string, unknown>[];
      return raw.map((r) => ({
        ...r,
        portal_customers: one(
          r.portal_customers as PartsOrderListRow["portal_customers"] | unknown[],
        ),
        crm_companies: one(
          r.crm_companies as PartsOrderListRow["crm_companies"] | unknown[],
        ),
      })) as PartsOrderListRow[];
    },
    staleTime: 15_000,
  });
}
