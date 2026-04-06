import { useMemo, useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokePartsManager } from "../lib/api";
import { usePartsQueue } from "../hooks/usePartsQueue";
import { PartsQueueBucket } from "../components/PartsQueueBucket";
import type { PartsQueueItem } from "../hooks/usePartsQueue";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ServiceSubNav } from "../components/ServiceSubNav";

function latestBin(item: PartsQueueItem): string {
  const rows = item.staging ?? [];
  if (rows.length === 0) return "";
  const sorted = [...rows].sort((a, b) =>
    String(b.staged_at).localeCompare(String(a.staged_at)),
  );
  return sorted[0]?.bin_location?.trim() ?? "";
}

function sortByBinThenPart(items: PartsQueueItem[]) {
  return [...items].sort((a, b) => {
    const ba = latestBin(a);
    const bb = latestBin(b);
    if (ba !== bb) return ba.localeCompare(bb);
    return a.part_number.localeCompare(b.part_number);
  });
}

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

  return {
    machineDown: sortByBinThenPart(machineDown),
    pullNow: sortByBinThenPart(pullNow),
    orderNow: sortByBinThenPart(orderNow),
    waitingVendor: sortByBinThenPart(waitingVendor),
    receivingToday: sortByBinThenPart(receivingToday),
    stageForTomorrow: sortByBinThenPart(stageForTomorrow),
    other: sortByBinThenPart(other),
  };
}

export function PartsWorkQueuePage() {
  const { data: items = [], isLoading } = usePartsQueue();
  const qc = useQueryClient();
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [pendingRequirementId, setPendingRequirementId] = useState<string | null>(null);
  const [binValue, setBinValue] = useState("STAGING-A");

  const buckets = useMemo(() => bucketize(items), [items]);

  const fulfill = useMutation({
    mutationFn: async (opts: {
      requirementId: string;
      action: string;
      bin?: string;
    }) => {
      const map: Record<string, string> = {
        pick: "pick",
        receive: "receive",
        stage: "stage",
      };
      const a = map[opts.action];
      if (!a) throw new Error("Unknown action");
      const body: Record<string, unknown> = {
        action: a,
        requirement_id: opts.requirementId,
      };
      if (opts.action === "stage" && opts.bin) body.bin_location = opts.bin;
      return invokePartsManager(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
    },
  });

  const handleAction = useCallback(
    (requirementId: string, action: string) => {
      if (action === "stage") {
        setPendingRequirementId(requirementId);
        setBinValue("STAGING-A");
        setStageDialogOpen(true);
        return;
      }
      fulfill.mutate({ requirementId, action });
    },
    [fulfill],
  );

  const confirmStage = useCallback(() => {
    const id = pendingRequirementId;
    const bin = binValue.trim();
    if (!id || !bin) return;
    setStageDialogOpen(false);
    setPendingRequirementId(null);
    fulfill.mutate({ requirementId: id, action: "stage", bin });
  }, [pendingRequirementId, binValue, fulfill]);

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <ServiceSubNav />
      <main aria-labelledby="parts-work-queue-title" className="space-y-6">
      <div>
        <h1 id="parts-work-queue-title" className="text-2xl font-semibold tracking-tight">
          Parts Work Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Queue-driven parts workflow — {items.length} active items
        </p>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-20"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading parts queue</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12 italic">No active parts requirements</p>
      ) : (
        <div className="space-y-4">
          <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Stage to bin</DialogTitle>
              </DialogHeader>
              <label className="text-sm text-muted-foreground block">
                Bin location
                <input
                  value={binValue}
                  onChange={(e) => setBinValue(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. STAGING-A"
                  autoFocus
                />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStageDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={confirmStage} disabled={!binValue.trim()}>
                  Stage
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <PartsQueueBucket title="Machine-Down Critical" items={buckets.machineDown} accentColor="bg-red-100" onAction={handleAction} />
          <PartsQueueBucket title="Pull Now" items={buckets.pullNow} accentColor="bg-blue-100" onAction={handleAction} />
          <PartsQueueBucket title="Order Now" items={buckets.orderNow} accentColor="bg-amber-100" onAction={handleAction} />
          <PartsQueueBucket title="Waiting on Vendor" items={buckets.waitingVendor} accentColor="bg-orange-100" onAction={handleAction} />
          <PartsQueueBucket title="Receiving Today" items={buckets.receivingToday} accentColor="bg-green-100" onAction={handleAction} />
          <PartsQueueBucket title="Stage for Tomorrow" items={buckets.stageForTomorrow} accentColor="bg-lime-100" onAction={handleAction} />
          <PartsQueueBucket title="Other" items={buckets.other} onAction={handleAction} />
        </div>
      )}
      </main>
    </div>
  );
}
