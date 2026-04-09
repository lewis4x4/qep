import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface PredictiveKit {
  id: string;
  fleet_id: string | null;
  crm_company_id: string | null;
  equipment_make: string | null;
  equipment_model: string | null;
  equipment_serial: string | null;
  current_hours: number | null;
  predicted_service_window: string;
  predicted_failure_type: string | null;
  confidence: number;
  kit_parts: Array<{
    part_number: string;
    description: string | null;
    quantity: number;
    unit_cost: number | null;
    in_stock: boolean;
  }>;
  kit_value: number;
  kit_part_count: number;
  stock_status: string;
  parts_in_stock: number;
  parts_total: number;
  status: string;
  nearest_branch_id: string | null;
  created_at: string;
  company_name?: string;
}

export interface PredictiveKitsSummary {
  kits: PredictiveKit[];
  suggestedCount: number;
  allInStockCount: number;
  partialCount: number;
  totalKitValue: number;
}

export function usePredictiveKits() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<PredictiveKitsSummary>({
    queryKey: ["predictive-kits", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!workspaceId) {
        return { kits: [], suggestedCount: 0, allInStockCount: 0, partialCount: 0, totalKitValue: 0 };
      }
      let kits: PredictiveKit[] = [];

      try {
        const { data, error } = await supabase
          .from("parts_predictive_kits")
          .select(`
            *,
            crm_companies!parts_predictive_kits_crm_company_id_fkey ( name )
          `)
          .eq("workspace_id", workspaceId)
          .in("status", ["suggested", "staged"])
          .order("confidence", { ascending: false })
          .limit(30);

        if (error) throw error;

        kits = (data ?? []).map((r) => {
          const co = r.crm_companies as { name?: string } | { name?: string }[] | null;
          const companyName = Array.isArray(co) ? co[0]?.name : co?.name;
          return { ...r, company_name: companyName ?? undefined } as PredictiveKit;
        });
      } catch {
        const { data, error } = await supabase
          .from("parts_predictive_kits")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in("status", ["suggested", "staged"])
          .order("confidence", { ascending: false })
          .limit(30);
        if (error) throw error;
        kits = (data ?? []) as PredictiveKit[];
      }

      const suggestedCount = kits.filter((k) => k.status === "suggested").length;
      const allInStockCount = kits.filter((k) => k.stock_status === "all_in_stock").length;
      const partialCount = kits.filter((k) => k.stock_status === "partial").length;
      const totalKitValue = kits.reduce((s, k) => s + (k.kit_value ?? 0), 0);

      return { kits, suggestedCount, allInStockCount, partialCount, totalKitValue };
    },
  });
}

export function useStageKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kitId: string) => {
      const { error } = await supabase
        .from("parts_predictive_kits")
        .update({ status: "staged" })
        .eq("id", kitId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["predictive-kits"] });
    },
  });
}
