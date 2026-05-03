import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { normalizePartActivityRows, type PartActivityRow } from "../lib/parts-row-normalizers";

export type { PartActivityRow } from "../lib/parts-row-normalizers";

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

      return normalizePartActivityRows(data);
    },
  });
}
