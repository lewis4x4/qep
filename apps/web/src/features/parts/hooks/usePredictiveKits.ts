import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { normalizePredictiveKits, type PredictiveKit } from "../lib/parts-row-normalizers";

export type { PredictiveKit } from "../lib/parts-row-normalizers";

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

        kits = normalizePredictiveKits(data);
      } catch {
        const { data, error } = await supabase
          .from("parts_predictive_kits")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in("status", ["suggested", "staged"])
          .order("confidence", { ascending: false })
          .limit(30);
        if (error) throw error;
        kits = normalizePredictiveKits(data);
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
