import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";

export interface ReplenishQueueRow {
  id: string;
  workspace_id: string;
  part_number: string;
  branch_id: string;
  qty_on_hand: number;
  reorder_point: number;
  recommended_qty: number;
  economic_order_qty: number | null;
  selected_vendor_id: string | null;
  vendor_score: number | null;
  vendor_selection_reason: string | null;
  estimated_unit_cost: number | null;
  estimated_total: number | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  parts_order_id: string | null;
  rejection_reason: string | null;
  expires_at: string;
  computation_batch_id: string | null;
  created_at: string;
  vendor_name?: string;
}

export interface ReplenishSummary {
  rows: ReplenishQueueRow[];
  pendingCount: number;
  autoApprovedCount: number;
  totalEstimated: number;
}

export function useReplenishQueue() {
  const ws = useMyWorkspaceId();

  return useQuery<ReplenishSummary>({
    queryKey: ["replenish-queue", ws],
    enabled: !!ws,
    staleTime: 30_000,
    queryFn: async () => {
      let rows: ReplenishQueueRow[] = [];

      try {
        const { data, error } = await supabase
          .from("parts_auto_replenish_queue")
          .select(`
            *,
            vendor_profiles!parts_auto_replenish_queue_selected_vendor_id_fkey ( name )
          `)
          .eq("workspace_id", ws!)
          .in("status", ["pending", "auto_approved"])
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        rows = (data ?? []).map((r) => {
          const vp = r.vendor_profiles as { name?: string } | { name?: string }[] | null;
          const vendorName = Array.isArray(vp) ? vp[0]?.name : vp?.name;
          return { ...r, vendor_name: vendorName ?? undefined } as ReplenishQueueRow;
        });
      } catch {
        const { data, error } = await supabase
          .from("parts_auto_replenish_queue")
          .select("*")
          .eq("workspace_id", ws!)
          .in("status", ["pending", "auto_approved"])
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        rows = (data ?? []) as ReplenishQueueRow[];
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
