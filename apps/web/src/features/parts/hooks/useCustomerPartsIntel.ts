import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CustomerPartsIntel {
  id: string;
  crm_company_id: string;
  total_spend_12m: number;
  total_spend_prior_12m: number;
  spend_trend: string;
  monthly_spend: Array<{ month: string; revenue: number }>;
  order_count_12m: number;
  avg_order_value: number;
  last_order_date: string | null;
  days_since_last_order: number | null;
  fleet_count: number;
  machines_approaching_service: number;
  predicted_next_quarter_spend: number;
  top_categories: Array<{ category: string; revenue: number; pct: number }>;
  churn_risk: string;
  recommended_outreach: string | null;
  opportunity_value: number;
  computed_at: string;
}

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
        return data as CustomerPartsIntel | null;
      } catch {
        return null;
      }
    },
  });
}
