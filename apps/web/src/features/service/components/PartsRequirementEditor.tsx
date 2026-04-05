import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  invokePartsManager,
  planPartsFulfillment,
  populatePartsFromJobCode,
  resyncPartsFromJobCode,
} from "../lib/api";

interface Props {
  jobId: string;
  selectedJobCodeId: string | null;
}

export function PartsRequirementEditor({ jobId, selectedJobCodeId }: Props) {
  const qc = useQueryClient();
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState(1);

  const addPart = useMutation({
    mutationFn: () =>
      invokePartsManager({
        action: "add",
        job_id: jobId,
        part_number: partNumber,
        quantity: qty,
        source: "manual",
      }),
    onSuccess: () => {
      setPartNumber("");
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const populate = useMutation({
    mutationFn: () => populatePartsFromJobCode(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const plan = useMutation({
    mutationFn: () => planPartsFulfillment(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  const resync = useMutation({
    mutationFn: (mode: "replace_cancelled_only" | "full") =>
      resyncPartsFromJobCode(jobId, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-job", jobId] });
      qc.invalidateQueries({ queryKey: ["parts-queue"] });
    },
  });

  return (
    <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Parts Lines</h3>
      <div className="flex flex-wrap gap-2">
        {selectedJobCodeId && (
          <button
            type="button"
            onClick={() => populate.mutate()}
            disabled={populate.isPending}
            className="text-xs px-2 py-1 rounded bg-secondary hover:bg-secondary/80"
          >
            {populate.isPending ? "Loading…" : "Load from job code"}
          </button>
        )}
        <button
          type="button"
          onClick={() => plan.mutate()}
          disabled={plan.isPending}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {plan.isPending ? "Planning…" : "Plan fulfillment"}
        </button>
        {selectedJobCodeId && (
          <>
            <button
              type="button"
              onClick={() => resync.mutate("replace_cancelled_only")}
              disabled={resync.isPending}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
            >
              {resync.isPending ? "Resync…" : "Resync from job code"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Cancel open lines and re-load full template from job code?")) {
                  resync.mutate("full");
                }
              }}
              disabled={resync.isPending}
              className="text-xs px-2 py-1 rounded border border-amber-600/50 text-amber-900 dark:text-amber-200"
            >
              Full replace
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Part #</label>
          <input
            value={partNumber}
            onChange={(e) => setPartNumber(e.target.value)}
            className="block w-full min-w-[140px] rounded border px-2 py-1 text-sm"
            placeholder="SKU"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Qty</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="block w-20 rounded border px-2 py-1 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => addPart.mutate()}
          disabled={!partNumber.trim() || addPart.isPending}
          className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground"
        >
          Add line
        </button>
      </div>
      {addPart.isError && (
        <p className="text-xs text-destructive">{(addPart.error as Error).message}</p>
      )}
    </div>
  );
}
