import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { normalizeTransferRecommendations, type TransferRecommendation } from "../lib/parts-row-normalizers";

export type { TransferRecommendation } from "../lib/parts-row-normalizers";

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

        const rows = normalizeTransferRecommendations(data);
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
