import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { normalizeCustomerPartsIntel, type CustomerPartsIntel } from "../lib/parts-row-normalizers";

export type { CustomerPartsIntel } from "../lib/parts-row-normalizers";

export function useCustomerPartsIntel(companyId: string | undefined) {
  return useQuery<CustomerPartsIntel | null>({
    queryKey: ["customer-parts-intel", companyId],
    enabled: !!companyId,
    staleTime: 120_000,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("customer_parts_intelligence")
          .select("*")
          .eq("crm_company_id", companyId!)
          .maybeSingle();

        if (error) throw error;
        return normalizeCustomerPartsIntel(data);
      } catch {
        return null;
      }
    },
  });
}
