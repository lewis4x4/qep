import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { normalizeReplenishQueueRows, type ReplenishQueueRow } from "../lib/parts-row-normalizers";

export type { ReplenishQueueRow } from "../lib/parts-row-normalizers";

export interface ReplenishSummary {
  rows: ReplenishQueueRow[];
  pendingCount: number;
  autoApprovedCount: number;
  totalEstimated: number;
}

export function useReplenishQueue() {
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;

  return useQuery<ReplenishSummary>({
    queryKey: ["replenish-queue", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: async () => {
      if (!workspaceId) {
        return { rows: [], pendingCount: 0, autoApprovedCount: 0, totalEstimated: 0 };
      }
      let rows: ReplenishQueueRow[] = [];

      try {
        const { data, error } = await supabase
          .from("parts_auto_replenish_queue")
          .select(`
            *,
            vendor_profiles!parts_auto_replenish_queue_selected_vendor_id_fkey ( name )
          `)
          .eq("workspace_id", workspaceId)
          .in("status", ["pending", "auto_approved"])
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        rows = normalizeReplenishQueueRows(data);
      } catch {
        const { data, error } = await supabase
          .from("parts_auto_replenish_queue")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in("status", ["pending", "auto_approved"])
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        rows = normalizeReplenishQueueRows(data);
      }

      const pendingCount = rows.filter((r) => r.status === "pending").length;
      const autoApprovedCount = rows.filter((r) => r.status === "auto_approved").length;
      const totalEstimated = rows.reduce(
        (s, r) => s + (r.estimated_total ?? 0),
        0,
      );

      return { rows, pendingCount, autoApprovedCount, totalEstimated };
    },
  });
}

export function useApproveReplenish() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (opts: { id: string; action: "approve" | "reject"; reason?: string }) => {
      if (opts.action === "approve") {
        const { error } = await supabase
          .from("parts_auto_replenish_queue")
          .update({
            status: "approved",
            approved_at: new Date().toISOString(),
          })
          .eq("id", opts.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("parts_auto_replenish_queue")
          .update({
            status: "rejected",
            rejection_reason: opts.reason ?? "Manually rejected",
          })
          .eq("id", opts.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["replenish-queue"] });
    },
  });
}
