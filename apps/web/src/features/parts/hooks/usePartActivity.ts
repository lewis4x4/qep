import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PartActivityRow = {
  id: string;
  order_id: string;
  order_status: string;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  created_at: string;
  customer_label: string | null;
};

export function usePartActivity(partNumber: string | null | undefined) {
  return useQuery({
    queryKey: ["parts-catalog-activity", partNumber?.toLowerCase() ?? null],
    enabled: !!partNumber,
    staleTime: 60_000,
    queryFn: async () => {
      if (!partNumber) return [] as PartActivityRow[];
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const { data, error } = await supabase
        .from("parts_order_lines")
        .select(
          `
          id,
          quantity,
          unit_price,
          line_total,
          created_at,
          part_number,
          parts_order_id,
          parts_orders!inner (
            id,
            status,
            created_at,
            portal_customers ( first_name, last_name ),
            crm_companies ( name )
          )
        `,
        )
        .eq("part_number", partNumber)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<{
        id: string;
        quantity: number;
        unit_price: number | null;
        line_total: number | null;
        created_at: string;
        parts_order_id: string;
        parts_orders: {
          id: string;
          status: string;
          created_at: string;
          portal_customers: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null;
          crm_companies: { name: string } | Array<{ name: string }> | null;
        };
      }>;

      return rows.map((r): PartActivityRow => {
        const pc = Array.isArray(r.parts_orders.portal_customers)
          ? r.parts_orders.portal_customers[0] ?? null
          : r.parts_orders.portal_customers;
        const cc = Array.isArray(r.parts_orders.crm_companies)
          ? r.parts_orders.crm_companies[0] ?? null
          : r.parts_orders.crm_companies;
        const label = cc?.name
          ?? (pc ? `${pc.first_name ?? ""} ${pc.last_name ?? ""}`.trim() || null : null);
        return {
          id: r.id,
          order_id: r.parts_orders.id,
          order_status: r.parts_orders.status,
          quantity: Number(r.quantity) || 0,
          unit_price: r.unit_price != null ? Number(r.unit_price) : null,
          line_total: r.line_total != null ? Number(r.line_total) : null,
          created_at: r.created_at,
          customer_label: label,
        };
      });
    },
  });
}
