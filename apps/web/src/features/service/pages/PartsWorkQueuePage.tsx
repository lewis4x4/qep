import { useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { usePartsQueue } from "../hooks/usePartsQueue";
import { PartsQueueBucket } from "../components/PartsQueueBucket";
import type { PartsQueueItem } from "../hooks/usePartsQueue";

function bucketize(items: PartsQueueItem[]) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

  const machineDown: PartsQueueItem[] = [];
  const pullNow: PartsQueueItem[] = [];
  const orderNow: PartsQueueItem[] = [];
  const waitingVendor: PartsQueueItem[] = [];
  const receivingToday: PartsQueueItem[] = [];
  const stageForTomorrow: PartsQueueItem[] = [];
  const other: PartsQueueItem[] = [];

  for (const item of items) {
    const isMD = item.job?.status_flags?.includes("machine_down");
    if (isMD) { machineDown.push(item); continue; }

    const latestAction = item.actions?.find((a) => !a.completed_at);

    switch (item.status) {
      case "pending":
      case "picking":
        pullNow.push(item);
        break;
      case "ordering":
        if (latestAction?.expected_date?.slice(0, 10) === today) {
          receivingToday.push(item);
        } else if (latestAction?.po_reference) {
          waitingVendor.push(item);
        } else {
          orderNow.push(item);
        }
        break;
      case "received":
        if (item.need_by_date?.slice(0, 10) === tomorrow || item.need_by_date?.slice(0, 10) === today) {
          stageForTomorrow.push(item);
        } else {
          other.push(item);
        }
        break;
      default:
        other.push(item);
    }
  }

  return { machineDown, pullNow, orderNow, waitingVendor, receivingToday, stageForTomorrow, other };
}

export function PartsWorkQueuePage() {
  const { data: items = [], isLoading } = usePartsQueue();
  const qc = useQueryClient();

  const buckets = useMemo(() => bucketize(items), [items]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Table not in generated types until next type generation
      const result: { error: { message: string } | null } = await (supabase as any)
        .from("service_parts_requirements")
        .update({ status })
        .eq("id", id);
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  const handleAction = useCallback(
    (requirementId: string, action: string) => {
      const statusMap: Record<string, string> = {
        pick: "picking",
        receive: "received",
        stage: "staged",
      };
      const newStatus = statusMap[action];
      if (newStatus) updateStatus.mutate({ id: requirementId, status: newStatus });
    },
    [updateStatus],
  );

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parts Work Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Queue-driven parts workflow — {items.length} active items
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12 italic">No active parts requirements</p>
      ) : (
        <div className="space-y-4">
          <PartsQueueBucket title="Machine-Down Critical" items={buckets.machineDown} accentColor="bg-red-100" onAction={handleAction} />
          <PartsQueueBucket title="Pull Now" items={buckets.pullNow} accentColor="bg-blue-100" onAction={handleAction} />
          <PartsQueueBucket title="Order Now" items={buckets.orderNow} accentColor="bg-amber-100" onAction={handleAction} />
          <PartsQueueBucket title="Waiting on Vendor" items={buckets.waitingVendor} accentColor="bg-orange-100" onAction={handleAction} />
          <PartsQueueBucket title="Receiving Today" items={buckets.receivingToday} accentColor="bg-green-100" onAction={handleAction} />
          <PartsQueueBucket title="Stage for Tomorrow" items={buckets.stageForTomorrow} accentColor="bg-lime-100" onAction={handleAction} />
          <PartsQueueBucket title="Other" items={buckets.other} onAction={handleAction} />
        </div>
      )}
    </div>
  );
}
