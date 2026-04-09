import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface TransferRecommendation {
  id: string;
  part_number: string;
  from_branch_id: string;
  to_branch_id: string;
  recommended_qty: number;
  from_qty_on_hand: number;
  to_qty_on_hand: number;
  to_reorder_point: number | null;
  to_forecast_demand: number | null;
  estimated_transfer_cost: number | null;
  estimated_stockout_cost_avoided: number | null;
  net_savings: number | null;
  priority: string;
  confidence: number;
  reason: string;
  status: string;
  created_at: string;
}

export interface TransferSummary {
  rows: TransferRecommendation[];
  pendingCount: number;
  totalSavings: number;
  criticalCount: number;
}

export function useTransferRecommendations() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<TransferSummary>({
    queryKey: ["transfer-recommendations", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: async () => {
      if (!workspaceId) {
        return { rows: [], pendingCount: 0, totalSavings: 0, criticalCount: 0 };
      }
      try {
        const { data, error } = await supabase
          .from("parts_transfer_recommendations")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("status", "pending")
          .order("net_savings", { ascending: false })
          .limit(20);

        if (error) throw error;

        const rows = (data ?? []) as TransferRecommendation[];
        return {
          rows,
          pendingCount: rows.length,
          totalSavings: rows.reduce((s, r) => s + (r.net_savings ?? 0), 0),
          criticalCount: rows.filter((r) => r.priority === "critical" || r.priority === "high").length,
        };
      } catch {
        return { rows: [], pendingCount: 0, totalSavings: 0, criticalCount: 0 };
      }
    },
  });
}

export function useApproveTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("parts_transfer_recommendations")
        .update({
          status: action,
          ...(action === "approved" ? { approved_at: new Date().toISOString() } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfer-recommendations"] });
    },
  });
}
